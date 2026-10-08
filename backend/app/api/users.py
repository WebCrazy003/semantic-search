# backend/app/api/users.py
"""Administration: accounts, password reset requests, sign-up.

Every route here is admin-only; main.py guards the router.
"""

from __future__ import annotations

import shutil

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.guards import remove_document
from app.auth import admin_user
from app.deps import Container, get_container
from app.logging_config import get_logger
from app.models.request_models import (
    AdminResetPasswordRequest,
    AuthSettingsRequest,
    CreateUserRequest,
    UpdateUserRequest,
)
from app.models.response_models import (
    AdminResetPasswordResponse,
    AuthSettingsResponse,
    CreatedUserResponse,
    DeletedUserResponse,
    ResetRequestView,
    UserAdminView,
)
from app.services.access_store import ResetRequest, User, UsernameTakenError
from app.services.ownership import user_folder
from app.services.passwords import (
    PasswordRuleError,
    check_password,
    check_username,
    generate_password,
    hash_password,
)

logger = get_logger("api.users")
router = APIRouter(tags=["users"], prefix="/admin")

_LAST_ADMIN = "DocSage needs at least one active administrator"
_NOT_YOURSELF = "You cannot do that to your own account"


@router.get("/users", response_model=list[UserAdminView])
def list_users(container: Container = Depends(get_container)) -> list[UserAdminView]:
    counts = container.manifest.owner_counts()
    return [_view(user, counts.get(user.user_id, {})) for user in container.access.list_users()]


@router.post("/users", status_code=201, response_model=CreatedUserResponse)
def create_user(
    body: CreateUserRequest,
    admin: User = Depends(admin_user),
    container: Container = Depends(get_container),
) -> CreatedUserResponse:
    """Works whether or not sign-up is open. The user picks a new password on first login."""
    try:
        name = check_username(body.username)
    except PasswordRuleError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    password = generate_password()
    try:
        user = container.access.create_user(
            name, hash_password(password), role=body.role, must_change_password=True
        )
    except UsernameTakenError as exc:
        raise HTTPException(status_code=409, detail="That username is taken") from exc
    logger.info("%s created the %s account %s", admin.username, body.role, name)
    return CreatedUserResponse(user=_view(user, {}), temporary_password=password)


@router.patch("/users/{user_id}", response_model=UserAdminView)
def update_user(
    user_id: str,
    body: UpdateUserRequest,
    admin: User = Depends(admin_user),
    container: Container = Depends(get_container),
) -> UserAdminView:
    target = _target(container, user_id)
    if target.user_id == admin.user_id:
        raise HTTPException(status_code=409, detail=_NOT_YOURSELF)

    demoting = body.role == "user" and target.is_admin
    disabling = body.disabled is True and not target.disabled
    if (demoting or disabling) and target.is_admin and not target.disabled:
        if container.access.active_admin_count() <= 1:
            raise HTTPException(status_code=409, detail=_LAST_ADMIN)

    updated = container.access.update_user(user_id, role=body.role, disabled=body.disabled)
    assert updated is not None
    if (body.role is not None and body.role != target.role) or disabling:
        container.access.revoke_sessions(user_id)
    logger.info(
        "%s updated %s: role=%s disabled=%s",
        admin.username,
        target.username,
        updated.role,
        updated.disabled,
    )
    counts = container.manifest.owner_counts().get(user_id, {})
    return _view(updated, counts)


@router.post("/users/{user_id}/reset-password", response_model=AdminResetPasswordResponse)
def reset_password(
    user_id: str,
    body: AdminResetPasswordRequest,
    admin: User = Depends(admin_user),
    container: Container = Depends(get_container),
) -> AdminResetPasswordResponse:
    """Set someone's password directly: typed by the admin, or generated and shown once."""
    target = _target(container, user_id)
    if target.user_id == admin.user_id:
        raise HTTPException(
            status_code=403, detail="Use Change password for your own account"
        )

    generated = not body.new_password
    password = generate_password() if generated else str(body.new_password)
    if not generated:
        try:
            check_password(password, target.username)
        except PasswordRuleError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    container.access.set_password(user_id, hash_password(password), body.must_change)
    container.access.supersede_reset_requests(user_id)
    container.access.revoke_sessions(user_id)
    logger.info("%s reset the password of %s", admin.username, target.username)
    return AdminResetPasswordResponse(temporary_password=password if generated else None)


