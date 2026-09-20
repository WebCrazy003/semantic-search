# backend/app/services/embedding_service.py
"""Local BGE-M3 dense embeddings.

Dense mode only, which is what the MVP specifies. The sparse and ColBERT heads that
BGE-M3 also provides are ignored, so sentence-transformers is enough and the heavier
FlagEmbedding package is not needed.

The encode lock matters: sentence-transformers is not thread-safe, and indexing runs
in a background thread while search requests arrive on the event loop's threadpool.
Without the lock a search during indexing can corrupt a forward pass.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.logging_config import get_logger

logger = get_logger("embedding")


@runtime_checkable
class EmbeddingService(Protocol):
    dimension: int

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, query: str) -> list[float]: ...

    def warmup(self) -> None: ...


def resolve_device(requested: str) -> str:
    if requested != "auto":
        return requested
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class BgeEmbeddingService:
    def __init__(
        self,
        model_path: Path,
        device: str = "auto",
        batch_size: int = 8,
        max_seq_length: int = 512,
        expected_dimension: int = 1024,
    ) -> None:
        if not model_path.exists():
            raise FileNotFoundError(
                f"BGE-M3 not found at {model_path}. Run scripts/download_model.py once "
                "while online, then keep ALLOW_MODEL_DOWNLOAD=false."
            )
        from sentence_transformers import SentenceTransformer

        self._device = resolve_device(device)
        self._batch_size = batch_size
        self._encode_lock = threading.Lock()

        started = time.perf_counter()
        self._model = SentenceTransformer(str(model_path), device=self._device)
        self._model.max_seq_length = max_seq_length
        self.dimension = int(self._model.get_sentence_embedding_dimension())
        logger.info(
            "loaded BGE-M3 from %s on %s in %.1fs (dimension=%d, max_seq_length=%d)",
            model_path,
            self._device,
            time.perf_counter() - started,
            self.dimension,
            max_seq_length,
        )
        if self.dimension != expected_dimension:
            raise RuntimeError(
                f"expected {expected_dimension}-dimensional vectors, got {self.dimension}; "
                "the Qdrant collection and VECTOR_SIZE would not match"
            )

    def _encode(self, texts: list[str]) -> list[list[float]]:
        # normalize_embeddings=True makes cosine distance equal to a dot product,
        # which is what the Qdrant collection is configured for.
        with self._encode_lock:
            vectors = self._model.encode(
                texts,
                batch_size=self._batch_size,
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
        return [row.tolist() for row in vectors]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        started = time.perf_counter()
        vectors = self._encode(texts)
        logger.debug(
            "embedded %d passages in %.2fs (batch_size=%d)",
            len(texts),
            time.perf_counter() - started,
            self._batch_size,
        )
        return vectors

    def embed_query(self, query: str) -> list[float]:
        # BGE-M3 takes no instruction prefix. Do not add one here.
        if not query.strip():
            raise ValueError("cannot embed an empty query")
        return self._encode([query])[0]

    def warmup(self) -> None:
        """Run one forward pass so the first real request is not the slow one."""
        started = time.perf_counter()
        self._encode(["warmup"])
        logger.info("embedding warmup took %.2fs", time.perf_counter() - started)
