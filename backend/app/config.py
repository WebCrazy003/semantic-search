"""Single source of truth for configuration.

No other module reads os.environ. Relative paths in .env are resolved against the
repository root so commands behave the same from any working directory.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]

Device = Literal["auto", "cpu", "mps", "cuda"]
Toggle = Literal["auto", "on", "off"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Documents
    pdf_directory: Path = Path("./documents")
    pdf_extract_tables: bool = True
    pdf_min_document_chars: int = 20
    # Whether a Korean line that ends without a trailing space broke inside a word.
    # auto decides per document from the evidence; on and off force it.
    pdf_korean_midword_join: Toggle = "auto"

    # Qdrant
    qdrant_url: str = "http://127.0.0.1:6333"
    # Set this and the vectors live in an embedded Qdrant at that path, with no
    # server and no Docker. Offline installs use it; leave it empty for the server.
    qdrant_path: Path | None = None
    qdrant_collection: str = "pdf_passages"
    qdrant_timeout: int = 30
    qdrant_upsert_batch: int = 128
    vector_size: int = 1024

    # Embeddings
    bge_model_path: Path = Path("./models/bge-m3")
    embedding_device: Device = "auto"
    embedding_batch_size: int = Field(default=8, ge=1, le=256)
    embedding_max_seq_length: int = Field(default=512, ge=64, le=8192)
    allow_model_download: bool = False

    # Chunking
    chunk_target_tokens: int = Field(default=300, ge=32)
    chunk_max_tokens: int = Field(default=450, ge=32)
    chunk_min_tokens: int = Field(default=80, ge=0)
    chunk_overlap_tokens: int = Field(default=50, ge=0)
    chunk_preserve_headings: bool = True
    chunk_repeat_heading: bool = True
    chunk_allow_cross_page: bool = False
    chunk_prefer_paragraph_boundaries: bool = True
    chunk_prefer_sentence_boundaries: bool = True

    # Search
    default_top_k: int = Field(default=10, ge=1)
    max_top_k: int = Field(default=100, ge=1)

    # Storage
    manifest_path: Path = Path("./data/manifest.db")

    # Service
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"
    log_level: str = "INFO"
    debug_log_text: bool = False

    @field_validator("pdf_directory", "bge_model_path", "manifest_path", mode="after")
    @classmethod
    def _resolve(cls, value: Path) -> Path:
        return value if value.is_absolute() else (REPO_ROOT / value).resolve()

    @field_validator("qdrant_path", mode="before")
    @classmethod
    def _blank_path_is_unset(cls, value: object) -> object:
        """An empty QDRANT_PATH in .env means "use the server", not "use the cwd"."""
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("qdrant_path", mode="after")
    @classmethod
    def _resolve_optional(cls, value: Path | None) -> Path | None:
        if value is None:
            return None
        return value if value.is_absolute() else (REPO_ROOT / value).resolve()

    @model_validator(mode="after")
    def _check_chunk_budget(self) -> Settings:
        if self.chunk_max_tokens < self.chunk_target_tokens:
            raise ValueError("chunk_max_tokens must be >= chunk_target_tokens")
        if self.chunk_overlap_tokens >= self.chunk_target_tokens:
            raise ValueError("chunk_overlap_tokens must be < chunk_target_tokens")
        if self.chunk_min_tokens > self.chunk_target_tokens:
            raise ValueError("chunk_min_tokens must be <= chunk_target_tokens")
        return self

    @property
    def embedded_qdrant(self) -> bool:
        """True when vectors live in a local directory rather than a Qdrant server."""
        return self.qdrant_path is not None

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def apply_offline_env(self) -> None:
        """Force Hugging Face into offline mode unless downloads are explicitly allowed.

        This is what stops the application silently reaching the network for weights.
        """
        flag = "0" if self.allow_model_download else "1"
        os.environ["HF_HUB_OFFLINE"] = flag
        os.environ["TRANSFORMERS_OFFLINE"] = flag


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.apply_offline_env()
    return settings