@router.delete("/users/{user_id}", response_model=DeletedUserResponse)
def delete_user(
    user_id: str,
    documents: str | None = Query(
        default=None, description="Must be 'delete': their documents and files go too"
    ),
    admin: User = Depends(admin_user),
    container: Container = Depends(get_container),
) -> DeletedUserResponse:
    """Delete an account with everything it owns: documents, passages and uploads."""
    if documents != "delete":
        raise HTTPException(
            status_code=422,
            detail="Deleting a user deletes their documents; pass documents=delete",
        )
    target = _target(container, user_id)
    if target.user_id == admin.user_id:
        raise HTTPException(status_code=409, detail=_NOT_YOURSELF)
    if target.is_admin and not target.disabled and container.access.active_admin_count() <= 1:
        raise HTTPException(status_code=409, detail=_LAST_ADMIN)
    if container.indexing.is_running:
        raise HTTPException(status_code=409, detail="An indexing run is in progress")

    owned = container.manifest.all_documents(owner_id=user_id)
    passages = sum(record.chunks for record in owned)
    files = 0
    for record in owned:
        files += remove_document(container, record)

    folder = user_folder(container.settings.pdf_directory, user_id)
    if folder.is_dir():
        files += sum(1 for path in folder.rglob("*") if path.is_file())
        shutil.rmtree(folder)

    container.drive.store.forget_tree(user_id)
    container.access.delete_user(user_id)
    logger.info(
        "%s deleted the account %s with %d document(s)", admin.username, target.username, len(owned)
    )
    return DeletedUserResponse(
        username=target.username,
        documents_removed=len(owned),
        passages_removed=passages,
        files_removed=files,
    )


# ------------------------------------------------------------ reset requests


@router.get("/reset-requests", response_model=list[ResetRequestView])
def list_reset_requests(container: Container = Depends(get_container)) -> list[ResetRequestView]:
    return [
        ResetRequestView(
            request_id=found.request_id,
            user_id=found.user_id,
            username=found.username,
            user_disabled=found.user_disabled,
            created_at=found.created_at,
            expires_at=found.expires_at,
            client_ip=found.client_ip,
        )
        for found in container.access.pending_reset_requests()
    ]


@router.post("/reset-requests/{request_id}/approve", status_code=204)
def approve_reset_request(
    request_id: str,
    admin: User = Depends(admin_user),
    container: Container = Depends(get_container),
) -> None:
    """Let whoever made this request set a new password for the account."""
    found = _pending(container, request_id)
    if found.user_id == admin.user_id:
        raise HTTPException(
            status_code=403,
            detail="Another administrator has to approve a reset of your own account",
        )
    if not container.access.decide_reset_request(request_id, approve=True, admin_id=admin.user_id):
        raise HTTPException(status_code=409, detail="This request is no longer pending")
    logger.info(
        "%s approved the password reset for %s (requested from %s)",
        admin.username,
        found.username,
        found.client_ip,
    )


@router.post("/reset-requests/{request_id}/deny", status_code=204)
def deny_reset_request(
    request_id: str,
    admin: User = Depends(admin_user),
    container: Container = Depends(get_container),
) -> None:
    found = _pending(container, request_id)
    if not container.access.decide_reset_request(request_id, approve=False, admin_id=admin.user_id):
        raise HTTPException(status_code=409, detail="This request is no longer pending")
    logger.info("%s denied the password reset for %s", admin.username, found.username)


# ------------------------------------------------------------------ settings


@router.get("/auth-settings", response_model=AuthSettingsResponse)
def get_auth_settings(container: Container = Depends(get_container)) -> AuthSettingsResponse:
    return AuthSettingsResponse(registration_open=container.access.registration_open())


@router.put("/auth-settings", response_model=AuthSettingsResponse)
def put_auth_settings(
    body: AuthSettingsRequest,
    admin: User = Depends(admin_user),
    container: Container = Depends(get_container),
) -> AuthSettingsResponse:
    container.access.set_registration_open(body.registration_open)
    logger.info(
        "%s turned sign-up %s", admin.username, "on" if body.registration_open else "off"
    )
    return AuthSettingsResponse(registration_open=body.registration_open)


# ------------------------------------------------------------------ helpers


def _target(container: Container, user_id: str) -> User:
    user = container.access.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="No such user")
    return user


def _pending(container: Container, request_id: str) -> ResetRequest:
    found = container.access.reset_request(request_id)
    if found is None:
        raise HTTPException(status_code=404, detail="No such request")
    if found.status != "pending":
        raise HTTPException(status_code=409, detail="This request is no longer pending")
    return found


def _view(user: User, counts: dict[str, int]) -> UserAdminView:
    return UserAdminView(
        user_id=user.user_id,
        username=user.username,
        role=user.role,
        disabled=user.disabled,
        must_change_password=user.must_change_password,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        documents=counts.get("documents", 0),
        public_documents=counts.get("public_documents", 0),
        passages=counts.get("passages", 0),
    )
