# backend/app/services/extractors.py
"""What every document format shares, and the registry that picks one per file.

Each format (PDF, DOCX) is an extractor that turns a file into the same
ExtractedDocument of pages and blocks, so chunking, embedding and search never know
which format a passage came from.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.models.domain import ExtractedDocument

_HASH_BLOCK = 1024 * 1024


class ExtractionUnsupportedError(Exception):
    """The file is readable but out of scope: encrypted, image-only, or empty."""


class ExtractionError(Exception):
    """The file could not be read at all."""


def compute_file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(_HASH_BLOCK), b""):
            digest.update(block)
    return digest.hexdigest()


def table_markdown(rows: list[list[str]]) -> str:
    """Header row first, then a rule, then the body.

    Markdown keeps each row on one line, so the chunker can split a long table by
    rows and repeat the header, which is what the specification asks for.
    """
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    lines = ["| " + " | ".join(padded[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
    lines.extend("| " + " | ".join(row) + " |" for row in padded[1:])
    return "\n".join(lines)


@runtime_checkable
class DocumentExtractor(Protocol):
    suffixes: tuple[str, ...]  # lower case, with the dot
    media_type: str  # what the file is served as

    def extract(self, path: Path, *, document_id: str, file_hash: str) -> ExtractedDocument: ...


class ExtractorRegistry:
    def __init__(self, extractors: list[DocumentExtractor]) -> None:
        self._by_suffix: dict[str, DocumentExtractor] = {}
        for extractor in extractors:
            for suffix in extractor.suffixes:
                self._by_suffix[suffix.lower()] = extractor

    @property
    def suffixes(self) -> frozenset[str]:
        return frozenset(self._by_suffix)

    def supports(self, path: Path) -> bool:
        return path.suffix.lower() in self._by_suffix

    def for_path(self, path: Path) -> DocumentExtractor | None:
        return self._by_suffix.get(path.suffix.lower())

    @staticmethod
    def compute_file_hash(path: Path) -> str:
        return compute_file_hash(path)
