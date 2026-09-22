# backend/app/services/embedding_service.py
"""Local BGE-M3 dense embeddings.

Dense mode only, which is what the MVP specifies. The sparse and ColBERT heads that
BGE-M3 also provides are ignored, so sentence-transformers is enough and the heavier
FlagEmbedding package is not needed.

The encode lock matters: sentence-transformers is not thread-safe, and indexing runs
in a background thread while search requests arrive on the event loop's threadpool.
Without the lock a search during indexing can corrupt a forward pass.

On an NVIDIA GPU the model runs in fp16 with a batch sized to the card's memory. The
GPU is never allowed to fail a run: a device that does not work at startup, and one
that runs out of memory later, both fall back and keep going, and device_info() says
why so the UI can show it.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal, Protocol, runtime_checkable

import numpy as np

from app.logging_config import get_logger

logger = get_logger("embedding")

Precision = Literal["auto", "fp32", "fp16"]

# Batch size on CUDA by total memory: (below this many GB, use this batch size).
# BGE-M3 in fp16 is about 1.1 GB, and a 512-token batch of 16 fits well in 8 GB.
_GPU_BATCH_BY_MEMORY = ((6.0, 8), (10.0, 16), (16.0, 32))
_GPU_BATCH_LARGEST = 64


@runtime_checkable
class EmbeddingService(Protocol):
    dimension: int

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, query: str) -> list[float]: ...

    def warmup(self) -> None: ...


@dataclass
class DeviceInfo:
    device: str  # "cuda", "mps" or "cpu"
    name: str  # "NVIDIA GeForce RTX 5060", "Apple GPU", "CPU"
    precision: str  # "fp16" or "fp32"
    batch_size: int
    memory_gb: float | None = None
    fallback_reason: str | None = None  # why the GPU is not being used, when it is not

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def probe_device(requested: str) -> tuple[str, str | None]:
    """The device to use, and why the GPU was passed over if it was.

    CUDA is exercised with a real kernel rather than trusted from is_available(): a
    driver too old for the build, or a card the build has no kernels for, only fails
    when something actually runs.
    """
    if requested in ("cpu", "mps"):
        return requested, None
    import torch

    if requested == "auto" and not torch.cuda.is_available():
        if torch.backends.mps.is_available():
            return "mps", None
        return "cpu", _no_cuda_reason(torch)
    try:
        probe = torch.ones(1, device="cuda") + 1
        torch.cuda.synchronize()
        if float(probe.item()) != 2.0:
            raise RuntimeError("the GPU returned a wrong result")
    except Exception as exc:  # AssertionError, RuntimeError, CUDA errors
        reason = f"the NVIDIA GPU could not be used: {_first_line(exc)}"
        logger.warning("%s; falling back to cpu", reason)
        return "cpu", reason
    return "cuda", None


def resolve_device(requested: str) -> str:
    return probe_device(requested)[0]


def gpu_batch_size(memory_gb: float) -> int:
    for limit, size in _GPU_BATCH_BY_MEMORY:
        if memory_gb < limit:
            return size
    return _GPU_BATCH_LARGEST


def _no_cuda_reason(torch: Any) -> str | None:
    if not torch.version.cuda:
        return None  # a CPU-only build on purpose: macOS, or a dev install
    return "no NVIDIA GPU found, or its driver is older than 580"


def _first_line(exc: BaseException) -> str:
    text = str(exc).strip() or type(exc).__name__
    return text.splitlines()[0]


def _is_out_of_memory(exc: BaseException) -> bool:
    return type(exc).__name__ == "OutOfMemoryError" or "out of memory" in str(exc).lower()


def _load_sentence_transformer(model_path: Path, device: str) -> Any:
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(str(model_path), device=device)


class BgeEmbeddingService:
    def __init__(
        self,
        model_path: Path,
        device: str = "auto",
        batch_size: int = 8,
        max_seq_length: int = 512,
        expected_dimension: int = 1024,
        batch_size_gpu: int | None = None,
        precision: Precision = "auto",
        loader: Callable[[Path, str], Any] = _load_sentence_transformer,
    ) -> None:
        if not model_path.exists():
            raise FileNotFoundError(
                f"BGE-M3 not found at {model_path}. Run scripts/download_model.py once "
                "while online, then keep ALLOW_MODEL_DOWNLOAD=false."
            )
        self._model_path = model_path
        self._loader = loader
        self._cpu_batch_size = batch_size
        self._encode_lock = threading.Lock()

        self._device, self._fallback_reason = probe_device(device)
        started = time.perf_counter()
        try:
            self._model = loader(model_path, self._device)
        except Exception as exc:
            if self._device != "cuda":
                raise
            self._fallback_reason = f"the model did not load on the GPU: {_first_line(exc)}"
            logger.warning("%s; falling back to cpu", self._fallback_reason)
            self._device = "cpu"
            self._model = loader(model_path, "cpu")
        self._model.max_seq_length = max_seq_length

        self._name, self._memory_gb = self._describe_device()
        if self._device == "cuda":
            self._batch_size = batch_size_gpu or gpu_batch_size(self._memory_gb or 0.0)
        else:
            self._batch_size = batch_size
        self._precision = self._resolve_precision(precision)
        if self._precision == "fp16":
            self._model.half()

        # sentence-transformers renamed this method; support both spellings.
        read_dimension = getattr(
            self._model, "get_embedding_dimension", None
        ) or self._model.get_sentence_embedding_dimension
        self.dimension = int(read_dimension())
        logger.info(
            "loaded BGE-M3 from %s in %.1fs: device=%s name=%r memory=%s precision=%s "
            "batch=%d dimension=%d max_seq_length=%d%s",
            model_path,
            time.perf_counter() - started,
            self._device,
            self._name,
            f"{self._memory_gb:.1f}GB" if self._memory_gb else "-",
            self._precision,
            self._batch_size,
            self.dimension,
            max_seq_length,
            f" (not on the GPU: {self._fallback_reason})" if self._fallback_reason else "",
        )
        if self.dimension != expected_dimension:
            raise RuntimeError(
                f"expected {expected_dimension}-dimensional vectors, got {self.dimension}; "
                "the Qdrant collection and VECTOR_SIZE would not match"
            )

    # ---------------------------------------------------------------- device

    def _describe_device(self) -> tuple[str, float | None]:
        if self._device == "cuda":
            import torch

            props = torch.cuda.get_device_properties(0)
            return str(props.name), props.total_memory / 1024**3
        if self._device == "mps":
            return "Apple GPU", None
        return "CPU", None

    def _resolve_precision(self, requested: Precision) -> str:
        if requested == "fp16" and self._device != "cuda":
            logger.warning("EMBEDDING_PRECISION=fp16 needs an NVIDIA GPU; using fp32")
            return "fp32"
        if requested == "auto":
            return "fp16" if self._device == "cuda" else "fp32"
        return requested

    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            device=self._device,
            name=self._name,
            precision=self._precision,
            batch_size=self._batch_size,
            memory_gb=round(self._memory_gb, 1) if self._memory_gb else None,
            fallback_reason=self._fallback_reason,
        )

    def _fall_back_to_cpu(self, reason: str) -> None:
        logger.warning("%s; moving the model to cpu for the rest of this run", reason)
        self._model.to("cpu")
        if self._precision == "fp16":
            self._model.float()  # fp16 on a CPU is slow, and some ops do not exist
        self._device, self._name, self._memory_gb = "cpu", "CPU", None
        self._precision = "fp32"
        self._batch_size = self._cpu_batch_size
        self._fallback_reason = reason

    # ---------------------------------------------------------------- encode

    def _encode(self, texts: list[str]) -> list[list[float]]:
        # normalize_embeddings=True makes cosine distance equal to a dot product,
        # which is what the Qdrant collection is configured for.
        with self._encode_lock:
            while True:
                try:
                    vectors = self._model.encode(
                        texts,
                        batch_size=self._batch_size,
                        normalize_embeddings=True,
                        convert_to_numpy=True,
                        show_progress_bar=False,
                    )
                    break
                except Exception as exc:
                    if self._device != "cuda" or not _is_out_of_memory(exc):
                        raise
                    self._recover_from_out_of_memory()

        vectors = np.asarray(vectors, dtype=np.float32)
        if self._precision == "fp16":
            # Normalized in fp16; redo it in fp32 so every vector is unit length.
            norms = np.linalg.norm(vectors, axis=1, keepdims=True)
            vectors = vectors / np.maximum(norms, 1e-12)
        return [row.tolist() for row in vectors]

    def _recover_from_out_of_memory(self) -> None:
        """Halve the batch and retry; at batch 1, give up on the GPU."""
        try:
            import torch

            torch.cuda.empty_cache()
        except Exception:  # the cache is a nicety; recovery must not fail on it
            pass
        if self._batch_size > 1:
            self._batch_size = max(1, self._batch_size // 2)
            logger.warning(
                "the GPU ran out of memory; retrying with batch size %d", self._batch_size
            )
            return
        self._fall_back_to_cpu("the GPU ran out of memory even one passage at a time")

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        started = time.perf_counter()
        vectors = self._encode(texts)
        logger.debug(
            "embedded %d passages in %.2fs (device=%s batch_size=%d)",
            len(texts),
            time.perf_counter() - started,
            self._device,
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
