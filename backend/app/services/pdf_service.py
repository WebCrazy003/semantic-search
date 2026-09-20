# backend/app/services/pdf_service.py
"""PyMuPDF extraction: one ExtractedDocument per file, one ExtractedPage per page.

Heading detection is a font-size and boldness heuristic. It is good enough for the
manuals this is built for and wrong on some documents, which is why the chunker can
be told to ignore headings entirely.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import fitz

from app.logging_config import get_logger
from app.models.domain import DocumentMeta, ExtractedDocument, ExtractedPage, PageBlock
from app.services.text_service import detect_language, join_wrapped_lines, normalize_text

logger = get_logger("pdf")

_HASH_BLOCK = 1024 * 1024
_HEADING_SIZE_RATIO = 1.15
_HEADING_MAX_CHARS = 120
_BOLD_HEADING_MAX_CHARS = 80
_BOLD_FLAG = 1 << 4
_SENTENCE_TAIL = "。．.!?！？，,;；、:："
_TABLE_OVERLAP_SHARE = 0.5
_LANGUAGE_SAMPLE_CHARS = 5000


class PdfUnsupportedError(Exception):
    """The file is a PDF but out of scope: encrypted, or image-only."""


class PdfExtractionError(Exception):
    """The file could not be read as a PDF at all."""


class PdfService:
    def __init__(self, min_document_chars: int = 20, extract_tables: bool = True) -> None:
        self._min_document_chars = min_document_chars
        self._extract_tables = extract_tables

    @staticmethod
    def compute_file_hash(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(_HASH_BLOCK), b""):
                digest.update(block)
        return digest.hexdigest()

    def extract(self, path: Path, *, document_id: str, file_hash: str) -> ExtractedDocument:
        try:
            document = fitz.open(str(path))
        except Exception as exc:  # FileDataError, FileNotFoundError, EmptyFileError
            raise PdfExtractionError(f"cannot open {path.name}: {exc}") from exc

        with document:
            if document.needs_pass:
                raise PdfUnsupportedError(f"{path.name} is password-protected")

            pages: list[ExtractedPage] = []
            for index in range(document.page_count):
                try:
                    page = document.load_page(index)
                    blocks = self._page_blocks(page)
                except Exception as exc:
                    raise PdfExtractionError(
                        f"failed on page {index + 1} of {path.name}: {exc}"
                    ) from exc
                text = normalize_text("\n\n".join(block.text for block in blocks))
                pages.append(
                    ExtractedPage(page_number=index + 1, blocks=tuple(blocks), text=text)
                )

            title = (document.metadata or {}).get("title") or None
            if title:
                title = title.strip() or None

        extracted = ExtractedDocument(
            meta=DocumentMeta(
                document_id=document_id,
                filename=path.name,
                filepath=str(path),
                folder=str(path.parent),
                file_hash=file_hash,
                modified_at=datetime.fromtimestamp(path.stat().st_mtime, tz=UTC),
                language=None,
                title=title,
            ),
            pages=tuple(pages),
        )

        if extracted.char_count < self._min_document_chars:
            raise PdfUnsupportedError(
                f"{path.name} has no extractable text; it is probably scanned, "
                "and OCR is out of scope"
            )

        sample = "\n".join(page.text for page in extracted.pages)[:_LANGUAGE_SAMPLE_CHARS]
        language = detect_language(sample)
        logger.info(
            "extracted %s: pages=%d chars=%d language=%s",
            path.name,
            len(extracted.pages),
            extracted.char_count,
            language,
        )
        return ExtractedDocument(
            meta=replace(extracted.meta, language=language),
            pages=extracted.pages,
        )

    # ---------------------------------------------------------------- blocks

    def _page_blocks(self, page: fitz.Page) -> list[PageBlock]:
        table_rects, table_blocks = self._tables(page)
        raw = page.get_text("dict")
        body_size = self._body_font_size(raw)

        # (y, x, block) so everything can be put back into reading order at the end.
        placed: list[tuple[float, float, PageBlock]] = []

        for block in raw.get("blocks", []):
            if block.get("type") != 0:  # 0 is text, 1 is an image
                continue
            rect = fitz.Rect(block["bbox"])
            if self._overlaps_table(rect, table_rects):
                continue

            pending: list[str] = []
            pending_origin: tuple[float, float] | None = None
            for line in block.get("lines", []):
                text = "".join(span.get("text", "") for span in line.get("spans", [])).strip()
                if not text:
                    continue
                origin = (line["bbox"][1], line["bbox"][0])
                if self._is_heading(line, text, body_size):
                    if pending and pending_origin:
                        placed.append(
                            (*pending_origin, PageBlock("paragraph", join_wrapped_lines(pending)))
                        )
                        pending, pending_origin = [], None
                    placed.append((*origin, PageBlock("heading", text)))
                    continue
                if pending_origin is None:
                    pending_origin = origin
                pending.append(text)
            if pending and pending_origin:
                placed.append(
                    (*pending_origin, PageBlock("paragraph", join_wrapped_lines(pending)))
                )

        for rect, markdown in table_blocks:
            placed.append((rect.y0, rect.x0, PageBlock("table", markdown)))

        placed.sort(key=lambda item: (round(item[0], 1), item[1]))

        blocks: list[PageBlock] = []
        for block in (item[2] for item in placed):
            text = normalize_text(block.text)
            if text:
                blocks.append(PageBlock(kind=block.kind, text=text, order=len(blocks)))
        return blocks

    @staticmethod
    def _body_font_size(raw: dict[str, Any]) -> float:
        """The most common span size on the page, weighted by character count."""
        weights: Counter[float] = Counter()
        for block in raw.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "").strip()
                    if text:
                        weights[round(float(span.get("size", 0.0)), 1)] += len(text)
        return weights.most_common(1)[0][0] if weights else 10.0

    @staticmethod
    def _is_heading(line: dict[str, Any], text: str, body_size: float) -> bool:
        spans = line.get("spans", [])
        if not spans or len(text) > _HEADING_MAX_CHARS:
            return False
        largest = max(round(float(span.get("size", 0.0)), 1) for span in spans)
        if largest >= body_size * _HEADING_SIZE_RATIO:
            return True
        all_bold = all(
            int(span.get("flags", 0)) & _BOLD_FLAG or "bold" in str(span.get("font", "")).lower()
            for span in spans
        )
        return all_bold and len(text) <= _BOLD_HEADING_MAX_CHARS and text[-1] not in _SENTENCE_TAIL

    # ---------------------------------------------------------------- tables

    def _tables(self, page: fitz.Page) -> tuple[list[fitz.Rect], list[tuple[fitz.Rect, str]]]:
        if not self._extract_tables:
            return [], []
        try:
            found = page.find_tables()
        except Exception as exc:  # table finding is best-effort
            logger.warning("find_tables failed on page %d: %s", page.number + 1, exc)
            return [], []

        rects: list[fitz.Rect] = []
        blocks: list[tuple[fitz.Rect, str]] = []
        for table in getattr(found, "tables", []):
            rows = [
                [("" if cell is None else str(cell)).replace("\n", " ").strip() for cell in row]
                for row in table.extract()
            ]
            rows = [row for row in rows if any(row)]
            if len(rows) < 2:  # a single row is not worth treating as a table
                continue
            rect = fitz.Rect(table.bbox)
            rects.append(rect)
            blocks.append((rect, self._table_markdown(rows)))
        return rects, blocks

    @staticmethod
    def _table_markdown(rows: list[list[str]]) -> str:
        """Header row first, then a rule, then the body.

        Markdown keeps each row on one line, so the chunker can split a long table by
        rows and repeat the header, which is what the specification asks for.
        """
        width = max(len(row) for row in rows)
        padded = [row + [""] * (width - len(row)) for row in rows]
        lines = ["| " + " | ".join(padded[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
        lines.extend("| " + " | ".join(row) + " |" for row in padded[1:])
        return "\n".join(lines)

    @staticmethod
    def _overlaps_table(rect: fitz.Rect, table_rects: list[fitz.Rect]) -> bool:
        area = rect.get_area()
        if area <= 0:
            return False
        for table_rect in table_rects:
            overlap = rect & table_rect
            if not overlap.is_empty and overlap.get_area() / area > _TABLE_OVERLAP_SHARE:
                return True
        return False
