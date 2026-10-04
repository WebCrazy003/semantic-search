import asyncio
from collections.abc import AsyncIterator

import pytest

from app.models.response_models import SearchHit, SearchResponse
from app.services.answer_model import AnswerModelUnavailable
from app.services.answer_service import NOT_FOUND, UNAVAILABLE, AnswerService, Event
from tests.conftest import FakeReranker


class FakeModel:
    """Replies with scripted answers, one per call, in pieces."""

    name = "fake"

    def __init__(self, *answers: str, fail: Exception | None = None) -> None:
        self.answers = list(answers)
        self.fail = fail
        self.calls: list[list[dict[str, str]]] = []
        self.closed = 0

    async def stream(
        self, messages: list[dict[str, str]], max_tokens: int, temperature: float
    ) -> AsyncIterator[str]:
        self.calls.append(messages)
        if self.fail:
            raise self.fail
        answer = self.answers.pop(0)
        try:
            for start in range(0, len(answer), 7):
                yield answer[start : start + 7]
        finally:
            self.closed += 1

    def available(self) -> bool:
        return True

    async def aclose(self) -> None:
        return None


def response(*texts: str, score: float = 0.8, query: str = "q") -> SearchResponse:
    hits = [
        SearchHit(
            score=score,
            document_id="doc",
            filename="manual.pdf",
            filepath="",
            page_start=1,
            page_end=1,
            chunk_index=i,
            text=text,
        )
        for i, text in enumerate(texts)
    ]
    return SearchResponse(query=query, count=len(hits), took_ms=1, results=hits)


def collect(service: AnswerService, question: str, *texts: str, score: float = 0.8) -> list[Event]:
    result = response(*texts, score=score, query=question)

    async def run() -> list[Event]:
        return [event async for event in service.events(result)]

    return asyncio.run(run())


def answer_text(events: list[Event]) -> str:
    return "".join(data["text"] for name, data in events if name == "delta")


def names(events: list[Event]) -> list[str]:
    return [name for name, _ in events if name != "delta"]


class TestEvents:
    def test_results_then_sources_then_the_answer(self) -> None:
        model = FakeModel("The filter is replaced every 3 months [1]. Use part A [2].")
        events = collect(AnswerService(model), "How often is the filter replaced?", "x", "y")
        assert names(events) == ["results", "sources", "done"]
        assert answer_text(events) == "The filter is replaced every 3 months [1]. Use part A [2]."
        sources = events[1][1]
        assert sources["language"] == "en"
        assert sources["unsupported"] is False
        assert [p["n"] for p in sources["passages"]] == [1, 2]
        assert events[-1][1]["status"] == "answered"
        assert events[-1][1]["restarted"] is False

    def test_the_answer_language_is_the_questions(self) -> None:
        model = FakeModel("필터는 3개월마다 교체합니다 [1].")
        events = collect(AnswerService(model), "필터 교체 주기는?", "滤芯每三个月更换一次")
        assert events[1][1]["language"] == "ko"
        assert "Korean" in model.calls[0][0]["content"]

    def test_no_results_is_not_found_without_asking_the_model(self) -> None:
        model = FakeModel()
        events = collect(AnswerService(model), "필터 교체 주기는?")
        assert answer_text(events) == NOT_FOUND["ko"]
        assert events[-1][1]["status"] == "not_found"
        assert model.calls == []

    def test_the_threshold_ignores_hits_that_were_not_reranked(self) -> None:
        # A search score is not comparable across questions, so it is never cut on.
        model = FakeModel("Answer [1].")
        events = collect(AnswerService(model, min_score=0.5), "question", "x", score=0.3)
        assert events[-1][1]["status"] == "answered"

    def test_without_a_model_the_results_come_then_an_error(self) -> None:
        events = collect(AnswerService(None), "如何更换滤芯", "x")
        assert names(events) == ["results", "sources", "error"]
        assert events[-1][1] == {"code": "unavailable", "message": UNAVAILABLE["zh-Hans"]}

    def test_a_model_that_is_down_is_an_error_after_the_results(self) -> None:
        model = FakeModel(fail=AnswerModelUnavailable("down"))
        events = collect(AnswerService(model), "question here", "x")
        assert names(events) == ["results", "sources", "error"]
        assert events[-1][1]["code"] == "unavailable"

    def test_an_unexpected_failure_is_reported_not_raised(self) -> None:
        model = FakeModel(fail=RuntimeError("boom"))
        events = collect(AnswerService(model), "question here", "x")
        assert events[-1] == (
            "error",
            {"code": "failed", "message": "The answer could not be finished."},
        )

    def test_an_empty_reply_is_a_failure_not_an_answer(self) -> None:
        events = collect(AnswerService(FakeModel("")), "question here", "x")
        assert names(events) == ["results", "sources", "error"]
        assert events[-1][1]["code"] == "failed"


