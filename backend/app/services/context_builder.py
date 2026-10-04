"""Turns search hits into the numbered sources an answer is written from."""

from __future__ import annotations

import re

from app.models.response_models import SearchHit
from app.services.answer_language import HANGUL_ALL_CHARS, KANA_CHARS
from app.services.answer_prompt import Source
from app.services.text_service import HAN_CHARS

_WIDE = re.compile(f"[{HAN_CHARS}{HANGUL_ALL_CHARS}{KANA_CHARS}]")
_WHITESPACE = re.compile(r"\s+")


def estimate_tokens(text: str) -> int:
    """A deliberately high estimate of the answer model's token count.

    Han and Hangul run about one token per character in current tokenizers, and other
    text about one per four characters; counting three keeps the estimate on the safe
    side whichever model is loaded.
    """
    wide = len(_WIDE.findall(text))
    return wide + (len(text) - wide) // 3 + 1


def build_sources(hits: list[SearchHit], max_passages: int, token_budget: int) -> list[Source]:
    """The best hits, numbered from 1, without repeats, within the token budget.

    Hits arrive best first. A passage that would overflow the budget is skipped rather
    than cut, since half a procedure is worse than none; the first one is always kept.
    """
    sources: list[Source] = []
    seen: set[str] = set()
    used = 0
    for hit in hits:
        if len(sources) >= max_passages:
            break
        key = _WHITESPACE.sub(" ", hit.text).strip()
        if not key or key in seen:
            continue
        cost = estimate_tokens(hit.text) + 40  # the tag and its attributes
        if sources and used + cost > token_budget:
            continue
        seen.add(key)
        used += cost
        sources.append(
            Source(
                n=len(sources) + 1,
                document_id=hit.document_id,
                chunk_index=hit.chunk_index,
                filename=hit.filename,
                pages=_pages(hit),
                heading=hit.heading,
                text=hit.text,
            )
        )
    return sources


def _pages(hit: SearchHit) -> str:
    approximate = "~" if hit.file_type == "docx" else ""
    if hit.page_end and hit.page_end != hit.page_start:
        return f"{approximate}{hit.page_start}-{hit.page_end}"
    return f"{approximate}{hit.page_start}"
