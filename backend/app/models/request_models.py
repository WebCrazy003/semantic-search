# backend/app/models/request_models.py
"""Inbound API shapes."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SearchFilters(BaseModel):
    language: str | None = None
    document_id: str | None = None

    def is_empty(self) -> bool:
        return self.language is None and self.document_id is None


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int | None = Field(default=None, ge=1)
    filters: SearchFilters | None = None


class IndexRequest(BaseModel):
    directory: str | None = Field(
        default=None, description="Defaults to PDF_DIRECTORY when omitted"
    )
    force: bool = Field(default=False, description="Re-index files that are unchanged")
    trigger: Literal["scan", "upload"] = Field(
        default="scan", description="Labels the run in the job history"
    )
