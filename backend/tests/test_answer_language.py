import pytest

from app.services.answer_language import choose, detect, is_in


class TestDetect:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("How often should the seals be replaced?", "en"),
            ("如何更换滤芯", "zh-Hans"),
            ("正常工作压力是多少", "zh-Hans"),
            ("這個濾芯應該多久更換一次？", "zh-Hant"),
            ("필터는 얼마나 자주 교체해야 하나요?", "ko"),
        ],
    )
    def test_each_supported_language(self, text: str, expected: str) -> None:
        assert detect(text) == expected

    def test_a_korean_question_with_an_english_model_number_is_korean(self) -> None:
        assert detect("PX-200 펌프의 씰 교체 주기는?") == "ko"

    def test_a_korean_question_with_long_english_terms_is_still_korean(self) -> None:
        assert detect("BGE-M3 embedding model은 뭐야") == "ko"

    def test_a_korean_question_with_a_chinese_part_name_is_korean(self) -> None:
        assert detect("滤芯 교체 방법") == "ko"

    def test_a_chinese_question_with_a_model_number_is_chinese(self) -> None:
        assert detect("PX-200的工作压力是多少") == "zh-Hans"

    def test_an_english_question_quoting_a_chinese_term_is_english(self) -> None:
        assert detect("What does 滤芯 mean in this manual?") == "en"

    def test_japanese_is_not_answered_in(self) -> None:
        assert detect("フィルターの交換方法は？") == "other"
        assert detect("滤芯の交換方法") == "other"

    def test_other_scripts_are_not_answered_in(self) -> None:
        assert detect("Как заменить фильтр?") == "other"

    def test_no_letters_is_unknown(self) -> None:
        assert detect("PX-200") == "en"  # Latin letters still count
        assert detect("12-34 / 56") is None


class TestChoose:
    def test_the_question_decides(self) -> None:
        assert choose("필터 교체 주기", top_source_text="滤芯每三个月更换一次").language == "ko"

    def test_no_letters_takes_the_top_passage_language(self) -> None:
        assert choose("12-34", top_source_text="滤芯每三个月更换一次").language == "zh-Hans"

    def test_no_letters_and_no_passage_is_english(self) -> None:
        assert choose("12-34").language == "en"

    def test_an_unsupported_language_is_answered_in_english_and_flagged(self) -> None:
        choice = choose("フィルターの交換方法は？")
        assert choice.language == "en"
        assert choice.unsupported is True


class TestIsIn:
    def test_matching(self) -> None:
        assert is_in("The seals are replaced every 2,000 hours [1].", "en")
        assert is_in("씰은 2,000시간마다 교체합니다 [1].", "ko")
        assert is_in("密封圈每2000小时更换一次[1]。", "zh-Hans")

    def test_an_english_answer_quoting_chinese_terms_is_english(self) -> None:
        assert is_in("Clean the 滤网 and 滤芯 [1].", "en")
        assert is_in("Replace the filter cartridge (滤芯) every 3 months [1].", "en")

    def test_a_korean_answer_citing_a_chinese_term_is_korean(self) -> None:
        assert is_in("필터 카트리지(滤芯)는 3개월마다 교체합니다 [1].", "ko")

    def test_drift_into_the_sources_language_is_caught(self) -> None:
        assert not is_in("滤芯每三个月更换一次[1]。", "ko")
        assert not is_in("滤芯每三个月更换一次[1]。", "en")

    def test_the_wrong_chinese_script_is_caught_only_on_clear_evidence(self) -> None:
        assert not is_in("這個濾芯應該每三個月更換一次。", "zh-Hans")
        assert not is_in("这个滤芯应该每三个月更换一次。", "zh-Hant")
        # Nothing script-specific either way: accepted.
        assert is_in("每三个月一次。", "zh-Hant")

    def test_no_letters_passes(self) -> None:
        assert is_in("2,000 [1].", "ko")
