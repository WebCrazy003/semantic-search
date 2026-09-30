# scripts/rebuild_manifest.py
"""Regenerate the SQLite manifest from Qdrant.

Run this if the manifest is deleted or out of step with the collection. It proves the
manifest is a cache: everything in it can be recomputed from the vector store.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import get_settings  # noqa: E402
from app.deps import build_qdrant_client  # noqa: E402
from app.services.access_store import AccessStore  # noqa: E402
from app.services.manifest_service import DocumentRecord, ManifestService  # noqa: E402
from app.services.ownership import LIBRARY, PRIVATE, PUBLIC, owner_for  # noqa: E402
from app.services.qdrant_service import QdrantService  # noqa: E402


def records_from_payloads(
    payloads: Iterable[dict[str, object]], documents_dir: Path, public_ids: set[str]
) -> list[DocumentRecord]:
    """One manifest row per document found in the passage store.

    Owner and visibility come from the payload. A point from before accounts existed
    has neither, so the owner falls back to where the file lives and the visibility to
    the list of public documents, which is kept outside the index.
    """
    chunks: dict[str, int] = defaultdict(int)
    pages: dict[str, int] = defaultdict(int)
    info: dict[str, dict[str, object]] = {}

    for payload in payloads:
        document_id = str(payload.get("document_id", ""))
        if not document_id:
            continue
        chunks[document_id] += 1
        pages[document_id] = max(pages[document_id], int(payload.get("page_end", 0) or 0))
        info.setdefault(document_id, payload)

    now = datetime.now(tz=UTC)
    records = []
    for document_id, payload in info.items():
        filepath = str(payload.get("filepath", ""))
        size = Path(filepath).stat().st_size if filepath and Path(filepath).exists() else 0
        owner = payload.get("owner_id") or owner_for(Path(filepath), documents_dir) or LIBRARY
        visibility = payload.get("visibility") or (
            PUBLIC if document_id in public_ids else PRIVATE
        )
        records.append(
            DocumentRecord(
                document_id=document_id,
                filename=str(payload.get("filename", "")),
                filepath=filepath,
                file_hash=str(payload.get("file_hash") or document_id),
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
                owner_id=str(owner),
                visibility=str(visibility),
            )
        )
    return records


def main() -> int:
    settings = get_settings()
    # With an embedded store this needs the application stopped: single writer.
    qdrant = QdrantService(
        client=build_qdrant_client(settings),
        collection=settings.qdrant_collection,
        vector_size=settings.vector_size,
    )
    if not qdrant.collection_exists():
        print(f"FAIL  collection '{settings.qdrant_collection}' does not exist")
        return 1

    access = AccessStore(settings.access_db_path)
    access.initialise()
    records = records_from_payloads(
        qdrant.iter_document_payloads(),
        documents_dir=settings.pdf_directory,
        public_ids=access.public_ids(),
    )
    access.close()

    manifest = ManifestService(settings.manifest_path)
    manifest.initialise()
    manifest.replace_all(records)
    manifest.close()
    passages = sum(record.chunks for record in records)
    print(f"OK    rebuilt manifest with {len(records)} documents, {passages} chunks")
    print("      modified_at and title are reset; the next index run restores them")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
