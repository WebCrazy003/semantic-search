# backend/app/api/folders.py
"""Folders the user indexes in place.

A browser file picker only hands over bytes, never a path, so importing copies files
into the documents folder. Registering a folder is the other way round: nothing is
copied, the PDFs stay where they are, and the index records their real locations.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.deps import Container, get_container
from app.logging_config import get_logger
from app.models.request_models import AddFolderRequest
from app.models.response_models import FolderSummary, RemovedFolderResponse

logger = get_logger("api.folders")
router = APIRouter(tags=["folders"])


@router.get("/folders", response_model=list[FolderSummary])
def list_folders(container: Container = Depends(get_container)) -> list[FolderSummary]:
    default = container.settings.pdf_directory
    records = container.manifest.folders()
    documents = container.manifest.all_documents()

    summaries = [_summarise(default, None, documents, is_default=True)]
    summaries.extend(
        _summarise(Path(record.path), record.added_at, documents) for record in records
    )
    return summaries


@router.post("/folders", response_model=FolderSummary, status_code=201)
def add_folder(
    request: AddFolderRequest,
    container: Container = Depends(get_container),
) -> FolderSummary:
    """Register a folder. Its PDFs are indexed where they are on the next run."""
    if container.indexing.is_running:
        raise HTTPException(status_code=409, detail="An indexing run is in progress")

    path = Path(request.path.strip()).expanduser()
    if not path.is_absolute():
        raise HTTPException(status_code=400, detail="Give an absolute path")
    try:
        path = path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=f"Cannot read that path: {exc}") from exc
    if not path.is_dir():
        raise HTTPException(status_code=400, detail="That path is not a folder")

    known = [
        container.settings.pdf_directory,
        *(Path(folder.path) for folder in container.manifest.folders()),
    ]
    for existing in known:
        if path == existing:
            raise HTTPException(status_code=409, detail="That folder is already in the library")
        if path.is_relative_to(existing):
            raise HTTPException(
                status_code=409,
                detail=f"Already covered by {existing}, which is scanned including subfolders",
            )

    record = container.manifest.add_folder(path)
    logger.info("registered folder %s", path)
    return _summarise(path, record.added_at, container.manifest.all_documents())


@router.delete("/folders", response_model=RemovedFolderResponse)
def remove_folder(
    path: str,
    container: Container = Depends(get_container),
) -> RemovedFolderResponse:
    """Unregister a folder and unindex what came from it. The files are untouched."""
    if container.indexing.is_running:
        raise HTTPException(status_code=409, detail="An indexing run is in progress")

    target = Path(path).expanduser()
    if target == container.settings.pdf_directory:
        raise HTTPException(status_code=400, detail="The documents folder cannot be removed")
    if not container.manifest.remove_folder(target):
        raise HTTPException(status_code=404, detail="That folder is not in the library")

    unindexed = 0
    for document in container.manifest.all_documents():
        if any(_within(Path(known), target) for known in document.known_paths):
            container.indexing.remove_document(document.document_id)
            unindexed += 1

    logger.info("unregistered folder %s, unindexed %d documents", target, unindexed)
    return RemovedFolderResponse(path=str(target), documents_unindexed=unindexed, files_kept=True)


def _within(path: Path, folder: Path) -> bool:
    try:
        return path.is_relative_to(folder)
    except ValueError:  # different drives on Windows
        return False


def _summarise(path, added_at, documents, is_default: bool = False) -> FolderSummary:
    readable = path.is_dir()
    return FolderSummary(
        path=str(path),
        added_at=added_at or _oldest(documents),
        exists=path.exists(),
        readable=readable,
        pdf_count=_count_pdfs(path) if readable else 0,
        indexed_documents=sum(
            1
            for document in documents
            if any(_within(Path(known), path) for known in document.known_paths)
        ),
        is_default=is_default,
    )


def _count_pdfs(path: Path) -> int:
    try:
        return sum(
            1
            for candidate in path.rglob("*")
            if candidate.is_file()
            and candidate.suffix.lower() == ".pdf"
            and not candidate.name.startswith(".")
        )
    except OSError:
        return 0


def _oldest(documents) -> object:
    from datetime import UTC, datetime

    return min((document.indexed_at for document in documents), default=datetime.now(tz=UTC))
