# backend/tests/api/test_library_migration.py
"""The library becomes the first admin's: files, documents, folders and public flags."""

from __future__ import annotations

import shutil
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.deps import Container
from app.services.indexing_service import IndexingService
from app.services.library_migration import adopt_library
from app.services.ownership import LIBRARY, PUBLIC, user_folder
from app.services.passwords import hash_password
from tests.api.conftest import ADMIN_NAME, CSRF, PASSWORD, login

LOOPBACK = ("127.0.0.1", 50000)


@pytest.fixture
def started(app, container: Container) -> Iterator[TestClient]:  # noqa: ANN001
    """The app with no account yet, so nothing has been adopted."""
    with TestClient(app, headers=CSRF, client=LOOPBACK) as test_client:
        yield test_client


def _index_as_library(container: Container) -> None:
    """Index the documents folder the way DocSage did before every document was a user's."""
    legacy = IndexingService(
        extractors=container.extractors,
        chunker=container.chunker,
        embedder=container.embedder,
        qdrant=container.qdrant,
        manifest=container.manifest,
        default_directory=container.settings.pdf_directory,
    )
    assert legacy.start(None)
    legacy.run(None)


def _publish(container: Container, document_id: str) -> None:
    container.access.make_public([document_id], by="someone")
    container.manifest.set_visibility([document_id], PUBLIC)
    container.qdrant.set_visibility(document_id, PUBLIC)


def _admin(container: Container) -> str:
    return container.access.create_user(ADMIN_NAME, hash_password(PASSWORD), role="admin").user_id


def _by_name(container: Container) -> dict:
    return {record.filename: record for record in container.manifest.all_documents()}


class TestAdoptingTheLibrary:
    def test_indexed_documents_move_without_being_embedded_again(
        self, started: TestClient, container: Container
    ) -> None:
        _index_as_library(container)
        before = _by_name(container)
        points = container.qdrant.count_points()
        _publish(container, before["manual_zh.pdf"].document_id)
        admin_id = _admin(container)
        embedded = len(container.embedder.calls)

        assert adopt_library(container) == 4

        after = _by_name(container)
        home = user_folder(container.settings.pdf_directory, admin_id)
        assert set(after) == set(before)
        assert {record.owner_id for record in after.values()} == {admin_id}
        assert all(Path(record.filepath).parent == home for record in after.values())
        assert not list(container.settings.pdf_directory.glob("*.pdf"))
        assert container.manifest.all_documents(owner_id=LIBRARY) == []
        assert container.qdrant.count_points() == points
        assert len(container.embedder.calls) == embedded

        zh = after["manual_zh.pdf"]
        assert zh.document_id != before["manual_zh.pdf"].document_id
        assert zh.visibility == PUBLIC
        assert container.access.public_ids() == {zh.document_id}

        login(started, ADMIN_NAME)
        hits = started.post("/api/search", json={"query": "manual", "top_k": 50}).json()["results"]
        assert hits and {hit["owner_username"] for hit in hits} == {ADMIN_NAME}
        assert started.get(f"/api/documents/{zh.document_id}/file").status_code == 200

    def test_the_library_folders_land_in_an_imported_files_folder(
        self, started: TestClient, container: Container
    ) -> None:
        store = container.drive.store
        shelf = store.create_folder(LIBRARY, None, "Shelf")
        store.add(LIBRARY, str(container.settings.pdf_directory / "manual_ko.pdf"), shelf.folder_id)
        _admin(container)
        adopt_library(container)

        login(started, ADMIN_NAME)
        root = started.get("/api/drive/list").json()
        assert [folder["name"] for folder in root["folders"]] == ["Imported files"]
        library = started.get(
            "/api/drive/list", params={"folder_id": root["folders"][0]["folder_id"]}
        ).json()
        assert [folder["name"] for folder in library["folders"]] == ["Shelf"]
        assert len(library["files"]) == 3
        inside = started.get("/api/drive/list", params={"folder_id": shelf.folder_id}).json()
        assert [file["name"] for file in inside["files"]] == ["manual_ko.pdf"]
        assert store.folders(LIBRARY) == []

    def test_registered_folders_are_copied_and_forgotten(
        self, started: TestClient, container: Container, corpus_dir: Path, tmp_path: Path
    ) -> None:
        outside = tmp_path / "usb"
        outside.mkdir()
        shutil.copy(corpus_dir / "manual_ko.pdf", outside / "manual_ko.pdf")
        container.manifest.add_folder(outside)
        admin_id = _admin(container)

        assert adopt_library(container) == 5
        home = user_folder(container.settings.pdf_directory, admin_id)
        assert (outside / "manual_ko.pdf").exists()  # never taken from where it was
        assert (home / "manual_ko (2).pdf").exists()
        assert container.manifest.folders() == []

    def test_it_runs_once(self, started: TestClient, container: Container) -> None:
        _admin(container)
        assert adopt_library(container) == 4
        assert adopt_library(container) == 0

    def test_it_waits_for_an_admin(self, started: TestClient, container: Container) -> None:
        container.access.create_user("kim", hash_password(PASSWORD), role="user")
        assert adopt_library(container) == 0
        assert len(list(container.settings.pdf_directory.glob("*.pdf"))) == 4


class TestSetup:
    def test_the_first_admin_gets_the_files_and_they_are_indexed(
        self, started: TestClient, container: Container
    ) -> None:
        response = started.post(
            "/api/auth/setup", json={"username": ADMIN_NAME, "password": PASSWORD}
        )
        assert response.status_code == 201
        deadline = time.monotonic() + 10
        while container.indexing.is_running and time.monotonic() < deadline:
            time.sleep(0.05)
        names = {row["filename"]: row for row in started.get("/api/documents").json()}
        assert set(names) == {
            "manual_zh.pdf", "manual_ko.pdf", "manual_mixed.pdf", "empty_scan_zh.pdf"
        }
        assert all(row["is_mine"] for row in names.values())
