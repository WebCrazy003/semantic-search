# backend/app/auth.py
"""Who is asking, and whether they may.

Three dependencies, each building on the last:

    current_user   a valid session, or 401
    active_user    ... whose password does not have to be changed first, or 403
    admin_user     ... who is an admin, or 403

Routers are guarded where main.py includes them, so a route added to an existing router
is protected without anyone remembering to protect it.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.deps import Container, get_container
from app.models.response_models import UserView
from app.services.access_store import User
from app.services.ownership import AccessScope

SESSION_COOKIE = "docsage_session"
CSRF_HEADER = "x-docsage"
PASSWORD_CHANGE_REQUIRED = "password_change_required"

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost"})


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def is_loopback(request: Request) -> bool:
    return client_ip(request) in _LOOPBACK


def user_view(user: User) -> UserView:
    return UserView(
        user_id=user.user_id,
        username=user.username,
        role=user.role,
        must_change_password=user.must_change_password,
    )


def scope_for(user: User | None, mode: str = "all") -> AccessScope:
    """Admins read everything; a visitor only public documents; anyone else their own
    documents and public ones."""
    if user is None:
        return AccessScope.visitor()
    if user.is_admin:
        return AccessScope(user_id=None)
    return AccessScope(user_id=user.user_id, mode=mode)  # type: ignore[arg-type]


# ------------------------------------------------------------------ sessions


def session_token(request: Request) -> str | None:
    return request.cookies.get(SESSION_COOKIE)


def start_session(response: Response, container: Container, user: User) -> str:
    settings = container.settings
    max_age = timedelta(days=settings.auth_session_max_days)
    token = container.access.create_session(user.user_id, max_age)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(max_age.total_seconds()),
        httponly=True,
        samesite="strict",
        secure=settings.auth_cookie_secure,
        path="/",
    )
    return token


def end_session(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def optional_user(
    request: Request, container: Container = Depends(get_container)
) -> User | None:
    token = session_token(request)
    if not token:
        return None
    idle = timedelta(days=container.settings.auth_session_idle_days)
    user = container.access.session_user(token, idle)
    if user is None or user.disabled:
        return None
    return user


def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Log in to continue")
    return user


def reader(user: User | None = Depends(optional_user)) -> User | None:
    """The caller on a route open to visitors: None for someone not logged in, who reads
    public documents only. Someone who must change their password counts as a visitor
    until they do, so they read no more than before they logged in."""
    if user is None or user.must_change_password:
        return None
    return user


def active_user(user: User = Depends(current_user)) -> User:
    if user.must_change_password:
        raise HTTPException(status_code=403, detail=PASSWORD_CHANGE_REQUIRED)
    return user


def admin_user(user: User = Depends(active_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Only an administrator can do that")
    return user


# ------------------------------------------------------------------ throttling


def too_many(retry_after: int) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail="Too many attempts. Wait a few minutes and try again",
        headers={"Retry-After": str(retry_after)},
    )


# ------------------------------------------------------------------ CSRF


class CsrfHeaderMiddleware(BaseHTTPMiddleware):
    """Every state-changing /api request must carry X-DocSage: 1.

    SameSite=Strict already keeps the session cookie off cross-site requests. This is
    the second layer: a form on another site cannot set a custom header.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if (
            request.method not in _SAFE_METHODS
            and request.url.path.startswith("/api/")
            and request.headers.get(CSRF_HEADER) != "1"
        ):
            return JSONResponse(
                status_code=403, content={"detail": "Missing the X-DocSage request header"}
            )
        return await call_next(request)
