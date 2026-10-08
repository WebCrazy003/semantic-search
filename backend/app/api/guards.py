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
from app.services.ownership import LIBRARY, PUBLIC, user_folder

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
    if record is None or not (user.is_admin or record.owner_id == user.user_id):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return record


def can_read(user: User | None, record: DocumentRecord) -> bool:
    if record.visibility == PUBLIC:
        return True
    return user is not None and (user.is_admin or record.owner_id == user.user_id)


def remove_document(container: Container, record: DocumentRecord) -> tuple[int, bool]:
    """Unindex a document. Returns (files deleted, whether the file was kept).

    A library file is the machine owner's, so it stays and a rescan finds it again. A
    user's upload is a copy the app made, so it goes too; otherwise the next rescan
    would bring back a document its owner deleted.
    """
    container.indexing.remove_document(record.document_id)
    if record.owner_id == LIBRARY:
        return 0, True
    return delete_uploads(container, record), False


def delete_uploads(container: Container, record: DocumentRecord) -> int:
    folder = user_folder(container.settings.pdf_directory, record.owner_id).resolve()
    deleted = 0
    for known in record.known_paths:
        path = Path(known).resolve()
        # Only ever inside the owner's own upload folder, whatever the manifest says.
        if path.is_relative_to(folder) and path.is_file():
            path.unlink()
            deleted += 1
    if deleted:
        logger.info("deleted %d uploaded file(s) of %s", deleted, record.filename)
    return deleted


def apply_visibility(
    container: Container, document_ids: list[str], visibility: str, admin: User
) -> tuple[list[str], list[str]]:
    """Make documents public or private. Returns (updated ids, unknown ids).

    Refused while an indexing run is in progress: the run may be about to rewrite the
    same document's passages with the visibility it read before this change.
    """
    if container.indexing.is_running:
        raise HTTPException(status_code=409, detail="An indexing run is in progress")

    known = [doc_id for doc_id in document_ids if container.manifest.get(doc_id) is not None]
    unknown = [doc_id for doc_id in document_ids if doc_id not in set(known)]
    if visibility == PUBLIC:
        container.access.make_public(known, by=admin.user_id)
    else:
        container.access.make_private(known)
    container.manifest.set_visibility(known, visibility)
    for document_id in known:
        container.qdrant.set_visibility(document_id, visibility)
    logger.info("%s made %d document(s) %s", admin.username, len(known), visibility)
    return known, unknown
