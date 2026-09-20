# backend/app/api/documents.py
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.deps import Container, get_container
from app.models.response_models import DocumentSummary

router = APIRouter(tags=["documents"])


@router.get("/documents", response_model=list[DocumentSummary])
def list_documents(
    status: str | None = Query(default=None, description="indexed, skipped, failed, unsupported"),
    container: Container = Depends(get_container),
) -> list[DocumentSummary]:
    """Read from the manifest, not from Qdrant.

    A scroll over the passage collection would be O(passages); this is O(documents) and
    stays fast as the corpus grows.
    """
    records = container.manifest.all_documents()
    if status is not None:
        records = [record for record in records if record.status == status]
    return [
        DocumentSummary(
            document_id=record.document_id,
            filename=record.filename,
            filepath=record.filepath,
            pages=record.pages,
            chunks=record.chunks,
            language=record.language,
            title=record.title,
            status=record.status,
            indexed_at=record.indexed_at,
        )
        for record in records
    ]
