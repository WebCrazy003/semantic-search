"""POST /api/ask: the search, then a streamed answer written from it."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.deps import Container
from app.services.answer_service import AnswerService
from tests.api.test_isolation import _index, _upload
from tests.test_answer_service import FakeModel


def events(response) -> list[tuple[str, dict]]:  # noqa: ANN001
    parsed = []
    for block in response.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        parsed.append((lines["event"], json.loads(lines["data"])))
    return parsed


@pytest.fixture
def indexed_client(client: TestClient, container: Container) -> TestClient:
    assert container.indexing.start(None, False) is True
    container.indexing.run(None, False)
    return client


def test_streams_results_sources_answer_and_done(
    indexed_client: TestClient, container: Container
) -> None:
    model = FakeModel("滤芯每三个月更换一次[1]。")
    container.answers = AnswerService(model)

    response = indexed_client.post("/api/ask", json={"query": "如何更换滤芯", "top_k": 5})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    stream = events(response)
    assert [name for name, _ in stream] == ["results", "sources", "delta", "done"]
    results, sources = stream[0][1], stream[1][1]
    assert results["query"] == "如何更换滤芯"
    assert results["count"] == len(results["results"]) > 0
    assert sources["language"] == "zh-Hans"
    # Every source is one of the results on the user's screen.
    shown = {(hit["document_id"], hit["chunk_index"]) for hit in results["results"]}
    assert {(p["document_id"], p["chunk_index"]) for p in sources["passages"]} <= shown
    assert stream[2][1]["text"] == "滤芯每三个月更换一次[1]。"


def test_same_results_as_search(indexed_client: TestClient, container: Container) -> None:
    container.answers = AnswerService(FakeModel("Answer [1]."))
    body = {"query": "保修期是多久", "top_k": 5}
    searched = indexed_client.post("/api/search", json=body).json()
    asked = events(indexed_client.post("/api/ask", json=body))[0][1]
    assert [h["chunk_index"] for h in asked["results"]] == [
        h["chunk_index"] for h in searched["results"]
    ]


def test_without_a_model_the_results_still_arrive(indexed_client: TestClient) -> None:
    stream = events(indexed_client.post("/api/ask", json={"query": "warranty period"}))
    assert [name for name, _ in stream] == ["results", "sources", "error"]
    assert stream[-1][1]["code"] == "unavailable"


def test_a_blank_question_is_rejected_before_streaming(indexed_client: TestClient) -> None:
    assert indexed_client.post("/api/ask", json={"query": "   "}).status_code == 400


def test_needs_a_session(anon: TestClient) -> None:
    assert anon.post("/api/ask", json={"query": "x"}).status_code == 401


def test_readiness_reports_whether_answers_are_available(
    client: TestClient, container: Container
) -> None:
    assert client.get("/api/health/ready").json()["answers_available"] is False
    container.answers = AnswerService(FakeModel())
    body = client.get("/api/health/ready").json()
    assert body["answers_available"] is True
    assert body["answer_model"] == "fake"


def test_an_answer_never_draws_on_someone_elses_documents(
    user_client, container: Container, corpus_dir: Path
) -> None:
    kim, lee = user_client("kim"), user_client("lee")
    _upload(kim, corpus_dir / "manual_zh.pdf", "kim.pdf")
    _index(kim)
    _upload(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
    _index(lee)
    model = FakeModel("Answer [1].")
    container.answers = AnswerService(model)

    stream = events(lee.post("/api/ask", json={"query": "manual", "top_k": 100}))

    assert {hit["filename"] for hit in stream[0][1]["results"]} == {"lee.pdf"}
    prompt = model.calls[0][1]["content"]
    assert 'file="lee.pdf"' in prompt
    assert "kim.pdf" not in prompt
