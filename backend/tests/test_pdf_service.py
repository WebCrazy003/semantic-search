# backend/tests/test_pdf_service.py
from pathlib import Path

import fitz
import pytest

from app.services.pdf_service import PdfExtractionError, PdfService, PdfUnsupportedError

CHINESE_SENTENCE = "在更换滤芯之前，必须先关闭主电源开关，并等待设备完全冷却至室温。"
KOREAN_SENTENCE = "필터를 교체하기 전에 반드시 주 전원 스위치를 끄고 장비가 완전히 식을 때까지 기다리십시오."


@pytest.fixture
def service() -> PdfService:
    return PdfService(min_document_chars=20, extract_tables=True)


def _extract(service: PdfService, path: Path):
    file_hash = service.compute_file_hash(path)
    return service.extract(path, document_id=file_hash, file_hash=file_hash)


class TestFileHash:
    def test_hash_is_a_64_character_hex_digest(self, service: PdfService, corpus_dir: Path) -> None:
        digest = service.compute_file_hash(corpus_dir / "manual_zh.pdf")
        assert len(digest) == 64
        assert all(char in "0123456789abcdef" for char in digest)

    def test_identical_bytes_hash_identically(
        self, service: PdfService, corpus_dir: Path, tmp_path: Path
    ) -> None:
        source = corpus_dir / "manual_zh.pdf"
        copy = tmp_path / "in-another-folder.pdf"
        copy.write_bytes(source.read_bytes())
        assert service.compute_file_hash(copy) == service.compute_file_hash(source)

    def test_different_documents_hash_differently(
        self, service: PdfService, corpus_dir: Path
    ) -> None:
        assert service.compute_file_hash(corpus_dir / "manual_zh.pdf") != service.compute_file_hash(
            corpus_dir / "manual_ko.pdf"
        )


class TestExtraction:
    def test_page_numbers_are_one_based_and_contiguous(
        self, service: PdfService, corpus_dir: Path
    ) -> None:
        document = _extract(service, corpus_dir / "manual_zh.pdf")
        assert [page.page_number for page in document.pages] == [1, 2, 3]

    def test_chinese_text_survives_extraction(self, service: PdfService, corpus_dir: Path) -> None:
        document = _extract(service, corpus_dir / "manual_zh.pdf")
        flat = "".join(page.text for page in document.pages).replace(" ", "")
        assert CHINESE_SENTENCE.replace(" ", "") in flat

    def test_korean_text_survives_extraction(self, service: PdfService, corpus_dir: Path) -> None:
        document = _extract(service, corpus_dir / "manual_ko.pdf")
        flat = "".join(page.text for page in document.pages)
        assert "필터를 교체하기 전에" in flat

    def test_korean_words_are_not_glued_together_by_line_wrapping(
        self, service: PdfService, corpus_dir: Path
    ) -> None:
        document = _extract(service, corpus_dir / "manual_ko.pdf")
        flat = "".join(page.text for page in document.pages)
        assert "끄고장비가" not in flat

    def test_headings_are_detected(self, service: PdfService, corpus_dir: Path) -> None:
        document = _extract(service, corpus_dir / "manual_zh.pdf")
        headings = [
            block.text
            for page in document.pages
            for block in page.blocks
            if block.kind == "heading"
        ]
        assert any("安全注意事项" in heading for heading in headings)
        assert any("日常维护" in heading for heading in headings)

    def test_paragraph_blocks_are_present_on_every_page(
        self, service: PdfService, corpus_dir: Path
    ) -> None:
        document = _extract(service, corpus_dir / "manual_zh.pdf")
        for page in document.pages:
            assert any(block.kind == "paragraph" for block in page.blocks)

    def test_block_order_is_sequential_within_a_page(
        self, service: PdfService, corpus_dir: Path
    ) -> None:
        document = _extract(service, corpus_dir / "manual_zh.pdf")
        for page in document.pages:
            assert [block.order for block in page.blocks] == list(range(len(page.blocks)))

    def test_metadata_is_populated(self, service: PdfService, corpus_dir: Path) -> None:
        path = corpus_dir / "manual_zh.pdf"
        document = _extract(service, path)
        assert document.meta.filename == "manual_zh.pdf"
        assert document.meta.filepath == str(path)
        assert document.meta.folder == str(path.parent)
        assert document.meta.language == "zh"
        assert document.meta.title == "设备使用手册"
        assert document.meta.modified_at.tzinfo is not None

    def test_korean_document_is_labelled_korean(
        self, service: PdfService, corpus_dir: Path
    ) -> None:
        document = _extract(service, corpus_dir / "manual_ko.pdf")
        assert document.meta.language == "ko"

    def test_mixed_document_is_labelled_mixed(self, service: PdfService, corpus_dir: Path) -> None:
        document = _extract(service, corpus_dir / "manual_mixed.pdf")
        assert document.meta.language == "mixed"

    def test_page_text_is_already_normalized(self, service: PdfService, corpus_dir: Path) -> None:
        document = _extract(service, corpus_dir / "manual_zh.pdf")
        for page in document.pages:
            assert "  " not in page.text
            assert "\n\n\n" not in page.text
            assert page.text == page.text.strip()


