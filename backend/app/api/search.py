# backend/app/api/search.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.deps import Container, get_container
from app.models.request_models import SearchRequest
from app.models.response_models import SearchResponse

router = APIRouter(tags=["search"])


@router.post("/search", response_model=SearchResponse)
def search(
    request: SearchRequest, container: Container = Depends(get_container)
) -> SearchResponse:
    try:
        return container.search.search(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
