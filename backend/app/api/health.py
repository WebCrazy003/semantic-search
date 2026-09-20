# backend/app/api/health.py
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.deps import Container, get_container
from app.models.response_models import HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness only. Deliberately does not touch Qdrant, so it stays instant."""
    return HealthResponse()


@router.get("/health/ready", response_model=ReadinessResponse)
def ready(container: Container = Depends(get_container)) -> ReadinessResponse:
    """Readiness: checks the things a search actually depends on."""
    try:
        points = container.qdrant.count_points()
        reachable = True
    except Exception:
        points, reachable = 0, False
    dimension = int(getattr(container.embedder, "dimension", 0))
    return ReadinessResponse(
        status="ready" if reachable and dimension > 0 else "degraded",
        qdrant_reachable=reachable,
        collection=container.settings.qdrant_collection,
        points=points,
        model_loaded=dimension > 0,
        embedding_dimension=dimension,
    )
