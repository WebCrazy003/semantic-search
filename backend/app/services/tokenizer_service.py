# backend/app/services/tokenizer_service.py
"""Token counting for the chunker.

Kept apart from the embedding service so chunker tests never load a 2 GB model.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class TokenCounter(Protocol):
    def count(self, text: str) -> int: ...

    def split_by_tokens(self, text: str, max_tokens: int) -> list[str]: ...


class BgeTokenizer:
    """The BGE-M3 tokenizer, which is XLM-RoBERTa's SentencePiece model."""

    def __init__(self, model_path: Path, cache_size: int = 8192) -> None:
        from transformers import AutoTokenizer

        if not model_path.exists():
            raise FileNotFoundError(
                f"tokenizer not found at {model_path}; run scripts/download_model.py"
            )
        self._tokenizer = AutoTokenizer.from_pretrained(str(model_path))
        self._count_cached = lru_cache(maxsize=cache_size)(self._count_uncached)

    def _count_uncached(self, text: str) -> int:
        return len(self._tokenizer.encode(text, add_special_tokens=False))

    def count(self, text: str) -> int:
        return self._count_cached(text)

    def cache_info(self):  # noqa: ANN201 - functools CacheInfo
        return self._count_cached.cache_info()

    def split_by_tokens(self, text: str, max_tokens: int) -> list[str]:
        """Last-resort split for a single sentence longer than max_tokens."""
        ids = self._tokenizer.encode(text, add_special_tokens=False)
        pieces: list[str] = []
        for start in range(0, len(ids), max_tokens):
            piece = self._tokenizer.decode(
                ids[start : start + max_tokens], skip_special_tokens=True
            ).strip()
            if piece:
                pieces.append(piece)
        return pieces or [text.strip()]
