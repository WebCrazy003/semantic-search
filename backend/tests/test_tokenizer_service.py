# backend/tests/test_tokenizer_service.py
import pytest

from app.config import get_settings
from app.services.tokenizer_service import BgeTokenizer


@pytest.fixture(scope="module")
def tokenizer() -> BgeTokenizer:
    settings = get_settings()
    if not settings.bge_model_path.exists():
        pytest.skip("model not downloaded; run scripts/download_model.py")
    return BgeTokenizer(settings.bge_model_path)


@pytest.mark.integration
def test_counts_are_positive_and_scale_with_length(tokenizer: BgeTokenizer) -> None:
    short = tokenizer.count("更换滤芯")
    long = tokenizer.count("更换滤芯之前必须关闭主电源开关并等待设备完全冷却。" * 4)
    assert 0 < short < long


@pytest.mark.integration
def test_counting_excludes_special_tokens(tokenizer: BgeTokenizer) -> None:
    # With CLS and SEP included this would be 2 higher.
    assert tokenizer.count("hello world") <= 3


@pytest.mark.integration
def test_korean_and_chinese_of_similar_meaning_have_comparable_counts(
    tokenizer: BgeTokenizer,
) -> None:
    chinese = tokenizer.count("更换滤芯之前必须关闭主电源开关。")
    korean = tokenizer.count("필터를 교체하기 전에 반드시 주 전원 스위치를 끄십시오.")
    assert 0 < chinese < 60
    assert 0 < korean < 60


@pytest.mark.integration
def test_split_by_tokens_respects_the_budget_and_loses_no_content(
    tokenizer: BgeTokenizer,
) -> None:
    text = "안전 주의사항입니다. " * 60
    pieces = tokenizer.split_by_tokens(text, max_tokens=20)
    assert len(pieces) > 1
    assert all(tokenizer.count(piece) <= 20 for piece in pieces)
    # Decoding is not byte-exact, so compare on content words rather than equality.
    assert "안전" in pieces[0]
    joined = "".join(pieces).replace(" ", "")
    assert joined.count("안전") >= 55


@pytest.mark.integration
def test_count_is_cached(tokenizer: BgeTokenizer) -> None:
    tokenizer.count("caching probe")
    before = tokenizer.cache_info().hits
    tokenizer.count("caching probe")
    assert tokenizer.cache_info().hits == before + 1
