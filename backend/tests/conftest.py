# backend/tests/conftest.py
"""Shared fakes.

The point of these is that the chunker, indexer, search service, and API can all be
tested with no model, no Docker, and no PDFs unless the test is about PDFs.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pytest

_WHITESPACE = re.compile(r"\s+")


class CharTokenCounter:
    """TokenCounter that counts non-whitespace characters.

    Chunker tests then read as plain arithmetic: a 40-character paragraph is 40
    tokens. Swapping in the real tokenizer changes only the numbers, not the logic.
    """

    def count(self, text: str) -> int:
        return len(_WHITESPACE.sub("", text))

    def split_by_tokens(self, text: str, max_tokens: int) -> list[str]:
        stripped = text.strip()
        return [stripped[i : i + max_tokens] for i in range(0, len(stripped), max_tokens)] or [""]


@dataclass
class FakeEmbeddingService:
    """Deterministic pseudo-embeddings derived from a hash of the text.

    Distances are meaningless, which is the point: tests that use this assert on
    plumbing, and only the integration tests assert on relevance.
    """

    dimension: int = 1024
    calls: list[list[str]] | None = None

    def __post_init__(self) -> None:
        self.calls = []

    @staticmethod
    @lru_cache(maxsize=2048)
    def _vector(text: str, dimension: int) -> tuple[float, ...]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        raw = [digest[i % len(digest)] / 255.0 for i in range(dimension)]
        norm = sum(value * value for value in raw) ** 0.5 or 1.0
        return tuple(value / norm for value in raw)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        assert self.calls is not None
        self.calls.append(list(texts))
        return [list(self._vector(text, self.dimension)) for text in texts]

    def embed_query(self, query: str) -> list[float]:
        return list(self._vector(query, self.dimension))

    def warmup(self) -> None:
        return None


@pytest.fixture
def token_counter() -> CharTokenCounter:
    return CharTokenCounter()


@pytest.fixture
def fake_embedder() -> FakeEmbeddingService:
    return FakeEmbeddingService()


@pytest.fixture(scope="session")
def corpus_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """The generated CJK PDF corpus, built once per test session."""
    from tests.fixtures.make_fixtures import build_all

    directory = tmp_path_factory.mktemp("corpus")
    build_all(directory)
    return directory


@pytest.fixture(scope="session")
def wrap_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """PDFs whose words are split by line wraps, blocks and page breaks."""
    from tests.fixtures.make_fixtures import build_wrapping

    directory = tmp_path_factory.mktemp("wrapping")
    build_wrapping(directory)
    return directory


@pytest.fixture(scope="session")
def docx_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Word documents covering headings, tables, tracked changes and page markers."""
    from tests.fixtures.make_fixtures import build_word_documents

    directory = tmp_path_factory.mktemp("word")
    build_word_documents(directory)
    return directory
