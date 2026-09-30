# backend/app/services/indexing_service.py
"""Indexing orchestration.

The only component that catches per-document exceptions, so the specification's rule
that one bad document must not stop the run lives in exactly one place.

Reservation protocol: the API calls start(), and only if it returns True does it hand
run() to a background task. start() takes the lock and run() releases it, so two
concurrent POSTs cannot both begin a run.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from app.logging_config import get_logger
from app.models.domain import ExtractedDocument
from app.models.response_models import IndexFailure, IndexStatusResponse
from app.services.chunk_service import Chunker
from app.services.embedding_service import EmbeddingService
from app.services.extractors import (
    ExtractionError,
    ExtractionUnsupportedError,
    ExtractorRegistry,
)
from app.services.manifest_service import DocumentRecord, JobRecord, ManifestService
from app.services.ownership import (
    LIBRARY,
    PRIVATE,
    PUBLIC,
    document_id_for,
    owner_for,
    users_root,
)
from app.services.qdrant_service import QdrantService

logger = get_logger("indexing")

_MAX_FAILURES_KEPT = 50
_EMBED_SLICE = 256  # bounds peak memory on very large documents


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _within(path: Path, folder: Path) -> bool:
    try:
        return path.is_relative_to(folder)
    except ValueError:  # different drives on Windows
        return False


class AccessLookup(Protocol):
    """What indexing needs to know about accounts. AccessStore provides it."""

    def user_ids(self) -> set[str]: ...

    def is_public(self, document_id: str) -> bool: ...

    def carry_public(self, old_id: str, new_id: str) -> bool: ...

    def make_private(self, document_ids: Iterable[str]) -> None: ...


class _State:
    """Mutable run state behind a lock; snapshot() is the only way out."""

    def __init__(self) -> None:
        self.status: str = "idle"
        self.job_id: str | None = None
        self.trigger: str = "scan"
        self.directory: str | None = None
        self.started_by: str | None = None
        self.scope: str = LIBRARY
        self.current_file: str | None = None
        self.current_stage: str | None = None
        self.current_file_progress: float = 0.0
        self.processed = 0
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
        extractors: ExtractorRegistry,
        chunker: Chunker,
        embedder: EmbeddingService,
        qdrant: QdrantService,
        manifest: ManifestService,
        default_directory: Path,
        access: AccessLookup | None = None,
    ) -> None:
        self._extractors = extractors
        self._chunker = chunker
        self._embedder = embedder
        self._qdrant = qdrant
        self._manifest = manifest
        self._default_directory = default_directory
        # Without it (scripts, unit tests) everything is library and private.
        self._access = access
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

    def roots(self, directory: Path | str | None = None) -> list[Path]:
        """Every folder a run covers: the one asked for, or the whole library.

        The library is the default documents folder plus the folders registered by
        the user, whose documents stay where they are and are never copied.
        """
        if directory:
            return [Path(directory)]
        found = [self._default_directory]
        for record in self._manifest.folders():
            path = Path(record.path)
            if path not in found:
                found.append(path)
        return found

    def start(
        self,
        directory: Path | str | None,
        force: bool = False,
        trigger: str = "scan",
        started_by: str | None = None,
        scope: str = LIBRARY,
    ) -> bool:
        """Reserve a run. False means one is already in progress.

        The job row is written here rather than in run(), so a job that never gets to
        run still leaves a trace in the history.
        """
        if not self._run_lock.acquire(blocking=False):
            return False
        with self._state_lock:
            self._state = _State()
            self._state.status = "running"
            self._state.job_id = uuid.uuid4().hex
            self._state.trigger = trigger
            self._state.started_by = started_by
            self._state.scope = scope
            self._state.directory = str(self.resolve_directory(directory))
            self._state.started_at = _now()
            reserved = self._state.directory
        self._persist_job()
        logger.info("indexing reserved for %s (force=%s, trigger=%s)", reserved, force, trigger)
        return True

    def snapshot(self) -> IndexStatusResponse:
        with self._state_lock:
            state = self._state
            return IndexStatusResponse(
                status=state.status,  # type: ignore[arg-type]
                job_id=state.job_id,
                trigger=state.trigger,
                scope=state.scope,
                directory=state.directory,
                current_file=state.current_file,
                current_stage=state.current_stage,
                current_file_progress=round(state.current_file_progress, 3),
                processed_documents=state.processed,
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
        whole_library = directory == self._default_directory
        roots = self.roots(None if whole_library else directory)
        readable = [root for root in roots if root.is_dir()]
        for missing in [root for root in roots if not root.is_dir()]:
            # A registered folder on an unplugged drive must not abort the run.
            logger.warning("folder is not readable, skipping: %s", missing)
            self._record_failure(
                filename=missing.name or str(missing),
                filepath=str(missing),
                error_type="DirectoryNotFound",
                error_message=f"folder is not readable: {missing}",
            )

        if not readable:
            self._finish("failed")
            return

        known_users = self._access.user_ids() if self._access is not None else set()
        paths: list[Path] = []
        for root in readable:
            paths.extend(self._owned(self._discover(root), known_users))
        with self._state_lock:
            self._state.total = len(paths)
        logger.info("discovered %d documents under %d folder(s)", len(paths), len(readable))

        seen: dict[str, Path] = {}
        for path in paths:
            with self._state_lock:
                self._state.current_file = path.name
                self._state.current_stage = "reading"
                self._state.current_file_progress = 0.0
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
            finally:
                with self._state_lock:
                    self._state.processed += 1
                self._persist_job()

        with self._state_lock:
            self._state.current_file = None
            self._state.current_stage = "removing deleted files"
        missing = [root for root in roots if not root.is_dir()]
        self._sweep_deleted(set(seen), None if whole_library else readable, missing)
        self._finish("completed")

    def _discover(self, directory: Path) -> list[Path]:
        found = [
            path
            for path in directory.rglob("*")
            if path.is_file()
            and self._extractors.supports(path)
        ]
        return sorted(found)

    def _owned(self, paths: list[Path], known_users: set[str]) -> list[Path]:
        """Drop files that belong to nobody.

        That is a file sitting directly in users/, or one in the folder of a user who no
        longer exists. Indexing either as library would hand someone's uploads to
        whoever can see the library.
        """
        kept: list[Path] = []
        warned: set[str] = set()
        for path in paths:
            owner = owner_for(path, self._default_directory)
            if owner is not None and (owner == LIBRARY or owner in known_users):
                kept.append(path)
                continue
            label = owner or str(users_root(self._default_directory))
            if label not in warned:
                warned.add(label)
                logger.warning("skipping files with no owner under %s", label)
        return kept

    def _identify(self, path: Path, file_hash: str) -> tuple[str, str]:
        owner = owner_for(path, self._default_directory) or LIBRARY
        return owner, document_id_for(owner, file_hash)

    def _visibility_for(self, document_id: str, path: Path) -> str:
        """Public if an admin made it public, including an earlier version of this file.

        A modified file hashes to a new id. Carrying the flag across means publishing a
        manual once survives someone saving a new version of it.
        """
        if self._access is None:
            return PRIVATE
        if self._access.is_public(document_id):
            return PUBLIC
        for previous in self._manifest.documents_at(str(path)):
            if previous.document_id != document_id and self._access.carry_public(
                previous.document_id, document_id
            ):
                return PUBLIC
        return PRIVATE

    def _process(self, path: Path, seen: dict[str, Path], force: bool) -> None:
        file_hash = self._extractors.compute_file_hash(path)
        owner_id, document_id = self._identify(path, file_hash)

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

        self._stage("extracting")
        try:
            extractor = self._extractors.for_path(path)
            if extractor is None:
                raise ExtractionUnsupportedError(f"{path.name}: unsupported file type")
            document = extractor.extract(path, document_id=document_id, file_hash=file_hash)
        except ExtractionUnsupportedError as exc:
            logger.warning("unsupported %s: %s", path.name, exc)
            self._store_record(
                path, document_id, file_hash, None, 0, "unsupported", exc, owner_id
            )
            self._bump("unsupported")
            return
        except ExtractionError as exc:
            logger.warning("failed %s: %s", path.name, exc)
            self._record_failure(path.name, str(path), type(exc).__name__, str(exc))
            self._store_record(path, document_id, file_hash, None, 0, "failed", exc, owner_id)
            self._bump("failed")
            return

        self._stage("splitting into passages")
        chunks = self._chunker.chunk_document(document)
        if not chunks:
            reason = ExtractionUnsupportedError(f"{path.name} produced no passages")
            self._store_record(
                path, document_id, file_hash, document, 0, "unsupported", reason, owner_id
            )
            self._bump("unsupported")
            return

        visibility = self._visibility_for(document_id, path)

        # Always clear first: a re-index that yields fewer chunks must not leave the
        # previous run's surplus points behind.
        self._qdrant.delete_document(document_id)
        self._stage("embedding", 0.0)
        for start in range(0, len(chunks), _EMBED_SLICE):
            batch = chunks[start : start + _EMBED_SLICE]
            vectors = self._embedder.embed_documents([chunk.text for chunk in batch])
            self._qdrant.upsert_chunks(batch, vectors, document.meta, owner_id, visibility)
            # Counted here rather than after the loop, so a long document's passage
            # count climbs while it is being embedded instead of jumping at the end.
            with self._state_lock:
                self._state.chunks += len(batch)
                self._state.current_file_progress = min(
                    1.0, (start + len(batch)) / max(1, len(chunks))
                )

        self._store_record(
            path, document_id, file_hash, document, len(chunks), "indexed", None, owner_id,
            visibility,
        )
        self._bump("indexed")
        logger.info(
            "indexed %s: pages=%d chunks=%d", path.name, len(document.pages), len(chunks)
        )

    def _sweep_deleted(
        self,
        seen_ids: set[str],
        roots: list[Path] | None = None,
        missing: list[Path] | None = None,
    ) -> None:
        """Remove entries for ids that no file on disk produces any more.

        Covers deleted files and the stale ids left behind by modified ones, because a
        modified file hashes to a new id.

        Only documents the run could have seen are candidates: with `roots`, those with
        a path under one of them, so indexing one user's folder never touches anybody
        else's documents. Documents under a folder that could not be read are never
        candidates, so an unplugged drive does not empty its part of the library.
        """
        records = self._manifest.all_documents()
        if roots is not None:
            records = [
                record
                for record in records
                if any(_within(Path(known), root) for known in record.known_paths for root in roots)
            ]
        if missing:
            records = [
                record
                for record in records
                if not any(
                    _within(Path(known), root) for known in record.known_paths for root in missing
                )
            ]
        for document_id in {record.document_id for record in records} - seen_ids:
            self._qdrant.delete_document(document_id)
            self._manifest.delete(document_id)
            if self._access is not None:
                self._access.make_private([document_id])
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
        owner_id: str = LIBRARY,
        visibility: str | None = None,
    ) -> None:
        existing = self._manifest.get(document_id)
        if visibility is None:
            visibility = self._visibility_for(document_id, path)
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
                owner_id=owner_id,
                visibility=visibility,
            )
        )

    def _mark_document_failed(self, path: Path, error: Exception) -> None:
        try:
            file_hash = self._extractors.compute_file_hash(path)
        except Exception:
            return
        owner_id, document_id = self._identify(path, file_hash)
        self._store_record(path, document_id, file_hash, None, 0, "failed", error, owner_id)
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

    def _stage(self, stage: str, progress: float | None = None) -> None:
        with self._state_lock:
            self._state.current_stage = stage
            if progress is not None:
                self._state.current_file_progress = progress

    def _bump(self, counter: str) -> None:
        with self._state_lock:
            setattr(self._state, counter, getattr(self._state, counter) + 1)

    def _finish(self, status: str) -> None:
        with self._state_lock:
            self._state.status = status
            self._state.current_file = None
            self._state.current_stage = None
            self._state.current_file_progress = 0.0
            self._state.finished_at = _now()
            state = self._state
        self._persist_job()
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

    def _persist_job(self) -> None:
        """Mirror the in-memory run state into the manifest's job history.

        Called once per document so a crashed or restarted process still leaves an
        accurate record of how far the run got.
        """
        with self._state_lock:
            state = self._state
            if state.job_id is None:
                return
            job = JobRecord(
                job_id=state.job_id,
                trigger=state.trigger,
                directory=state.directory or "",
                status=state.status,
                started_at=state.started_at or _now(),
                finished_at=state.finished_at,
                total=state.total,
                processed=state.processed,
                indexed=state.indexed,
                skipped=state.skipped,
                unsupported=state.unsupported,
                failed=state.failed,
                deleted=state.deleted,
                chunks=state.chunks,
                started_by=state.started_by,
                scope=state.scope,
                failures=[
                    {
                        "filename": failure.filename,
                        "error_type": failure.error_type,
                        "error_message": failure.error_message,
                    }
                    for failure in state.failures
                ],
            )
        self._manifest.upsert_job(job)

    # --------------------------------------------------------------- removals

    def remove_document(self, document_id: str) -> DocumentRecord | None:
        """Unindex one document: its passages and its manifest row go, the file stays.

        A later scan re-indexes the file, which is the documented behaviour: this
        removes it from search, it does not delete anything from disk.
        """
        record = self._manifest.get(document_id)
        if record is None:
            return None
        self._qdrant.delete_document(document_id)
        self._manifest.delete(document_id)
        if self._access is not None:
            self._access.make_private([document_id])
        logger.info("removed %s from the index", record.filename)
        return record

    def clear_index(self) -> tuple[int, int]:
        """Drop every passage and every document record. Files and history survive.

        Returns (documents_removed, passages_removed).
        """
        passages = self._qdrant.count_points()
        documents = self._manifest.clear_documents()
        self._qdrant.recreate_collection()
        with self._state_lock:
            self._state = _State()
        logger.info("cleared the index: %d documents, %d passages", documents, passages)
        return documents, passages
