from datetime import UTC, datetime

import pytest

from app.models.domain import Chunk, DocumentMeta, ExtractedDocument, ExtractedPage, PageBlock


def _meta() -> DocumentMeta:
    return DocumentMeta(
        document_id="a" * 64,
        filename="manual.pdf",
        filepath="/documents/manual.pdf",
        folder="/documents",
        file_hash="a" * 64,
        modified_at=datetime(2026, 9, 20, 12, 0, tzinfo=UTC),
        language="zh",
        title="使用手册",
    )


def test_extracted_document_exposes_document_id_from_its_metadata() -> None:
    document = ExtractedDocument(meta=_meta(), pages=())
    assert document.document_id == "a" * 64


def test_page_blocks_default_to_order_zero() -> None:
    block = PageBlock(kind="paragraph", text="hello")
    assert block.order == 0


def test_extracted_page_reports_its_character_count_ignoring_whitespace() -> None:
    page = ExtractedPage(page_number=1, blocks=(), text="a b\nc")
    assert page.char_count == 3


def test_domain_objects_are_immutable() -> None:
    chunk = Chunk(
        document_id="a" * 64,
        page_start=1,
        page_end=1,
        chunk_index=0,
        text="hello",
        heading=None,
        token_count=1,
        kind="text",
    )
    with pytest.raises(AttributeError):
        chunk.text = "changed"  # type: ignore[misc]