class TestTables:
    def test_a_ruled_table_is_extracted_as_a_table_block(
        self, service: PdfService, corpus_dir: Path
    ) -> None:
        document = _extract(service, corpus_dir / "manual_mixed.pdf")
        tables = [
            block for page in document.pages for block in page.blocks if block.kind == "table"
        ]
        assert len(tables) == 1
        assert "XJ-200B" in tables[0].text
        assert tables[0].text.startswith("|")

    def test_table_cells_are_not_duplicated_as_paragraph_text(
        self, service: PdfService, corpus_dir: Path
    ) -> None:
        document = _extract(service, corpus_dir / "manual_mixed.pdf")
        table_page = document.pages[2]
        paragraphs = " ".join(
            block.text for block in table_page.blocks if block.kind == "paragraph"
        )
        assert "SAE 40" not in paragraphs

    def test_table_extraction_can_be_switched_off(self, corpus_dir: Path) -> None:
        service = PdfService(min_document_chars=20, extract_tables=False)
        document = _extract(service, corpus_dir / "manual_mixed.pdf")
        assert not any(
            block.kind == "table" for page in document.pages for block in page.blocks
        )


class TestUnsupportedAndBrokenFiles:
    def test_a_pdf_with_no_text_is_unsupported(self, service: PdfService, corpus_dir: Path) -> None:
        with pytest.raises(PdfUnsupportedError, match="scanned"):
            _extract(service, corpus_dir / "empty_scan_zh.pdf")

    def test_a_password_protected_pdf_is_unsupported(
        self, service: PdfService, tmp_path: Path
    ) -> None:
        path = tmp_path / "locked.pdf"
        document = fitz.open()
        page = document.new_page()
        page.insert_text(fitz.Point(72, 100), "secret content here for length")
        document.save(str(path), encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="letmein")
        document.close()
        with pytest.raises(PdfUnsupportedError, match="password"):
            _extract(service, path)

    def test_a_corrupt_file_raises_an_extraction_error(
        self, service: PdfService, tmp_path: Path
    ) -> None:
        path = tmp_path / "broken.pdf"
        path.write_bytes(b"%PDF-1.7\nthis is not a real pdf at all")
        with pytest.raises(PdfExtractionError):
            _extract(service, path)

    def test_a_missing_file_raises_an_extraction_error(
        self, service: PdfService, tmp_path: Path
    ) -> None:
        with pytest.raises(PdfExtractionError):
            service.extract(tmp_path / "nope.pdf", document_id="x", file_hash="x")


