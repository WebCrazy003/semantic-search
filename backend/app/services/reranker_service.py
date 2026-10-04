"""Reorders search hits by how well each one answers the question.

BGE-M3 compares a question and a passage as two separate vectors, which is fast enough
to search everything but blurs the difference between a passage on the topic and a
passage that answers. A cross-encoder reads the two together and tells them apart,
too slowly to run over everything but well within budget for the top ten results.
Used before an answer is written, where choosing the right few passages matters most,
and only on the results already on screen, so it never delays them.

Its score is a probability-like relevance between 0 and 1, comparable across questions,
which is what the "not found" threshold is set on. The search score is not.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Protocol

from app.logging_config import get_logger
from app.services.embedding_service import resolve_device

logger = get_logger("reranker")


class Reranker(Protocol):
    def scores(self, query: str, texts: list[str]) -> list[float]: ...

    def warmup(self) -> None: ...


class BgeReranker:
    def __init__(
        self,
        model_path: Path,
        device: str = "auto",
        max_length: int = 512,
        batch_size: int = 8,
    ) -> None:
        if not model_path.exists():
            raise FileNotFoundError(
                f"reranker not found at {model_path}. Run "
                "scripts/download_model.py reranker once with the network on."
            )
        self._batch_size = batch_size
        # sentence-transformers is not thread-safe, and two asks at once each reach this
        # from their own worker thread; one at a time also keeps the GPU's memory in hand.
        self._lock = threading.Lock()
        started = time.perf_counter()
        self.device = resolve_device(device)
        self._model = _load_cross_encoder(model_path, self.device, max_length)
        logger.info(
            "loaded reranker from %s in %.1fs: device=%s",
            model_path,
            time.perf_counter() - started,
            self.device,
        )

    def scores(self, query: str, texts: list[str]) -> list[float]:
        if not texts:
            return []
        # A one-label cross-encoder applies a sigmoid by default: 0 to 1, higher is better.
        with self._lock:
            raw = self._model.predict(
                [(query, text) for text in texts],
                batch_size=self._batch_size,
                show_progress_bar=False,
            )
        return [float(value) for value in raw]

    def warmup(self) -> None:
        self.scores("warmup", ["warmup"])


def _load_cross_encoder(model_path: Path, device: str, max_length: int) -> Any:
    from sentence_transformers import CrossEncoder

    # Half precision on a GPU: twice as fast on Apple Silicon and NVIDIA alike, half the
    # memory, and the scores match fp32 to three places. The CPU stays in fp32.
    model_kwargs: dict[str, Any] = {}
    if device in ("cuda", "mps"):
        import torch

        model_kwargs["torch_dtype"] = torch.float16
    return CrossEncoder(
        str(model_path), device=device, max_length=max_length, model_kwargs=model_kwargs
    )
