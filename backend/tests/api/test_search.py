# backend/tests/api/test_search.py
import pytest
from fastapi.testclient import TestClient

from app.deps import Container


@pytest.fixture
def indexed_client(client: TestClient, container: Container) -> TestClient:
    assert container.indexing.start(None, False) is True
    container.indexing.run(None, False)
    return client


class TestContract:
    def test_a_search_returns_the_specified_fields(self, indexed_client: TestClient) -> None:
        response = indexed_client.post("/api/search", json={"query": "更换滤芯", "top_k": 5})
        assert response.status_code == 200
        body = response.json()
        assert body["query"] == "更换滤芯"
        assert isinstance(body["count"], int)
        assert isinstance(body["took_ms"], int)
        assert len(body["results"]) == body["count"]

    def test_each_result_carries_what_the_ui_displays(self, indexed_client: TestClient) -> None:
        body = indexed_client.post("/api/search", json={"query": "保修"}).json()
        hit = body["results"][0]
        for field in ("score", "document_id", "filename", "page_start", "page_end", "text"):
            assert field in hit
        assert hit["filename"].endswith(".pdf")
        assert hit["page_start"] >= 1

    def test_top_k_defaults_when_omitted(self, indexed_client: TestClient) -> None:
        body = indexed_client.post("/api/search", json={"query": "维护"}).json()
        assert body["count"] <= 10


class TestFilters:
    def test_a_language_filter_is_applied(self, indexed_client: TestClient) -> None:
        body = indexed_client.post(
            "/api/search", json={"query": "필터", "filters": {"language": "ko"}}
        ).json()
        assert body["count"] > 0
        assert all(hit["filename"] == "manual_ko.pdf" for hit in body["results"])

    def test_a_null_filter_value_is_ignored(self, indexed_client: TestClient) -> None:
        body = indexed_client.post(
            "/api/search",
            json={"query": "维护", "top_k": 50, "filters": {"language": None, "document_id": None}},
        ).json()
        filenames = {hit["filename"] for hit in body["results"]}
        assert len(filenames) > 1

    def test_a_document_filter_restricts_to_one_file(self, indexed_client: TestClient) -> None:
        everything = indexed_client.post("/api/search", json={"query": "维护", "top_k": 50}).json()
        document_id = everything["results"][0]["document_id"]
        body = indexed_client.post(
            "/api/search",
            json={"query": "维护", "top_k": 50, "filters": {"document_id": document_id}},
        ).json()
        assert {hit["document_id"] for hit in body["results"]} == {document_id}


class TestValidation:
    def test_an_empty_query_is_rejected(self, client: TestClient) -> None:
        assert client.post("/api/search", json={"query": ""}).status_code == 422

    def test_a_whitespace_only_query_is_rejected(self, client: TestClient) -> None:
        response = client.post("/api/search", json={"query": "   "})
        assert response.status_code == 400
        assert "empty" in response.json()["detail"]

    def test_a_missing_query_is_rejected(self, client: TestClient) -> None:
        assert client.post("/api/search", json={}).status_code == 422

    def test_a_zero_top_k_is_rejected(self, client: TestClient) -> None:
        assert client.post("/api/search", json={"query": "x", "top_k": 0}).status_code == 422

    def test_an_unknown_filter_key_is_ignored_rather_than_failing(
        self, indexed_client: TestClient
    ) -> None:
        response = indexed_client.post(
            "/api/search", json={"query": "维护", "filters": {"nonsense": "x"}}
        )
        assert response.status_code == 200


class TestEmptyIndex:
    def test_searching_before_indexing_returns_an_empty_result_set(
        self, client: TestClient
    ) -> None:
        body = client.post("/api/search", json={"query": "任何内容"}).json()
        assert body["count"] == 0
        assert body["results"] == []