class TestWholeWords:
    def test_hyphenated_words_are_rejoined(self, service: PdfService, wrap_dir: Path) -> None:
        text = _extract(service, wrap_dir / "wrap_en.pdf").pages[0].text
        assert "maintenance light" in text
        assert "maintenance log" in text  # soft hyphen
        assert "state-of-the-art controller" in text
        assert "COVID-19 lockout codes and ISO-9001 audit" in text
        assert "mainte" not in text.replace("maintenance", "")

    def test_a_paragraph_split_into_two_blocks_is_one_block(
        self, service: PdfService, wrap_dir: Path
    ) -> None:
        page = _extract(service, wrap_dir / "wrap_en.pdf").pages[0]
        assert "The seal inspection takes place every week." in [b.text for b in page.blocks]

    def test_a_word_split_over_a_page_break_stays_on_its_first_page(
        self, service: PdfService, wrap_dir: Path
    ) -> None:
        first, second = _extract(service, wrap_dir / "wrap_en.pdf").pages
        assert "recorded in the inspection" in first.text
        assert second.text.startswith("report before restarting")
        assert "tion" not in second.text.split()

    def test_korean_mid_word_breaks_are_joined(self, service: PdfService, wrap_dir: Path) -> None:
        from tests.fixtures.make_fixtures import WRAP_KOREAN_TEXT

        text = _extract(service, wrap_dir / "wrap_ko_charwrap.pdf").pages[0].text
        assert text == WRAP_KOREAN_TEXT + " " + WRAP_KOREAN_TEXT

    def test_korean_without_trailing_space_evidence_keeps_word_spaces(
        self, service: PdfService, wrap_dir: Path
    ) -> None:
        # No evidence, so every break gets a space: never two words glued together.
        text = _extract(service, wrap_dir / "wrap_ko_nospace.pdf").pages[0].text
        assert "교체하기 전에" in text
        assert "완전 히" in text

    def test_korean_mid_word_join_can_be_forced_off(self, wrap_dir: Path) -> None:
        service = PdfService(korean_midword_join="off")
        text = _extract(service, wrap_dir / "wrap_ko_charwrap.pdf").pages[0].text
        assert "완전 히" in text

    def test_korean_mid_word_join_can_be_forced_on(self, wrap_dir: Path) -> None:
        service = PdfService(korean_midword_join="on")
        text = _extract(service, wrap_dir / "wrap_ko_nospace.pdf").pages[0].text
        assert "완전히" in text

    def test_a_list_item_is_not_merged_into_the_paragraph_above(self) -> None:
        from app.services.pdf_service import _Region
        from app.services.text_service import WrappedLine

        def region(text: str, top: float) -> _Region:
            return _Region("paragraph", [WrappedLine(text)], top, 56, 56, top + 15, 15)

        merged = PdfService._merge_continuations(
            [region("Check these parts", 100), region("• the filter", 117)], body_size=11
        )
        assert len(merged) == 2

    def test_a_finished_sentence_is_not_merged_with_the_next_block(self) -> None:
        from app.services.pdf_service import _Region
        from app.services.text_service import WrappedLine

        def region(text: str, top: float) -> _Region:
            return _Region("paragraph", [WrappedLine(text)], top, 56, 56, top + 15, 15)

        merged = PdfService._merge_continuations(
            [region("Close the valve.", 100), region("Then open the lid", 117)], body_size=11
        )
        assert len(merged) == 2

    def test_a_code_listing_keeps_one_block_per_line(self) -> None:
        from app.services.pdf_service import _Region
        from app.services.text_service import WrappedLine

        def region(text: str, top: float) -> _Region:
            return _Region(
                "paragraph", [WrappedLine(text)], top, 56, 56, top + 15, 15, monospace=True
            )

        merged = PdfService._merge_continuations(
            [region("render: function(){", 100), region("return x", 117)], body_size=11
        )
        assert len(merged) == 2

    def test_a_citation_after_a_full_stop_ends_the_paragraph(self) -> None:
        from app.services.pdf_service import _Region
        from app.services.text_service import WrappedLine

        def region(text: str, top: float) -> _Region:
            return _Region("paragraph", [WrappedLine(text)], top, 56, 56, top + 15, 15)

        merged = PdfService._merge_continuations(
            [region("把工程應用到軟體上。[5]", 100), region("與開發有關的理論", 117)], body_size=11
        )
        assert len(merged) == 2
