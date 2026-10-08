# backend/tests/api/test_drive.py
"""The document manager's backend: folders in the database, moves that touch nothing
else, uploads that index themselves, and indexing by hand (2026-10-08 spec §3)."""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import resume_uploads
from app.services.ownership import user_folder


def _upload(test_client: TestClient, path: Path, name: str, folder_id: str | None = None):  # noqa: ANN202
    data = {"folder_id": folder_id} if folder_id else {}
    response = test_client.post(
        "/api/documents/upload",
        files=[("files", (name, path.read_bytes(), "application/pdf"))],
        data=data,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _folder(test_client: TestClient, name: str, parent_id: str | None = None, tree: str = "me") -> str:
    response = test_client.post(
        "/api/drive/folders", json={"tree": tree, "parent_id": parent_id, "name": name}
    )
    assert response.status_code == 201, response.text
    return response.json()["folder_id"]


def _list(test_client: TestClient, folder_id: str | None = None, tree: str = "me") -> dict:
    params = {"tree": tree, **({"folder_id": folder_id} if folder_id else {})}
    response = test_client.get("/api/drive/list", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _names(listing: dict) -> dict[str, str]:
    return {file["name"]: file["state"] for file in listing["files"]}


def _point_ids(container) -> set[str]:  # noqa: ANN001
    points, _ = container.qdrant._client.scroll(
        collection_name=container.qdrant._collection, limit=10_000, with_payload=False
    )
    return {str(point.id) for point in points}


class TestUploads:
    def test_an_upload_lands_in_its_folder_indexed_and_flat_on_disk(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        manuals = _folder(kim, "Manuals")
        body = _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf", manuals)
        assert body["indexing"] == "started"
        assert [file["name"] for file in body["files"]] == ["a.pdf"]

        assert _names(_list(kim, manuals)) == {"a.pdf": "indexed"}
        assert _names(_list(kim)) == {}
        kim_id = container.access.find_user("kim").user_id
        assert (user_folder(container.settings.pdf_directory, kim_id) / "a.pdf").is_file()

    def test_an_upload_waits_behind_another_run_instead_of_being_refused(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        assert container.indexing.start(None, False)  # someone else's run, held open
        body = _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf")
        assert body["indexing"] == "queued"
        assert _names(_list(kim)) == {"a.pdf": "waiting"}
        status = kim.get("/api/index/status").json()
        assert [file["name"] for file in status["queued_files"]] == ["a.pdf"]

        container.indexing.run(None, False)  # finishes, then runs what queued behind it
        assert _names(_list(kim)) == {"a.pdf": "indexed"}

    def test_a_folder_of_someone_else_is_refused(
        self, user_client, corpus_dir: Path
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        lees = _folder(lee, "Private")
        response = kim.post(
            "/api/documents/upload",
            files=[("files", ("a.pdf", (corpus_dir / "manual_zh.pdf").read_bytes(), "application/pdf"))],
            data={"folder_id": lees},
        )
        assert response.status_code == 400


class TestIndexingByHand:
    def _drop(self, container, kim_id: str, corpus_dir: Path, *names: str) -> None:  # noqa: ANN001
        folder = user_folder(container.settings.pdf_directory, kim_id)
        folder.mkdir(parents=True, exist_ok=True)
        sources = ["manual_mixed.pdf", "manual_ko.pdf", "manual_zh.pdf"]
        for index, name in enumerate(names):
            shutil.copy(corpus_dir / sources[index % len(sources)], folder / name)

    def test_index_now_indexes_exactly_the_files_that_are_not_indexed(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        kim_id = container.access.find_user("kim").user_id
        _upload(kim, corpus_dir / "manual_zh.pdf", "done.pdf")
        before = _point_ids(container)
        self._drop(container, kim_id, corpus_dir, "x.pdf", "y.pdf")
        assert _list(kim)["not_indexed"] == 2

        response = kim.post("/api/drive/index", json={"tree": "me"})
        assert response.status_code == 202
        assert response.json() == {"status": "started", "files": 2}
        assert _names(_list(kim)) == {"done.pdf": "indexed", "x.pdf": "indexed", "y.pdf": "indexed"}
        assert before <= _point_ids(container)

    def test_indexing_one_file_never_unindexes_the_others(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        """A run given files must not sweep: a sweep would remove everything else."""
        kim = user_client("kim")
        kim_id = container.access.find_user("kim").user_id
        _upload(kim, corpus_dir / "manual_zh.pdf", "one.pdf")
        _upload(kim, corpus_dir / "manual_ko.pdf", "two.pdf")
        # manual_mixed.pdf: content neither upload has, so a document of its own.
        documents = {row["document_id"] for row in kim.get("/api/documents").json()}
        points = _point_ids(container)
        self._drop(container, kim_id, corpus_dir, "three.pdf")
        three = next(f for f in _list(kim)["files"] if f["name"] == "three.pdf")

        kim.post("/api/drive/index", json={"tree": "me", "file_ids": [three["file_id"]]})
        after = {row["document_id"] for row in kim.get("/api/documents").json()}
        assert documents < after
        assert points <= _point_ids(container)

    def test_nothing_to_index_says_so(self, user_client) -> None:
        kim = user_client("kim")
        assert kim.post("/api/drive/index", json={"tree": "me"}).json()["status"] == "nothing"

    def test_files_left_waiting_by_a_restart_are_queued_at_startup(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        kim_id = container.access.find_user("kim").user_id
        self._drop(container, kim_id, corpus_dir, "left.pdf")
        assert resume_uploads(container) == 1 + 4  # and the admin's corpus, never indexed
        deadline = time.monotonic() + 10
        while container.indexing.is_running and time.monotonic() < deadline:
            time.sleep(0.05)
        assert _names(_list(kim)) == {"left.pdf": "indexed"}


class TestMoves:
    def test_a_move_changes_only_the_folder_row(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf")
        archive = _folder(kim, "Archive")
        file_id = _list(kim)["files"][0]["file_id"]
        points = _point_ids(container)
        documents = kim.get("/api/documents").json()
        on_disk = sorted(p.name for p in container.settings.pdf_directory.rglob("*.pdf"))

        # Even while a run is in progress.
        assert container.indexing.start(None, False)
        try:
            response = kim.post(
                "/api/drive/move", json={"tree": "me", "file_ids": [file_id], "to": archive}
            )
        finally:
            container.indexing.run(None, False)
        assert response.status_code == 204
        assert _names(_list(kim, archive)) == {"a.pdf": "indexed"}
        # The held run indexed the library meanwhile; kim's passages are untouched.
        assert points <= _point_ids(container)
        assert [d["filepath"] for d in kim.get("/api/documents").json()] == [
            d["filepath"] for d in documents
        ]
        assert sorted(p.name for p in container.settings.pdf_directory.rglob("*.pdf")) == on_disk

    def test_folders_move_with_everything_in_them(self, user_client, corpus_dir: Path) -> None:
        kim = user_client("kim")
        outer, inner = _folder(kim, "Outer"), _folder(kim, "Inner")
        _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf", inner)
        kim.post("/api/drive/move", json={"tree": "me", "folder_ids": [inner], "to": outer})
        assert [f["name"] for f in _list(kim, outer)["folders"]] == ["Inner"]
        assert _names(_list(kim, inner)) == {"a.pdf": "indexed"}
        tree = kim.get("/api/drive/tree", params={"tree": "me"}).json()
        assert tree["folders"][0]["folders"][0]["name"] == "Inner"

    def test_a_folder_cannot_go_inside_itself(self, user_client) -> None:
        kim = user_client("kim")
        outer = _folder(kim, "Outer")
        inner = _folder(kim, "Inner", outer)
        response = kim.post("/api/drive/move", json={"tree": "me", "folder_ids": [outer], "to": inner})
        assert response.status_code == 400

    def test_nothing_moves_between_trees(self, user_client, corpus_dir: Path) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf")
        lees = _folder(lee, "Lee's")
        file_id = _list(kim)["files"][0]["file_id"]
        assert kim.post("/api/drive/move", json={"tree": "me", "file_ids": [file_id], "to": lees}).status_code == 400
        assert lee.post("/api/drive/move", json={"tree": "me", "file_ids": [file_id]}).status_code == 400
        lee_id = lee.get("/api/auth/me").json()["user"]["user_id"]
        assert kim.get("/api/drive/list", params={"tree": lee_id}).status_code == 403
        assert kim.get("/api/drive/list", params={"tree": "library"}).status_code == 403

    def test_folders_survive_clearing_and_rebuilding_the_index(
        self, client: TestClient, user_client, corpus_dir: Path  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        manuals = _folder(kim, "Manuals")
        _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf", manuals)
        assert client.post("/api/index/clear").status_code == 200
        assert _names(_list(kim, manuals)) == {"a.pdf": "not_indexed"}
        kim.post("/api/drive/index", json={"tree": "me"})
        assert _names(_list(kim, manuals)) == {"a.pdf": "indexed"}


class TestFolders:
    def test_names_are_unique_among_siblings_and_cleaned(self, user_client) -> None:
        kim = user_client("kim")
        _folder(kim, "  Reports  ")
        clash = kim.post("/api/drive/folders", json={"name": "reports"})
        assert clash.status_code == 409
        bad = kim.post("/api/drive/folders", json={"name": "a/b"})
        assert bad.status_code == 400
        assert [f["name"] for f in _list(kim)["folders"]] == ["Reports"]

    def test_rename(self, user_client) -> None:
        kim = user_client("kim")
        folder = _folder(kim, "Old")
        response = kim.patch(f"/api/drive/folders/{folder}", json={"name": "New"})
        assert response.json()["name"] == "New"

    def test_deleting_a_folder_deletes_its_uploads(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        kim_id = container.access.find_user("kim").user_id
        doomed = _folder(kim, "Doomed")
        inner = _folder(kim, "Inner", doomed)
        _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf", inner)
        _upload(kim, corpus_dir / "manual_ko.pdf", "keep.pdf")
        assert kim.delete(f"/api/drive/folders/{doomed}").status_code == 204
        assert _list(kim)["folders"] == []
        assert _names(_list(kim)) == {"keep.pdf": "indexed"}
        assert not (user_folder(container.settings.pdf_directory, kim_id) / "a.pdf").exists()
        assert [d["filename"] for d in kim.get("/api/documents").json()] == ["keep.pdf"]

    def test_someone_elses_folder_does_not_exist_for_you(self, user_client) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        lees = _folder(lee, "Lee's")
        assert kim.patch(f"/api/drive/folders/{lees}", json={"name": "Mine"}).status_code == 404
        assert kim.delete(f"/api/drive/folders/{lees}").status_code == 404


class TestWhatIsOnDisk:
    def test_files_already_there_are_the_first_admins_in_an_imported_folder(
        self, client: TestClient
    ) -> None:
        client.post("/api/index", json={})
        root = _list(client)
        assert root["files"] == []
        assert [(f["name"], f["file_count"]) for f in root["folders"]] == [("Imported files", 4)]
        listing = _list(client, root["folders"][0]["folder_id"])
        assert {file["state"] for file in listing["files"]} <= {"indexed", "unsupported"}

    def test_there_is_no_library_tree(self, client: TestClient) -> None:
        assert client.get("/api/drive/list", params={"tree": "library"}).status_code == 403

    def test_a_file_deleted_by_hand_disappears(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        kim_id = container.access.find_user("kim").user_id
        _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf")
        (user_folder(container.settings.pdf_directory, kim_id) / "a.pdf").unlink()
        assert _list(kim)["files"] == []

    def test_a_file_moved_by_hand_is_followed_and_keeps_its_folder(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        """The regression for the bug in spec §0: the old path used to stay recorded."""
        kim = user_client("kim")
        kim_id = container.access.find_user("kim").user_id
        manuals = _folder(kim, "Manuals")
        _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf", manuals)
        home = user_folder(container.settings.pdf_directory, kim_id)
        (home / "sub").mkdir()
        (home / "a.pdf").rename(home / "sub" / "a.pdf")

        kim.post("/api/index", json={})
        document = kim.get("/api/documents").json()[0]
        assert document["filepath"].endswith("sub/a.pdf") or document["filepath"].endswith("sub\\a.pdf")
        assert kim.get(f"/api/documents/{document['document_id']}/file").status_code == 200
        assert _names(_list(kim, manuals)) == {"a.pdf": "indexed"}


class TestRobustness:
    def test_a_move_that_fails_half_way_moves_nothing(self, user_client, corpus_dir: Path) -> None:
        kim = user_client("kim")
        _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf")
        target = _folder(kim, "Target")
        file_id = _list(kim)["files"][0]["file_id"]
        response = kim.post(
            "/api/drive/move",
            json={"tree": "me", "file_ids": [file_id, "f" * 32], "to": target},
        )
        assert response.status_code == 400
        assert _names(_list(kim)) == {"a.pdf": "indexed"}

    def test_a_rejected_upload_is_reported_by_the_name_it_was_sent_as(self, user_client) -> None:
        kim = user_client("kim")
        response = kim.post(
            "/api/documents/upload",
            files=[("files", ("Q&A #1.pdf", b"not a pdf", "application/pdf"))],
        )
        assert [item["filename"] for item in response.json()["rejected"]] == ["Q&A #1.pdf"]

    def test_clearing_the_index_waits_for_a_run(self, client: TestClient, container) -> None:  # noqa: ANN001
        assert container.indexing.start(None, False)
        try:
            assert client.post("/api/index/clear").status_code == 409
        finally:
            container.indexing.run(None, False)
        assert client.post("/api/index/clear").status_code == 200


class TestGaps:
    def test_a_file_that_was_never_indexed_can_be_deleted(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        kim_id = container.access.find_user("kim").user_id
        home = user_folder(container.settings.pdf_directory, kim_id)
        home.mkdir(parents=True, exist_ok=True)
        shutil.copy(corpus_dir / "manual_ko.pdf", home / "never.pdf")
        _upload(kim, corpus_dir / "manual_zh.pdf", "kept.pdf")
        never = next(f for f in _list(kim)["files"] if f["name"] == "never.pdf")
        assert never["state"] == "not_indexed"

        response = kim.post("/api/drive/files/delete", json={"tree": "me", "file_ids": [never["file_id"]]})
        assert response.status_code == 204
        assert not (home / "never.pdf").exists()
        assert _names(_list(kim)) == {"kept.pdf": "indexed"}

    def test_an_indexed_file_is_deleted_with_its_passages(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf")
        file_id = _list(kim)["files"][0]["file_id"]
        kim.post("/api/drive/files/delete", json={"tree": "me", "file_ids": [file_id]})
        assert kim.get("/api/documents").json() == []
        assert _list(kim)["files"] == []

    def test_someone_elses_file_cannot_be_deleted(self, user_client, corpus_dir: Path) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf")
        file_id = _list(kim)["files"][0]["file_id"]
        assert lee.post("/api/drive/files/delete", json={"tree": "me", "file_ids": [file_id]}).status_code == 404
        assert _names(_list(kim)) == {"a.pdf": "indexed"}

    def test_deleting_a_user_deletes_their_folders(
        self, client: TestClient, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        kim_id = container.access.find_user("kim").user_id
        _upload(kim, corpus_dir / "manual_zh.pdf", "a.pdf", _folder(kim, "Kept"))
        assert client.delete(f"/api/admin/users/{kim_id}", params={"documents": "delete"}).status_code == 200
        assert container.drive.store.folders(kim_id) == []
        assert container.drive.store.files(kim_id) == []

    def test_two_uploads_of_one_name_both_keep_their_file(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        kim_id = container.access.find_user("kim").user_id
        _upload(kim, corpus_dir / "manual_zh.pdf", "same.pdf")
        _upload(kim, corpus_dir / "manual_ko.pdf", "same.pdf")
        home = user_folder(container.settings.pdf_directory, kim_id)
        assert sorted(p.name for p in home.iterdir()) == ["same (2).pdf", "same.pdf"]
        assert (home / "same.pdf").read_bytes() == (corpus_dir / "manual_zh.pdf").read_bytes()

    def test_an_oversized_upload_is_refused(self, user_client, monkeypatch) -> None:  # noqa: ANN001
        import app.api.documents as documents

        monkeypatch.setattr(documents, "_MAX_UPLOAD_BYTES", 1000)
        kim = user_client("kim")
        response = kim.post(
            "/api/documents/upload",
            files=[("files", ("big.pdf", b"%PDF-" + b"x" * 5000, "application/pdf"))],
        )
        assert response.json()["rejected"][0]["reason"].startswith("larger than")

    def test_someone_elses_run_does_not_say_whose(
        self, user_client, container  # noqa: ANN001
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        lee_id = container.access.find_user("lee").user_id
        assert container.indexing.start(
            user_folder(container.settings.pdf_directory, lee_id), False, scope=lee_id
        )
        try:
            assert kim.get("/api/index/status").json()["scope"] == "other"
            assert lee.get("/api/index/status").json()["scope"] == lee_id
        finally:
            container.indexing.run(user_folder(container.settings.pdf_directory, lee_id), False)

    def test_deleting_one_copy_keeps_the_other(
        self, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        """Two files with the same content are one document; deleting one copy must
        leave the other on disk, searchable, and openable."""
        kim = user_client("kim")
        kim_id = container.access.find_user("kim").user_id
        home = user_folder(container.settings.pdf_directory, kim_id)
        home.mkdir(parents=True, exist_ok=True)
        shutil.copy(corpus_dir / "manual_zh.pdf", home / "first.pdf")
        shutil.copy(corpus_dir / "manual_zh.pdf", home / "second.pdf")
        kim.post("/api/index", json={})
        first = next(f for f in _list(kim)["files"] if f["name"] == "first.pdf")

        assert kim.post("/api/drive/files/delete", json={"tree": "me", "file_ids": [first["file_id"]]}).status_code == 204
        assert not (home / "first.pdf").exists()
        assert (home / "second.pdf").exists()
        document = kim.get("/api/documents").json()[0]
        assert document["filename"] == "second.pdf"
        assert kim.get(f"/api/documents/{document['document_id']}/file").status_code == 200
        assert _names(_list(kim)) == {"second.pdf": "indexed"}
