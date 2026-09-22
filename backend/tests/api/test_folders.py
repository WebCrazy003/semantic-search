# backend/tests/api/test_folders.py
"""Folders indexed in place: registered by path, never copied."""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi.testclient import TestClient


def _index(client: TestClient) -> dict:
    client.post("/api/index", json={})
    return client.get("/api/index/status").json()


def _elsewhere(tmp_path: Path, name: str = "elsewhere") -> Path:
    """A folder of PDFs outside the documents folder, as a user's own folder would be.

    The content differs from the corpus on purpose: identical bytes would be detected
    as duplicates and indexed once, which is a different behaviour from this one.
    """
    import fitz

    target = tmp_path / name
    (target / "nested").mkdir(parents=True)
    _make_pdf(target / "outside_zh.pdf", "外部文档", "这是位于项目之外的中文技术文档，用于测试原地索引。")
    _make_pdf(
        target / "nested" / "outside_ko.pdf",
        "외부 문서",
        "이 문서는 프로젝트 밖의 폴더에 있으며 제자리 색인을 확인하기 위한 것입니다.",
        korean=True,
    )
    assert fitz  # the import above is what writes the files, via _make_pdf
    return target


def _make_pdf(path: Path, heading: str, body: str, korean: bool = False) -> Path:
    import fitz

    document = fitz.open()
    page = document.new_page()
    font = "korea-s" if korean else "china-ss"
    page.insert_text((72, 100), heading, fontname=font, fontsize=18)
    page.insert_text((72, 140), body, fontname=font, fontsize=11)
    page.insert_text((72, 170), body, fontname=font, fontsize=11)
    document.save(path)
    document.close()
    return path


class TestRegistering:
    def test_the_documents_folder_is_listed_by_default(self, client: TestClient) -> None:
        folders = client.get("/api/folders").json()
        assert len(folders) == 1
        assert folders[0]["is_default"] is True
        assert folders[0]["readable"] is True

    def test_a_folder_is_added_by_path(self, client: TestClient, tmp_path) -> None:
        outside = _elsewhere(tmp_path)
        response = client.post("/api/folders", json={"path": str(outside)})

        assert response.status_code == 201
        body = response.json()
        assert body["path"] == str(outside)
        assert body["pdf_count"] == 2  # counted through subfolders
        assert body["document_count"] == 2

    def test_word_files_are_counted_and_lock_files_are_not(
        self, client: TestClient, tmp_path, docx_dir
    ) -> None:
        import shutil

        outside = _elsewhere(tmp_path)
        shutil.copy(docx_dir / "manual_ko.docx", outside / "manual_ko.docx")
        (outside / "~$manual_ko.docx").write_bytes(b"lock")
        body = client.post("/api/folders", json={"path": str(outside)}).json()
        assert body["document_count"] == 3
        assert body["pdf_count"] == 2
        assert body["is_default"] is False

    def test_it_survives_a_restart(self, client: TestClient, container, tmp_path) -> None:
        outside = _elsewhere(tmp_path)
        client.post("/api/folders", json={"path": str(outside)})

        from app.main import create_app

        with TestClient(create_app(container=container)) as fresh:
            assert [f["path"] for f in fresh.get("/api/folders").json() if not f["is_default"]] == [
                str(outside)
            ]

    def test_a_relative_path_is_rejected(self, client: TestClient) -> None:
        response = client.post("/api/folders", json={"path": "./documents"})
        assert response.status_code == 400
        assert "absolute" in response.json()["detail"]

    def test_a_path_that_does_not_exist_is_rejected(self, client: TestClient, tmp_path) -> None:
        response = client.post("/api/folders", json={"path": str(tmp_path / "nope")})
        assert response.status_code == 400

    def test_a_file_is_not_a_folder(self, client: TestClient, tmp_path) -> None:
        single = _make_pdf(tmp_path / "one.pdf", "标题", "正文")
        response = client.post("/api/folders", json={"path": str(single)})
        assert response.status_code == 400
        assert "not a folder" in response.json()["detail"]

    def test_the_same_folder_twice_is_refused(self, client: TestClient, tmp_path) -> None:
        outside = _elsewhere(tmp_path)
        client.post("/api/folders", json={"path": str(outside)})
        again = client.post("/api/folders", json={"path": str(outside)})
        assert again.status_code == 409
        assert "already in the library" in again.json()["detail"]

    def test_a_subfolder_of_a_known_folder_is_refused(
        self, client: TestClient, tmp_path, corpus_dir
    ) -> None:
        outside = _elsewhere(tmp_path)
        client.post("/api/folders", json={"path": str(outside)})
        nested = client.post("/api/folders", json={"path": str(outside / "nested")})
        assert nested.status_code == 409
        assert "scanned including subfolders" in nested.json()["detail"]

    def test_adding_is_refused_while_a_run_is_in_progress(
        self, client: TestClient, container, tmp_path, corpus_dir
    ) -> None:
        outside = _elsewhere(tmp_path)
        container.indexing.start(container.settings.pdf_directory)
        try:
            assert client.post("/api/folders", json={"path": str(outside)}).status_code == 409
        finally:
            container.indexing.run(container.settings.pdf_directory)


