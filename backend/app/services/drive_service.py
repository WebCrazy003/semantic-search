# backend/app/services/drive_service.py
"""What the document manager shows for a tree: its folders, its files, and where each
file is in indexing (2026-10-08 spec §3).

The folders and the file-to-folder map are DriveStore's. Which files exist is the disk's,
and how far each one got is the manifest's and the indexing service's. This puts the
three together, and asks for indexing when something is uploaded or a user asks.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.services.drive_store import DriveFile, DriveStore
from app.services.extractors import ExtractorRegistry
from app.services.indexing_service import IndexingService, RunRequest
from app.services.manifest_service import DocumentRecord, ManifestService
from app.services.ownership import LIBRARY, user_folder, users_root

# What a file in a run that has not finished is doing.
_IN_RUN = {"waiting", "indexing"}


@dataclass(frozen=True)
class FileState:
    file: DriveFile
    # uploading is the browser's; here: waiting, indexing, indexed, unsupported, failed,
    # duplicate, not_indexed
    state: str
    record: DocumentRecord | None = None
    error: str | None = None


class DriveService:
    def __init__(
        self,
        store: DriveStore,
        manifest: ManifestService,
        indexing: IndexingService,
        extractors: ExtractorRegistry,
        documents_dir: Path,
    ) -> None:
        self.store = store
        self._manifest = manifest
        self._indexing = indexing
        self._extractors = extractors
        self._documents_dir = documents_dir

    # ------------------------------------------------------------------ disk

    def folder_on_disk(self, tree: str) -> Path:
        """Where a tree's uploads are saved."""
        if tree == LIBRARY:
            return self._documents_dir
        return user_folder(self._documents_dir, tree)

    def roots(self, tree: str) -> list[Path]:
        if tree != LIBRARY:
            return [user_folder(self._documents_dir, tree)]
        roots = [self._documents_dir]
        for record in self._manifest.folders():
            path = Path(record.path)
            if path not in roots:
                roots.append(path)
        return roots

    def paths_on_disk(self, tree: str) -> tuple[list[str], list[Path]]:
        """The tree's files, and the roots that could not be read (an unplugged drive)."""
        users = users_root(self._documents_dir)
        found: set[str] = set()
        missing: list[Path] = []
        for root in self.roots(tree):
            if not root.is_dir():
                missing.append(root)
                continue
            for folder, subfolders, names in os.walk(root):
                if tree == LIBRARY and Path(folder) == users:
                    subfolders.clear()  # users' uploads are their trees, not the library's
                    continue
                for name in names:
                    path = Path(folder) / name
                    if self._extractors.supports(path):
                        found.add(str(path))
        return sorted(found), missing

    def sync(self, tree: str) -> list[DriveFile]:
        """The tree's files as they are on disk now, each with its row. Rows under a root
        that cannot be read are kept: their folders cannot be rebuilt."""
        paths, missing = self.paths_on_disk(tree)
        return self.store.sync(tree, paths, keep_under=missing)

    def records_by_path(self) -> dict[str, DocumentRecord]:
        """Every index record, by each path it is known at."""
        found: dict[str, DocumentRecord] = {}
        for record in self._manifest.all_documents():
            for known in record.known_paths:
                found.setdefault(known, record)
        return found

    # ---------------------------------------------------------------- states

    def states(
        self,
        tree: str,
        files: list[DriveFile],
        by_path: dict[str, DocumentRecord] | None = None,
    ) -> dict[str, FileState]:
        """Each file's place in indexing, by file id."""
        if not files:
            return {}
        if by_path is None:
            by_path = self.records_by_path()

        snapshot = self._indexing.snapshot()
        running = (
            {file.path: file for file in snapshot.files}
            if snapshot.status == "running" and snapshot.scope == tree
            else {}
        )
        queued_all = False
        queued_paths: set[str] = set()
        for request in self._indexing.queued():
            if request.scope != tree:
                continue
            if request.paths is None:
                queued_all = True
            else:
                queued_paths.update(str(path) for path in request.paths)
        if snapshot.status == "running" and snapshot.scope == tree and not snapshot.files:
            # A whole-tree run that has not listed its files yet.
            queued_all = True

        states: dict[str, FileState] = {}
        for file in files:
            record = by_path.get(file.path)
            run = running.get(file.path)
            if run is not None and run.state in _IN_RUN:
                state = FileState(file, run.state, record)
            elif file.path in queued_paths or (queued_all and record is None):
                state = FileState(file, "waiting", record)
            elif record is None:
                state = FileState(file, "not_indexed")
            elif file.path != record.filepath:
                state = FileState(file, "duplicate", record)
            else:
                state = FileState(file, record.status, record, record.error_message)
            states[file.file_id] = state
        return states

    def not_indexed(self, tree: str) -> list[DriveFile]:
        files = self.sync(tree)
        states = self.states(tree, files)
        return [file for file in files if states[file.file_id].state == "not_indexed"]

    def busy(
        self,
        tree: str,
        files: list[DriveFile],
        by_path: dict[str, DocumentRecord] | None = None,
    ) -> bool:
        """Whether any of these files is being indexed or waiting to be."""
        states = self.states(tree, files, by_path)
        return any(states[file.file_id].state in _IN_RUN for file in files)

    # -------------------------------------------------------------- indexing

    def request_index(
        self,
        tree: str,
        paths: list[str] | None,
        started_by: str,
        force: bool = False,
        trigger: str = "upload",
    ) -> Literal["started", "queued"]:
        """Ask for these files (or the whole tree) to be indexed: "started" or "queued"."""
        directory = None if tree == LIBRARY else self.folder_on_disk(tree)
        return self._indexing.request_run(
            RunRequest(
                directory=directory,
                force=force,
                trigger=trigger,
                started_by=started_by,
                scope=tree,
                paths=None if paths is None else tuple(Path(path) for path in paths),
            )
        )
