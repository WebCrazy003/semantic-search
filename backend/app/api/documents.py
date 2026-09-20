# backend/app/api/documents.py
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.deps import Container, get_container
from app.logging_config import get_logger
from app.models.response_models import (
    DocumentSummary,
    RejectedUpload,
    RemovedDocumentResponse,
    UploadResponse,
)

logger = get_logger("api.documents")
router = APIRouter(tags=["documents"])

# Upload limits. A PDF larger than this is far more likely to be a mistake than a
# manual, and the whole file is read into memory before it is written.
_MAX_UPLOAD_BYTES = 200 * 1024 * 1024
_PDF_MAGIC = b"%PDF-"
_UNSAFE = re.compile(r"[^\w.\- ()　-鿿가-힯]", re.UNICODE)


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
            file_size=record.file_size,
            file_hash=record.file_hash,
            modified_at=record.modified_at,
            pages=record.pages,
            chunks=record.chunks,
            language=record.language,
            title=record.title,
            status=record.status,
            error_type=record.error_type,
            error_message=record.error_message,
            alt_filepaths=record.alt_filepaths,
            indexed_at=record.indexed_at,
        )
        for record in records
    ]


@router.post("/documents/upload", response_model=UploadResponse, status_code=201)
async def upload_documents(
    files: list[UploadFile] = File(...),
    container: Container = Depends(get_container),
) -> UploadResponse:
    """Copy PDFs into the documents folder. Indexing is a separate, explicit step.

    Nothing is parsed here: a file that turns out to be scanned or damaged is reported
    by the indexing run, which is the one place that classifies documents.
    """
    directory = container.settings.pdf_directory
    directory.mkdir(parents=True, exist_ok=True)

    saved: list[str] = []
    rejected: list[RejectedUpload] = []

    for upload in files:
        name = _safe_name(upload.filename or "")
        if not name:
            rejected.append(RejectedUpload(filename=upload.filename or "?", reason="no filename"))
            continue
        if not name.lower().endswith(".pdf"):
            rejected.append(RejectedUpload(filename=name, reason="not a .pdf file"))
            continue

        payload = await upload.read()
        if len(payload) > _MAX_UPLOAD_BYTES:
            rejected.append(
                RejectedUpload(
                    filename=name,
                    reason=f"larger than {_MAX_UPLOAD_BYTES // 1024 // 1024} MB",
                )
            )
            continue
        if not payload.startswith(_PDF_MAGIC):
            rejected.append(RejectedUpload(filename=name, reason="not a PDF (bad header)"))
            continue

        target = _free_path(directory / name)
        target.write_bytes(payload)
        saved.append(target.name)
        logger.info("stored upload %s (%d bytes)", target.name, len(payload))

    return UploadResponse(saved=saved, rejected=rejected, directory=str(directory))


@router.get("/documents/{document_id}/file")
def get_document_file(
    document_id: str,
    container: Container = Depends(get_container),
) -> FileResponse:
    """Serve one indexed PDF so the UI can open it at the matching page.

    Only files that are in the manifest and still inside the configured documents
    folder are served: the id is not a path, and the resolved path is checked against
    the folder, so no request can read anything else on the machine.
    """
    record = container.manifest.get(document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="No such document")

    # The allow-list is the library: the documents folder plus every folder the user
    # registered. A manifest row on its own is not enough to read a file.
    roots = [container.settings.pdf_directory.resolve()]
    roots.extend(Path(folder.path).resolve() for folder in container.manifest.folders())

    for candidate in record.known_paths:
        path = Path(candidate).resolve()
        if any(path.is_relative_to(root) for root in roots) and path.is_file():
            return FileResponse(
                path,
                media_type="application/pdf",
                filename=record.filename,
                content_disposition_type="inline",
            )

    raise HTTPException(
        status_code=404,
        detail=f"{record.filename} is no longer in any folder in the library",
    )


@router.delete("/documents/{document_id}", response_model=RemovedDocumentResponse)
def remove_document(
    document_id: str,
    container: Container = Depends(get_container),
) -> RemovedDocumentResponse:
    """Unindex one document. The PDF itself is left on disk.

    Refused while a run is in progress, because the sweep at the end of that run owns
    the same rows.
    """
    if container.indexing.is_running:
        raise HTTPException(status_code=409, detail="An indexing run is in progress")

    record = container.indexing.remove_document(document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="No such document")
    return RemovedDocumentResponse(
        document_id=record.document_id,
        filename=record.filename,
        chunks_removed=record.chunks,
        file_kept=True,
    )


def _safe_name(raw: str) -> str:
    """Strip any path component and anything that is not a plain filename character."""
    name = Path(raw).name.strip()
    name = _UNSAFE.sub("_", name)
    return name.lstrip(".")


def _free_path(target: Path) -> Path:
    """Never overwrite an existing file; add ' (2)', ' (3)', and so on."""
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    for counter in range(2, 1000):
        candidate = target.with_name(f"{stem} ({counter}){suffix}")
        if not candidate.exists():
            return candidate
    raise HTTPException(status_code=409, detail=f"too many files named {target.name}")