class TestIndexingInPlace:
    def test_a_registered_folder_is_scanned_with_the_documents_folder(
        self, client: TestClient, tmp_path, corpus_dir
    ) -> None:
        outside = _elsewhere(tmp_path)
        client.post("/api/folders", json={"path": str(outside)})

        status = _index(client)
        names = {d["filename"] for d in client.get("/api/documents").json()}
        assert status.get("failed_documents") == 0
        assert {"outside_zh.pdf", "outside_ko.pdf"} <= names

    def test_nothing_is_copied_into_the_documents_folder(
        self, client: TestClient, container, tmp_path, corpus_dir
    ) -> None:
        outside = _elsewhere(tmp_path)
        client.post("/api/folders", json={"path": str(outside)})
        before = sorted(p.name for p in container.settings.pdf_directory.rglob("*.pdf"))

        _index(client)

        assert sorted(p.name for p in container.settings.pdf_directory.rglob("*.pdf")) == before
        assert (outside / "outside_zh.pdf").exists()

    def test_the_stored_path_is_the_real_one(
        self, client: TestClient, tmp_path, corpus_dir
    ) -> None:
        outside = _elsewhere(tmp_path)
        client.post("/api/folders", json={"path": str(outside)})
        _index(client)

        document = next(
            d for d in client.get("/api/documents").json() if d["filename"] == "outside_ko.pdf"
        )
        assert document["filepath"] == str(outside / "nested" / "outside_ko.pdf")

    def test_a_file_in_a_registered_folder_can_be_opened(
        self, client: TestClient, tmp_path, corpus_dir
    ) -> None:
        outside = _elsewhere(tmp_path)
        client.post("/api/folders", json={"path": str(outside)})
        _index(client)

        document = next(
            d for d in client.get("/api/documents").json() if d["filename"] == "outside_zh.pdf"
        )
        response = client.get(f"/api/documents/{document['document_id']}/file")
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF-")

    def test_an_unreadable_folder_does_not_stop_the_run(
        self, client: TestClient, container, tmp_path, corpus_dir
    ) -> None:
        outside = _elsewhere(tmp_path)
        client.post("/api/folders", json={"path": str(outside)})
        shutil.rmtree(outside)  # as if a drive was unplugged

        status = _index(client)
        assert status["status"] == "completed"
        assert status["indexed_documents"] == 3  # the documents folder still went through
        assert any("not readable" in failure["error_message"] for failure in status["failures"])

    def test_the_folder_report_counts_what_it_contributed(
        self, client: TestClient, tmp_path, corpus_dir
    ) -> None:
        outside = _elsewhere(tmp_path)
        client.post("/api/folders", json={"path": str(outside)})
        _index(client)

        folder = next(f for f in client.get("/api/folders").json() if not f["is_default"])
        assert folder["indexed_documents"] == 2


class TestUnregistering:
    def test_removing_a_folder_unindexes_its_documents_and_keeps_the_files(
        self, client: TestClient, tmp_path, corpus_dir
    ) -> None:
        outside = _elsewhere(tmp_path)
        client.post("/api/folders", json={"path": str(outside)})
        _index(client)

        response = client.delete("/api/folders", params={"path": str(outside)})
        assert response.status_code == 200
        body = response.json()
        assert body["documents_unindexed"] == 2
        assert body["files_kept"] is True

        names = {d["filename"] for d in client.get("/api/documents").json()}
        assert "outside_zh.pdf" not in names
        assert (outside / "outside_zh.pdf").exists()

    def test_the_documents_folder_cannot_be_removed(self, client: TestClient, container) -> None:
        response = client.delete(
            "/api/folders", params={"path": str(container.settings.pdf_directory)}
        )
        assert response.status_code == 400

    def test_removing_an_unknown_folder_is_a_404(self, client: TestClient, tmp_path) -> None:
        assert client.delete("/api/folders", params={"path": str(tmp_path)}).status_code == 404

    def test_documents_from_the_documents_folder_are_untouched(
        self, client: TestClient, tmp_path, corpus_dir
    ) -> None:
        outside = _elsewhere(tmp_path)
        client.post("/api/folders", json={"path": str(outside)})
        _index(client)
        client.delete("/api/folders", params={"path": str(outside)})

        names = {d["filename"] for d in client.get("/api/documents").json()}
        assert "manual_zh.pdf" in names
