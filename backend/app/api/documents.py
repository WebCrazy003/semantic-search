# backend/app/api/documents.py
from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.api.guards import apply_visibility, owned_or_404, readable_or_404, remove_document
from app.auth import active_user, admin_user
from app.deps import Container, get_container
from app.logging_config import get_logger
from app.models.request_models import VisibilityRequest
from app.models.response_models import (
    DocumentSummary,
    RejectedUpload,
    RemovedDocumentResponse,
    UploadResponse,
    VisibilityResponse,
)
from app.services.access_store import User
from app.services.docx_service import DOCX_MEDIA_TYPE, OLE_MAGIC, ZIP_MAGIC
from app.services.extractors import file_type_for
from app.services.manifest_service import DocumentRecord
from app.services.ownership import LIBRARY, user_folder

logger = get_logger("api.documents")
router = APIRouter(tags=["documents"])

# Upload limits. A file larger than this is far more likely to be a mistake than a
# manual, and the whole file is read into memory before it is written.
_MAX_UPLOAD_BYTES = 200 * 1024 * 1024
_PDF_MAGIC = b"%PDF-"
_NOT_SUPPORTED = "not a PDF or Word (.docx) file"
_UNSAFE = re.compile(r"[^\w.\- ()　-鿿가-힯]", re.UNICODE)


