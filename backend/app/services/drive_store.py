# backend/app/services/drive_store.py
"""The document manager's folders, and which folder each file is in (2026-10-08 spec §3.5).

Kept in data/access.db, beside the accounts, because like them it cannot be recomputed:
the manifest is a cache that a rebuild or "Clear the index" empties, and files never
move on disk. A move here is one UPDATE.

A tree is one user's files, named by their user id. A file is keyed by its path on
disk, not its document id, because the path exists from the moment of upload and never
changes, while the id comes later and changes whenever the content does.
"""

from __future__ import annotations

import sqlite3
import threading
import uuid
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS drive_folders (
    folder_id   TEXT PRIMARY KEY,
    tree        TEXT NOT NULL,
    parent_id   TEXT REFERENCES drive_folders(folder_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drive_folders_tree ON drive_folders(tree, parent_id);

CREATE TABLE IF NOT EXISTS drive_files (
    file_id     TEXT PRIMARY KEY,
    tree        TEXT NOT NULL,
    path        TEXT NOT NULL UNIQUE,
    folder_id   TEXT REFERENCES drive_folders(folder_id) ON DELETE SET NULL,
    added_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drive_files_tree ON drive_files(tree, folder_id);
"""

MAX_NAME = 120
MAX_DEPTH = 20
MAX_FOLDERS = 5000


class DriveError(Exception):
    """A request the store refuses. The message is fit to show."""


class NameTakenError(DriveError):
    pass


@dataclass(frozen=True)
class Folder:
    folder_id: str
    tree: str
    parent_id: str | None
    name: str
    created_at: str


@dataclass(frozen=True)
class DriveFile:
    file_id: str
    tree: str
    path: str
    folder_id: str | None
    added_at: str

    @property
    def name(self) -> str:
        return Path(self.path).name


def _now() -> str:
    return datetime.now(tz=UTC).isoformat()


def clean_name(raw: str) -> str:
    """A folder name as stored: trimmed, readable in a breadcrumb, never a path."""
    name = " ".join(raw.split())
    if not name:
        raise DriveError("Give the folder a name")
    if len(name) > MAX_NAME:
        raise DriveError(f"A folder name can be at most {MAX_NAME} characters")
    if name in {".", ".."} or any(char in name for char in "/\\\0"):
        raise DriveError("A folder name cannot contain / or \\")
    return name


class DriveStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._connection: sqlite3.Connection | None = None
        self._lock = threading.RLock()

    def initialise(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self._connect().executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        if self._connection is None:
            self._connection = sqlite3.connect(
                self._path, check_same_thread=False, isolation_level=None
            )
            self._connection.row_factory = sqlite3.Row
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA busy_timeout=5000")
            self._connection.execute("PRAGMA foreign_keys=ON")
        return self._connection

    def close(self) -> None:
        with self._lock:
            if self._connection is not None:
                self._connection.close()
                self._connection = None

    @contextmanager
    def _transaction(self) -> Iterator[None]:
        """All or nothing: a move that fails half-way leaves every row where it was."""
        with self._lock:
            connection = self._connect()
            if connection.in_transaction:  # already inside one
                yield
                return
            connection.execute("BEGIN IMMEDIATE")
            try:
                yield
            except BaseException:
                connection.execute("ROLLBACK")
                raise
            connection.execute("COMMIT")

    def _rows(self, sql: str, params: Iterable[object] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._connect().execute(sql, tuple(params)).fetchall()

    def _write(self, sql: str, params: Iterable[object] = ()) -> int:
        with self._lock:
            return self._connect().execute(sql, tuple(params)).rowcount

    # ---------------------------------------------------------------- folders

    def folders(self, tree: str) -> list[Folder]:
        return [
            Folder(**dict(row))
            for row in self._rows(
                "SELECT * FROM drive_folders WHERE tree = ? ORDER BY name COLLATE NOCASE", (tree,)
            )
        ]

    def folder(self, folder_id: str) -> Folder | None:
        rows = self._rows("SELECT * FROM drive_folders WHERE folder_id = ?", (folder_id,))
        return Folder(**dict(rows[0])) if rows else None

    def folder_in(self, tree: str, folder_id: str | None) -> Folder | None:
        """The folder, which must be in `tree`; None means the root."""
        if folder_id is None:
            return None
        folder = self.folder(folder_id)
        if folder is None or folder.tree != tree:
            raise DriveError("No such folder")
        return folder

    def ancestors(self, folder_id: str | None) -> list[Folder]:
        """From the root down to this folder, for the breadcrumb."""
        chain: list[Folder] = []
        current = self.folder(folder_id) if folder_id else None
        while current is not None and len(chain) <= MAX_DEPTH:
            chain.append(current)
            current = self.folder(current.parent_id) if current.parent_id else None
        return list(reversed(chain))

    def create_folder(self, tree: str, parent_id: str | None, name: str) -> Folder:
        name = clean_name(name)
        with self._lock:
            self.folder_in(tree, parent_id)
            if len(self.ancestors(parent_id)) >= MAX_DEPTH:
                raise DriveError(f"Folders can be at most {MAX_DEPTH} levels deep")
            count = self._rows("SELECT COUNT(*) AS n FROM drive_folders WHERE tree = ?", (tree,))
            if count[0]["n"] >= MAX_FOLDERS:
                raise DriveError(f"A tree can hold at most {MAX_FOLDERS} folders")
            if self._sibling_named(tree, parent_id, name):
                raise NameTakenError(f"There is already a folder called {name} here")
            folder = Folder(uuid.uuid4().hex, tree, parent_id, name, _now())
            self._write(
                "INSERT INTO drive_folders (folder_id, tree, parent_id, name, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (folder.folder_id, tree, parent_id, name, folder.created_at),
            )
            return folder

    def rename_folder(self, folder_id: str, name: str) -> Folder:
        name = clean_name(name)
        with self._lock:
            folder = self.folder(folder_id)
            if folder is None:
                raise DriveError("No such folder")
            other = self._sibling_named(folder.tree, folder.parent_id, name)
            if other is not None and other != folder_id:
                raise NameTakenError(f"There is already a folder called {name} here")
            self._write("UPDATE drive_folders SET name = ? WHERE folder_id = ?", (name, folder_id))
            return self.folder(folder_id)  # type: ignore[return-value]

    def move_folders(self, tree: str, folder_ids: list[str], to: str | None) -> None:
        """Move folders under `to` (None: the root). A clashing name gets " (2)"."""
        with self._transaction():
            self.folder_in(tree, to)
            target_depth = len(self.ancestors(to))
            for folder_id in folder_ids:
                folder = self.folder_in(tree, folder_id)
                assert folder is not None
                if folder.parent_id == to:
                    continue
                if to is not None and (to == folder_id or to in self.subtree_ids(folder_id)):
                    raise DriveError("A folder cannot go inside itself")
                if target_depth + self._height(folder_id) > MAX_DEPTH:
                    raise DriveError(f"Folders can be at most {MAX_DEPTH} levels deep")
                name = self._free_name(tree, to, folder.name)
                self._write(
                    "UPDATE drive_folders SET parent_id = ?, name = ? WHERE folder_id = ?",
                    (to, name, folder_id),
                )

    def subtree_ids(self, folder_id: str) -> list[str]:
        """The folder's descendants, not the folder itself."""
        rows = self._rows(
            """
            WITH RECURSIVE below(folder_id) AS (
                SELECT folder_id FROM drive_folders WHERE parent_id = ?
                UNION ALL
                SELECT f.folder_id FROM drive_folders f JOIN below b ON f.parent_id = b.folder_id
            )
            SELECT folder_id FROM below
            """,
            (folder_id,),
        )
        return [row["folder_id"] for row in rows]

    def files_under(self, folder_id: str) -> list[DriveFile]:
        """Every file in the folder or any folder below it."""
        ids = [folder_id, *self.subtree_ids(folder_id)]
        marks = ",".join("?" * len(ids))
        return [
            DriveFile(**dict(row))
            for row in self._rows(f"SELECT * FROM drive_files WHERE folder_id IN ({marks})", ids)
        ]

    def delete_folder(self, folder_id: str) -> None:
        """The folder and everything below it. Their files' rows go back to the root;
        the caller deletes the files themselves first."""
        self._write("DELETE FROM drive_folders WHERE folder_id = ?", (folder_id,))

    def _sibling_named(self, tree: str, parent_id: str | None, name: str) -> str | None:
        # SQLite treats NULLs as distinct in UNIQUE, so the root is checked here.
        rows = self._rows(
            "SELECT folder_id FROM drive_folders WHERE tree = ? AND parent_id IS ? "
            "AND name = ? COLLATE NOCASE",
            (tree, parent_id, name),
        )
        return rows[0]["folder_id"] if rows else None

    def _free_name(self, tree: str, parent_id: str | None, name: str) -> str:
        candidate, number = name, 2
        while self._sibling_named(tree, parent_id, candidate) is not None:
            candidate = f"{name} ({number})"
            number += 1
        return candidate

    def _height(self, folder_id: str) -> int:
        """Levels from this folder down to its deepest descendant, itself included."""
        children = self._rows(
            "SELECT folder_id FROM drive_folders WHERE parent_id = ?", (folder_id,)
        )
        return 1 + max((self._height(row["folder_id"]) for row in children), default=0)

    # ------------------------------------------------------------------ files

    def files(self, tree: str) -> list[DriveFile]:
        return [
            DriveFile(**dict(row))
            for row in self._rows("SELECT * FROM drive_files WHERE tree = ?", (tree,))
        ]

    def files_by_id(self, tree: str, file_ids: Iterable[str]) -> list[DriveFile]:
        ids = list(file_ids)
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        rows = self._rows(
            f"SELECT * FROM drive_files WHERE tree = ? AND file_id IN ({marks})", [tree, *ids]
        )
        if len(rows) != len(set(ids)):
            raise DriveError("No such file")
        return [DriveFile(**dict(row)) for row in rows]

    def sync(
        self, tree: str, paths: Iterable[str], keep_under: Iterable[Path] = ()
    ) -> list[DriveFile]:
        """Match the rows to the files on disk: a new file gets a row at the root, and a
        row whose file is gone is dropped. Returns the rows, one per path.

        Rows under `keep_under` (folders that cannot be read right now) stay, and so does
        a row whose file exists after all: it was saved after `paths` was listed.
        """
        present = list(dict.fromkeys(paths))
        unreadable = list(keep_under)
        with self._transaction():
            known = {file.path: file for file in self.files(tree)}
            for path in set(known) - set(present):
                if any(Path(path).is_relative_to(root) for root in unreadable):
                    continue
                if Path(path).exists():
                    present.append(path)
                    continue
                self._write("DELETE FROM drive_files WHERE path = ?", (path,))
            for path in present:
                if path not in known:
                    known[path] = self.add(tree, path, None)
            return [known[path] for path in present]

    def add(self, tree: str, path: str, folder_id: str | None) -> DriveFile:
        """A row for a file just saved, in the folder it was uploaded into."""
        file = DriveFile(uuid.uuid4().hex, tree, path, folder_id, _now())
        self._write(
            "INSERT INTO drive_files (file_id, tree, path, folder_id, added_at) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(path) DO UPDATE SET folder_id = excluded.folder_id",
            (file.file_id, tree, path, folder_id, file.added_at),
        )
        rows = self._rows("SELECT * FROM drive_files WHERE path = ?", (path,))
        return DriveFile(**dict(rows[0]))

    def move_files(self, tree: str, file_ids: list[str], to: str | None) -> None:
        with self._transaction():
            self.folder_in(tree, to)
            self.files_by_id(tree, file_ids)
            for file_id in file_ids:
                self._write(
                    "UPDATE drive_files SET folder_id = ? WHERE file_id = ? AND tree = ?",
                    (to, file_id, tree),
                )

    def adopt(self, old_tree: str, new_tree: str, moved: dict[str, str], home_name: str) -> None:
        """Hand one tree's folders and files to another, all inside a new folder there, so
        no name clashes with one already in it.

        `moved` maps each file's old path to its new one. Every file in it ends up in the
        new tree, in the folder it was in or in the new folder; a row of the old tree
        whose file is not in it is dropped.
        """
        with self._transaction():
            folders = self.folders(old_tree)
            if not folders and not moved:
                self._write("DELETE FROM drive_files WHERE tree = ?", (old_tree,))
                return
            home = self.create_folder(new_tree, None, self._free_name(new_tree, None, home_name))
            self._write(
                "UPDATE drive_folders SET parent_id = ? WHERE tree = ? AND parent_id IS NULL",
                (home.folder_id, old_tree),
            )
            self._write("UPDATE drive_folders SET tree = ? WHERE tree = ?", (new_tree, old_tree))
            placed = {file.path: file.folder_id for file in self.files(old_tree)}
            self._write("DELETE FROM drive_files WHERE tree = ?", (old_tree,))
            for old, new in moved.items():
                self.add(new_tree, new, placed.get(old) or home.folder_id)

    def forget_tree(self, tree: str) -> None:
        """Everything of one tree: its folders and every file's placement."""
        with self._transaction():
            self._write("DELETE FROM drive_files WHERE tree = ?", (tree,))
            self._write("DELETE FROM drive_folders WHERE tree = ?", (tree,))

    def forget(self, path: str) -> None:
        self._write("DELETE FROM drive_files WHERE path = ?", (path,))

    def forget_many(self, paths: list[str]) -> None:
        with self._transaction():
            for path in paths:
                self.forget(path)

    def relocate(self, old: str, new: str) -> None:
        """A file moved by hand on disk keeps its folder."""
        with self._lock:
            before = self._rows("SELECT folder_id FROM drive_files WHERE path = ?", (old,))
            if not before:
                return
            if self._rows("SELECT 1 FROM drive_files WHERE path = ?", (new,)):
                # Already listed at its new place, at the root: give it its folder back.
                self._write(
                    "UPDATE drive_files SET folder_id = ? WHERE path = ?",
                    (before[0]["folder_id"], new),
                )
                self._write("DELETE FROM drive_files WHERE path = ?", (old,))
            else:
                self._write("UPDATE drive_files SET path = ? WHERE path = ?", (new, old))
