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
from datetime import datetime
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
"""

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
