# backend/app/services/text_service.py
"""Pure text helpers shared by extraction and chunking.

Normalization is deliberately conservative: it removes invisible characters and
whitespace noise and changes nothing else. It never translates, transliterates, or
strips punctuation.

The Han and Hangul character classes are kept separate on purpose. Han text has no
word spaces, so a line wrap between two Han characters closes with nothing. Korean
is space-separated, so the same wrap must close with a space or two words merge.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

_HAN = r"一-鿿㐀-䶿豈-﫿"
_HANGUL = r"가-힣ㄱ-ㆎ"
# Han plus the full-width punctuation and brackets that behave like it for spacing.
_WIDE = _HAN + r"　-〿！-｠"

_ZERO_WIDTH = re.compile(r"[​-‏⁠﻿­]")
_INLINE_SPACE = re.compile(r"[ \t 　  ]+")
_BLANK_RUNS = re.compile(r"\n{3,}")
_SPACE_BETWEEN_WIDE = re.compile(rf"(?<=[{_WIDE}]) +(?=[{_WIDE}])")

_ENDS_WIDE = re.compile(rf"[{_WIDE}]$")
_STARTS_WIDE = re.compile(rf"^[{_WIDE}]")
_ENDS_HANGUL = re.compile(rf"[{_HANGUL}]$")
_STARTS_HANGUL = re.compile(rf"^[{_HANGUL}]")
_SOFT_HYPHEN = "\u00ad"
# ASCII hyphen-minus, U+2010 hyphen, U+2011 non-breaking hyphen.
_HYPHENS = "-\u2010\u2011"
# [^\W\d_] is "any letter, any script"; [^\W_] adds digits.
_LETTER_HYPHEN_TAIL = re.compile(rf"[^\W\d_][{_HYPHENS}]$")
_WORD_HYPHEN_TAIL = re.compile(rf"[^\W_][{_HYPHENS}]$")
# Punctuation that closes what came before; a line starting with it never takes a space.
_STARTS_CLOSING = re.compile(r"^[.,;:!?%)\]}」』》〉）］｝。，、；：！？]")
# The last word already has a hyphen inside it, so it is a compound: state-of-the-
_COMPOUND_HYPHEN_TAIL = re.compile(rf"[^\W_][{_HYPHENS}]\S*[^\W_][{_HYPHENS}]$")

_CJK_TERMINATORS = "。！？；…．"
_SENTENCE_BREAK = re.compile(
    rf"(?<=[{_CJK_TERMINATORS}])\s*"
    rf"|(?<=[.!?])\s+(?=[\"'(\[]?[A-Z0-9{_HAN}{_HANGUL}])"
    r"|\n+"
)

_HAN_RE = re.compile(f"[{_HAN}]")
_HANGUL_RE = re.compile(f"[{_HANGUL}]")
_LATIN_RE = re.compile(r"[A-Za-z]")

_MIN_CHARS_FOR_LANGUAGE = 10


def normalize_text(raw: str) -> str:
    if not raw:
        return ""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    # NFC, not NFKC: NFKC would rewrite full-width forms and compatibility jamo.
    text = unicodedata.normalize("NFC", text)
    text = _ZERO_WIDTH.sub("", text)
    text = _INLINE_SPACE.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = _BLANK_RUNS.sub("\n\n", text)
    return text.strip()


@dataclass(frozen=True, slots=True)
class WrappedLine:
    """One rendered line, plus whether the PDF put whitespace after it.

    The trailing space is the only evidence a PDF carries about whether a Korean
    line broke between two words or in the middle of one.
    """

    text: str
    trailing_space: bool = False


def ends_in_hangul(text: str) -> bool:
    return bool(_ENDS_HANGUL.search(text.rstrip()))


def join_wrapped_lines(
    lines: Sequence[str | WrappedLine], *, korean_midword_join: bool = False
) -> str:
    """Join the rendered lines of one paragraph back into running text.

    Only the extractor knows that a group of lines is a single paragraph, so this is
    called from pdf_service rather than from normalize_text. Plain strings count as
    lines with no trailing space.

    korean_midword_join says the caller trusts trailing spaces: a Hangul line with
    none then broke inside a word and is glued to the next without a space.
    """
    parts = [_as_line(line) for line in lines]
    parts = [part for part in parts if part.text]
    if not parts:
        return ""
    result = parts[0].text
    previous = parts[0]
    for part in parts[1:]:
        result = _join_pair(result, previous.trailing_space, part.text, korean_midword_join)
        previous = part
    return result


def join_across_break(
    left: str, right: str, *, left_trailing_space: bool, korean_midword_join: bool
) -> str | None:
    """Join two fragments only when the boundary is certainly inside a word.

    Used where a paragraph continues on the next page: there, a plain space is not
    a safe default, so anything that is not a split word returns None.
    """
    left, right = left.rstrip(), right.lstrip()
    if not left or not right:
        return None
    if left.endswith(_SOFT_HYPHEN):
        return left[:-1] + right
    if _COMPOUND_HYPHEN_TAIL.search(left) and right[0].isalnum():
        return left + right  # state-of-the- + art keeps its hyphen
    if _LETTER_HYPHEN_TAIL.search(left) and right[0].islower():
        return left[:-1] + right
    if (
        korean_midword_join
        and not left_trailing_space
        and _ENDS_HANGUL.search(left)
        and _STARTS_HANGUL.match(right)
    ):
        return left + right
    return None


def _as_line(line: str | WrappedLine) -> WrappedLine:
    if isinstance(line, WrappedLine):
        return WrappedLine(line.text.strip(), line.trailing_space)
    return WrappedLine(line.strip())


def _join_pair(left: str, left_trailing_space: bool, right: str, midword: bool) -> str:
    joined = join_across_break(
        left, right, left_trailing_space=left_trailing_space, korean_midword_join=midword
    )
    if joined is not None:
        return joined  # mainte- + nance, main\u00ad + tenance, 유지보 + 수
    if _WORD_HYPHEN_TAIL.search(left) and (right[0].isupper() or right[0].isdigit()):
        return left + right  # COVID- + 19, XJ- + 200B: the hyphen is part of the name
    if _ENDS_WIDE.search(left) and _STARTS_WIDE.match(right):
        return left + right  # Han has no word spaces
    if _STARTS_CLOSING.match(right):
        return left + right  # 합니다 + . and word + ) close without a space
    return left + " " + right  # Korean, Latin, and mixed boundaries


def split_paragraphs(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]


def split_sentences(text: str) -> list[str]:
    if not text.strip():
        return []
    parts = [part.strip() for part in _SENTENCE_BREAK.split(text)]
    return [part for part in parts if part]


def join_sentences(parts: list[str]) -> str:
    """Join sentences, dropping the space where full-width characters meet."""
    if not parts:
        return ""
    joined = " ".join(part.strip() for part in parts if part.strip())
    return _SPACE_BETWEEN_WIDE.sub("", joined)


def detect_language(text: str) -> str | None:
    """Best-effort script-share heuristic.

    Search never depends on this. It exists for UI labels and optional filtering,
    as the specification allows.
    """
    korean = len(_HANGUL_RE.findall(text))
    chinese = len(_HAN_RE.findall(text))
    english = len(_LATIN_RE.findall(text))
    total = korean + chinese + english
    if total < _MIN_CHARS_FOR_LANGUAGE:
        return None

    shares = {"ko": korean / total, "zh": chinese / total, "en": english / total}
    top_code, top_share = max(shares.items(), key=lambda item: item[1])
    runner_up = sorted(shares.values(), reverse=True)[1]
    if top_share < 0.6 and runner_up > 0.25:
        return "mixed"
    return top_code
