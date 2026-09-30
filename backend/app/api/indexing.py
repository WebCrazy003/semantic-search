# backend/app/api/indexing.py
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from app.auth import active_user, admin_user
from app.deps import Container, get_container
from app.models.request_models import IndexRequest
from app.models.response_models import (
    ClearIndexResponse,
    DeviceUsageView,
    IndexStartedResponse,
    IndexStatusResponse,
    JobSummary,
)
from app.services.access_store import User
from app.services.device_usage import usage_as_dict
from app.services.ownership import LIBRARY, user_folder

router = APIRouter(tags=["indexing"])


@router.post("/index", response_model=IndexStartedResponse, status_code=202)
def start_indexing(
    request: IndexRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> JSONResponse:
    """Reserve a run and hand it to a background task.

    Returns 202 immediately, or 409 if a run is already in progress. Indexing ten PDFs
    takes minutes, so a synchronous handler would time out the browser.

    A user's run always covers their own uploads and nothing else, whatever directory
    the request names. An admin indexes the whole library, one folder, or one user's
    uploads (`scope`).
    """
    if user.is_admin and request.scope is None:
        directory = container.indexing.resolve_directory(request.directory)
        scope, trigger = LIBRARY, request.trigger
    else:
        scope = user.user_id if not user.is_admin else str(request.scope)
        if user.is_admin and container.access.get_user(scope) is None:
            raise HTTPException(status_code=404, detail="No such user")
        directory = user_folder(container.settings.pdf_directory, scope)
        directory.mkdir(parents=True, exist_ok=True)
        trigger = "upload" if not user.is_admin else request.trigger

    if not container.indexing.start(
        directory, request.force, trigger=trigger, started_by=user.user_id, scope=scope
    ):
        snapshot = container.indexing.snapshot()
        visible = user.is_admin or snapshot.scope == user.user_id
        return JSONResponse(
            status_code=409,
            content=IndexStartedResponse(
                status="already_running",
                directory=(snapshot.directory or str(directory)) if visible else "",
            ).model_dump(),
        )

    # A sync function here runs in Starlette's threadpool, so the event loop stays free.
    background_tasks.add_task(container.indexing.run, directory, request.force)
    return JSONResponse(
        status_code=202,
        content=IndexStartedResponse(status="started", directory=str(directory)).model_dump(),
    )


@router.get("/index/status", response_model=IndexStatusResponse)
def index_status(
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> IndexStatusResponse:
    """The run's progress, and while it is running, what the GPU or CPU is doing.

    Someone else's run shows only that it is running and how far along it is: never
    its folder, its filenames or its failures.

    The usage is sampled here rather than inside the indexing service: it is a property
    of the machine, not of the job, and sampling it outside the service's state lock
    keeps a slow reading from blocking the run.
    """
    snapshot = container.indexing.snapshot()
    if not user.is_admin and snapshot.scope != user.user_id:
        snapshot = snapshot.model_copy(
            update={"directory": None, "current_file": None, "failures": []}
        )
    if snapshot.status != "running" or container.device_monitor is None:
        return snapshot

    usage = container.device_monitor.sample()
    return snapshot.model_copy(update={"device": DeviceUsageView(**usage_as_dict(usage))})


@router.get("/index/jobs", response_model=list[JobSummary])
def index_jobs(
    limit: int = Query(default=20, ge=1, le=200),
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> list[JobSummary]:
    """Past runs, newest first, read from the manifest so they survive a restart.

    A user sees the runs over their own uploads; an admin sees every run.
    """
    scope = None if user.is_admin else user.user_id
    names = container.access.usernames() if user.is_admin else {}
    return [
        JobSummary(
            job_id=job.job_id,
            trigger=job.trigger,
            directory=job.directory,
            status=job.status,
            started_at=job.started_at,
            finished_at=job.finished_at,
            total=job.total,
            processed=job.processed,
            indexed=job.indexed,
            skipped=job.skipped,
            unsupported=job.unsupported,
            failed=job.failed,
            deleted=job.deleted,
            chunks=job.chunks,
            failures=job.failures,
            scope=job.scope,
            started_by_username=names.get(job.started_by or ""),
        )
        for job in container.manifest.recent_jobs(limit, scope=scope)
    ]


@router.post("/index/clear", response_model=ClearIndexResponse, dependencies=[Depends(admin_user)])
def clear_index(container: Container = Depends(get_container)) -> ClearIndexResponse:
    """Drop every passage and document record, for every user.

    Files, job history and which documents are public are all kept, so a full rescan
    brings every document back with its owner and its visibility.
    """
    if container.indexing.is_running:
        raise HTTPException(status_code=409, detail="An indexing run is in progress")

    documents, passages = container.indexing.clear_index()
    return ClearIndexResponse(
        documents_removed=documents, passages_removed=passages, files_kept=True
    )
