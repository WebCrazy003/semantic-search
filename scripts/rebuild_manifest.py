# scripts/rebuild_manifest.py
"""Regenerate the SQLite manifest from Qdrant.

Run this if the manifest is deleted or out of step with the collection. It proves the
manifest is a cache: everything in it can be recomputed from the vector store.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from qdrant_client import QdrantClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.services.manifest_service import DocumentRecord, ManifestService  # noqa: E402
from app.services.qdrant_service import QdrantService  # noqa: E402


def main() -> int:
    settings = get_settings()
    qdrant = QdrantService(
        client=QdrantClient(url=settings.qdrant_url, timeout=settings.qdrant_timeout),
        collection=settings.qdrant_collection,
        vector_size=settings.vector_size,
    )
    if not qdrant.collection_exists():
        print(f"FAIL  collection '{settings.qdrant_collection}' does not exist")
        return 1

    chunks: dict[str, int] = defaultdict(int)
    pages: dict[str, int] = defaultdict(int)
    info: dict[str, dict[str, object]] = {}

    for payload in qdrant.iter_document_payloads():
        document_id = str(payload.get("document_id", ""))
        if not document_id:
            continue
        chunks[document_id] += 1
        pages[document_id] = max(pages[document_id], int(payload.get("page_end", 0)))
        info.setdefault(document_id, payload)

    now = datetime.now(tz=UTC)
    records = []
    for document_id, payload in info.items():
        filepath = str(payload.get("filepath", ""))
        size = Path(filepath).stat().st_size if filepath and Path(filepath).exists() else 0
        records.append(
            DocumentRecord(
                document_id=document_id,
                filename=str(payload.get("filename", "")),
                filepath=filepath,
                file_hash=document_id,
                file_size=size,
                modified_at=now,
                pages=pages[document_id],
                chunks=chunks[document_id],
                language=payload.get("language"),  # type: ignore[arg-type]
                title=None,
                status="indexed",
                error_type=None,
                error_message=None,
                indexed_at=now,
                alt_filepaths=[],
            )
        )

    manifest = ManifestService(settings.manifest_path)
    manifest.initialise()
    manifest.replace_all(records)
    manifest.close()
    print(f"OK    rebuilt manifest with {len(records)} documents, {sum(chunks.values())} chunks")
    print("      modified_at and title are reset; the next index run restores them")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
