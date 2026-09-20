# backend/app/models/response_models.py
"""Outbound API shapes."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadinessResponse(BaseModel):
    status: Literal["ready", "degraded"]
    qdrant_reachable: bool
    collection: str
    points: int
    model_loaded: bool
    embedding_dimension: int


class SearchHit(BaseModel):
    score: float
    document_id: str
    filename: str
    filepath: str
    page_start: int
    page_end: int
    chunk_index: int
    heading: str | None = None
    language: str | None = None
    text: str


class SearchResponse(BaseModel):
    query: str
    count: int
    took_ms: int
    results: list[SearchHit]


class IndexStartedResponse(BaseModel):
    status: Literal["started", "already_running"]
    directory: str


class IndexFailure(BaseModel):
    filename: str
    filepath: str
    error_type: str
    error_message: str
    timestamp: datetime


class IndexStatusResponse(BaseModel):
    status: Literal["idle", "running", "completed", "failed"]
    directory: str | None = None
    total_documents: int = 0
    indexed_documents: int = 0
    skipped_documents: int = 0
    unsupported_documents: int = 0
    failed_documents: int = 0
    deleted_documents: int = 0
    total_chunks: int = 0
    started_at: datetime | None = None
    finished_at: datetime | None = None
    failures: list[IndexFailure] = []


class DocumentSummary(BaseModel):
    document_id: str
    filename: str
    filepath: str
    pages: int
    chunks: int
    language: str | None = None
    title: str | None = None
    status: str
    indexed_at: datetime | None = None
