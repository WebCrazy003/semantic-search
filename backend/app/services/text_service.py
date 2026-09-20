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
_LATIN_HYPHEN_TAIL = re.compile(r"[A-Za-z]-$")
_LATIN_HEAD = re.compile(r"^[A-Za-z]")

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


def join_wrapped_lines(lines: list[str]) -> str:
    """Join the rendered lines of one paragraph back into running text.

    Only the extractor knows that a group of lines is a single paragraph, so this is
    called from pdf_service rather than from normalize_text.
    """
    parts = [line.strip() for line in lines if line.strip()]
    if not parts:
        return ""
    result = parts[0]
    for part in parts[1:]:
        if _LATIN_HYPHEN_TAIL.search(result) and _LATIN_HEAD.match(part):
            result = result[:-1] + part  # mainten- + ance -> maintenance
        elif _ENDS_WIDE.search(result) and _STARTS_WIDE.match(part):
            result = result + part  # Han has no word spaces
        else:
            result = result + " " + part  # Korean, Latin, and mixed boundaries
    return result


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
