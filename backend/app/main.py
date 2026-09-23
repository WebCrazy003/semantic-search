# backend/app/main.py
"""Application factory and lifespan.

The container is created in the lifespan handler and closed on shutdown, so the model
loads exactly once per process, as the specification requires. Tests pass a container
of fakes and the same startup path runs.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import admin, documents, folders, health, indexing, search
from app.config import REPO_ROOT, Settings, get_settings
from app.deps import Container, build_container
from app.logging_config import configure_logging, get_logger

logger = get_logger("main")

# Built by `npm --prefix frontend run build`. When it is there the API also serves
# the interface, so an installed copy is one process on one port and needs no Node.
# In development it is absent and the Vite dev server serves the UI instead.
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


def create_app(container: Container | None = None, settings: Settings | None = None) -> FastAPI:
    resolved = settings or (container.settings if container else get_settings())
    configure_logging(level=resolved.log_level, log_text=resolved.debug_log_text)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        logger.info("starting up (offline mode, model=%s)", resolved.bge_model_path)
        built = container or build_container(resolved)
        application.state.container = built
        built.manifest.initialise()
        # A job left 'running' by a killed process would otherwise block the UI forever.
        abandoned = built.manifest.abandon_running_jobs()
        if abandoned:
            logger.warning("marked %d interrupted indexing job(s) as failed", abandoned)
        built.qdrant.ensure_collection()
        built.embedder.warmup()
        logger.info("ready on %s:%d", resolved.api_host, resolved.api_port)
        try:
            yield
        finally:
            built.close()
            logger.info("shut down")

    application = FastAPI(
        title="Offline Semantic PDF Search",
        version="0.1.0",
        description="Local semantic search over Chinese and Korean PDFs. No cloud services.",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=resolved.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    application.include_router(health.router, prefix="/api")
    application.include_router(search.router, prefix="/api")
    application.include_router(indexing.router, prefix="/api")
    application.include_router(documents.router, prefix="/api")
    application.include_router(folders.router, prefix="/api")
    application.include_router(admin.router, prefix="/api")

    # Last, so every /api route and /docs is matched before the catch-all mount.
    if FRONTEND_DIST.is_dir():
        application.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="ui")
        logger.info("serving the interface from %s", FRONTEND_DIST)

    return application


app = create_app()
