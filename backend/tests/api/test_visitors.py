# backend/tests/api/test_visitors.py
"""Someone not logged in reads public documents and nothing else (2026-10-08 spec §1.5)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from tests.api.conftest import login


def _upload(test_client: TestClient, path: Path, name: str) -> None:
    response = test_client.post(
        "/api/documents/upload",
        files=[("files", (name, path.read_bytes(), "application/pdf"))],
    )
    assert response.status_code == 201, response.text


def _index(test_client: TestClient) -> None:
    assert test_client.post("/api/index", json={}).status_code == 202


def _ids(test_client: TestClient) -> dict[str, str]:
    return {row["filename"]: row["document_id"] for row in test_client.get("/api/documents").json()}


def _search(test_client: TestClient, **body) -> list[dict]:  # noqa: ANN003
    response = test_client.post("/api/search", json={"query": "manual", "top_k": 100, **body})
    assert response.status_code == 200, response.text
    return response.json()["results"]


def _two_owners(client: TestClient, user_client, corpus_dir: Path) -> tuple[str, str]:  # noqa: ANN001
    """kim's private kim.pdf and lee's lee.pdf, made public. Returns their ids."""
    kim, lee = user_client("kim"), user_client("lee")
    _upload(kim, corpus_dir / "manual_zh.pdf", "kim.pdf")
    _index(kim)
    _upload(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
    _index(lee)
    kim_id, lee_id = _ids(kim)["kim.pdf"], _ids(lee)["lee.pdf"]
    published = client.put(f"/api/documents/{lee_id}/visibility", json={"visibility": "public"})
    assert published.status_code == 200
    return kim_id, lee_id


class TestSearch:
    def test_a_visitor_finds_public_documents_only(
        self, client: TestClient, user_client, anon: TestClient, corpus_dir: Path
    ) -> None:
        _two_owners(client, user_client, corpus_dir)
        hits = _search(anon)
        assert hits
        assert {hit["filename"] for hit in hits} == {"lee.pdf"}
        assert all(hit["visibility"] == "public" for hit in hits)

    def test_a_visitor_sees_no_owner_or_path(
        self, client: TestClient, user_client, anon: TestClient, corpus_dir: Path
    ) -> None:
        _two_owners(client, user_client, corpus_dir)
        for hit in _search(anon):
            assert hit["owner_id"] is None
            assert hit["owner_username"] is None
            assert hit["filepath"] == ""
            assert hit["is_mine"] is False

    def test_filters_and_scope_cannot_widen_a_visitor(
        self, client: TestClient, user_client, anon: TestClient, corpus_dir: Path
    ) -> None:
        kim_id, _ = _two_owners(client, user_client, corpus_dir)
        assert _search(anon, filters={"document_id": kim_id}) == []
        assert _search(anon, filters={"visibility": "private"}) != []  # ignored, not obeyed
        assert {hit["filename"] for hit in _search(anon, scope="mine")} == {"lee.pdf"}
        assert {hit["filename"] for hit in _search(anon, scope="all")} == {"lee.pdf"}

    def test_the_library_stays_hidden_until_published(
        self, client: TestClient, anon: TestClient
    ) -> None:
        _index(client)
        assert _search(anon) == []

    def test_logging_in_widens_the_same_search(
        self, client: TestClient, user_client, anon: TestClient, corpus_dir: Path
    ) -> None:
        _two_owners(client, user_client, corpus_dir)
        login(anon, "kim")
        assert {hit["filename"] for hit in _search(anon)} == {"kim.pdf", "lee.pdf"}

    def test_a_pending_password_change_reads_as_a_visitor(
        self, client: TestClient, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        _two_owners(client, user_client, corpus_dir)
        kim = TestClient(client.app, headers=client.headers)
        login(kim, "kim")
        user = container.access.find_user("kim")
        container.access.set_password(
            user.user_id, container.access.password_hash(user.user_id), True
        )
        assert {hit["filename"] for hit in _search(kim)} == {"lee.pdf"}


class TestReading:
    def test_a_public_file_and_passage_open_for_a_visitor(
        self, client: TestClient, user_client, anon: TestClient, corpus_dir: Path
    ) -> None:
        _, lee_id = _two_owners(client, user_client, corpus_dir)
        assert anon.get(f"/api/documents/{lee_id}/file").status_code == 200
        passage = anon.get(f"/api/documents/{lee_id}/passages/0")
        assert passage.status_code == 200, passage.text
        body = passage.json()
        assert body["filename"] == "lee.pdf"
        assert body["file_type"] == "pdf"
        assert body["text"]
        assert body["page_start"] >= 1

    def test_a_private_file_does_not_exist_for_a_visitor(
        self, client: TestClient, user_client, anon: TestClient, corpus_dir: Path
    ) -> None:
        kim_id, _ = _two_owners(client, user_client, corpus_dir)
        unknown = "f" * 64
        for suffix in ("/file", "/passages/0"):
            theirs = anon.get(f"/api/documents/{kim_id}{suffix}")
            missing = anon.get(f"/api/documents/{unknown}{suffix}")
            assert theirs.status_code == missing.status_code == 404
            assert theirs.json() == missing.json()

    def test_an_unknown_passage_of_a_readable_document_is_404(
        self, client: TestClient, user_client, corpus_dir: Path
    ) -> None:
        kim_id, _ = _two_owners(client, user_client, corpus_dir)
        assert client.get(f"/api/documents/{kim_id}/passages/99999").status_code == 404

    def test_everything_else_still_needs_a_login(self, anon: TestClient) -> None:
        assert anon.get("/api/documents").status_code == 401
        assert anon.post("/api/index", json={}).status_code == 401
        assert anon.get("/api/index/status").status_code == 401


class TestReadiness:
    def test_a_visitor_learns_about_answers_but_not_the_machine(
        self, anon: TestClient
    ) -> None:
        response = anon.get("/api/health/ready")
        assert response.status_code == 200
        body = response.json()
        assert "answers_available" in body
        assert body["embedding_device"] is None
        assert body["embedding_device_name"] is None
        assert body["answer_model"] is None
