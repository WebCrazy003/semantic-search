from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from app.auth import reader, scope_for
from app.deps import Container, get_container
from app.models.request_models import SearchRequest
from app.models.response_models import SearchResponse
from app.services.access_store import User
from app.services.answer_service import Event
from app.services.ownership import LIBRARY

router = APIRouter(tags=["search"])


@router.post("/search", response_model=SearchResponse)
def search(
    request: SearchRequest,
    user: User | None = Depends(reader),
    container: Container = Depends(get_container),
) -> SearchResponse:
    """Search what the caller may read: everything for an admin, public documents for a
    visitor, otherwise their own documents and public ones. The scope comes from the
    session, not the body."""
    return _search_as(user, request, container)


@router.post("/ask")
async def ask(
    request: SearchRequest,
    user: User | None = Depends(reader),
    container: Container = Depends(get_container),
) -> StreamingResponse:
    """A search, then an answer written from its results, as server-sent events.

    The search is the very one /search runs, with the same scope, so the answer can
    only draw on passages the caller may read, and cites only results on their screen.
    Passage text is never taken from the client.
    """
    response = await run_in_threadpool(_search_as, user, request, container)
    events = container.answers.events(response)
    return StreamingResponse(
        _server_sent(events),
        media_type="text/event-stream",
        # Proxies and the Vite dev server must pass each event on as it is written.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _search_as(
    user: User | None, request: SearchRequest, container: Container
) -> SearchResponse:
    is_admin = user is not None and user.is_admin
    if not is_admin and request.filters is not None:
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

    names = container.access.usernames() if is_admin else {}
    for hit in response.results:
        hit.is_mine = user is not None and hit.owner_id == user.user_id
        if is_admin:
            hit.owner_username = names.get(hit.owner_id or "") if hit.owner_id != LIBRARY else None
        else:
            # Everyone else sees "Public", never who uploaded it or where it is stored.
            hit.owner_id = None
            if not hit.is_mine:
                hit.filepath = ""
    return response


async def _server_sent(events: AsyncIterator[Event]) -> AsyncIterator[str]:
    async for name, data in events:
        yield f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
