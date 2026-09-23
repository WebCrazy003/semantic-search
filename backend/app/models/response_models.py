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
    embedding_device: str | None = None  # "cuda", "mps" or "cpu"
    embedding_device_name: str | None = None  # "NVIDIA GeForce RTX 5060"
    embedding_precision: str | None = None
    embedding_batch_size: int | None = None
    embedding_memory_gb: float | None = None
    # Why indexing is not on the GPU, when a GPU exists but could not be used.
    embedding_fallback_reason: str | None = None


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
    file_type: str = "pdf"  # "pdf" or "docx"
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
    current_stage: str | None = None
    current_file_progress: float = 0.0
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
    file_type: str = "pdf"  # "pdf" or "docx"
    # A .docx has no fixed pages; its page numbers are Word's last layout, or 1.
    pages_approximate: bool = False


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


class FolderSummary(BaseModel):
    path: str
    added_at: datetime
    exists: bool
    readable: bool
    document_count: int = 0  # every supported file on disk, subfolders included
    pdf_count: int = 0  # deprecated: PDFs only, kept for one release
    indexed_documents: int = 0
    is_default: bool = False


class RemovedFolderResponse(BaseModel):
    path: str
    documents_unindexed: int
    files_kept: bool = True


class RemovedDocumentResponse(BaseModel):
    document_id: str
    filename: str
    chunks_removed: int
    file_kept: bool = True


class ClearIndexResponse(BaseModel):
    documents_removed: int
    passages_removed: int
    files_kept: bool = True


# ------------------------------------------------------------------ admin
# Read-only introspection for the admin page. Nothing here is used by indexing or
# search; it exists so a wrong-looking result can be traced to extraction, chunking
# or retrieval.


class ExtractedBlock(BaseModel):
    kind: str  # heading | paragraph | table
    text: str


class ExtractedPageView(BaseModel):
    page_number: int
    text: str
    char_count: int
    blocks: list[ExtractedBlock] = []


class ExtractionResponse(BaseModel):
    document_id: str
    filename: str
    file_type: str
    filepath: str
    pages: int
    pages_approximate: bool = False
    language: str | None = None
    title: str | None = None
    extracted_ms: int
    page: int
    per_page: int
    # False means the file changed since it was indexed, so what is shown here is not
    # what the index holds.
    file_hash_matches_manifest: bool
    page_views: list[ExtractedPageView] = []


class ChunkView(BaseModel):
    chunk_index: int
    point_id: str
    page_start: int
    page_end: int
    heading: str | None = None
    kind: str | None = None
    token_count: int | None = None
    char_count: int
    text: str
    # Where the repeat from the previous passage starts, and how long it is. The start
    # is past the repeated section heading when the chunker put one there.
    overlap_start: int = 0
    overlap_with_previous: int = 0


class ChunkListResponse(BaseModel):
    document_id: str
    filename: str
    total_chunks: int
    total_tokens: int
    pages_covered: int
    offset: int
    limit: int
    chunks: list[ChunkView] = []


class PayloadField(BaseModel):
    name: str
    type: str
    indexed: bool = False
    description: str


class QdrantSchema(BaseModel):
    collection: str
    exists: bool
    vector_size: int | None = None
    distance: str | None = None
    points_count: int | None = None
    segments_count: int | None = None
    status: str | None = None
    payload_indexes: list[str] = []
    payload_fields: list[PayloadField] = []


class ManifestColumn(BaseModel):
    name: str
    type: str
    notnull: bool = False
    pk: bool = False


class ManifestTable(BaseModel):
    name: str
    rows: int
    columns: list[ManifestColumn] = []
    indexes: list[str] = []


class ManifestSchema(BaseModel):
    path: str
    tables: list[ManifestTable] = []
    status_breakdown: dict[str, int] = {}


class ChunkingSchema(BaseModel):
    target_tokens: int
    max_tokens: int
    min_tokens: int
    overlap_tokens: int
    preserve_headings: bool
    repeat_heading: bool
    allow_cross_page: bool
    prefer_paragraph_boundaries: bool
    prefer_sentence_boundaries: bool


class EmbeddingSchema(BaseModel):
    model: str
    vector_size: int
    device: str | None = None
    device_name: str | None = None
    precision: str | None = None
    max_seq_length: int


class IndexSchemaResponse(BaseModel):
    qdrant: QdrantSchema
    manifest: ManifestSchema
    chunking: ChunkingSchema
    embedding: EmbeddingSchema
