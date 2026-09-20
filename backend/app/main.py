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

from app.api import documents, health, indexing, search
from app.config import Settings, get_settings
from app.deps import Container, build_container
from app.logging_config import configure_logging, get_logger

logger = get_logger("main")


def create_app(container: Container | None = None, settings: Settings | None = None) -> FastAPI:
    resolved = settings or (container.settings if container else get_settings())
    configure_logging(level=resolved.log_level, log_text=resolved.debug_log_text)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        logger.info("starting up (offline mode, model=%s)", resolved.bge_model_path)
        built = container or build_container(resolved)
        application.state.container = built
        built.manifest.initialise()
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
    return application


app = create_app()
