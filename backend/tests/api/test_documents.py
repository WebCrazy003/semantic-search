# backend/tests/api/test_documents.py
from fastapi.testclient import TestClient


class TestBeforeIndexing:
    def test_the_list_is_empty(self, client: TestClient) -> None:
        response = client.get("/api/documents")
        assert response.status_code == 200
        assert response.json() == []


class TestAfterIndexing:
    def test_every_document_is_listed_with_its_counts(self, client: TestClient) -> None:
        client.post("/api/index", json={})
        body = client.get("/api/documents").json()
        by_name = {entry["filename"]: entry for entry in body}
        assert set(by_name) == {
            "manual_zh.pdf",
            "manual_ko.pdf",
            "manual_mixed.pdf",
            "empty_scan_zh.pdf",
        }
        assert by_name["manual_zh.pdf"]["pages"] == 3
        assert by_name["manual_zh.pdf"]["chunks"] > 0
        assert by_name["manual_zh.pdf"]["status"] == "indexed"
        assert by_name["manual_zh.pdf"]["language"] == "zh"
        assert by_name["manual_zh.pdf"]["document_id"]
        assert by_name["manual_zh.pdf"]["indexed_at"]

    def test_an_unsupported_document_is_listed_with_its_status(
        self, client: TestClient
    ) -> None:
        client.post("/api/index", json={})
        body = client.get("/api/documents").json()
        scan = next(entry for entry in body if entry["filename"] == "empty_scan_zh.pdf")
        assert scan["status"] == "unsupported"
        assert scan["chunks"] == 0

    def test_the_list_is_ordered_by_filename(self, client: TestClient) -> None:
        client.post("/api/index", json={})
        names = [entry["filename"] for entry in client.get("/api/documents").json()]
        assert names == sorted(names)

    def test_only_indexed_documents_can_be_requested(self, client: TestClient) -> None:
        client.post("/api/index", json={})
        body = client.get("/api/documents?status=indexed").json()
        assert len(body) == 3
        assert all(entry["status"] == "indexed" for entry in body)

    def test_an_unknown_status_filter_returns_nothing(self, client: TestClient) -> None:
        client.post("/api/index", json={})
        assert client.get("/api/documents?status=nonsense").json() == []
