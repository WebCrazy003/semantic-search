# backend/app/api/documents.py
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import BinaryIO

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse

from app.api.guards import apply_visibility, owned_or_404, readable_or_404, remove_document
from app.auth import active_user, admin_user, reader
from app.deps import Container, get_container
from app.logging_config import get_logger
from app.models.request_models import VisibilityRequest
from app.models.response_models import (
    DocumentSummary,
    PassageResponse,
    RejectedUpload,
    RemovedDocumentResponse,
    UploadedFile,
    UploadResponse,
    VisibilityResponse,
)
from app.services.access_store import User
from app.services.docx_service import DOCX_MEDIA_TYPE, OLE_MAGIC, ZIP_MAGIC
from app.services.drive_store import DriveError, DriveFile
from app.services.extractors import file_type_for
from app.services.manifest_service import DocumentRecord
from app.services.ownership import LIBRARY, user_folder

logger = get_logger("api.documents")
router = APIRouter(tags=["documents"])
# Reading one document is open to visitors, who may read public documents. main.py
# mounts this router without the signed-in guard, so every route here declares its own.
reader_router = APIRouter(tags=["documents"])

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
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    folder_id: str | None = Form(default=None),
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> UploadResponse:
    """Copy PDF and Word files into the uploader's own folder, and index them.

    Nothing is parsed here: a file that turns out to be scanned or damaged is reported
    by the indexing run, which is the one place that classifies documents. The folder on
    disk comes from the session, never from the request, and decides who owns the files.

    `folder_id` is the document manager's folder to list them in. Indexing starts here,
    not in the browser, so closing the tab right after an upload loses nothing; it waits
    its turn when another run is going (2026-10-08 spec §3.3).
    """
    try:
        container.drive.store.folder_in(user.user_id, folder_id or None)
    except DriveError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    directory = user_folder(container.settings.pdf_directory, user.user_id)
    directory.mkdir(parents=True, exist_ok=True)

    saved: list[str] = []
    rejected: list[RejectedUpload] = []
    added: list[DriveFile] = []

    for upload in files:
        # Rejections report the name as sent, so the browser can match its own row.
        sent = upload.filename or "?"
        name = _safe_name(upload.filename or "")
        if not name:
            rejected.append(RejectedUpload(filename=upload.filename or "?", reason="no filename"))
            continue
        suffix = Path(name).suffix.lower()
        if suffix not in container.extractors.suffixes:
            rejected.append(RejectedUpload(filename=sent, reason=_NOT_SUPPORTED))
            continue

        stored = await _store(upload, directory / name, suffix)
        if isinstance(stored, str):
            rejected.append(RejectedUpload(filename=sent, reason=stored))
            continue
        target, size = stored
        saved.append(target.name)
        added.append(container.drive.store.add(user.user_id, str(target), folder_id or None))
        logger.info("stored upload %s (%d bytes)", target.name, size)

    indexing = None
    if added:
        indexing = container.drive.request_index(
            user.user_id, [file.path for file in added], user.user_id
        )
        if indexing == "started":
            background_tasks.add_task(container.indexing.drain)
    return UploadResponse(
        saved=saved,
        rejected=rejected,
        directory=str(directory),
        files=[UploadedFile(file_id=file.file_id, name=file.name) for file in added],
        indexing=indexing,
    )


@reader_router.get("/documents/{document_id}/file")
def get_document_file(
    document_id: str,
    user: User | None = Depends(reader),
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


@reader_router.get(
    "/documents/{document_id}/passages/{chunk_index}", response_model=PassageResponse
)
def get_passage(
    document_id: str,
    chunk_index: int,
    user: User | None = Depends(reader),
    container: Container = Depends(get_container),
) -> PassageResponse:
    """One passage of a document the caller may read, for a viewer opened from a link."""
    record = readable_or_404(container, user, document_id)
    payload = container.qdrant.get_chunk(document_id, chunk_index)
    if payload is None:
        raise HTTPException(status_code=404, detail="No such passage")
    return PassageResponse(
        document_id=document_id,
        chunk_index=chunk_index,
        filename=record.filename,
        file_type=file_type_for(record.filename),
        page_start=int(payload.get("page_start", 0)),
        page_end=int(payload.get("page_end", 0)),
        heading=payload.get("heading"),
        text=str(payload.get("text", "")),
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


def _header_problem(suffix: str, head: bytes) -> str | None:
    """Check the first bytes match the name, so a renamed file is refused up front."""
    if suffix == ".pdf":
        return None if head.startswith(_PDF_MAGIC) else "not a PDF (bad header)"
    if head.startswith(OLE_MAGIC):
        return "a password-protected or old-format (.doc) Word file"
    if not head.startswith(ZIP_MAGIC):
        return "not a Word .docx file (bad header)"
    return None


def _docx_problem(path: Path) -> str | None:
    """A .docx is a zip with the document inside; check the saved file is one."""
    try:
        with zipfile.ZipFile(path) as archive:
            archive.getinfo("word/document.xml")
    except (zipfile.BadZipFile, KeyError):
        return "not a Word .docx file (no document inside)"
    return None


def _safe_name(raw: str) -> str:
    """Strip any path component and anything that is not a plain filename character."""
    name = Path(raw).name.strip()
    name = _UNSAFE.sub("_", name)
    return name.lstrip(".")


def _claim(target: Path) -> tuple[Path, BinaryIO]:
    """Open a name nobody has for writing; add ' (2)', ' (3)', and so on.

    Exclusive create ("xb") rather than checking first: two uploads of the same name at
    the same moment each get their own file instead of one overwriting the other.
    """
    stem, suffix = target.stem, target.suffix
    for counter in range(1, 1000):
        candidate = target if counter == 1 else target.with_name(f"{stem} ({counter}){suffix}")
        try:
            return candidate, candidate.open("xb")
        except FileExistsError:
            continue
    raise HTTPException(status_code=409, detail=f"too many files named {target.name}")


_CHUNK = 1024 * 1024
_TOO_LARGE = f"larger than {_MAX_UPLOAD_BYTES // 1024 // 1024} MB"


async def _store(upload: UploadFile, target: Path, suffix: str) -> tuple[Path, int] | str:
    """Save an upload under a free name, a chunk at a time. Returns (path, size), or the
    reason it was refused, in which case nothing is left on disk.

    Starlette has already spooled the request to a temporary file; this copies it in
    chunks rather than holding the file in memory, and stops at the size limit.
    """
    if upload.size is not None and upload.size > _MAX_UPLOAD_BYTES:
        return _TOO_LARGE
    head = await upload.read(_CHUNK)
    problem = _header_problem(suffix, head)
    if problem:
        return problem
    path, handle = _claim(target)
    size = 0
    try:
        with handle:
            chunk = head
            while chunk:
                size += len(chunk)
                if size > _MAX_UPLOAD_BYTES:
                    problem = _TOO_LARGE
                    break
                handle.write(chunk)
                chunk = await upload.read(_CHUNK)
        if problem is None and suffix == ".docx":
            problem = _docx_problem(path)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    if problem:
        path.unlink(missing_ok=True)
        return problem
    return path, size
