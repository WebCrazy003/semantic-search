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
    job_id: str | None = None
    trigger: str = "scan"
    directory: str | None = None
    current_file: str | None = None
    processed_documents: int = 0
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
    file_size: int = 0
    file_hash: str = ""
    modified_at: datetime | None = None
    pages: int
    chunks: int
    language: str | None = None
    title: str | None = None
    status: str
    error_type: str | None = None
    error_message: str | None = None
    alt_filepaths: list[str] = []
    indexed_at: datetime | None = None


class JobSummary(BaseModel):
    """One finished or running indexing run, read back from the manifest."""

    job_id: str
    trigger: str
    directory: str
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    total: int = 0
    processed: int = 0
    indexed: int = 0
    skipped: int = 0
    unsupported: int = 0
    failed: int = 0
    deleted: int = 0
    chunks: int = 0
    failures: list[dict[str, str]] = []


class RejectedUpload(BaseModel):
    filename: str
    reason: str


class UploadResponse(BaseModel):
    saved: list[str] = []
    rejected: list[RejectedUpload] = []
    directory: str


class RemovedDocumentResponse(BaseModel):
    document_id: str
    filename: str
    chunks_removed: int
    file_kept: bool = True


class ClearIndexResponse(BaseModel):
    documents_removed: int
    passages_removed: int
    files_kept: bool = True
