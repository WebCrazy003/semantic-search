"""Which language an answer is written in: the language of the question.

Decided here, in code, and handed to the model as an instruction. Left to itself a
small model drifts into the language of its sources, answering a Korean question in
Chinese because the manual is Chinese.

The answer is English, Simplified Chinese, Traditional Chinese or Korean. The documents'
language, the language filter and the browser's language play no part.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from app.services.text_service import HAN_CHARS, HANGUL_CHARS

AnswerLanguage = Literal["en", "zh-Hans", "zh-Hant", "ko"]

LANGUAGE_NAMES: dict[AnswerLanguage, str] = {
    "en": "English",
    "zh-Hans": "Simplified Chinese (简体中文)",
    "zh-Hant": "Traditional Chinese (繁體中文)",
    "ko": "Korean (한국어)",
}

# The text service's Hangul syllables and compatibility jamo, plus conjoining jamo.
HANGUL_ALL_CHARS = HANGUL_CHARS + "\u1100-\u11ff"
KANA_CHARS = "\u3040-\u30ff\u31f0-\u31ff"
_HANGUL = re.compile(f"[{HANGUL_ALL_CHARS}]")
_KANA = re.compile(f"[{KANA_CHARS}]")
_HAN = re.compile(f"[{HAN_CHARS}]")
_LATIN_WORD = re.compile(r"[A-Za-zÀ-ɏ]+")

# Common characters that differ between the two scripts. Pairs where the simplified
# form is also an ordinary traditional character (后, 准, 周, 台, 只, 干, 里) are left
# out, since they say nothing about which script a text is in.
_PAIRS = (
    "這这 個个 們们 來来 時时 會会 說说 對对 過过 還还 麼么 為为 與与 國国 學学 語语"
    " 發发 開开 關关 實实 現现 點点 體体 當当 從从 頭头 種种 樣样 經经 處处 問问"
    " 題题 機机 電电 長长 義义 區区 應应 書书 專专 業业 務务 單单 價价 產产 設设"
    " 計计 動动 員员 兩两 車车 無无 給给 買买 錢钱 讓让 進进 華华 東东 陽阳 門门"
    " 見见 歡欢 記记 覺觉 請请 談谈 論论 變变 顯显 驗验 壓压 換换 濾滤 護护 養养"
    " 檢检 際际 據据 裝装 線线 嗎吗 該该 測测 溫温 號号 級级 認认 證证 寫写 讀读"
    " 聽听 條条 運运 轉转 環环 響响 標标 簡简 統统 網网 鐘钟 檔档 擇择 調调 備备"
    " 數数 錯错 誤误 須须 規规 維维 閥阀 輸输 傳传 導导"
)
_TRADITIONAL = frozenset(pair[0] for pair in _PAIRS.split())
_SIMPLIFIED = frozenset(pair[1] for pair in _PAIRS.split())


@dataclass(frozen=True)
class LanguageChoice:
    language: AnswerLanguage
    # The question was in a language answers are not given in, so the answer is in
    # English and the UI says why.
    unsupported: bool = False


def detect(text: str) -> AnswerLanguage | Literal["other"] | None:
    """The language a piece of text is written in, or None when it has no letters.

    Any Hangul makes it Korean: nobody writes Hangul in a Chinese or English sentence,
    while a Korean one often carries a Chinese part name or an English model number.
    Kana makes it Japanese, which is not answered in. Otherwise Han characters against
    Latin words decide between Chinese and English.
    """
    hangul = len(_HANGUL.findall(text))
    kana = len(_KANA.findall(text))
    if hangul and hangul >= kana:
        return "ko"
    if kana:
        return "other"

    han = len(_HAN.findall(text))
    latin_words = _LATIN_WORD.findall(text)
    latin_letters = sum(len(word) for word in latin_words)
    other_letters = sum(1 for char in text if char.isalpha()) - han - latin_letters
    if other_letters > han + latin_letters:
        return "other"  # Cyrillic, Arabic, Thai and the like
    if han and han >= len(latin_words):
        return chinese_script(text)
    if latin_words:
        return "en"
    return "other" if other_letters else None


def chinese_script(text: str) -> Literal["zh-Hans", "zh-Hant"]:
    traditional, simplified = _script_counts(text)
    return "zh-Hant" if traditional > simplified else "zh-Hans"


def _script_counts(text: str) -> tuple[int, int]:
    """Characters only traditional Chinese uses, and only simplified."""
    traditional = sum(1 for char in text if char in _TRADITIONAL)
    simplified = sum(1 for char in text if char in _SIMPLIFIED)
    return traditional, simplified


def choose(question: str, top_source_text: str | None = None) -> LanguageChoice:
    """The answer's language for a question.

    A question with no letters at all, such as a bare part number, takes the language
    of the best-matching passage instead.
    """
    detected = detect(question)
    if detected is None and top_source_text:
        detected = detect(top_source_text)
    if detected is None:
        return LanguageChoice("en")
    if detected == "other":
        return LanguageChoice("en", unsupported=True)
    return LanguageChoice(detected)


def is_in(text: str, language: AnswerLanguage) -> bool:
    """Whether an answer is in the language asked for. Used on its first sentence.

    Only clear evidence counts against it: text with no letters passes; English fails
    only when Han characters outnumber its letters, since an English answer quotes
    Chinese terms in brackets; Chinese fails on its script only when the other script's
    characters plainly outnumber.
    """
    detected = detect(text)
    if detected is None or detected == language:
        return True
    if language == "en":
        if detected in ("ko", "other"):
            return False
        latin_letters = sum(len(word) for word in _LATIN_WORD.findall(text))
        return len(_HAN.findall(text)) <= latin_letters
    if language == "ko" or not detected.startswith("zh"):
        return False
    traditional, simplified = _script_counts(text)
    if language == "zh-Hans":
        return not (traditional >= 3 and simplified == 0)
    return not (simplified >= 3 and traditional == 0)
