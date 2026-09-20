# backend/tests/test_fixtures.py
from pathlib import Path

from tests.fixtures.make_fixtures import (
    CHINESE_FILTER_SENTENCE,
    KOREAN_FILTER_SENTENCE,
    build_all,
)


def test_build_all_writes_the_expected_files(tmp_path: Path) -> None:
    paths = build_all(tmp_path)
    names = sorted(path.name for path in paths)
    assert names == [
        "empty_scan_zh.pdf",
        "manual_ko.pdf",
        "manual_mixed.pdf",
        "manual_zh.pdf",
    ]
    # The scan fixture is a deliberately text-free page, so it is much smaller.
    text_pdfs = [path for path in paths if path.name != "empty_scan_zh.pdf"]
    assert all(path.stat().st_size > 1000 for path in text_pdfs)
    assert (tmp_path / "empty_scan_zh.pdf").stat().st_size > 0


def test_chinese_text_round_trips_through_extraction(tmp_path: Path) -> None:
    import fitz

    build_all(tmp_path)
    with fitz.open(tmp_path / "manual_zh.pdf") as document:
        text = "".join(page.get_text() for page in document)
    assert CHINESE_FILTER_SENTENCE.replace(" ", "") in text.replace(" ", "").replace("\n", "")


def test_korean_text_round_trips_through_extraction(tmp_path: Path) -> None:
    import fitz

    build_all(tmp_path)
    with fitz.open(tmp_path / "manual_ko.pdf") as document:
        text = "".join(page.get_text() for page in document)
    assert KOREAN_FILTER_SENTENCE.replace(" ", "") in text.replace(" ", "").replace("\n", "")


def test_the_scanned_stand_in_has_no_extractable_text(tmp_path: Path) -> None:
    import fitz

    build_all(tmp_path)
    with fitz.open(tmp_path / "empty_scan_zh.pdf") as document:
        text = "".join(page.get_text() for page in document).strip()
    assert text == ""


def test_the_chinese_manual_has_three_pages(tmp_path: Path) -> None:
    import fitz

    build_all(tmp_path)
    with fitz.open(tmp_path / "manual_zh.pdf") as document:
        assert document.page_count == 3
