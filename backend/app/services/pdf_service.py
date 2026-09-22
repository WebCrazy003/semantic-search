# backend/app/services/pdf_service.py
"""PyMuPDF extraction: one ExtractedDocument per file, one ExtractedPage per page.

Heading detection is a font-size and boldness heuristic. It is good enough for the
manuals this is built for and wrong on some documents, which is why the chunker can
be told to ignore headings entirely.

Words split by the layout are put back together here, because only the extractor
sees the layout: lines of one paragraph, paragraphs PyMuPDF cut into several blocks,
and a word hyphenated across a page break. Pages are therefore read in two passes:
regions with geometry first, then text, once the whole document has been seen.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import fitz

from app.logging_config import get_logger
from app.models.domain import (
    BlockKind,
    DocumentMeta,
    ExtractedDocument,
    ExtractedPage,
    PageBlock,
)
from app.services.extractors import (
    ExtractionError,
    ExtractionUnsupportedError,
    compute_file_hash,
    table_markdown,
)
from app.services.text_service import (
    WrappedLine,
    detect_language,
    ends_in_hangul,
    join_across_break,
    join_wrapped_lines,
    normalize_text,
)

logger = get_logger("pdf")

_HEADING_SIZE_RATIO = 1.15
_HEADING_MAX_CHARS = 120
_BOLD_HEADING_MAX_CHARS = 80
_BOLD_FLAG = 1 << 4
_MONOSPACE_FLAG = 1 << 3
_MONOSPACE_FONTS = re.compile(r"mono|courier|consol|menlo|code", re.IGNORECASE)
_SENTENCE_TAIL = "。．.!?！？，,;；、:："
_TABLE_OVERLAP_SHARE = 0.5
_LANGUAGE_SAMPLE_CHARS = 5000

# Ligatures are expanded (U+FB01 would otherwise sit inside "ﬁlter" as one character)
# and images are not needed; whitespace is kept because trailing spaces are evidence.
_TEXT_FLAGS = fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_LIGATURES & ~fitz.TEXT_PRESERVE_IMAGES

# Two paragraph blocks are one paragraph when the second starts in the same column,
# closer than a paragraph gap, and the first has not finished its sentence.
_SAME_COLUMN_SHARE = 0.5  # of the body font size
_CONTINUATION_GAP_SHARE = 0.6  # of the previous line's height; double spacing is ~0.5
# A terminator, then any closing quotes or brackets and citation marks: 上。[5]
_PARAGRAPH_END = re.compile(r"[。．.!?！？:：;；][\"'”’」』)）\]]*(?:\[\d+\])*$")
_LIST_MARKER = re.compile(r"^(?:[•·‣◦▪●○■□◆◇➢➤→\-–—*]|\(?\d{1,3}[.)]|[①-⑳])")

# Trailing spaces decide Korean mid-word joins only when the document has enough
# Hangul line ends to judge, and keeps the space on a fair share of them.
KoreanMidwordJoin = Literal["auto", "on", "off"]
_MIDWORD_MIN_LINE_ENDS = 20
_MIDWORD_MIN_SPACE_SHARE = 0.2

# Running headers and footers sit in these margins and must not be mistaken for the
# paragraph a page ends or starts with.
_MARGIN_SHARE = 0.05
_RUNNING_MIN_PAGES = 3
_DIGITS = re.compile(r"\d+")
_PAGE_NUMBER = re.compile(r"^[\W\d_]*(?:page|p\.)?[\W\d_]*$", re.IGNORECASE)
_FIRST_WORD = re.compile(r"\S+")


@dataclass(slots=True)
class _Region:
    """One heading, paragraph or table on a page, before it becomes text."""

    kind: BlockKind
    lines: list[WrappedLine]
    top: float
    left: float  # leftmost line
    first_left: float  # first line, which may be indented
    bottom: float
    line_height: float
    table_text: str = ""
    monospace: bool = False  # code listings keep one block per line

    @property
    def last_text(self) -> str:
        return self.lines[-1].text if self.lines else ""


@dataclass(slots=True)
class _Page:
    regions: list[_Region]
    height: float


class PdfUnsupportedError(ExtractionUnsupportedError):
    """The file is a PDF but out of scope: encrypted, or image-only."""


class PdfExtractionError(ExtractionError):
    """The file could not be read as a PDF at all."""


class PdfService:
    suffixes = (".pdf",)
    media_type = "application/pdf"
    compute_file_hash = staticmethod(compute_file_hash)

    def __init__(
        self,
        min_document_chars: int = 20,
        extract_tables: bool = True,
        korean_midword_join: KoreanMidwordJoin = "auto",
    ) -> None:
        self._min_document_chars = min_document_chars
        self._extract_tables = extract_tables
        self._korean_midword_join = korean_midword_join

    def extract(self, path: Path, *, document_id: str, file_hash: str) -> ExtractedDocument:
        try:
            document = fitz.open(str(path))
        except Exception as exc:  # FileDataError, FileNotFoundError, EmptyFileError
            raise PdfExtractionError(f"cannot open {path.name}: {exc}") from exc

        with document:
            if document.needs_pass:
                raise PdfUnsupportedError(f"{path.name} is password-protected")

            laid_out: list[_Page] = []
            for index in range(document.page_count):
                try:
                    page = document.load_page(index)
                    laid_out.append(_Page(self._page_regions(page), page.rect.height))
                except Exception as exc:
                    raise PdfExtractionError(
                        f"failed on page {index + 1} of {path.name}: {exc}"
                    ) from exc

            midword = self._decide_midword(laid_out, path.name)
            self._join_across_pages(laid_out, midword)
            pages: list[ExtractedPage] = []
            for index, laid in enumerate(laid_out):
                blocks = self._render(laid.regions, midword)
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

    def _page_regions(self, page: fitz.Page) -> list[_Region]:
        table_rects, table_blocks = self._tables(page)
        raw = page.get_text("dict", flags=_TEXT_FLAGS)
        body_size = self._body_font_size(raw)

        regions: list[_Region] = []
        for block in raw.get("blocks", []):
            if block.get("type") != 0:  # 0 is text, 1 is an image
                continue
            rect = fitz.Rect(block["bbox"])
            if self._overlaps_table(rect, table_rects):
                continue

            pending: list[tuple[WrappedLine, tuple[float, float, float, float]]] = []
            monospace = self._is_monospace(block)
            for line in block.get("lines", []):
                joined = "".join(span.get("text", "") for span in line.get("spans", []))
                text = joined.strip()
                if not text:
                    continue
                wrapped = WrappedLine(text, trailing_space=joined[-1:].isspace())
                box = tuple(line["bbox"])
                if self._is_heading(line, text, body_size):
                    if pending:
                        regions.append(self._region("paragraph", pending, monospace))
                        pending = []
                    regions.append(self._region("heading", [(wrapped, box)]))
                    continue
                pending.append((wrapped, box))
            if pending:
                regions.append(self._region("paragraph", pending, monospace))

        for rect, markdown in table_blocks:
            regions.append(
                _Region("table", [], rect.y0, rect.x0, rect.x0, rect.y1, 0.0, markdown)
            )

        regions.sort(key=lambda region: (round(region.top, 1), region.first_left))
        return self._merge_continuations(regions, body_size)

    @staticmethod
    def _is_monospace(block: dict[str, Any]) -> bool:
        spans = [
            span
            for line in block.get("lines", [])
            for span in line.get("spans", [])
            if span.get("text", "").strip()
        ]
        return bool(spans) and all(
            int(span.get("flags", 0)) & _MONOSPACE_FLAG
            or _MONOSPACE_FONTS.search(str(span.get("font", "")))
            for span in spans
        )

    @staticmethod
    def _region(
        kind: BlockKind,
        lines: list[tuple[WrappedLine, tuple[float, float, float, float]]],
        monospace: bool = False,
    ) -> _Region:
        boxes = [box for _, box in lines]
        return _Region(
            kind=kind,
            lines=[wrapped for wrapped, _ in lines],
            top=boxes[0][1],
            left=min(box[0] for box in boxes),
            first_left=boxes[0][0],
            bottom=boxes[-1][3],
            line_height=boxes[-1][3] - boxes[-1][1],
            monospace=monospace,
        )

    @staticmethod
    def _merge_continuations(regions: list[_Region], body_size: float) -> list[_Region]:
        """Put back together a paragraph PyMuPDF split into several blocks."""
        merged: list[_Region] = []
        for region in regions:
            previous = merged[-1] if merged else None
            if (
                previous is not None
                and previous.kind == region.kind == "paragraph"
                and not (previous.monospace or region.monospace)
                and abs(region.first_left - previous.left) <= body_size * _SAME_COLUMN_SHARE
                and 0
                <= region.top - previous.bottom
                <= previous.line_height * _CONTINUATION_GAP_SHARE
                and not _PARAGRAPH_END.search(previous.last_text)
                and not _LIST_MARKER.match(region.lines[0].text)
            ):
                previous.lines.extend(region.lines)
                previous.bottom = region.bottom
                previous.line_height = region.line_height
                previous.left = min(previous.left, region.left)
                continue
            merged.append(region)
        return merged

    def _decide_midword(self, pages: list[_Page], filename: str) -> bool:
        """Whether a Hangul line with no trailing space broke inside a word.

        Generators that keep the space after a word-wrapped line give real evidence;
        generators that drop every trailing space give none, and then the old
        behaviour (always a space) is the safe choice.
        """
        if self._korean_midword_join != "auto":
            return self._korean_midword_join == "on"
        line_ends = with_space = 0
        for page in pages:
            for region in page.regions:
                if region.kind != "paragraph":
                    continue
                for line in region.lines[:-1]:
                    if ends_in_hangul(line.text):
                        line_ends += 1
                        with_space += line.trailing_space
        reliable = (
            line_ends >= _MIDWORD_MIN_LINE_ENDS
            and with_space / line_ends >= _MIDWORD_MIN_SPACE_SHARE
        )
        logger.debug(
            "%s: hangul line ends=%d with trailing space=%d, midword join=%s",
            filename,
            line_ends,
            with_space,
            reliable,
        )
        return reliable

    def _join_across_pages(self, pages: list[_Page], midword: bool) -> None:
        """Move the tail of a word split over a page break back onto its first page.

        The word belongs to the page it starts on, which is the page the UI opens.
        """
        running = self._running_keys(pages)
        for current, following in zip(pages, pages[1:], strict=False):
            content = [r for r in current.regions if not self._is_margin(r, current, running)]
            nxt = [r for r in following.regions if not self._is_margin(r, following, running)]
            if not content or not nxt:
                continue
            last, first = content[-1], nxt[0]
            if last.kind != "paragraph" or first.kind != "paragraph":
                continue
            head = first.lines[0]
            match = _FIRST_WORD.match(head.text)
            if match is None:
                continue
            tail = last.lines[-1]
            joined = join_across_break(
                tail.text,
                match.group(),
                left_trailing_space=tail.trailing_space,
                korean_midword_join=midword,
            )
            if joined is None:
                continue
            last.lines[-1] = WrappedLine(joined, tail.trailing_space)
            rest = head.text[match.end() :].strip()
            if rest:
                first.lines[0] = WrappedLine(rest, head.trailing_space)
            else:
                first.lines.pop(0)
                if not first.lines:
                    following.regions.remove(first)

    @staticmethod
    def _region_key(region: _Region) -> str:
        text = " ".join(line.text for line in region.lines) or region.table_text
        return _DIGITS.sub("#", "".join(text.split()))

    def _running_keys(self, pages: list[_Page]) -> set[str]:
        """Text that recurs in the page margins: running headers and footers."""
        seen: Counter[str] = Counter()
        for page in pages:
            keys = {
                self._region_key(region)
                for region in page.regions
                if self._in_margin(region, page)
            }
            seen.update(keys)
        return {key for key, count in seen.items() if count >= _RUNNING_MIN_PAGES}

    @staticmethod
    def _in_margin(region: _Region, page: _Page) -> bool:
        margin = page.height * _MARGIN_SHARE
        return region.bottom <= margin or region.top >= page.height - margin

    def _is_margin(self, region: _Region, page: _Page, running: set[str]) -> bool:
        if not self._in_margin(region, page):
            return False
        key = self._region_key(region)
        return key in running or bool(_PAGE_NUMBER.match(key))

    @staticmethod
    def _render(regions: list[_Region], midword: bool) -> list[PageBlock]:
        blocks: list[PageBlock] = []
        for region in regions:
            if region.kind == "table":
                raw = region.table_text
            elif region.kind == "heading":
                raw = region.lines[0].text if region.lines else ""
            else:
                raw = join_wrapped_lines(region.lines, korean_midword_join=midword)
            text = normalize_text(raw)
            if text:
                blocks.append(PageBlock(kind=region.kind, text=text, order=len(blocks)))
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
                [join_wrapped_lines(str(cell or "").split("\n")) for cell in row]
                for row in table.extract()
            ]
            rows = [row for row in rows if any(row)]
            if len(rows) < 2:  # a single row is not worth treating as a table
                continue
            rect = fitz.Rect(table.bbox)
            rects.append(rect)
            blocks.append((rect, table_markdown(rows)))
        return rects, blocks

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
