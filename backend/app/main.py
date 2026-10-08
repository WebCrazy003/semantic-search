# backend/app/main.py
"""Application factory and lifespan.

The container is created in the lifespan handler and closed on shutdown, so the model
loads exactly once per process, as the specification requires. Tests pass a container
of fakes and the same startup path runs.
"""

from __future__ import annotations

import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import admin, auth, documents, drive, folders, health, indexing, search, users
from app.auth import CsrfHeaderMiddleware, active_user, admin_user
from app.config import REPO_ROOT, Settings, get_settings
from app.deps import Container, build_container
from app.logging_config import configure_logging, get_logger

logger = get_logger("main")

# Built by `npm --prefix frontend run build`. When it is there the API also serves
# the interface, so an installed copy is one process on one port and needs no Node.
# In development it is absent and the Vite dev server serves the UI instead.
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


def resume_uploads(container: Container) -> int:
    """Queue every user's files that are on disk but were never indexed: uploads left
    waiting when the server last stopped, since the queue lives in memory (2026-10-08
    spec §3.3). Returns how many files were queued.

    A directory listing and one manifest read per user; no file is hashed here.
    """
    queued = 0
    started = False
    for user_id in sorted(container.access.user_ids()):
        waiting = container.drive.not_indexed(user_id)
        if not waiting:
            continue
        queued += len(waiting)
        outcome = container.drive.request_index(
            user_id, [file.path for file in waiting], started_by=user_id
        )
        started = started or outcome == "started"
    if started:
        threading.Thread(
            target=container.indexing.drain, name="resume-uploads", daemon=True
        ).start()
    if queued:
        logger.info("queued %d uploaded file(s) that were never indexed", queued)
    return queued


def create_app(container: Container | None = None, settings: Settings | None = None) -> FastAPI:
    resolved = settings or (container.settings if container else get_settings())
    configure_logging(level=resolved.log_level, log_text=resolved.debug_log_text)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        logger.info("starting up (offline mode, model=%s)", resolved.bge_model_path)
        built = container or build_container(resolved)
        application.state.container = built
        built.manifest.initialise()
        built.access.initialise()
        built.drive.store.initialise()
        built.access.purge_expired(timedelta(days=resolved.auth_session_idle_days))
        # A job left 'running' by a killed process would otherwise block the UI forever.
        abandoned = built.manifest.abandon_running_jobs()
        if abandoned:
            logger.warning("marked %d interrupted indexing job(s) as failed", abandoned)
        built.qdrant.ensure_collection()
        # Passages indexed before accounts existed have no owner. Payload only: an
        # upgrade re-embeds nothing, and this is a no-op on every later start.
        assigned = built.qdrant.assign_unowned_to_library()
        if assigned:
            logger.info("assigned %d existing passages to the library", assigned)
        built.embedder.warmup()
        resume_uploads(built)
        logger.info("ready on %s:%d", resolved.api_host, resolved.api_port)
        try:
            yield
        finally:
            await built.answers.aclose()
            built.close()
            logger.info("shut down")

    application = FastAPI(
        title="DocSage",
        version="0.1.0",
        description=(
            "Find knowledge locally: semantic search over your own PDF and Word "
            "documents, in Chinese, Korean and English. No cloud services."
        ),
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=resolved.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["*"],
    )
    application.add_middleware(CsrfHeaderMiddleware)

    # Guarded here rather than route by route, so a route added to one of these routers
    # is protected without anyone having to remember. health, auth, search and the
    # document reader hold the routes open to visitors and guard the rest themselves;
    # tests/api/test_route_guards.py checks that nothing else is reachable without a
    # session.
    signed_in = [Depends(active_user)]
    admins = [Depends(admin_user)]
    application.include_router(health.router, prefix="/api")
    application.include_router(auth.router, prefix="/api")
    # Open to visitors, who read public documents only; each route guards itself.
    application.include_router(search.router, prefix="/api")
    application.include_router(documents.reader_router, prefix="/api")
    application.include_router(indexing.router, prefix="/api", dependencies=signed_in)
    application.include_router(documents.router, prefix="/api", dependencies=signed_in)
    application.include_router(drive.router, prefix="/api", dependencies=signed_in)
    application.include_router(folders.router, prefix="/api", dependencies=admins)
    application.include_router(admin.router, prefix="/api", dependencies=admins)
    application.include_router(users.router, prefix="/api", dependencies=admins)

    # Last, so every /api route and /docs is matched before the catch-all mount.
    if FRONTEND_DIST.is_dir():
        application.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="ui")
        logger.info("serving the interface from %s", FRONTEND_DIST)

    return application


app = create_app()
