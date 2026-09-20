# app/services/chunk_service.py
"""Token-aware chunking.

Every page becomes a flat stream of units (heading, paragraph, table), each carrying
its page number and the heading in force. One packing routine consumes that stream,
so single-page and cross-page chunking share all their logic and differ only in
whether the stream is flushed at page boundaries.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from app.models.domain import Chunk, ExtractedDocument, ExtractedPage
from app.services.text_service import join_sentences, split_paragraphs, split_sentences
from app.services.tokenizer_service import TokenCounter


@dataclass(frozen=True)
class ChunkConfig:
    target_tokens: int = 300
    max_tokens: int = 450
    min_tokens: int = 80
    overlap_tokens: int = 50
    preserve_headings: bool = True
    repeat_heading: bool = True
    allow_cross_page: bool = False
    prefer_paragraph_boundaries: bool = True
    prefer_sentence_boundaries: bool = True

    def __post_init__(self) -> None:
        if self.max_tokens < self.target_tokens:
            raise ValueError("max_tokens must be >= target_tokens")
        if self.overlap_tokens >= self.target_tokens:
            raise ValueError("overlap_tokens must be < target_tokens")
        if self.min_tokens > self.target_tokens:
            raise ValueError("min_tokens must be <= target_tokens")


@dataclass(frozen=True)
class _Unit:
    """One indivisible-by-default piece of the stream."""

    text: str
    tokens: int
    page: int
    heading: str | None
    kind: str  # "text" | "heading" | "table"

    @property
    def atomic(self) -> bool:
        """Headings and tables are never sentence-split or merged away."""
        return self.kind in ("heading", "table")


class Chunker:
    def __init__(self, tokenizer: TokenCounter, config: ChunkConfig) -> None:
        self._tokenizer = tokenizer
        self._config = config

    # ------------------------------------------------------------------ public

    def chunk_document(self, document: ExtractedDocument) -> list[Chunk]:
        if self._config.allow_cross_page:
            units = [unit for page in document.pages for unit in self._page_units(page)]
            return self._pack(document.document_id, units, start_index=0)

        chunks: list[Chunk] = []
        for page in document.pages:
            chunks.extend(
                self._pack(
                    document.document_id, self._page_units(page), start_index=len(chunks)
                )
            )
        return chunks

    # ------------------------------------------------------------------ stream

    def _page_units(self, page: ExtractedPage) -> list[_Unit]:
        units: list[_Unit] = []
        heading: str | None = None

        for block in page.blocks:
            if block.kind == "heading":
                if not self._config.preserve_headings:
                    # Still keep the words, just do not treat them as a heading.
                    units.append(self._unit(block.text, page.page_number, None, "text"))
                    continue
                heading = block.text
                units.append(self._unit(block.text, page.page_number, heading, "heading"))
                continue

            if block.kind == "table":
                for piece in self._split_table(block.text):
                    units.append(self._unit(piece, page.page_number, heading, "table"))
                continue

            paragraphs = (
                split_paragraphs(block.text)
                if self._config.prefer_paragraph_boundaries
                else [block.text]
            )
            for paragraph in paragraphs:
                units.append(self._unit(paragraph, page.page_number, heading, "text"))

        return [unit for unit in units if unit.text]

    def _unit(self, text: str, page: int, heading: str | None, kind: str) -> _Unit:
        stripped = text.strip()
        return _Unit(
            text=stripped,
            tokens=self._tokenizer.count(stripped),
            page=page,
            heading=heading,
            kind=kind,
        )

    # ------------------------------------------------------------------ packing

    def _pack(self, document_id: str, units: list[_Unit], start_index: int) -> list[Chunk]:
        config = self._config
        chunks: list[Chunk] = []
        buffer: list[_Unit] = []
        buffered = 0
        has_new_content = False

        def close(carry_overlap: bool) -> None:
            nonlocal buffer, buffered, has_new_content
            if buffer and has_new_content:
                chunk = self._build_chunk(document_id, buffer, len(chunks))
                if chunk is not None:
                    chunks.append(chunk)
            seed = self._overlap_seed(buffer) if carry_overlap else []
            buffer = list(seed)
            buffered = sum(unit.tokens for unit in buffer)
            has_new_content = False

        for unit in units:
            pieces = (
                [unit]
                if unit.atomic or unit.tokens <= config.max_tokens
                else self._split_oversized(unit)
            )
            for piece in pieces:
                starts_section = piece.kind in ("heading", "table")
                if buffer and (starts_section or buffered + piece.tokens > config.max_tokens):
                    close(carry_overlap=not starts_section)

                buffer.append(piece)
                buffered += piece.tokens
                has_new_content = True

                if piece.kind == "table":
                    close(carry_overlap=False)  # a table stands alone
                elif buffered >= config.target_tokens:
                    close(carry_overlap=True)

        close(carry_overlap=False)
        return self._merge_small(chunks, start_index)

    def _build_chunk(self, document_id: str, units: list[_Unit], index: int) -> Chunk | None:
        config = self._config
        body = "\n\n".join(unit.text for unit in units).strip()
        if not body:
            return None

        heading = next((unit.heading for unit in units if unit.heading), None)
        if config.repeat_heading and heading and not body.startswith(heading):
            body = f"{heading}\n\n{body}"

        if any(unit.kind == "table" for unit in units):
            kind = "table"
        elif all(unit.kind == "heading" for unit in units):
            # A lone heading, warning, or label: structurally important, so _merge_small
            # must not fold it into the paragraph above it.
            kind = "heading"
        else:
            kind = "text"
        return Chunk(
            document_id=document_id,
            page_start=min(unit.page for unit in units),
            page_end=max(unit.page for unit in units),
            chunk_index=index,
            text=body,
            heading=heading,
            token_count=self._tokenizer.count(body),
            kind=kind,  # type: ignore[arg-type]
        )

    def _overlap_seed(self, units: list[_Unit]) -> list[_Unit]:
        """Trailing sentences of the closing chunk, as context for the next one."""
        config = self._config
        if config.overlap_tokens <= 0:
            return []
        text_units = [unit for unit in units if unit.kind == "text"]
        if not text_units:
            return []

        last = text_units[-1]
        sentences = split_sentences(last.text) or [last.text]
        picked: list[str] = []
        total = 0
        for sentence in reversed(sentences):
            tokens = self._tokenizer.count(sentence)
            if total + tokens > config.overlap_tokens:
                break
            picked.insert(0, sentence)
            total += tokens

        if not picked or total >= config.target_tokens:
            return []
        return [self._unit(join_sentences(picked), last.page, last.heading, "text")]

    def _split_oversized(self, unit: _Unit) -> list[_Unit]:
        """Split a paragraph longer than max_tokens, sentences first, tokens last."""
        config = self._config
        sentences = (
            split_sentences(unit.text) if config.prefer_sentence_boundaries else [unit.text]
        )
        if not sentences:
            return []

        pieces: list[_Unit] = []
        current: list[str] = []
        current_tokens = 0

        def flush() -> None:
            nonlocal current, current_tokens
            if current:
                pieces.append(
                    self._unit(join_sentences(current), unit.page, unit.heading, "text")
                )
                current, current_tokens = [], 0

        for sentence in sentences:
            tokens = self._tokenizer.count(sentence)
            if tokens > config.max_tokens:
                flush()
                for fragment in self._tokenizer.split_by_tokens(sentence, config.max_tokens):
                    pieces.append(self._unit(fragment, unit.page, unit.heading, "text"))
                continue
            if current_tokens + tokens > config.max_tokens:
                flush()
            current.append(sentence)
            current_tokens += tokens
            if current_tokens >= config.target_tokens:
                flush()
        flush()
        return [piece for piece in pieces if piece.text]

    def _split_table(self, markdown: str) -> list[str]:
        """Split a long table by rows, repeating the header in each piece."""
        if self._tokenizer.count(markdown) <= self._config.max_tokens:
            return [markdown]

        lines = markdown.split("\n")
        header, body = lines[:2], lines[2:]
        header_text = "\n".join(header)
        header_tokens = self._tokenizer.count(header_text)

        pieces: list[str] = []
        current: list[str] = []
        current_tokens = header_tokens
        for row in body:
            row_tokens = self._tokenizer.count(row)
            if current and current_tokens + row_tokens > self._config.max_tokens:
                pieces.append("\n".join(header + current))
                current, current_tokens = [], header_tokens
            current.append(row)
            current_tokens += row_tokens
        if current:
            pieces.append("\n".join(header + current))
        return pieces or [markdown]

    def _merge_small(self, chunks: list[Chunk], start_index: int) -> list[Chunk]:
        """Fold undersized text chunks into the previous chunk on the same page."""
        config = self._config
        merged: list[Chunk] = []
        for chunk in chunks:
            previous = merged[-1] if merged else None
            can_merge = (
                previous is not None
                and chunk.kind == "text"
                and previous.kind == "text"
                and chunk.token_count < config.min_tokens
                and previous.heading == chunk.heading  # never merge across a section
                and previous.page_end == chunk.page_start
                and previous.token_count + chunk.token_count <= config.max_tokens
            )
            if can_merge and previous is not None:
                text = f"{previous.text}\n\n{chunk.text}"
                merged[-1] = replace(
                    previous,
                    text=text,
                    token_count=self._tokenizer.count(text),
                    page_end=chunk.page_end,
                )
                continue
            merged.append(chunk)

        return [replace(chunk, chunk_index=start_index + offset) for offset, chunk in enumerate(merged)]
