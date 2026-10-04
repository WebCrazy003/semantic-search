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
Precision = Literal["auto", "fp32", "fp16"]


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
    # Word .docx files are indexed alongside PDFs. Legacy .doc is not supported.
    docx_enabled: bool = True

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
    # On an NVIDIA GPU. None (auto, or empty) sizes it from the card's memory.
    embedding_batch_size_gpu: int | None = Field(default=None, ge=1, le=512)
    # auto is fp16 on an NVIDIA GPU and fp32 everywhere else.
    embedding_precision: Precision = "auto"
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

    # Answers, written by a local language model from the passages a search finds.
    # The model runs in its own process (llama-server, Ollama, LM Studio) on this
    # machine. Empty LLM_URL turns answers off; search is unaffected either way.
    llm_url: str = ""  # e.g. http://127.0.0.1:8081/v1
    llm_model: str = "local"  # the model name the server expects, if it cares
    # The GGUF file the launchers start llama-server with. The backend never reads it.
    llm_model_path: Path | None = None
    llm_context_tokens: int = Field(default=8192, ge=1024)
    llm_max_answer_tokens: int = Field(default=600, ge=64)
    llm_temperature: float = Field(default=0.2, ge=0, le=2)
    llm_timeout_seconds: int = Field(default=120, ge=5)
    # Answers written at once. Others wait their turn; their results do not.
    llm_max_concurrent: int = Field(default=1, ge=1)
    # Asks hybrid models (Qwen3 and later) to skip thinking aloud before answering.
    llm_disable_thinking: bool = True
    # Passages an answer is written from, best first.
    rag_context_passages: int = Field(default=6, ge=1, le=20)
    # Hits scoring below this are not handed to the model; with none left the answer
    # is "not found". 0 sends every hit until a threshold is calibrated on the eval set.
    rag_min_score: float = Field(default=0.0, ge=0, le=1)

    # Storage
    manifest_path: Path = Path("./data/manifest.db")
    # Accounts, sessions, reset requests and which documents are public. Unlike the
    # manifest this is not derivable from anything, so nothing ever rebuilds or clears it.
    access_db_path: Path = Path("./data/access.db")

    # Accounts
    auth_session_idle_days: int = Field(default=7, ge=1)
    auth_session_max_days: int = Field(default=30, ge=1)
    # Only behind HTTPS: over plain HTTP a Secure cookie is never sent back.
    auth_cookie_secure: bool = False
    auth_login_max_failures: int = Field(default=5, ge=1)
    auth_reset_request_hours: int = Field(default=24, ge=1)

    # Service
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"
    log_level: str = "INFO"
    debug_log_text: bool = False

    @field_validator(
        "pdf_directory", "bge_model_path", "manifest_path", "access_db_path", mode="after"
    )
    @classmethod
    def _resolve(cls, value: Path) -> Path:
        return value if value.is_absolute() else (REPO_ROOT / value).resolve()

    @field_validator("embedding_batch_size_gpu", mode="before")
    @classmethod
    def _auto_is_unset(cls, value: object) -> object:
        if isinstance(value, str) and value.strip().lower() in ("", "auto"):
            return None
        return value

    @field_validator("qdrant_path", "llm_model_path", mode="before")
    @classmethod
    def _blank_path_is_unset(cls, value: object) -> object:
        """An empty QDRANT_PATH in .env means "use the server", not "use the cwd"."""
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("qdrant_path", "llm_model_path", mode="after")
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
