# backend/app/api/indexing.py
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from app.deps import Container, get_container
from app.models.request_models import IndexRequest
from app.models.response_models import (
    ClearIndexResponse,
    IndexStartedResponse,
    IndexStatusResponse,
    JobSummary,
)

router = APIRouter(tags=["indexing"])


@router.post("/index", response_model=IndexStartedResponse, status_code=202)
def start_indexing(
    request: IndexRequest,
    background_tasks: BackgroundTasks,
    container: Container = Depends(get_container),
) -> JSONResponse:
    """Reserve a run and hand it to a background task.

    Returns 202 immediately, or 409 if a run is already in progress. Indexing ten PDFs
    takes minutes, so a synchronous handler would time out the browser.
    """
    directory = container.indexing.resolve_directory(request.directory)
    if not container.indexing.start(directory, request.force, trigger=request.trigger):
        return JSONResponse(
            status_code=409,
            content=IndexStartedResponse(
                status="already_running",
                directory=container.indexing.snapshot().directory or str(directory),
            ).model_dump(),
        )

    # A sync function here runs in Starlette's threadpool, so the event loop stays free.
    background_tasks.add_task(container.indexing.run, directory, request.force)
    return JSONResponse(
        status_code=202,
        content=IndexStartedResponse(status="started", directory=str(directory)).model_dump(),
    )


@router.get("/index/status", response_model=IndexStatusResponse)
def index_status(container: Container = Depends(get_container)) -> IndexStatusResponse:
    return container.indexing.snapshot()


@router.get("/index/jobs", response_model=list[JobSummary])
def index_jobs(
    limit: int = Query(default=20, ge=1, le=200),
    container: Container = Depends(get_container),
) -> list[JobSummary]:
    """Past runs, newest first, read from the manifest so they survive a restart."""
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
        )
        for job in container.manifest.recent_jobs(limit)
    ]


@router.post("/index/clear", response_model=ClearIndexResponse)
def clear_index(container: Container = Depends(get_container)) -> ClearIndexResponse:
    """Drop every passage and document record. PDFs and job history are kept."""
    if container.indexing.is_running:
        raise HTTPException(status_code=409, detail="An indexing run is in progress")

    documents, passages = container.indexing.clear_index()
    return ClearIndexResponse(
        documents_removed=documents, passages_removed=passages, files_kept=True
    )
