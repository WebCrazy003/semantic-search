# backend/tests/api/test_isolation.py
"""Owners, public documents, and what each user can see (spec §2)."""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from app.services.ownership import document_id_for


def _upload(test_client: TestClient, path: Path, name: str | None = None) -> None:
    response = test_client.post(
        "/api/documents/upload",
        files=[("files", (name or path.name, path.read_bytes(), "application/pdf"))],
    )
    assert response.status_code == 201, response.text


def _index(test_client: TestClient, **body) -> None:  # noqa: ANN003
    response = test_client.post("/api/index", json=body)
    assert response.status_code == 202, response.text


def _docs(test_client: TestClient) -> dict[str, dict]:
    return {row["filename"]: row for row in test_client.get("/api/documents").json()}


def _search_files(test_client: TestClient, **body) -> set[str]:  # noqa: ANN003
    response = test_client.post("/api/search", json={"query": "manual", "top_k": 100, **body})
    assert response.status_code == 200, response.text
    return {hit["filename"] for hit in response.json()["results"]}


def _user_id(container, username: str) -> str:  # noqa: ANN001
    return container.access.find_user(username).user_id


class TestPrivateByDefault:
    def test_users_see_and_search_only_their_own(
        self, client: TestClient, user_client, corpus_dir: Path
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload(kim, corpus_dir / "manual_zh.pdf", "kim.pdf")
        _index(kim)
        _upload(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
        _index(lee)

        assert set(_docs(kim)) == {"kim.pdf"}
        assert set(_docs(lee)) == {"lee.pdf"}
        assert _search_files(kim) == {"kim.pdf"}
        assert _search_files(lee) == {"lee.pdf"}

    def test_naming_someone_elses_document_in_a_filter_finds_nothing(
        self, user_client, corpus_dir: Path
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
        _index(lee)
        lee_id = _docs(lee)["lee.pdf"]["document_id"]
        assert _search_files(kim, filters={"document_id": lee_id}) == set()
        # Owner and visibility filters are the admin's; for a user they change nothing.
        assert _search_files(kim, filters={"owner_id": "library"}) == set()

    def test_the_admins_documents_are_private_until_published(
        self, client: TestClient, user_client
    ) -> None:
        _index(client)
        kim = user_client("kim")
        assert _docs(kim) == {}
        assert _search_files(kim) == set()
        assert len(_docs(client)) == 4

    def test_someone_elses_private_document_does_not_exist_for_you(
        self, user_client, corpus_dir: Path
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
        _index(lee)
        lee_id = _docs(lee)["lee.pdf"]["document_id"]
        unknown = "f" * 64
        for method, suffix in (("GET", "/file"), ("DELETE", "")):
            theirs = kim.request(method, f"/api/documents/{lee_id}{suffix}")
            missing = kim.request(method, f"/api/documents/{unknown}{suffix}")
            assert theirs.status_code == missing.status_code == 404
            assert theirs.json() == missing.json()


class TestPublicDocuments:
    def test_a_published_document_is_readable_by_everyone_but_not_removable(
        self, client: TestClient, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
        _index(lee)
        lee_id = _docs(lee)["lee.pdf"]["document_id"]

        published = client.put(
            f"/api/documents/{lee_id}/visibility", json={"visibility": "public"}
        )
        assert published.status_code == 200

        row = _docs(kim)["lee.pdf"]
        assert row["visibility"] == "public"
        assert row["is_mine"] is False
        assert row["owner_username"] is None
        assert row["owner_id"] is None
        assert row["filepath"] == ""

        hits = kim.post("/api/search", json={"query": "manual", "top_k": 100}).json()["results"]
        assert hits and all(hit["visibility"] == "public" for hit in hits)
        assert all(hit["owner_id"] is None and hit["filepath"] == "" for hit in hits)

        assert kim.get(f"/api/documents/{lee_id}/file").status_code == 200
        assert kim.delete(f"/api/documents/{lee_id}").status_code == 404
        # Still the owner's: lee sees it as theirs and can remove it.
        assert _docs(lee)["lee.pdf"]["is_mine"] is True

    def test_scope_mine_and_public(
        self, client: TestClient, user_client, corpus_dir: Path
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload(kim, corpus_dir / "manual_zh.pdf", "kim.pdf")
        _index(kim)
        _upload(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
        _index(lee)
        lee_id = _docs(lee)["lee.pdf"]["document_id"]
        client.put(f"/api/documents/{lee_id}/visibility", json={"visibility": "public"})

        assert _search_files(kim) == {"kim.pdf", "lee.pdf"}
        assert _search_files(kim, scope="mine") == {"kim.pdf"}
        assert _search_files(kim, scope="public") == {"lee.pdf"}

    def test_making_it_private_again_hides_it(
        self, client: TestClient, user_client
    ) -> None:
        _index(client)
        kim = user_client("kim")
        library_id = _docs(client)["manual_zh.pdf"]["document_id"]
        client.put(f"/api/documents/{library_id}/visibility", json={"visibility": "public"})
        assert "manual_zh.pdf" in _search_files(kim)
        client.put(f"/api/documents/{library_id}/visibility", json={"visibility": "private"})
        assert "manual_zh.pdf" not in _search_files(kim)

    def test_a_visibility_change_waits_for_a_running_index(
        self, client: TestClient, container  # noqa: ANN001
    ) -> None:
        _index(client)
        library_id = _docs(client)["manual_zh.pdf"]["document_id"]
        container.indexing.start(container.settings.pdf_directory)
        try:
            response = client.put(
                f"/api/documents/{library_id}/visibility", json={"visibility": "public"}
            )
            assert response.status_code == 409
        finally:
            container.indexing.run(container.settings.pdf_directory)

    def test_publishing_survives_clear_and_rescan(
        self, client: TestClient, user_client
    ) -> None:
        _index(client)
        library_id = _docs(client)["manual_zh.pdf"]["document_id"]
        client.put(f"/api/documents/{library_id}/visibility", json={"visibility": "public"})

        client.post("/api/index/clear")
        _index(client)

        kim = user_client("kim")
        assert "manual_zh.pdf" in _search_files(kim)
        assert _docs(client)["manual_zh.pdf"]["visibility"] == "public"

    def test_a_new_version_of_a_public_file_stays_public(
        self, client: TestClient, user_client, container, admin_dir: Path  # noqa: ANN001
    ) -> None:
        _index(client)
        old_id = _docs(client)["manual_zh.pdf"]["document_id"]
        client.put(f"/api/documents/{old_id}/visibility", json={"visibility": "public"})

        # A save changes the bytes, so the file hashes to a new id. Bytes after %%EOF
        # are ignored by PDF readers.
        target = admin_dir / "manual_zh.pdf"
        target.write_bytes(target.read_bytes() + b"\n% saved again\n")
        _index(client)

        row = _docs(client)["manual_zh.pdf"]
        assert row["document_id"] != old_id
        assert row["visibility"] == "public"
        assert old_id not in container.access.public_ids()


class TestOwnersPublish:
    def test_an_owner_makes_their_own_document_public_and_private(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
        _index(lee)
        lee_id = _docs(lee)["lee.pdf"]["document_id"]

        response = lee.put(f"/api/documents/{lee_id}/visibility", json={"visibility": "public"})
        assert response.status_code == 200
        assert _search_files(kim) == {"lee.pdf"}
        assert container.access.publishers()[lee_id] == _user_id(container, "lee")

        lee.put(f"/api/documents/{lee_id}/visibility", json={"visibility": "private"})
        assert _search_files(kim) == set()

    def test_nobody_else_can_change_it(self, user_client, corpus_dir: Path) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
        _index(lee)
        lee_id = _docs(lee)["lee.pdf"]["document_id"]
        lee.put(f"/api/documents/{lee_id}/visibility", json={"visibility": "public"})

        refused = kim.put(f"/api/documents/{lee_id}/visibility", json={"visibility": "private"})
        assert refused.status_code == 404
        bulk = kim.post(
            "/api/documents/visibility",
            json={"document_ids": [lee_id], "visibility": "private"},
        ).json()
        assert bulk == {"updated": 0, "not_found": [lee_id]}
        assert _docs(lee)["lee.pdf"]["visibility"] == "public"

    def test_the_owner_and_admins_see_who_published_it(
        self, client: TestClient, user_client, corpus_dir: Path
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
        _index(lee)
        lee_id = _docs(lee)["lee.pdf"]["document_id"]
        client.put(f"/api/documents/{lee_id}/visibility", json={"visibility": "public"})

        assert _docs(lee)["lee.pdf"]["published_by_username"] == "boss"
        assert _docs(client)["lee.pdf"]["published_by_username"] == "boss"
        # To anyone else a public document never says who is behind it.
        assert _docs(kim)["lee.pdf"]["published_by_username"] is None


class TestOwnershipOnDisk:
    def test_the_same_file_from_two_users_is_two_documents(
        self, user_client, corpus_dir: Path
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        for person in (kim, lee):
            _upload(person, corpus_dir / "manual_zh.pdf", "same.pdf")
            _index(person)
        kim_row, lee_row = _docs(kim)["same.pdf"], _docs(lee)["same.pdf"]
        assert kim_row["document_id"] != lee_row["document_id"]

        assert kim.delete(f"/api/documents/{kim_row['document_id']}").status_code == 200
        assert _search_files(lee) == {"same.pdf"}
        assert _docs(kim) == {}

    def test_a_user_cannot_index_anything_but_their_own_uploads(
        self, client: TestClient, user_client, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        _index(kim, directory=str(container.settings.pdf_directory))
        assert _docs(kim) == {}
        assert _docs(client) == {}  # nor anybody else's

    def test_indexing_one_users_folder_removes_nobody_elses_documents(
        self, client: TestClient, user_client, corpus_dir: Path
    ) -> None:
        _index(client)
        kim, lee = user_client("kim"), user_client("lee")
        _upload(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
        _index(lee)
        _index(kim)  # kim has no uploads: an empty folder
        assert "lee.pdf" in _docs(lee)
        assert len(_docs(client)) == 5

    def test_clear_and_rescan_restores_every_owner(
        self, client: TestClient, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        _upload(kim, corpus_dir / "manual_zh.pdf", "kim.pdf")
        _index(kim)
        client.post("/api/index/clear")
        _index(client)
        assert set(_docs(kim)) == {"kim.pdf"}
        assert _docs(client)["kim.pdf"]["owner_username"] == "kim"

    def test_removing_a_document_deletes_its_file(
        self, client: TestClient, user_client, corpus_dir: Path, container, admin_dir: Path  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        _upload(kim, corpus_dir / "manual_zh.pdf", "kim.pdf")
        _index(kim)
        uploaded = (
            container.settings.pdf_directory / "users" / _user_id(container, "kim") / "kim.pdf"
        )
        assert uploaded.exists()
        removed = kim.delete(f"/api/documents/{_docs(kim)['kim.pdf']['document_id']}")
        assert removed.json()["file_kept"] is False
        assert not uploaded.exists()

        _index(client)
        own = _docs(client)["manual_ko.pdf"]
        assert client.delete(f"/api/documents/{own['document_id']}").json()["file_kept"] is False
        assert not (admin_dir / "manual_ko.pdf").exists()

    def test_a_folder_of_an_unknown_user_is_skipped(
        self, client: TestClient, container, corpus_dir: Path  # noqa: ANN001
    ) -> None:
        stray = container.settings.pdf_directory / "users" / ("0" * 32)
        stray.mkdir(parents=True)
        shutil.copy(corpus_dir / "manual_zh.pdf", stray / "orphan.pdf")
        (container.settings.pdf_directory / "users" / "loose.pdf").write_bytes(
            (corpus_dir / "manual_zh.pdf").read_bytes()
        )
        _index(client)
        names = set(_docs(client))
        assert "orphan.pdf" not in names
        assert "loose.pdf" not in names

    def test_user_document_ids_include_the_owner(self) -> None:
        assert document_id_for("library", "abc") == "abc"
        assert document_id_for("u1", "abc") != document_id_for("u2", "abc")


class TestStatusAndJobs:
    def test_someone_elses_run_shows_no_filenames(
        self, client: TestClient, user_client, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        _index(client)
        body = kim.get("/api/index/status").json()
        assert body["directory"] is None
        assert body["current_file"] is None
        assert body["failures"] == []
        assert kim.get("/api/index/jobs").json() == []
        assert len(client.get("/api/index/jobs").json()) == 1

    def test_readiness_counts_only_what_you_can_search(
        self, client: TestClient, user_client
    ) -> None:
        _index(client)
        kim = user_client("kim")
        assert client.get("/api/health/ready").json()["points"] > 0
        assert kim.get("/api/health/ready").json()["points"] == 0
