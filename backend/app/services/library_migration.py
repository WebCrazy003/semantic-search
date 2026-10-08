# backend/app/services/library_migration.py
"""Hand the library to the first administrator.

Every document is a user's upload. Before that rule, files put in the documents folder by
hand, files in registered folders and everything indexed before accounts existed formed
a library no user owned. This moves those files into the first admin's upload folder and
makes their documents the admin's: the folders they were in, whether they are public and
their passages all come along, and nothing is embedded again.

Runs at startup and once the first admin exists. Once done it finds nothing to do: files
outside users/ are no longer indexed, and nothing is given the library as an owner.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING

from app.logging_config import get_logger
from app.services.access_store import User
from app.services.manifest_service import DocumentRecord
from app.services.ownership import (
    LIBRARY,
    PUBLIC,
    document_id_for,
    user_folder,
    users_root,
    within,
)

if TYPE_CHECKING:
    from app.deps import Container

logger = get_logger("library_migration")

# The admin's folder the library's files and folders land in: not "Library", which
# would read as the old library rather than a folder of the admin's own.
HOME_FOLDER = "Imported files"


def first_admin(container: Container) -> User | None:
    admins = [user for user in container.access.list_users() if user.is_admin and not user.disabled]
    return min(admins, key=lambda user: user.created_at, default=None)


def adopt_library(container: Container) -> int:
    """Move the library to the first admin. Returns how many files moved.

    Waits for a later start while there is no admin to give it to, or while a run is
    indexing: the run may be writing the same documents. Each document's files move
    right before its rows change, and one that fails is logged and left for the next
    start, so a failure never stops the app or strands a document half-moved.
    """
    admin = first_admin(container)
    if admin is None or container.indexing.is_running:
        return 0
    documents = container.settings.pdf_directory
    registered = [Path(folder.path) for folder in container.manifest.folders()]
    found = _library_files(container, documents, registered)
    records = container.manifest.all_documents(owner_id=LIBRARY)
    if not found and not records and not registered:
        return 0

    target = user_folder(documents, admin.user_id)
    target.mkdir(parents=True, exist_ok=True)
    # Keyed by the walk's spelling of each path, which the document manager's rows use;
    # a manifest row may spell the same file differently (a symlinked folder), so rows
    # are matched on the resolved path.
    moved: dict[str, str] = {}
    by_real = {str(path.resolve()): path for path in found}

    def take(path: Path) -> str:
        if str(path) not in moved:
            new = _free_path(target / path.name)
            if within(path, documents):
                shutil.move(path, new)
            else:
                # A registered folder is the machine owner's own: copy, never take.
                shutil.copy2(path, new)
            moved[str(path)] = str(new)
        return moved[str(path)]

    for record in records:
        try:
            on_disk = (by_real.get(str(Path(known).resolve())) for known in record.known_paths)
            paths = list(dict.fromkeys(take(path) for path in on_disk if path is not None))
            _adopt_record(container, record, admin.user_id, paths)
        except Exception:
            logger.exception("could not move %s to %s", record.filename, admin.username)
    failed = False
    for path in found:
        try:
            take(path)
        except OSError:
            failed = True
            logger.exception("could not move %s to %s", path, admin.username)
    container.drive.store.adopt(LIBRARY, admin.user_id, moved, HOME_FOLDER)
    if not failed:
        for folder in registered:
            container.manifest.remove_folder(folder)
    logger.info(
        "moved %d library file(s) and %d document(s) to %s",
        len(moved),
        len(records),
        admin.username,
    )
    return len(moved)


def _library_files(container: Container, documents: Path, registered: list[Path]) -> list[Path]:
    """Every supported file outside users/: in the documents folder and registered ones."""
    users = users_root(documents)
    found: list[Path] = []
    for root in [documents, *registered]:
        if not root.is_dir():
            continue
        for folder, subfolders, names in os.walk(root):
            if Path(folder) == users:
                subfolders.clear()
                continue
            found.extend(
                Path(folder) / name
                for name in sorted(names)
                if container.extractors.supports(Path(folder) / name)
            )
    return list(dict.fromkeys(found))


def _free_path(target: Path) -> Path:
    """`target`, or the first of 'name (2).pdf', 'name (3).pdf'… that is not taken."""
    candidate, number = target, 2
    while candidate.exists():
        candidate = target.with_name(f"{target.stem} ({number}){target.suffix}")
        number += 1
    return candidate


def _adopt_record(
    container: Container, record: DocumentRecord, owner_id: str, paths: list[str]
) -> None:
    """Make one library document the admin's, under the id their upload of it would get.
    `paths` are its files, already in the admin's folder."""
    if not paths:
        # Its file is gone: nothing to hand over.
        container.indexing.remove_document(record.document_id)
        return
    new_id = document_id_for(owner_id, record.file_hash)
    public = container.access.carry_public(record.document_id, new_id)
    existing = container.manifest.get(new_id)
    if existing is not None:
        # The admin had uploaded the same content: one document, with every copy.
        existing.alt_filepaths = [
            *existing.alt_filepaths,
            *(path for path in paths if path not in existing.known_paths),
        ]
        if public and existing.visibility != PUBLIC:
            existing.visibility = PUBLIC
            container.qdrant.set_visibility(new_id, PUBLIC)
        container.manifest.upsert(existing)
        container.indexing.remove_document(record.document_id)
        return
    filepath = paths[0]
    filename = Path(filepath).name
    container.qdrant.rekey_document(record.document_id, new_id, owner_id, filepath, filename)
    container.manifest.upsert(
        replace(
            record,
            document_id=new_id,
            filepath=filepath,
            filename=filename,
            alt_filepaths=paths[1:],
            owner_id=owner_id,
        )
    )
    container.manifest.delete(record.document_id)
    container.access.make_private([record.document_id])
