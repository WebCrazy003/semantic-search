"""A written answer to a question, from the passages a search found.

The route runs the search and hands this the results, so the list the user sees and the
passages the answer cites are one and the same, already limited to what that user may
read. This decides the answer's language, numbers the sources, and streams the model's
answer as events:

    results → sources → delta… → done        (or error, after results)
"""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal

from app.logging_config import get_logger
from app.models.response_models import SearchResponse
from app.services import answer_language
from app.services.answer_language import AnswerLanguage
from app.services.answer_model import AnswerModel, AnswerModelUnavailable
from app.services.answer_prompt import SYSTEM_PROMPT, Source, build_messages
from app.services.context_builder import build_sources, estimate_tokens

logger = get_logger("answer")

Event = tuple[str, dict[str, Any]]

# Fixed sentences come from here, never from the model.
NOT_FOUND: dict[AnswerLanguage, str] = {
    "en": "I couldn't find this in your documents.",
    "zh-Hans": "在您的文档中没有找到相关内容。",
    "zh-Hant": "在您的文件中沒有找到相關內容。",
    "ko": "문서에서 관련 내용을 찾지 못했습니다.",
}
UNAVAILABLE: dict[AnswerLanguage, str] = {
    "en": "The answer model is not running, so only the search results are shown.",
    "zh-Hans": "回答模型未运行，仅显示搜索结果。",
    "zh-Hant": "回答模型未執行，僅顯示搜尋結果。",
    "ko": "답변 모델이 실행되고 있지 않아 검색 결과만 표시합니다.",
}
FAILED: dict[AnswerLanguage, str] = {
    "en": "The answer could not be finished.",
    "zh-Hans": "无法完成回答。",
    "zh-Hant": "無法完成回答。",
    "ko": "답변을 완성하지 못했습니다.",
}

# The first sentence is held back until its language is checked.
_SENTENCE_END = re.compile(r"[.!?](\s|$)|[。！？\n]")
_CHECK_AFTER_CHARS = 120
_MIN_CHECK_CHARS = 12


class AnswerService:
    def __init__(
        self,
        model: AnswerModel | None,
        context_passages: int = 6,
        context_tokens: int = 8192,
        max_answer_tokens: int = 600,
        temperature: float = 0.2,
        min_score: float = 0.0,
        max_concurrent: int = 1,
    ) -> None:
        self._model = model
        self._context_passages = context_passages
        self._max_answer_tokens = max_answer_tokens
        self._temperature = temperature
        self._min_score = min_score
        # What is left of the context for passages once the instructions, the question
        # and the answer itself have their share.
        self._source_budget = max(
            512, context_tokens - max_answer_tokens - estimate_tokens(SYSTEM_PROMPT) - 300
        )
        self._slots = asyncio.Semaphore(max_concurrent)

    @property
    def model_name(self) -> str | None:
        return self._model.name if self._model is not None else None

    def available(self) -> bool:
        return self._model is not None and self._model.available()

    async def aclose(self) -> None:
        if self._model is not None:
            await self._model.aclose()

    async def events(self, response: SearchResponse) -> AsyncIterator[Event]:
        yield "results", response.model_dump(mode="json")

        hits = response.results
        choice = answer_language.choose(response.query, hits[0].text if hits else None)
        language = choice.language
        relevant = [hit for hit in hits if hit.score >= self._min_score]
        sources = build_sources(relevant, self._context_passages, self._source_budget)
        yield (
            "sources",
            {
                "language": language,
                "unsupported": choice.unsupported,
                "passages": [
                    {"n": s.n, "document_id": s.document_id, "chunk_index": s.chunk_index}
                    for s in sources
                ],
            },
        )

        if not sources:
            # Nothing close enough to answer from: say so without asking the model.
            yield "delta", {"text": NOT_FOUND[language]}
            yield "done", _done("not_found", 0, self.model_name, False)
            logger.info("answer status=not_found sources=0")
            return

        if self._model is None:
            yield "error", {"code": "unavailable", "message": UNAVAILABLE[language]}
            return

        started = time.perf_counter()
        outcome = _Outcome()
        try:
            async with self._slots:
                async for event in self._generate(response.query, sources, language, outcome):
                    yield event
        except AnswerModelUnavailable as exc:
            logger.warning("answer model unavailable: %s", exc)
            yield "error", {"code": "unavailable", "message": UNAVAILABLE[language]}
            return
        except Exception:
            logger.exception("answer failed")
            yield "error", {"code": "failed", "message": FAILED[language]}
            return

        took = int((time.perf_counter() - started) * 1000)
        if not outcome.wrote:
            # The model said nothing, or only thought aloud: not an answer.
            logger.warning("answer model returned an empty answer in %dms", took)
            yield "error", {"code": "failed", "message": FAILED[language]}
            return
        # Counts and timings only: neither the question nor the answer is logged.
        logger.info(
            "answer status=answered sources=%d language=%s restarted=%s in %dms",
            len(sources),
            language,
            outcome.restarted,
            took,
        )
        yield "done", _done("answered", took, self.model_name, outcome.restarted)

    async def _generate(
        self,
        question: str,
        sources: list[Source],
        language: AnswerLanguage,
        outcome: _Outcome,
    ) -> AsyncIterator[Event]:
        """Stream the answer, holding back the first sentence until its language is
        checked. In the wrong language, the answer is started again once with a firmer
        instruction; the user never sees the false start."""
        assert self._model is not None
        for attempt in (0, 1):
            held = ""
            checked = False
            stream = self._model.stream(
                build_messages(question, sources, language, retry=attempt > 0),
                max_tokens=self._max_answer_tokens,
                temperature=self._temperature,
            )
            try:
                async for piece in stream:
                    if not checked:
                        held += piece
                        if not _ready_to_check(held):
                            continue
                        checked = True
                        piece, held = held, ""
                        if attempt == 0 and not answer_language.is_in(piece, language):
                            break
                    outcome.wrote = True
                    yield "delta", {"text": piece}
            finally:
                # Closing the stream closes the connection, so the server stops writing.
                close = getattr(stream, "aclose", None)
                if close is not None:
                    await close()

            if checked and not outcome.wrote:
                outcome.restarted = True  # the first sentence was in the wrong language
                continue
            if held:
                # A short answer that ended before a full sentence: check it whole.
                if attempt == 0 and not answer_language.is_in(held, language):
                    outcome.restarted = True
                    continue
                outcome.wrote = True
                yield "delta", {"text": held}
            return


@dataclass
class _Outcome:
    wrote: bool = False
    restarted: bool = False


def _ready_to_check(held: str) -> bool:
    if len(held) >= _CHECK_AFTER_CHARS:
        return True
    return len(held) >= _MIN_CHECK_CHARS and _SENTENCE_END.search(held) is not None


def _done(
    status: Literal["answered", "not_found"], took_ms: int, model: str | None, restarted: bool
) -> dict[str, Any]:
    return {
        "status": status,
        "answer_ms": took_ms,
        "model": model or "",
        "restarted": restarted,
    }
