# backend/app/services/manifest_service.py
"""SQLite document manifest.

This is a derived cache, not a second source of truth. Qdrant holds the vectors and
the passage text; this holds per-document bookkeeping so that deciding "has this file
changed" and answering GET /api/documents are both O(documents) rather than
O(passages). scripts/rebuild_manifest.py regenerates it from Qdrant.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from app.logging_config import get_logger

logger = get_logger("manifest")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    document_id   TEXT PRIMARY KEY,
    filename      TEXT NOT NULL,
    filepath      TEXT NOT NULL,
    file_hash     TEXT NOT NULL,
    file_size     INTEGER NOT NULL,
    modified_at   TEXT NOT NULL,
    pages         INTEGER NOT NULL DEFAULT 0,
    chunks        INTEGER NOT NULL DEFAULT 0,
    language      TEXT,
    title         TEXT,
    status        TEXT NOT NULL,
    error_type    TEXT,
    error_message TEXT,
    indexed_at    TEXT NOT NULL,
    alt_filepaths TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);

CREATE TABLE IF NOT EXISTS index_jobs (
    job_id        TEXT PRIMARY KEY,
    trigger       TEXT NOT NULL,
    directory     TEXT NOT NULL,
    status        TEXT NOT NULL,
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    total         INTEGER NOT NULL DEFAULT 0,
    processed     INTEGER NOT NULL DEFAULT 0,
    indexed       INTEGER NOT NULL DEFAULT 0,
    skipped       INTEGER NOT NULL DEFAULT 0,
    unsupported   INTEGER NOT NULL DEFAULT 0,
    failed        INTEGER NOT NULL DEFAULT 0,
    deleted       INTEGER NOT NULL DEFAULT 0,
    chunks        INTEGER NOT NULL DEFAULT 0,
    failures      TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_jobs_started ON index_jobs(started_at DESC);

CREATE TABLE IF NOT EXISTS library_folders (
    path     TEXT PRIMARY KEY,
    added_at TEXT NOT NULL
);
"""

_JOB_COLUMNS = (
    "job_id",
    "trigger",
    "directory",
    "status",
    "started_at",
    "finished_at",
    "total",
    "processed",
    "indexed",
    "skipped",
    "unsupported",
    "failed",
    "deleted",
    "chunks",
    "failures",
)

_COLUMNS = (
    "document_id",
    "filename",
    "filepath",
    "file_hash",
    "file_size",
    "modified_at",
    "pages",
    "chunks",
    "language",
    "title",
    "status",
    "error_type",
    "error_message",
    "indexed_at",
    "alt_filepaths",
)


@dataclass
class DocumentRecord:
    document_id: str
    filename: str
    filepath: str
    file_hash: str
    file_size: int
    modified_at: datetime
    pages: int
    chunks: int
    language: str | None
    title: str | None
    status: str  # indexed | skipped | failed | unsupported
    error_type: str | None
    error_message: str | None
    indexed_at: datetime
    alt_filepaths: list[str] = field(default_factory=list)

    @property
    def known_paths(self) -> list[str]:
        """Every place this exact content has been seen, primary path first."""
        return [self.filepath, *self.alt_filepaths]


@dataclass(frozen=True)
class FolderRecord:
    """A folder the user asked to index in place. Its PDFs are never copied."""

    path: str
    added_at: datetime


