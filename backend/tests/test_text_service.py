# backend/tests/test_text_service.py
from app.services.text_service import (
    detect_language,
    join_sentences,
    join_wrapped_lines,
    normalize_text,
    split_paragraphs,
    split_sentences,
)


class TestNormalizeText:
    def test_collapses_runs_of_spaces_and_tabs(self) -> None:
        assert normalize_text("a  \t  b") == "a b"

    def test_normalizes_line_endings(self) -> None:
        assert normalize_text("a\r\nb\rc") == "a\nb\nc"

    def test_collapses_runs_of_blank_lines_to_one(self) -> None:
        assert normalize_text("a\n\n\n\n\nb") == "a\n\nb"

    def test_strips_trailing_whitespace_per_line(self) -> None:
        assert normalize_text("a   \n   b") == "a\nb"

    def test_removes_zero_width_and_soft_hyphen_characters(self) -> None:
        assert normalize_text("a​b­c﻿d") == "abcd"

    def test_leaves_single_newlines_alone(self) -> None:
        # Repairing wraps is join_wrapped_lines' job, not this function's.
        assert normalize_text("更换滤芯之前必须\n关闭主电源开关。") == "更换滤芯之前必须\n关闭主电源开关。"

    def test_keeps_a_paragraph_break_between_chinese_paragraphs(self) -> None:
        assert normalize_text("第一段。\n\n第二段。") == "第一段。\n\n第二段。"

    def test_preserves_punctuation_numbers_and_identifiers(self) -> None:
        source = "型号 XJ-200B，压力 3.5 MPa（±0.1）。"
        assert normalize_text(source) == source

    def test_preserves_precomposed_hangul(self) -> None:
        # NFC keeps Hangul as syllables rather than decomposing into jamo.
        assert normalize_text("한글") == "한글"
        assert len(normalize_text("한글")) == 2

    def test_converts_ideographic_space_to_a_plain_space(self) -> None:
        assert normalize_text("a　b") == "a b"

    def test_returns_an_empty_string_for_whitespace_only_input(self) -> None:
        assert normalize_text("   \n\n  ") == ""


class TestJoinWrappedLines:
    def test_joins_two_chinese_lines_without_a_space(self) -> None:
        lines = ["更换滤芯之前必须", "关闭主电源开关。"]
        assert join_wrapped_lines(lines) == "更换滤芯之前必须关闭主电源开关。"

    def test_joins_two_korean_lines_with_a_space(self) -> None:
        # Korean is space-separated, so gluing these would merge two words.
        lines = ["필터를 교체하기", "전에 전원을 끄십시오."]
        assert join_wrapped_lines(lines) == "필터를 교체하기 전에 전원을 끄십시오."

    def test_joins_english_lines_with_a_space(self) -> None:
        assert join_wrapped_lines(["the quick", "brown fox"]) == "the quick brown fox"

    def test_repairs_a_hyphenated_latin_word_split_across_lines(self) -> None:
        assert join_wrapped_lines(["mainten-", "ance schedule"]) == "maintenance schedule"

    def test_does_not_strip_a_hyphen_from_an_identifier(self) -> None:
        assert join_wrapped_lines(["model XJ-", "200B"]) == "model XJ- 200B"

    def test_ignores_blank_lines(self) -> None:
        assert join_wrapped_lines(["one", "  ", "two"]) == "one two"

    def test_returns_an_empty_string_for_no_lines(self) -> None:
        assert join_wrapped_lines([]) == ""


class TestSplitParagraphs:
    def test_splits_on_blank_lines(self) -> None:
        assert split_paragraphs("one\n\ntwo\n\nthree") == ["one", "two", "three"]

    def test_keeps_single_newlines_inside_a_paragraph(self) -> None:
        assert split_paragraphs("line one\nline two") == ["line one\nline two"]

    def test_drops_empty_paragraphs(self) -> None:
        assert split_paragraphs("one\n\n\n\ntwo") == ["one", "two"]


class TestSplitSentences:
    def test_splits_chinese_on_full_width_terminators(self) -> None:
        assert split_sentences("第一句。第二句！第三句？") == ["第一句。", "第二句！", "第三句？"]

    def test_splits_korean_on_ascii_terminators(self) -> None:
        result = split_sentences("첫 문장입니다. 두 번째 문장입니다.")
        assert result == ["첫 문장입니다.", "두 번째 문장입니다."]

    def test_does_not_split_a_decimal_number(self) -> None:
        assert split_sentences("압력은 3.5 MPa 입니다.") == ["압력은 3.5 MPa 입니다."]

    def test_does_not_split_a_chinese_decimal_number(self) -> None:
        assert split_sentences("压力为 3.5 MPa。") == ["压力为 3.5 MPa。"]

    def test_splits_english_sentences(self) -> None:
        assert split_sentences("First one. Second one.") == ["First one.", "Second one."]

    def test_splits_on_a_newline(self) -> None:
        assert split_sentences("first\nsecond") == ["first", "second"]

    def test_returns_the_whole_text_when_there_is_no_terminator(self) -> None:
        assert split_sentences("没有标点的文字") == ["没有标点的文字"]

    def test_returns_an_empty_list_for_blank_input(self) -> None:
        assert split_sentences("   ") == []


class TestJoinSentences:
    def test_joins_chinese_sentences_without_a_space(self) -> None:
        assert join_sentences(["第一句。", "第二句。"]) == "第一句。第二句。"

    def test_joins_english_sentences_with_a_space(self) -> None:
        assert join_sentences(["First.", "Second."]) == "First. Second."

    def test_keeps_the_space_between_korean_sentences(self) -> None:
        assert join_sentences(["첫째.", "둘째."]) == "첫째. 둘째."

    def test_round_trips_with_split_sentences_for_chinese(self) -> None:
        source = "第一句。第二句！第三句？"
        assert join_sentences(split_sentences(source)) == source

    def test_returns_an_empty_string_for_no_parts(self) -> None:
        assert join_sentences([]) == ""


class TestDetectLanguage:
    def test_detects_chinese(self) -> None:
        assert detect_language("更换滤芯之前必须关闭主电源开关并等待冷却。") == "zh"

    def test_detects_korean(self) -> None:
        assert detect_language("필터를 교체하기 전에 반드시 주 전원을 끄십시오.") == "ko"

    def test_detects_english(self) -> None:
        assert detect_language("Switch off the main power before replacing the filter.") == "en"

    def test_reports_mixed_when_two_scripts_are_both_substantial(self) -> None:
        assert detect_language("更换滤芯之前必须关闭电源。필터를 교체하기 전에 전원을 끄십시오.") == "mixed"

    def test_returns_none_when_there_is_too_little_text_to_judge(self) -> None:
        assert detect_language("ab") is None