@router.get("/documents", response_model=list[DocumentSummary])
def list_documents(
    status: str | None = Query(default=None, description="indexed, skipped, failed, unsupported"),
    owner_id: str | None = Query(default=None, description="Admin only: a user id, or library"),
    visibility: str | None = Query(default=None, description="Admin only: public or private"),
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> list[DocumentSummary]:
    """Read from the manifest, not from Qdrant.

    A scroll over the passage collection would be O(passages); this is O(documents) and
    stays fast as the corpus grows. A user sees their own documents and public ones;
    an admin sees everything and may filter by owner and visibility.
    """
    if user.is_admin:
        records = container.manifest.all_documents(owner_id=owner_id, visibility=visibility)
        names = container.access.usernames()
    else:
        records = container.manifest.all_documents(readable_by=user.user_id)
        names = {}
    if status is not None:
        records = [record for record in records if record.status == status]
    return [_summary(record, user, names) for record in records]


def _summary(record: DocumentRecord, user: User, names: dict[str, str]) -> DocumentSummary:
    mine = record.owner_id == user.user_id
    # Another user's public document shows its content, never where it lives or who
    # uploaded it.
    private_details = user.is_admin or mine
    return DocumentSummary(
        document_id=record.document_id,
        filename=record.filename,
        filepath=record.filepath if private_details else "",
        file_size=record.file_size,
        file_hash=record.file_hash if private_details else "",
        modified_at=record.modified_at,
        pages=record.pages,
        chunks=record.chunks,
        language=record.language,
        title=record.title,
        status=record.status,
        error_type=record.error_type,
        error_message=record.error_message,
        alt_filepaths=record.alt_filepaths if private_details else [],
        indexed_at=record.indexed_at,
        file_type=file_type_for(record.filename),
        pages_approximate=file_type_for(record.filename) == "docx" and record.pages > 0,
        visibility=record.visibility,
        is_mine=mine,
        owner_id=record.owner_id if user.is_admin else None,
        owner_username=(
            names.get(record.owner_id) if user.is_admin and record.owner_id != LIBRARY else None
        ),
    )


@router.post("/documents/upload", response_model=UploadResponse, status_code=201)
async def upload_documents(
    files: list[UploadFile] = File(...),
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> UploadResponse:
    """Copy PDF and Word files into the uploader's own folder. Indexing is a separate step.

    Nothing is parsed here: a file that turns out to be scanned or damaged is reported
    by the indexing run, which is the one place that classifies documents. The folder
    comes from the session, never from the request, and decides who owns the files.
    """
    directory = user_folder(container.settings.pdf_directory, user.user_id)
    directory.mkdir(parents=True, exist_ok=True)

    saved: list[str] = []
    rejected: list[RejectedUpload] = []

    for upload in files:
        name = _safe_name(upload.filename or "")
        if not name:
            rejected.append(RejectedUpload(filename=upload.filename or "?", reason="no filename"))
            continue
        suffix = Path(name).suffix.lower()
        if suffix not in container.extractors.suffixes:
            rejected.append(RejectedUpload(filename=name, reason=_NOT_SUPPORTED))
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
        problem = _header_problem(suffix, payload)
        if problem:
            rejected.append(RejectedUpload(filename=name, reason=problem))
            continue

        target = _free_path(directory / name)
        target.write_bytes(payload)
        saved.append(target.name)
        logger.info("stored upload %s (%d bytes)", target.name, len(payload))

    return UploadResponse(saved=saved, rejected=rejected, directory=str(directory))


@router.get("/documents/{document_id}/file")
def get_document_file(
    document_id: str,
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> FileResponse:
    """Serve one indexed file: a PDF opens in the browser at the matching page, and a
    Word file, which browsers cannot show, downloads.

    Only files that are in the manifest and still inside the configured documents
    folder are served: the id is not a path, and the resolved path is checked against
    the folder, so no request can read anything else on the machine.
    """
    record = readable_or_404(container, user, document_id)

    # The allow-list is the library: the documents folder plus every folder the user
    # registered. A manifest row on its own is not enough to read a file.
    roots = [container.settings.pdf_directory.resolve()]
    roots.extend(Path(folder.path).resolve() for folder in container.manifest.folders())

    for candidate in record.known_paths:
        path = Path(candidate).resolve()
        if any(path.is_relative_to(root) for root in roots) and path.is_file():
            media_type = container.extractors.media_type_for(path)
            return FileResponse(
                path,
                media_type=media_type,
                filename=record.filename,
                content_disposition_type=(
                    "attachment" if media_type == DOCX_MEDIA_TYPE else "inline"
                ),
            )

    raise HTTPException(
        status_code=404,
        detail=f"{record.filename} is no longer in any folder in the library",
    )


@router.delete("/documents/{document_id}", response_model=RemovedDocumentResponse)
def delete_document(
    document_id: str,
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> RemovedDocumentResponse:
    """Remove one document from the index.

    A library file is left on disk, so a later scan finds it again. A user's upload is
    deleted with it: it is a copy the app made. Only the owner and admins may do this;
    for anyone else the document does not exist, public or not.

    Refused while a run is in progress, because the sweep at the end of that run owns
    the same rows.
    """
    # Before the ownership check: the answer is the same for every id, so it reveals
    # nothing about which documents exist.
    if container.indexing.is_running:
        raise HTTPException(status_code=409, detail="An indexing run is in progress")
    record = owned_or_404(container, user, document_id)

    _, kept = remove_document(container, record)
    return RemovedDocumentResponse(
        document_id=record.document_id,
        filename=record.filename,
        chunks_removed=record.chunks,
        file_kept=kept,
    )


@router.put("/documents/{document_id}/visibility", response_model=VisibilityResponse)
def set_document_visibility(
    document_id: str,
    body: VisibilityRequest,
    admin: User = Depends(admin_user),
    container: Container = Depends(get_container),
) -> VisibilityResponse:
    """Make a document public, so every user can find it, or private again."""
    updated, _ = apply_visibility(container, [document_id], body.visibility, admin)
    if not updated:
        raise HTTPException(status_code=404, detail="No such document")
    return VisibilityResponse(document_id=document_id, visibility=body.visibility)


def _header_problem(suffix: str, payload: bytes) -> str | None:
    """Check the bytes match the name, so a renamed file is refused up front."""
    if suffix == ".pdf":
        return None if payload.startswith(_PDF_MAGIC) else "not a PDF (bad header)"
    if payload.startswith(OLE_MAGIC):
        return "a password-protected or old-format (.doc) Word file"
    if not payload.startswith(ZIP_MAGIC):
        return "not a Word .docx file (bad header)"
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            archive.getinfo("word/document.xml")
    except (zipfile.BadZipFile, KeyError):
        return "not a Word .docx file (no document inside)"
    return None


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