@dataclass
class JobRecord:
    """One indexing run, kept after it finishes so the UI can show a history."""

    job_id: str
    trigger: str  # scan | upload
    directory: str
    status: str  # running | completed | failed
    started_at: datetime
    finished_at: datetime | None = None
    total: int = 0
    processed: int = 0
    indexed: int = 0
    skipped: int = 0
    unsupported: int = 0
    failed: int = 0
    deleted: int = 0
    chunks: int = 0
    failures: list[dict[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class ManifestTotals:
    documents: int
    pages: int
    chunks: int


class ManifestService:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._connection: sqlite3.Connection | None = None

    def initialise(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        connection = self._connect()
        with connection:
            connection.executescript(_SCHEMA)
        logger.info("manifest ready at %s", self._path)

    def _connect(self) -> sqlite3.Connection:
        if self._connection is None:
            # check_same_thread=False: indexing runs in a background thread while API
            # requests read from the event loop's threadpool. Writes are serialised by
            # SQLite itself and every write here is a single statement.
            self._connection = sqlite3.connect(
                self._path, check_same_thread=False, isolation_level=None
            )
            self._connection.row_factory = sqlite3.Row
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA busy_timeout=5000")
        return self._connection

    # ------------------------------------------------------------------ write

    def upsert(self, record: DocumentRecord) -> None:
        placeholders = ", ".join("?" for _ in _COLUMNS)
        assignments = ", ".join(f"{name}=excluded.{name}" for name in _COLUMNS[1:])
        connection = self._connect()
        with connection:
            connection.execute(
                f"INSERT INTO documents ({', '.join(_COLUMNS)}) VALUES ({placeholders}) "
                f"ON CONFLICT(document_id) DO UPDATE SET {assignments}",
                self._to_row(record),
            )

    def delete(self, document_id: str) -> None:
        connection = self._connect()
        with connection:
            connection.execute("DELETE FROM documents WHERE document_id = ?", (document_id,))

    def replace_all(self, records: list[DocumentRecord]) -> None:
        """Used by the rebuild script. Atomic: readers see old or new, never partial."""
        connection = self._connect()
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM documents")
            placeholders = ", ".join("?" for _ in _COLUMNS)
            connection.executemany(
                f"INSERT INTO documents ({', '.join(_COLUMNS)}) VALUES ({placeholders})",
                [self._to_row(record) for record in records],
            )

    # ------------------------------------------------------------------- read

    def get(self, document_id: str) -> DocumentRecord | None:
        row = (
            self._connect()
            .execute("SELECT * FROM documents WHERE document_id = ?", (document_id,))
            .fetchone()
        )
        return self._from_row(row) if row else None

    def all_documents(self) -> list[DocumentRecord]:
        rows = self._connect().execute("SELECT * FROM documents ORDER BY filename").fetchall()
        return [self._from_row(row) for row in rows]

    def document_ids(self) -> set[str]:
        rows = self._connect().execute("SELECT document_id FROM documents").fetchall()
        return {row["document_id"] for row in rows}

    def totals(self) -> ManifestTotals:
        row = (
            self._connect()
            .execute(
                "SELECT COUNT(*) AS documents, COALESCE(SUM(pages), 0) AS pages, "
                "COALESCE(SUM(chunks), 0) AS chunks FROM documents WHERE status = 'indexed'"
            )
            .fetchone()
        )
        return ManifestTotals(
            documents=int(row["documents"]), pages=int(row["pages"]), chunks=int(row["chunks"])
        )

    def status_breakdown(self) -> dict[str, int]:
        rows = self._connect().execute(
            "SELECT status, COUNT(*) AS count FROM documents GROUP BY status"
        )
        return {str(row["status"]): int(row["count"]) for row in rows}

    def describe(self) -> list[dict[str, object]]:
        """The database's real shape, for the admin page.

        Read with PRAGMA rather than returned from the _SCHEMA literal above, so the
        page shows what the file actually contains. A copy of the DDL would keep
        claiming a column exists after a migration removed it.
        """
        connection = self._connect()
        names = [
            str(row["name"])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        tables: list[dict[str, object]] = []
        for name in names:
            # The table names come from sqlite_master, not from a request, so they can
            # be interpolated; PRAGMA takes no parameters.
            columns = [
                {
                    "name": str(row["name"]),
                    "type": str(row["type"]),
                    "notnull": bool(row["notnull"]),
                    "pk": bool(row["pk"]),
                }
                for row in connection.execute(f"PRAGMA table_info({name})")
            ]
            indexes = sorted(
                str(row["name"]) for row in connection.execute(f"PRAGMA index_list({name})")
            )
            count = connection.execute(f"SELECT COUNT(*) AS count FROM {name}").fetchone()
            tables.append(
                {
                    "name": name,
                    "rows": int(count["count"]),
                    "columns": columns,
                    "indexes": indexes,
                }
            )
        return tables

    # ------------------------------------------------------------------- jobs

    def upsert_job(self, job: JobRecord) -> None:
        placeholders = ", ".join("?" for _ in _JOB_COLUMNS)
        assignments = ", ".join(f"{name}=excluded.{name}" for name in _JOB_COLUMNS[1:])
        connection = self._connect()
        with connection:
            connection.execute(
                f"INSERT INTO index_jobs ({', '.join(_JOB_COLUMNS)}) VALUES ({placeholders}) "
                f"ON CONFLICT(job_id) DO UPDATE SET {assignments}",
                self._job_to_row(job),
            )

    def get_job(self, job_id: str) -> JobRecord | None:
        row = (
            self._connect()
            .execute("SELECT * FROM index_jobs WHERE job_id = ?", (job_id,))
            .fetchone()
        )
        return self._job_from_row(row) if row else None

    def recent_jobs(self, limit: int = 20) -> list[JobRecord]:
        rows = (
            self._connect()
            .execute("SELECT * FROM index_jobs ORDER BY started_at DESC LIMIT ?", (limit,))
            .fetchall()
        )
        return [self._job_from_row(row) for row in rows]

    def abandon_running_jobs(self) -> int:
        """Mark jobs left 'running' by a crash or restart as failed.

        Without this a killed process leaves a job that never completes, and the UI
        would show a run in progress forever.
        """
        connection = self._connect()
        with connection:
            cursor = connection.execute(
                "UPDATE index_jobs SET status = 'failed', finished_at = ? "
                "WHERE status = 'running'",
                (datetime.now(tz=UTC).isoformat(),),
            )
        return int(cursor.rowcount or 0)

    # ---------------------------------------------------------- folders

    def add_folder(self, path: Path, added_at: datetime | None = None) -> FolderRecord:
        record = FolderRecord(path=str(path), added_at=added_at or datetime.now(tz=UTC))
        connection = self._connect()
        with connection:
            connection.execute(
                "INSERT INTO library_folders (path, added_at) VALUES (?, ?) "
                "ON CONFLICT(path) DO NOTHING",
                (record.path, record.added_at.isoformat()),
            )
        return record

    def remove_folder(self, path: Path | str) -> bool:
        connection = self._connect()
        with connection:
            cursor = connection.execute(
                "DELETE FROM library_folders WHERE path = ?", (str(path),)
            )
        return bool(cursor.rowcount)

    def folders(self) -> list[FolderRecord]:
        rows = self._connect().execute("SELECT * FROM library_folders ORDER BY path").fetchall()
        return [
            FolderRecord(path=row["path"], added_at=datetime.fromisoformat(row["added_at"]))
            for row in rows
        ]

    # ------------------------------------------------------------ bulk delete

    def clear_documents(self) -> int:
        """Drop every document record, keeping the job history."""
        connection = self._connect()
        with connection:
            cursor = connection.execute("DELETE FROM documents")
        return int(cursor.rowcount or 0)

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    # ------------------------------------------------------------- conversion

    @staticmethod
    def _to_row(record: DocumentRecord) -> tuple[object, ...]:
        return (
            record.document_id,
            record.filename,
            record.filepath,
            record.file_hash,
            record.file_size,
            record.modified_at.isoformat(),
            record.pages,
            record.chunks,
            record.language,
            record.title,
            record.status,
            record.error_type,
            record.error_message,
            record.indexed_at.isoformat(),
            json.dumps(record.alt_filepaths),
        )

    @staticmethod
    def _job_to_row(job: JobRecord) -> tuple[object, ...]:
        return (
            job.job_id,
            job.trigger,
            job.directory,
            job.status,
            job.started_at.isoformat(),
            job.finished_at.isoformat() if job.finished_at else None,
            job.total,
            job.processed,
            job.indexed,
            job.skipped,
            job.unsupported,
            job.failed,
            job.deleted,
            job.chunks,
            json.dumps(job.failures),
        )

    @staticmethod
    def _job_from_row(row: sqlite3.Row) -> JobRecord:
        return JobRecord(
            job_id=row["job_id"],
            trigger=row["trigger"],
            directory=row["directory"],
            status=row["status"],
            started_at=datetime.fromisoformat(row["started_at"]),
            finished_at=(
                datetime.fromisoformat(row["finished_at"]) if row["finished_at"] else None
            ),
            total=int(row["total"]),
            processed=int(row["processed"]),
            indexed=int(row["indexed"]),
            skipped=int(row["skipped"]),
            unsupported=int(row["unsupported"]),
            failed=int(row["failed"]),
            deleted=int(row["deleted"]),
            chunks=int(row["chunks"]),
            failures=json.loads(row["failures"] or "[]"),
        )

    @staticmethod
    def _from_row(row: sqlite3.Row) -> DocumentRecord:
        return DocumentRecord(
            document_id=row["document_id"],
            filename=row["filename"],
            filepath=row["filepath"],
            file_hash=row["file_hash"],
            file_size=int(row["file_size"]),
            modified_at=datetime.fromisoformat(row["modified_at"]),
            pages=int(row["pages"]),
            chunks=int(row["chunks"]),
            language=row["language"],
            title=row["title"],
            status=row["status"],
            error_type=row["error_type"],
            error_message=row["error_message"],
            indexed_at=datetime.fromisoformat(row["indexed_at"]),
            alt_filepaths=json.loads(row["alt_filepaths"] or "[]"),
        )
