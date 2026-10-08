# backend/app/models/request_models.py
"""Inbound API shapes."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SearchFilters(BaseModel):
    language: str | None = None
    document_id: str | None = None
    # Admin-only narrowing. Ignored for everyone else, not rejected, so an older client
    # that happens to send them keeps working.
    owner_id: str | None = None
    visibility: Literal["public", "private"] | None = None

    def is_empty(self) -> bool:
        return all(
            value is None
            for value in (self.language, self.document_id, self.owner_id, self.visibility)
        )


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int | None = Field(default=None, ge=1)
    filters: SearchFilters | None = None
    # For a non-admin: their own documents and public ones (all), or just one of the two.
    scope: Literal["all", "mine", "public"] = "all"


class IndexRequest(BaseModel):
    directory: str | None = Field(
        default=None, description="Defaults to PDF_DIRECTORY when omitted"
    )
    force: bool = Field(default=False, description="Re-index files that are unchanged")
    trigger: Literal["scan", "upload"] = Field(
        default="scan", description="Labels the run in the job history"
    )
    scope: str | None = Field(
        default=None,
        description="Admin only: a user id, to re-index just that user's uploads",
    )


class AddFolderRequest(BaseModel):
    path: str = Field(min_length=1, description="Absolute path of a folder to index in place")


# ------------------------------------------------------------------ accounts


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class ResetRequestCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class ResetRequestToken(BaseModel):
    request_token: str = Field(min_length=1, max_length=256)


class ResetRequestComplete(BaseModel):
    request_token: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    role: Literal["user", "admin"] = "user"


class UpdateUserRequest(BaseModel):
    role: Literal["user", "admin"] | None = None
    disabled: bool | None = None


class AdminResetPasswordRequest(BaseModel):
    # Empty means "generate one for me".
    new_password: str | None = Field(default=None, max_length=256)
    must_change: bool = True


class VisibilityRequest(BaseModel):
    visibility: Literal["public", "private"]


class BulkVisibilityRequest(BaseModel):
    document_ids: list[str] = Field(min_length=1, max_length=500)
    visibility: Literal["public", "private"]


class AuthSettingsRequest(BaseModel):
    registration_open: bool


# ------------------------------------------------------------ document manager
# `tree` is "me", or for an admin a user id or "library" (2026-10-08 spec §3.5).


class CreateFolderRequest(BaseModel):
    tree: str = "me"
    parent_id: str | None = None
    name: str = Field(min_length=1, max_length=200)


class RenameFolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class DriveMoveRequest(BaseModel):
    tree: str = "me"
    file_ids: list[str] = Field(default_factory=list, max_length=1000)
    folder_ids: list[str] = Field(default_factory=list, max_length=1000)
    # The folder to move into; None is the top of the tree.
    to: str | None = None


class DriveIndexRequest(BaseModel):
    tree: str = "me"
    # None: every file in the tree that is not indexed yet.
    file_ids: list[str] | None = Field(default=None, max_length=1000)
    # Re-read files that already have a verdict, as Retry does for a failed one.
    force: bool = False