class TestReranking:
    def test_results_are_sent_in_search_order_and_answered_in_reranked_order(self) -> None:
        reranker = FakeReranker()
        model = FakeModel("Answer [1].")
        events = collect(
            AnswerService(model, reranker=reranker), "滤芯更换", "保修条款", "滤芯型号", "更换滤芯"
        )
        assert [hit["text"] for hit in events[0][1]["results"]] == [
            "保修条款",
            "滤芯型号",
            "更换滤芯",
        ]
        sources = events[1][1]["passages"]
        assert [p["chunk_index"] for p in sources] == [2, 1, 0]
        assert (
            '<source id="1" file="manual.pdf" pages="1">\n更换滤芯' in model.calls[0][1]["content"]
        )

    def test_only_the_first_candidates_are_reranked(self) -> None:
        reranker = FakeReranker()
        collect(
            AnswerService(FakeModel("A [1]."), reranker=reranker, rerank_candidates=2),
            "q",
            "a",
            "b",
            "c",
        )
        assert reranker.seen == [["a", "b"]]

    def test_the_threshold_cuts_on_the_rerank_score(self) -> None:
        model = FakeModel()
        events = collect(
            AnswerService(model, reranker=FakeReranker(), min_score=0.5), "滤芯", "保修条款"
        )
        assert events[-1][1]["status"] == "not_found"
        assert events[0][1]["count"] == 1  # the results themselves are still shown
        assert model.calls == []

    def test_each_source_carries_its_relevance(self) -> None:
        events = collect(
            AnswerService(FakeModel("A [1]."), reranker=FakeReranker()), "滤芯", "滤芯型号", "保修"
        )
        assert [p["relevance"] for p in events[1][1]["passages"]] == [1.0, 0.0]
        assert events[1][1]["top_relevance"] == 1.0
        # The results that were sent are never changed by the ranking.
        assert "relevance" not in events[0][1]["results"][0]

    def test_without_a_reranker_sources_have_no_relevance(self) -> None:
        events = collect(AnswerService(FakeModel("A [1].")), "q", "a")
        assert events[1][1]["passages"][0]["relevance"] is None

    def test_results_past_the_candidates_are_not_answered_from(self) -> None:
        # Unscored, they would slip past the threshold.
        events = collect(
            AnswerService(FakeModel("A [1]."), reranker=FakeReranker(), rerank_candidates=2),
            "q",
            "a",
            "b",
            "c",
        )
        assert sorted(p["chunk_index"] for p in events[1][1]["passages"]) == [0, 1]

    def test_repeated_text_is_scored_once(self) -> None:
        reranker = FakeReranker()
        collect(
            AnswerService(FakeModel("A [1]."), reranker=reranker),
            "q",
            "same  text",
            "same text",
            "b",
        )
        assert reranker.seen == [["same  text", "b"]]

    def test_nothing_is_reranked_without_an_answer_model(self) -> None:
        reranker = FakeReranker()
        collect(AnswerService(None, reranker=reranker), "q", "a")
        assert reranker.seen == []

    def test_a_failing_reranker_falls_back_to_the_search_order(self) -> None:
        events = collect(
            AnswerService(FakeModel("A [1]."), reranker=FakeReranker(fail=True)), "q", "a", "b"
        )
        assert events[-1][1]["status"] == "answered"
        assert [p["chunk_index"] for p in events[1][1]["passages"]] == [0, 1]


class TestLanguageGuard:
    def test_a_wrong_language_start_is_restarted_once_unseen(self) -> None:
        model = FakeModel("滤芯每三个月更换一次[1]。然后……", "필터는 3개월마다 교체합니다 [1].")
        events = collect(AnswerService(model), "필터 교체 주기는?", "x")
        assert answer_text(events) == "필터는 3개월마다 교체합니다 [1]."
        assert events[-1][1]["restarted"] is True
        assert len(model.calls) == 2
        assert "previous answer was not in Korean" in model.calls[1][1]["content"]
        assert model.closed == 2  # the false start's stream was closed

    def test_a_second_wrong_start_is_accepted_rather_than_looping(self) -> None:
        model = FakeModel("滤芯每三个月更换一次[1]。", "滤芯每三个月更换一次[1]。")
        events = collect(AnswerService(model), "필터 교체 주기는?", "x")
        assert answer_text(events) == "滤芯每三个月更换一次[1]。"
        assert len(model.calls) == 2

    def test_a_short_answer_with_no_sentence_end_is_still_checked(self) -> None:
        model = FakeModel("滤芯", "필터")
        events = collect(AnswerService(model), "필터 교체 주기는?", "x")
        assert answer_text(events) == "필터"


@pytest.mark.parametrize("passages", [1, 3])
def test_context_passages_limits_the_sources(passages: int) -> None:
    model = FakeModel("Answer [1].")
    events = collect(
        AnswerService(model, context_passages=passages), "question", "a", "b", "c", "d"
    )
    assert len(events[1][1]["passages"]) == passages
