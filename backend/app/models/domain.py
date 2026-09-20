"""Internal pipeline types. These never cross the HTTP boundary.

API shapes live in request_models.py and response_models.py so the wire format can
change without touching the pipeline, and vice versa.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

BlockKind = Literal["heading", "paragraph", "table"]
ChunkKind = Literal["text", "table", "heading"]

_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class PageBlock:
    """One layout region of a page, already normalized."""

    kind: BlockKind
    text: str
    order: int = 0


@dataclass(frozen=True, slots=True)
class ExtractedPage:
    page_number: int  # 1-based, matching what the UI shows
    blocks: tuple[PageBlock, ...]
    text: str

    @property
    def char_count(self) -> int:
        return len(_WHITESPACE.sub("", self.text))


@dataclass(frozen=True, slots=True)
class DocumentMeta:
    document_id: str
    filename: str
    filepath: str
    folder: str
    file_hash: str
    modified_at: datetime
    language: str | None = None
    title: str | None = None


@dataclass(frozen=True, slots=True)
class ExtractedDocument:
    meta: DocumentMeta
    pages: tuple[ExtractedPage, ...]

    @property
    def document_id(self) -> str:
        return self.meta.document_id

    @property
    def char_count(self) -> int:
        return sum(page.char_count for page in self.pages)


@dataclass(frozen=True, slots=True)
class Chunk:
    document_id: str
    page_start: int
    page_end: int
    chunk_index: int
    text: str
    heading: str | None
    token_count: int
    kind: ChunkKind = "text"
