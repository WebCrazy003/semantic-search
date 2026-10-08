# backend/app/services/indexing_service.py
"""Indexing orchestration.

The only component that catches per-document exceptions, so the specification's rule
that one bad document must not stop the run lives in exactly one place.

One run at a time, and a queue behind it (2026-10-08 spec §3.3). request_run() either
reserves a run, and the caller hands drain() to a background task, or queues the request
behind the run in progress, which drain() picks up when that finishes. Requests for the
same scope merge while they wait. start() and run() are the older pair, which
POST /api/index and scripts use: start() reserves or refuses, run() runs and then drains
the queue too.

A request may name files (`paths`): uploads, or files indexed by hand. Such a run
processes only those and never sweeps, because a sweep removes every document in scope
that the run did not see, which would be everything else the owner has.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol

from app.logging_config import get_logger
from app.models.domain import ExtractedDocument
from app.models.response_models import IndexFailure, IndexStatusResponse, RunFileView
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
    within,
)
from app.services.qdrant_service import QdrantService

logger = get_logger("indexing")

_MAX_FAILURES_KEPT = 50
_EMBED_SLICE = 256  # bounds peak memory on very large documents


def _now() -> datetime:
    return datetime.now(tz=UTC)


class AccessLookup(Protocol):
    """What indexing needs to know about accounts. AccessStore provides it."""

    def user_ids(self) -> set[str]: ...

    def is_public(self, document_id: str) -> bool: ...

    def carry_public(self, old_id: str, new_id: str) -> bool: ...

    def make_private(self, document_ids: Iterable[str]) -> None: ...


class RunningError(Exception):
    """Refused because an indexing run is in progress."""


@dataclass
class RunRequest:
    """One run asked for: a folder (None for the whole library), or files in it."""

    directory: Path | None
    force: bool = False
    trigger: str = "scan"
    started_by: str | None = None
    scope: str = LIBRARY
    # None: everything under the folder, with a sweep. Otherwise only these files.
    paths: tuple[Path, ...] | None = None

    def merge(self, other: RunRequest) -> bool:
        """Fold a later request for the same thing into this one. False if it differs."""
        if (other.scope, other.directory, other.force) != (self.scope, self.directory, self.force):
            return False
        if self.paths is None or other.paths is None:
            self.paths = None
        else:
            self.paths = tuple(dict.fromkeys(self.paths + other.paths))
        return True


@dataclass
class _RunFile:
    name: str
    state: str = "waiting"
    error: str | None = None
    document_id: str | None = None


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
        # Every file of the run, by path, as it goes from waiting to its outcome.
        self.files: dict[str, _RunFile] = {}


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
        on_relocated: Callable[[str, str], None] | None = None,
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
        # Guards the queue and handing the run lock from one request to the next.
        self._queue_lock = threading.Lock()
        self._queue: list[RunRequest] = []
        self._current: RunRequest | None = None
        # Told when a file turns up at a new path with the same content (old, new), so
        # the document manager can keep it in its folder.
        self.on_relocated = on_relocated

    # ----------------------------------------------------------- reservations

    @property
    def is_running(self) -> bool:
        """A run holds the lock, including between one queued run and the next."""
        return self._run_lock.locked()

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
        request = RunRequest(
            directory=(
                None
                if not directory or Path(directory) == self._default_directory
                else Path(directory)
            ),
            force=force,
            trigger=trigger,
            started_by=started_by,
            scope=scope,
        )
        with self._queue_lock:
            if not self._run_lock.acquire(blocking=False):
                return False
            self._reserve(request)
        return True

    def request_run(self, request: RunRequest) -> Literal["started", "queued"]:
        """Reserve a run ("started": call drain() next) or queue it ("queued")."""
        with self._queue_lock:
            if self._run_lock.acquire(blocking=False):
                self._reserve(request)
                return "started"
            for waiting in self._queue:
                if waiting.merge(request):
                    break
            else:
                self._queue.append(request)
            logger.info("indexing queued for %s", request.scope)
            return "queued"

    def queued(self) -> list[RunRequest]:
        """The requests waiting behind the run in progress, oldest first."""
        with self._queue_lock:
            return [RunRequest(**vars(request)) for request in self._queue]

    def _reserve(self, request: RunRequest) -> None:
        """Make `request` the run in progress. Caller holds the queue lock and the run lock.

        The job row is written here rather than when the run starts, so a job that never
        gets to run still leaves a trace in the history.
        """
        self._current = request
        directory = self.resolve_directory(request.directory)
        with self._state_lock:
            self._state = _State()
            self._state.status = "running"
            self._state.job_id = uuid.uuid4().hex
            self._state.trigger = request.trigger
            self._state.started_by = request.started_by
            self._state.scope = request.scope
            self._state.directory = str(directory)
            self._state.started_at = _now()
            for path in request.paths or ():
                self._state.files[str(path)] = _RunFile(name=path.name)
        self._persist_job()
        logger.info(
            "indexing reserved for %s (force=%s, trigger=%s, files=%s)",
            directory,
            request.force,
            request.trigger,
            "all" if request.paths is None else len(request.paths),
        )

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
                files=[
                    RunFileView(
                        path=path,
                        name=file.name,
                        state=file.state,
                        error=file.error,
                        document_id=file.document_id,
                    )
                    for path, file in state.files.items()
                ],
            )

    # -------------------------------------------------------------------- run

    def run(self, directory: Path | str | None = None, force: bool = False) -> None:
        """Run the reservation taken by start(), then everything queued behind it."""
        current = self._current
        paths = current.paths if current is not None else None
        self._drain(self.resolve_directory(directory), force, paths)

    def drain(self) -> None:
        """Run the request reserved by request_run(), then everything queued behind it."""
        current = self._current
        assert current is not None, "drain() without a reservation"
        self._drain(self.resolve_directory(current.directory), current.force, current.paths)

    def _drain(self, directory: Path, force: bool, paths: tuple[Path, ...] | None) -> None:
        job: tuple[Path, bool, tuple[Path, ...] | None] | None = (directory, force, paths)
        while job is not None:
            try:
                if job[2] is None:
                    self._run(job[0], job[1])
                else:
                    self._run_files(list(job[2]), job[1])
            except Exception:  # the queue behind must still run
                logger.exception("indexing run failed")
                try:
                    self._finish("failed")
                except Exception:
                    logger.exception("could not mark the run failed")
            job = self._next()

    def _next(self) -> tuple[Path, bool, tuple[Path, ...] | None] | None:
        """Reserve the next queued request, or release the run lock if there is none."""
        with self._queue_lock:
            if not self._queue:
                self._current = None
                self._run_lock.release()
                return None
            request = self._queue.pop(0)
            self._reserve(request)
        return self.resolve_directory(request.directory), request.force, request.paths

    def _run_files(self, paths: list[Path], force: bool) -> None:
        """Index exactly these files. No discovery and, above all, no sweep."""
        known_users = self._access.user_ids() if self._access is not None else set()
        present = [path for path in paths if path.is_file() and self._extractors.supports(path)]
        for gone in set(paths) - set(present):
            self._set_file(gone, "failed", "the file is no longer there")
        wanted = self._owned(present, known_users)
        self._process_all(wanted, force)
        self._finish("completed")

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
        logger.info("discovered %d documents under %d folder(s)", len(paths), len(readable))
        seen = self._process_all(paths, force)

        with self._state_lock:
            self._state.current_file = None
            self._state.current_stage = "removing deleted files"
        missing = [root for root in roots if not root.is_dir()]
        self._sweep_deleted(set(seen), None if whole_library else readable, missing)
        self._finish("completed")

    def _process_all(self, paths: list[Path], force: bool) -> dict[str, Path]:
        """Process each file, whatever happens to the others. Returns the ids seen."""
        with self._state_lock:
            self._state.total = len(paths)
            for path in paths:
                self._state.files.setdefault(str(path), _RunFile(name=path.name))
        seen: dict[str, Path] = {}
        for path in paths:
            with self._state_lock:
                self._state.current_file = path.name
                self._state.current_stage = "reading"
                self._state.current_file_progress = 0.0
                before = self._outcomes()
            self._set_file(path, "indexing")
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
                    after = self._outcomes()
                outcome = next(
                    (name for name in after if after[name] > before[name]), "skipped"
                )
                document_id = next((key for key, value in seen.items() if value == path), None)
                failure = self._last_failure_for(path) if outcome == "failed" else None
                self._set_file(path, outcome, failure, document_id)
                self._persist_job()
        return seen

    def _outcomes(self) -> dict[str, int]:
        """The per-file outcome counters. Caller holds the state lock."""
        state = self._state
        return {
            "indexed": state.indexed,
            "unsupported": state.unsupported,
            "failed": state.failed,
            "skipped": state.skipped,
        }

    def _last_failure_for(self, path: Path) -> str | None:
        with self._state_lock:
            for failure in reversed(self._state.failures):
                if failure.filepath == str(path):
                    return failure.error_message
        return None

    def _set_file(
        self,
        path: Path,
        state: str,
        error: str | None = None,
        document_id: str | None = None,
    ) -> None:
        with self._state_lock:
            file = self._state.files.setdefault(str(path), _RunFile(name=path.name))
            file.state = state
            file.error = error
            if document_id is not None:
                file.document_id = document_id

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
        if existing is not None and str(path) not in existing.known_paths:
            # Same content, same owner, new place: a file moved by hand. Its old path is
            # gone, so follow it rather than keep serving a path that 404s.
            if not any(Path(known).exists() for known in existing.known_paths):
                self._relocate(existing, path)
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
                if any(within(Path(known), root) for known in record.known_paths for root in roots)
            ]
        if missing:
            records = [
                record
                for record in records
                if not any(
                    within(Path(known), root) for known in record.known_paths for root in missing
                )
            ]
        for document_id in {record.document_id for record in records} - seen_ids:
            self._qdrant.delete_document(document_id)
            self._manifest.delete(document_id)
            if self._access is not None:
                self._access.make_private([document_id])
            self._bump("deleted")
            logger.info("removed vanished document %s", document_id[:12])

    def _relocate(self, record: DocumentRecord, path: Path) -> None:
        old = record.filepath
        record.filepath = str(path)
        record.filename = path.name
        record.alt_filepaths = [known for known in record.alt_filepaths if Path(known).exists()]
        self._manifest.upsert(record)
        self._qdrant.set_location(record.document_id, str(path), path.name)
        if self.on_relocated is not None:
            self.on_relocated(old, str(path))
        logger.info("followed %s to its new place", path.name)

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
        try:
            self._manifest.upsert_job(job)
        except Exception:
            # History is a record, not the run: failing to write it must never leave
            # the run lock held, which would stop all indexing until a restart.
            logger.exception("could not record indexing job %s", job.job_id)

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

        Returns (documents_removed, passages_removed). Raises RunningError while a run
        holds the lock, so no run can start halfway through.
        """
        with self._queue_lock:
            if not self._run_lock.acquire(blocking=False):
                raise RunningError("An indexing run is in progress")
        try:
            passages = self._qdrant.count_points()
            documents = self._manifest.clear_documents()
            self._qdrant.recreate_collection()
            with self._state_lock:
                self._state = _State()
        finally:
            self._run_lock.release()
        logger.info("cleared the index: %d documents, %d passages", documents, passages)
        return documents, passages
