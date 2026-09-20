# backend/app/api/indexing.py
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import JSONResponse

from app.deps import Container, get_container
from app.models.request_models import IndexRequest
from app.models.response_models import IndexStartedResponse, IndexStatusResponse

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
    if not container.indexing.start(directory, request.force):
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
