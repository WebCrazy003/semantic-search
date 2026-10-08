# backend/app/api/guards.py
"""The one place a document route asks "may this user touch this document?".

Every document route goes through readable_or_404 or owned_or_404. A document the
caller may not see gets exactly the answer an unknown id gets, so its existence is not
revealed.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from app.deps import Container
from app.logging_config import get_logger
from app.services.access_store import User
from app.services.manifest_service import DocumentRecord
from app.services.ownership import PUBLIC, user_folder

logger = get_logger("api.guards")

NOT_FOUND = "No such document"


def readable_or_404(
    container: Container, user: User | None, document_id: str
) -> DocumentRecord:
    """Admins read everything; a visitor (None) public documents; anyone else their own
    documents and public ones."""
    record = container.manifest.get(document_id)
    if record is None or not can_read(user, record):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return record


def owned_or_404(container: Container, user: User, document_id: str) -> DocumentRecord:
    """Admins may act on any document; anyone else only on their own."""
    record = container.manifest.get(document_id)
    if record is None or not can_manage(user, record):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return record


def can_manage(user: User, record: DocumentRecord) -> bool:
    return user.is_admin or record.owner_id == user.user_id


def can_read(user: User | None, record: DocumentRecord) -> bool:
    if record.visibility == PUBLIC:
        return True
    return user is not None and can_manage(user, record)


def uploaded_files(container: Container, record: DocumentRecord) -> list[Path]:
    """The document's paths that are in its owner's upload folder and still there. Only
    those are ever read or deleted: a manifest row on its own is not permission."""
    root = user_folder(container.settings.pdf_directory, record.owner_id).resolve()
    paths = dict.fromkeys(Path(known).resolve() for known in record.known_paths)
    return [path for path in paths if path.is_relative_to(root) and path.is_file()]


def file_on_disk(container: Container, record: DocumentRecord) -> Path | None:
    return next(iter(uploaded_files(container, record)), None)


def remove_document(container: Container, record: DocumentRecord) -> int:
    """Unindex a document and delete its uploaded files. Returns how many were deleted.

    The upload goes too, or the next rescan would bring back a document its owner
    deleted.
    """
    container.indexing.remove_document(record.document_id)
    return delete_uploads(container, record)


def delete_uploads(container: Container, record: DocumentRecord) -> int:
    found = uploaded_files(container, record)
    for path in found:
        path.unlink()
    deleted = len(found)
    if deleted:
        logger.info("deleted %d uploaded file(s) of %s", deleted, record.filename)
    return deleted


def apply_visibility(
    container: Container, document_ids: list[str], visibility: str, actor: User
) -> tuple[list[str], list[str]]:
    """Make documents public or private. Returns (updated ids, unknown ids).

    An owner decides for their own documents and an admin for anyone's. Someone else's
    document counts as unknown, so its existence is not revealed.

    Refused while an indexing run is in progress: the run may be about to rewrite the
    same document's passages with the visibility it read before this change.
    """
    if container.indexing.is_running:
        raise HTTPException(status_code=409, detail="An indexing run is in progress")

    known = []
    for doc_id in dict.fromkeys(document_ids):
        record = container.manifest.get(doc_id)
        if record is not None and can_manage(actor, record):
            known.append(doc_id)
    allowed = set(known)
    unknown = [doc_id for doc_id in dict.fromkeys(document_ids) if doc_id not in allowed]
    if visibility == PUBLIC:
        container.access.make_public(known, by=actor.user_id)
    else:
        container.access.make_private(known)
    container.manifest.set_visibility(known, visibility)
    for document_id in known:
        container.qdrant.set_visibility(document_id, visibility)
    logger.info("%s made %d document(s) %s", actor.username, len(known), visibility)
    return known, unknown
