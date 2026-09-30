# backend/app/api/search.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.auth import active_user, scope_for
from app.deps import Container, get_container
from app.models.request_models import SearchRequest
from app.models.response_models import SearchResponse
from app.services.access_store import User
from app.services.ownership import LIBRARY

router = APIRouter(tags=["search"])


@router.post("/search", response_model=SearchResponse)
def search(
    request: SearchRequest,
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> SearchResponse:
    """Search what the caller may read: everything for an admin, otherwise their own
    documents and public ones. The scope comes from the session, not the body."""
    if not user.is_admin and request.filters is not None:
        # Owner and visibility filters are the admin's; for anyone else they are
        # ignored rather than rejected, so an older client keeps working.
        request = request.model_copy(
            update={
                "filters": request.filters.model_copy(
                    update={"owner_id": None, "visibility": None}
                )
            }
        )
    try:
        response = container.search.search(request, scope_for(user, request.scope))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    names = container.access.usernames() if user.is_admin else {}
    for hit in response.results:
        hit.is_mine = hit.owner_id == user.user_id
        if user.is_admin:
            hit.owner_username = names.get(hit.owner_id or "") if hit.owner_id != LIBRARY else None
        else:
            # Everyone else sees "Public", never who uploaded it or where it is stored.
            hit.owner_id = None
            if not hit.is_mine:
                hit.filepath = ""
    return response
