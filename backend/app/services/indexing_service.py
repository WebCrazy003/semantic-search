# backend/app/services/indexing_service.py
"""Indexing orchestration.

The only component that catches per-document exceptions, so the specification's rule
that one bad PDF must not stop the run lives in exactly one place.

Reservation protocol: the API calls start(), and only if it returns True does it hand
run() to a background task. start() takes the lock and run() releases it, so two
concurrent POSTs cannot both begin a run.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime
from pathlib import Path

from app.logging_config import get_logger
from app.models.domain import ExtractedDocument
from app.models.response_models import IndexFailure, IndexStatusResponse
from app.services.chunk_service import Chunker
from app.services.embedding_service import EmbeddingService
from app.services.manifest_service import DocumentRecord, ManifestService
from app.services.pdf_service import PdfExtractionError, PdfService, PdfUnsupportedError
from app.services.qdrant_service import QdrantService

logger = get_logger("indexing")

_MAX_FAILURES_KEPT = 50
_EMBED_SLICE = 256  # bounds peak memory on very large documents
_IGNORED_PREFIXES = (".", "._")


def _now() -> datetime:
    return datetime.now(tz=UTC)


class _State:
    """Mutable run state behind a lock; snapshot() is the only way out."""

    def __init__(self) -> None:
        self.status: str = "idle"
        self.directory: str | None = None
        self.total = 0
        self.indexed = 0
        self.skipped = 0
        self.unsupported = 0
        self.failed = 0
        self.deleted = 0
        self.chunks = 0
        self.started_at: datetime | None = None
        self.finished_at: datetime | None = None
        self.failures: list[IndexFailure] = []


class IndexingService:
    def __init__(
        self,
        pdf: PdfService,
        chunker: Chunker,
        embedder: EmbeddingService,
        qdrant: QdrantService,
        manifest: ManifestService,
        default_directory: Path,
    ) -> None:
        self._pdf = pdf
        self._chunker = chunker
        self._embedder = embedder
        self._qdrant = qdrant
        self._manifest = manifest
        self._default_directory = default_directory
        self._state = _State()
        self._state_lock = threading.Lock()
        self._run_lock = threading.Lock()

    # ----------------------------------------------------------- reservations

    @property
    def is_running(self) -> bool:
        with self._state_lock:
            return self._state.status == "running"

    def resolve_directory(self, directory: Path | str | None) -> Path:
        return Path(directory) if directory else self._default_directory

    def start(self, directory: Path | str | None, force: bool = False) -> bool:
        """Reserve a run. False means one is already in progress."""
        if not self._run_lock.acquire(blocking=False):
            return False
        with self._state_lock:
            self._state = _State()
            self._state.status = "running"
            self._state.directory = str(self.resolve_directory(directory))
            self._state.started_at = _now()
            reserved = self._state.directory
        logger.info("indexing reserved for %s (force=%s)", reserved, force)
        return True

    def snapshot(self) -> IndexStatusResponse:
        with self._state_lock:
            state = self._state
            return IndexStatusResponse(
                status=state.status,  # type: ignore[arg-type]
                directory=state.directory,
                total_documents=state.total,
                indexed_documents=state.indexed,
                skipped_documents=state.skipped,
                unsupported_documents=state.unsupported,
                failed_documents=state.failed,
                deleted_documents=state.deleted,
                total_chunks=state.chunks,
                started_at=state.started_at,
                finished_at=state.finished_at,
                failures=list(state.failures),
            )

    # -------------------------------------------------------------------- run

    def run(self, directory: Path | str | None = None, force: bool = False) -> None:
        """Run the reservation taken by start(), then release it."""
        try:
            self._run(self.resolve_directory(directory), force)
        finally:
            self._run_lock.release()

    def _run(self, directory: Path, force: bool) -> None:
        if not directory.is_dir():
            self._record_failure(
                filename=directory.name or str(directory),
                filepath=str(directory),
                error_type="DirectoryNotFound",
                error_message=f"directory does not exist: {directory}",
            )
            self._finish("failed")
            return

        paths = self._discover(directory)
        with self._state_lock:
            self._state.total = len(paths)
        logger.info("discovered %d PDF files under %s", len(paths), directory)

        seen: dict[str, Path] = {}
        for path in paths:
            try:
                self._process(path, seen, force)
            except Exception as exc:  # last line of defence; the run continues
                logger.exception("unexpected failure on %s", path)
                self._record_failure(
                    filename=path.name,
                    filepath=str(path),
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                )
                self._mark_document_failed(path, exc)

        self._sweep_deleted(set(seen))
        self._finish("completed")

    @staticmethod
    def _discover(directory: Path) -> list[Path]:
        found = [
            path
            for path in directory.rglob("*")
            if path.is_file()
            and path.suffix.lower() == ".pdf"
            and not path.name.startswith(_IGNORED_PREFIXES)
            and "__MACOSX" not in path.parts
        ]
        return sorted(found)

    def _process(self, path: Path, seen: dict[str, Path], force: bool) -> None:
        file_hash = self._pdf.compute_file_hash(path)
        document_id = file_hash

        if document_id in seen:
            self._record_duplicate(document_id, path)
            return
        seen[document_id] = path

        existing = self._manifest.get(document_id)
        if existing is not None and not force and existing.status in ("indexed", "unsupported"):
            # An unchanged file keeps the verdict it already has, so a repeat run still
            # reports a scanned PDF as unsupported rather than quietly as skipped.
            self._bump("unsupported" if existing.status == "unsupported" else "skipped")
            logger.debug("skipping unchanged %s", path.name)
            return

        try:
            document = self._pdf.extract(path, document_id=document_id, file_hash=file_hash)
        except PdfUnsupportedError as exc:
            logger.warning("unsupported %s: %s", path.name, exc)
            self._store_record(path, document_id, file_hash, None, 0, "unsupported", exc)
            self._bump("unsupported")
            return
        except PdfExtractionError as exc:
            logger.warning("failed %s: %s", path.name, exc)
            self._record_failure(path.name, str(path), type(exc).__name__, str(exc))
            self._store_record(path, document_id, file_hash, None, 0, "failed", exc)
            self._bump("failed")
            return

        chunks = self._chunker.chunk_document(document)
        if not chunks:
            reason = PdfUnsupportedError(f"{path.name} produced no passages")
            self._store_record(path, document_id, file_hash, document, 0, "unsupported", reason)
            self._bump("unsupported")
            return

        # Always clear first: a re-index that yields fewer chunks must not leave the
        # previous run's surplus points behind.
        self._qdrant.delete_document(document_id)
        for start in range(0, len(chunks), _EMBED_SLICE):
            batch = chunks[start : start + _EMBED_SLICE]
            vectors = self._embedder.embed_documents([chunk.text for chunk in batch])
            self._qdrant.upsert_chunks(batch, vectors, document.meta)

        self._store_record(path, document_id, file_hash, document, len(chunks), "indexed", None)
        self._bump("indexed")
        with self._state_lock:
            self._state.chunks += len(chunks)
        logger.info(
            "indexed %s: pages=%d chunks=%d", path.name, len(document.pages), len(chunks)
        )

    def _sweep_deleted(self, seen_ids: set[str]) -> None:
        """Remove entries for ids that no file on disk produces any more.

        Covers deleted files and the stale ids left behind by modified ones, because a
        modified file hashes to a new id.
        """
        for document_id in self._manifest.document_ids() - seen_ids:
            self._qdrant.delete_document(document_id)
            self._manifest.delete(document_id)
            self._bump("deleted")
            logger.info("removed vanished document %s", document_id[:12])

    # ------------------------------------------------------------ bookkeeping

    def _store_record(
        self,
        path: Path,
        document_id: str,
        file_hash: str,
        document: ExtractedDocument | None,
        chunks: int,
        status: str,
        error: Exception | None,
    ) -> None:
        existing = self._manifest.get(document_id)
        self._manifest.upsert(
            DocumentRecord(
                document_id=document_id,
                filename=path.name,
                filepath=str(path),
                file_hash=file_hash,
                file_size=path.stat().st_size if path.exists() else 0,
                modified_at=document.meta.modified_at if document else _now(),
                pages=len(document.pages) if document else 0,
                chunks=chunks,
                language=document.meta.language if document else None,
                title=document.meta.title if document else None,
                status=status,
                error_type=type(error).__name__ if error else None,
                error_message=str(error) if error else None,
                indexed_at=_now(),
                alt_filepaths=existing.alt_filepaths if existing else [],
            )
        )

    def _mark_document_failed(self, path: Path, error: Exception) -> None:
        try:
            file_hash = self._pdf.compute_file_hash(path)
        except Exception:
            return
        self._store_record(path, file_hash, file_hash, None, 0, "failed", error)
        self._bump("failed")

    def _record_duplicate(self, document_id: str, path: Path) -> None:
        record = self._manifest.get(document_id)
        if record is not None and str(path) not in record.known_paths:
            record.alt_filepaths = [*record.alt_filepaths, str(path)]
            self._manifest.upsert(record)
        self._bump("skipped")
        logger.info("duplicate content, indexed once: %s", path)

    def _record_failure(
        self, filename: str, filepath: str, error_type: str, error_message: str
    ) -> None:
        with self._state_lock:
            if len(self._state.failures) < _MAX_FAILURES_KEPT:
                self._state.failures.append(
                    IndexFailure(
                        filename=filename,
                        filepath=filepath,
                        error_type=error_type,
                        error_message=error_message,
                        timestamp=_now(),
                    )
                )

    def _bump(self, counter: str) -> None:
        with self._state_lock:
            setattr(self._state, counter, getattr(self._state, counter) + 1)

    def _finish(self, status: str) -> None:
        with self._state_lock:
            self._state.status = status
            self._state.finished_at = _now()
            state = self._state
        logger.info(
            "indexing %s: indexed=%d skipped=%d unsupported=%d failed=%d deleted=%d chunks=%d",
            status,
            state.indexed,
            state.skipped,
            state.unsupported,
            state.failed,
            state.deleted,
            state.chunks,
        )
