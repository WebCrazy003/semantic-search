# backend/app/api/auth.py
"""Setup, sign-up, log in and out, change a password, and ask for a reset.

Most routes here are public by design: they are how someone without a session gets
one. Each guards itself; main.py includes this router without a router-level guard.

Errors never say whether a username exists. The one exception, "This account is
disabled", is only returned after the password has been checked.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from app.auth import (
    client_ip,
    current_user,
    end_session,
    is_loopback,
    optional_user,
    session_token,
    start_session,
    too_many,
    user_view,
)
from app.deps import Container, get_container
from app.logging_config import get_logger
from app.models.request_models import (
    ChangePasswordRequest,
    Credentials,
    ResetRequestComplete,
    ResetRequestCreate,
    ResetRequestToken,
)
from app.models.response_models import (
    AuthStatusResponse,
    MeResponse,
    ResetRequestCreated,
    ResetRequestStatus,
)
from app.services.access_store import User, UsernameTakenError
from app.services.passwords import (
    DUMMY_HASH,
    PasswordRuleError,
    check_password,
    check_username,
    hash_password,
    needs_rehash,
    new_token,
    username_key,
    verify_password,
)

logger = get_logger("api.auth")
router = APIRouter(tags=["auth"], prefix="/auth")

_WRONG_LOGIN = "Wrong username or password"


@router.get("/status", response_model=AuthStatusResponse)
def status(
    user: User | None = Depends(optional_user),
    container: Container = Depends(get_container),
) -> AuthStatusResponse:
    """What the login screen needs before anyone has logged in. Never fails."""
    return AuthStatusResponse(
        setup_required=not container.access.has_users(),
        registration_open=container.access.registration_open(),
        user=user_view(user) if user else None,
    )


@router.post("/setup", status_code=201, response_model=MeResponse)
def setup(
    body: Credentials,
    request: Request,
    response: Response,
    container: Container = Depends(get_container),
) -> MeResponse:
    """Create the first account, an admin. Only once, and only on this computer.

    Loopback only, so on a `run.bat lan` install nobody on the network can race the
    owner to become its administrator.
    """
    if container.access.has_users():
        raise HTTPException(status_code=409, detail="DocSage is already set up")
    if not is_loopback(request):
        raise HTTPException(
            status_code=403,
            detail="Finish setting up DocSage on the computer it is installed on",
        )
    user = _create(container, body, role="admin")
    start_session(response, container, user)
    container.access.record_login(user.user_id)
    logger.info("setup: created the first administrator %s", user.username)
    return MeResponse(user=user_view(user))


@router.post("/register", status_code=201, response_model=MeResponse)
def register(
    body: Credentials,
    response: Response,
    container: Container = Depends(get_container),
) -> MeResponse:
    if not container.access.has_users():
        raise HTTPException(status_code=403, detail="DocSage is not set up yet")
    if not container.access.registration_open():
        raise HTTPException(
            status_code=403,
            detail="Registration is closed. Ask an administrator for an account",
        )
    user = _create(container, body, role="user")
    start_session(response, container, user)
    container.access.record_login(user.user_id)
    return MeResponse(user=user_view(user))


@router.post("/login", response_model=MeResponse)
def login(
    body: Credentials,
    request: Request,
    response: Response,
    container: Container = Depends(get_container),
) -> MeResponse:
    throttles = container.throttles
    name_key = username_key(body.username)
    ip = client_ip(request) or "?"
    for throttle, key in ((throttles.login_by_name, name_key), (throttles.login_by_ip, ip)):
        wait = throttle.retry_after(key)
        if wait is not None:
            raise too_many(wait)

    user = container.access.find_user(body.username)
    stored = container.access.password_hash(user.user_id) if user else None
    # An unknown name still pays for one scrypt, so timing does not reveal it.
    valid = verify_password(body.password, stored or DUMMY_HASH) and user is not None
    if not valid or user is None or stored is None:
        throttles.login_by_name.hit(name_key)
        throttles.login_by_ip.hit(ip)
        raise HTTPException(status_code=401, detail=_WRONG_LOGIN)
    if user.disabled:
        raise HTTPException(status_code=403, detail="This account is disabled")

    throttles.login_by_name.clear(name_key)
    if needs_rehash(stored):
        container.access.set_password(
            user.user_id, hash_password(body.password), user.must_change_password
        )
    container.access.record_login(user.user_id)
    start_session(response, container, user)
    return MeResponse(user=user_view(user))


@router.post("/logout", status_code=204)
def logout(request: Request, container: Container = Depends(get_container)) -> Response:
    token = session_token(request)
    if token:
        container.access.delete_session(token)
    response = Response(status_code=204)
    end_session(response)
    return response


@router.get("/me", response_model=MeResponse)
def me(
    user: User = Depends(current_user),
    container: Container = Depends(get_container),
) -> MeResponse:
    """Allowed while a password change is pending, so the UI can show that screen."""
    return MeResponse(
        user=user_view(user),
        pending_reset_requests=(
            container.access.pending_reset_count() if user.is_admin else None
        ),
    )


@router.post("/password", status_code=204)
def change_password(
    body: ChangePasswordRequest,
    request: Request,
    user: User = Depends(current_user),
    container: Container = Depends(get_container),
) -> Response:
    """Change your own password. Every other session of yours is logged out."""
    stored = container.access.password_hash(user.user_id)
    if stored is None or not verify_password(body.current_password, stored):
        raise HTTPException(status_code=400, detail="The current password is wrong")
    _check_password(body.new_password, user.username)
    container.access.set_password(user.user_id, hash_password(body.new_password), False)
    container.access.revoke_sessions(user.user_id, keep_token=session_token(request))
    logger.info("%s changed their password", user.username)
    return Response(status_code=204)


# ------------------------------------------------------------ reset requests


@router.post("/reset-requests", status_code=202, response_model=ResetRequestCreated)
def request_reset(
    body: ResetRequestCreate,
    request: Request,
    container: Container = Depends(get_container),
) -> JSONResponse:
    """Ask an administrator to let you set a new password.

    The answer is the same whether or not the username exists. For an unknown name
    nothing is stored and the token simply stays pending until it expires.
    """
    ip = client_ip(request) or "?"
    throttle = container.throttles.reset_requests_by_ip
    wait = throttle.retry_after(ip)
    if wait is not None:
        raise too_many(wait)
    throttle.hit(ip)

    ttl = timedelta(hours=container.settings.auth_reset_request_hours)
    user = container.access.find_user(body.username)
    if user is not None:
        token = container.access.create_reset_request(user.user_id, client_ip(request), ttl)
        logger.info("password reset requested for %s from %s", user.username, ip)
    else:
        token = new_token()
        logger.info("password reset requested for an unknown username from %s", ip)
    created = ResetRequestCreated(request_token=token, expires_at=datetime.now(tz=UTC) + ttl)
    return JSONResponse(status_code=202, content=created.model_dump(mode="json"))


@router.post("/reset-requests/status", response_model=ResetRequestStatus)
def reset_status(
    body: ResetRequestToken, container: Container = Depends(get_container)
) -> ResetRequestStatus:
    """POST, so the token never appears in a URL or a server log."""
    found = container.access.reset_request_by_token(body.request_token)
    if found is None:
        # Unknown usernames look pending too; the page's own copy of expires_at, from
        # the create response, is what tells it when to give up.
        return ResetRequestStatus(status="pending")
    return ResetRequestStatus(status=found.status, expires_at=found.expires_at)  # type: ignore[arg-type]


@router.post("/reset-requests/complete", response_model=MeResponse)
def complete_reset(
    body: ResetRequestComplete,
    response: Response,
    container: Container = Depends(get_container),
) -> MeResponse:
    """Set the new password once an admin has approved the request, and log in."""
    found = container.access.reset_request_by_token(body.request_token)
    if found is None or found.status != "approved":
        raise HTTPException(
            status_code=400, detail="This request is not approved or has expired"
        )
    _check_password(body.new_password, found.username)
    container.access.set_password(found.user_id, hash_password(body.new_password), False)
    container.access.revoke_sessions(found.user_id)
    container.access.complete_reset_request(found.request_id)
    user = container.access.get_user(found.user_id)
    assert user is not None
    logger.info("%s set a new password through an approved reset request", user.username)
    if user.disabled:
        # The password is set, but a disabled account still cannot log in.
        raise HTTPException(status_code=403, detail="This account is disabled")
    container.access.record_login(user.user_id)
    start_session(response, container, user)
    return MeResponse(user=user_view(user))


# ------------------------------------------------------------------ helpers


def _create(container: Container, body: Credentials, role: str) -> User:
    try:
        name = check_username(body.username)
        check_password(body.password, name)
    except PasswordRuleError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        return container.access.create_user(name, hash_password(body.password), role=role)
    except UsernameTakenError as exc:
        raise HTTPException(status_code=409, detail="That username is taken") from exc


def _check_password(password: str, username: str) -> None:
    try:
        check_password(password, username)
    except PasswordRuleError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
