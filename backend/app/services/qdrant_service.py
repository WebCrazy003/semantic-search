# backend/app/services/qdrant_service.py
"""Qdrant access: one collection, one point per passage.

Point IDs are a UUIDv5 of "document_id:chunk_index", so re-indexing a document
overwrites exactly its own points. An interrupted indexing run is therefore safe to
repeat, and a retry cannot leave duplicates behind.
"""

from __future__ import annotations

import uuid
import warnings
from collections.abc import Iterator
from typing import Any

from qdrant_client import QdrantClient, models

from app.logging_config import get_logger
from app.models.domain import Chunk, DocumentMeta
from app.models.request_models import SearchFilters
from app.models.response_models import SearchHit

logger = get_logger("qdrant")

# Fixed namespace: changing it orphans every existing point, so never change it.
_POINT_NAMESPACE = uuid.UUID("1b4d8c0a-3e6f-4a2b-9c7d-5f8e1a2b3c4d")

_INDEXED_PAYLOAD_FIELDS = ("document_id", "filename", "language")
_SUMMARY_FIELDS = [
    "document_id",
    "filename",
    "filepath",
    "page_start",
    "page_end",
    "chunk_index",
    "language",
]


def point_id_for(document_id: str, chunk_index: int) -> str:
    return str(uuid.uuid5(_POINT_NAMESPACE, f"{document_id}:{chunk_index}"))


class QdrantService:
    def __init__(
        self,
        client: QdrantClient,
        collection: str,
        vector_size: int = 1024,
        upsert_batch: int = 128,
    ) -> None:
        self._client = client
        self._collection = collection
        self._vector_size = vector_size
        self._upsert_batch = upsert_batch

    # ------------------------------------------------------------- collection

    def collection_exists(self) -> bool:
        return bool(self._client.collection_exists(self._collection))

    def ensure_collection(self) -> None:
        if self.collection_exists():
            self._verify_vector_size()
        else:
            self._client.create_collection(
                collection_name=self._collection,
                vectors_config=models.VectorParams(
                    size=self._vector_size, distance=models.Distance.COSINE
                ),
            )
            logger.info(
                "created collection %s (size=%d, distance=cosine)",
                self._collection,
                self._vector_size,
            )
        self._ensure_payload_indexes()

    def recreate_collection(self) -> None:
        """Drop the collection and build an empty one with the same configuration.

        Cheaper and more certain than deleting points one document at a time, and it
        leaves the payload indexes in place.
        """
        if self.collection_exists():
            self._client.delete_collection(self._collection)
            logger.info("deleted collection %s", self._collection)
        self.ensure_collection()

    def _verify_vector_size(self) -> None:
        info = self._client.get_collection(self._collection)
        params = info.config.params.vectors
        actual = getattr(params, "size", None)
        if actual is not None and int(actual) != self._vector_size:
            raise RuntimeError(
                f"collection '{self._collection}' has vector size {actual} but this build "
                f"produces {self._vector_size}. Delete the collection or set VECTOR_SIZE."
            )

    def _ensure_payload_indexes(self) -> None:
        for field in _INDEXED_PAYLOAD_FIELDS:
            try:
                with warnings.catch_warnings():
                    # Embedded Qdrant filters by scanning and says so on every call.
                    # Filtering still works, so the warning is noise for an end user.
                    warnings.filterwarnings("ignore", message=".*no effect in the local Qdrant.*")
                    self._client.create_payload_index(
                        collection_name=self._collection,
                        field_name=field,
                        field_schema=models.PayloadSchemaType.KEYWORD,
                    )
            except Exception as exc:
                # Already present, or local mode, which does not need them.
                logger.debug("payload index on %s not created: %s", field, exc)

    # ------------------------------------------------------------------ write

    def upsert_chunks(
        self, chunks: list[Chunk], vectors: list[list[float]], document: DocumentMeta
    ) -> None:
        if len(chunks) != len(vectors):
            raise ValueError(
                f"chunks and vectors must be the same length, got {len(chunks)} and {len(vectors)}"
            )
        if not chunks:
            return

        points = [
            models.PointStruct(
                id=point_id_for(chunk.document_id, chunk.chunk_index),
                vector=vector,
                payload=self._payload(chunk, document),
            )
            for chunk, vector in zip(chunks, vectors, strict=True)
        ]
        for start in range(0, len(points), self._upsert_batch):
            batch = points[start : start + self._upsert_batch]
            self._client.upsert(collection_name=self._collection, points=batch, wait=True)
        logger.info("upserted %d points for %s", len(points), document.filename)

    @staticmethod
    def _payload(chunk: Chunk, document: DocumentMeta) -> dict[str, Any]:
        return {
            # Required by the specification
            "document_id": document.document_id,
            "filename": document.filename,
            "filepath": document.filepath,
            "page_start": chunk.page_start,
            "page_end": chunk.page_end,
            "chunk_index": chunk.chunk_index,
            "text": chunk.text,
            "file_hash": document.file_hash,
            "modified_at": document.modified_at.isoformat(),
            # Optional
            "heading": chunk.heading,
            "token_count": chunk.token_count,
            "language": document.language,
            "title": document.title,
            "folder": document.folder,
            "kind": chunk.kind,
        }

    def delete_document(self, document_id: str) -> None:
        self._client.delete(
            collection_name=self._collection,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="document_id", match=models.MatchValue(value=document_id)
                        )
                    ]
                )
            ),
            wait=True,
        )

    # ------------------------------------------------------------------- read

    def search(
        self, vector: list[float], top_k: int, filters: SearchFilters | None = None
    ) -> list[SearchHit]:
        response = self._client.query_points(
            collection_name=self._collection,
            query=vector,
            limit=top_k,
            query_filter=self._build_filter(filters),
            with_payload=True,
        )
        return [self._to_hit(point) for point in response.points]

    @staticmethod
    def _build_filter(filters: SearchFilters | None) -> models.Filter | None:
        if filters is None or filters.is_empty():
            return None
        conditions = [
            models.FieldCondition(key=key, match=models.MatchValue(value=value))
            for key, value in (
                ("language", filters.language),
                ("document_id", filters.document_id),
            )
            if value is not None
        ]
        return models.Filter(must=conditions)

    @staticmethod
    def _to_hit(point: Any) -> SearchHit:
        payload = point.payload or {}
        return SearchHit(
            score=float(point.score),
            document_id=str(payload.get("document_id", "")),
            filename=str(payload.get("filename", "")),
            filepath=str(payload.get("filepath", "")),
            page_start=int(payload.get("page_start", 0)),
            page_end=int(payload.get("page_end", 0)),
            chunk_index=int(payload.get("chunk_index", 0)),
            heading=payload.get("heading"),
            language=payload.get("language"),
            text=str(payload.get("text", "")),
        )

    def count_points(self) -> int:
        return int(self._client.count(collection_name=self._collection, exact=True).count)

    def iter_document_payloads(self, page_size: int = 512) -> Iterator[dict[str, Any]]:
        """Stream per-point metadata without passage text.

        Used only by scripts/rebuild_manifest.py, which regenerates the SQLite
        manifest from Qdrant, keeping Qdrant the single source of truth.
        """
        offset = None
        while True:
            points, offset = self._client.scroll(
                collection_name=self._collection,
                limit=page_size,
                offset=offset,
                with_payload=_SUMMARY_FIELDS,
                with_vectors=False,
            )
            for point in points:
                yield dict(point.payload or {})
            if offset is None:
                return

    def close(self) -> None:
        self._client.close()
