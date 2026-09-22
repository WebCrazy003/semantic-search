# backend/tests/api/test_library.py
"""Upload, remove, clear, and job history: the document library operations."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _index(client: TestClient) -> dict:
    client.post("/api/index", json={})
    return client.get("/api/index/status").json()


class TestUpload:
    def test_a_pdf_is_stored_in_the_documents_folder(
        self, client: TestClient, corpus_dir: Path, tmp_path: Path, container
    ) -> None:
        payload = (corpus_dir / "manual_zh.pdf").read_bytes()
        response = client.post(
            "/api/documents/upload",
            files=[("files", ("new_manual.pdf", payload, "application/pdf"))],
        )
        assert response.status_code == 201
        body = response.json()
        assert body["saved"] == ["new_manual.pdf"]
        assert body["rejected"] == []
        assert (container.settings.pdf_directory / "new_manual.pdf").exists()

    def test_several_files_arrive_in_one_request(
        self, client: TestClient, corpus_dir: Path
    ) -> None:
        zh = (corpus_dir / "manual_zh.pdf").read_bytes()
        ko = (corpus_dir / "manual_ko.pdf").read_bytes()
        response = client.post(
            "/api/documents/upload",
            files=[
                ("files", ("a.pdf", zh, "application/pdf")),
                ("files", ("b.pdf", ko, "application/pdf")),
            ],
        )
        assert sorted(response.json()["saved"]) == ["a.pdf", "b.pdf"]

    def test_a_non_pdf_is_rejected_by_extension(self, client: TestClient) -> None:
        response = client.post(
            "/api/documents/upload",
            files=[("files", ("notes.txt", b"hello", "text/plain"))],
        )
        body = response.json()
        assert body["saved"] == []
        assert body["rejected"][0]["reason"] == "not a PDF or Word (.docx) file"

    def test_a_word_file_is_stored(self, client: TestClient, docx_dir: Path, container) -> None:
        payload = (docx_dir / "manual_ko.docx").read_bytes()
        response = client.post(
            "/api/documents/upload",
            files=[("files", ("manual.docx", payload, "application/octet-stream"))],
        )
        assert response.json()["saved"] == ["manual.docx"]
        assert (container.settings.pdf_directory / "manual.docx").exists()

    def test_a_docx_extension_without_word_content_is_rejected(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/documents/upload",
            files=[("files", ("fake.docx", b"not really a zip", "application/octet-stream"))],
        )
        assert response.json()["rejected"][0]["reason"] == "not a Word .docx file (bad header)"

    def test_a_zip_that_is_not_a_word_file_is_rejected(self, client: TestClient) -> None:
        import io
        import zipfile

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("hello.txt", "hi")
        response = client.post(
            "/api/documents/upload",
            files=[("files", ("x.docx", buffer.getvalue(), "application/octet-stream"))],
        )
        assert "no document inside" in response.json()["rejected"][0]["reason"]

    def test_an_encrypted_or_legacy_word_file_is_rejected(
        self, client: TestClient, docx_dir: Path
    ) -> None:
        payload = (docx_dir / "locked.docx").read_bytes()
        response = client.post(
            "/api/documents/upload",
            files=[("files", ("locked.docx", payload, "application/octet-stream"))],
        )
        assert "password-protected" in response.json()["rejected"][0]["reason"]

    def test_a_legacy_doc_is_rejected_by_extension(self, client: TestClient) -> None:
        response = client.post(
            "/api/documents/upload",
            files=[("files", ("old.doc", b"\xd0\xcf\x11\xe0", "application/msword"))],
        )
        assert response.json()["rejected"][0]["reason"] == "not a PDF or Word (.docx) file"

    def test_a_pdf_extension_without_pdf_content_is_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/api/documents/upload",
            files=[("files", ("fake.pdf", b"not really a pdf", "application/pdf"))],
        )
        assert response.json()["rejected"][0]["reason"] == "not a PDF (bad header)"

    def test_one_bad_file_does_not_stop_the_good_ones(
        self, client: TestClient, corpus_dir: Path
    ) -> None:
        good = (corpus_dir / "manual_zh.pdf").read_bytes()
        response = client.post(
            "/api/documents/upload",
            files=[
                ("files", ("good.pdf", good, "application/pdf")),
                ("files", ("bad.txt", b"nope", "text/plain")),
            ],
        )
        body = response.json()
        assert body["saved"] == ["good.pdf"]
        assert len(body["rejected"]) == 1

    def test_a_path_in_the_filename_cannot_escape_the_folder(
        self, client: TestClient, corpus_dir: Path, container
    ) -> None:
        payload = (corpus_dir / "manual_zh.pdf").read_bytes()
        client.post(
            "/api/documents/upload",
            files=[("files", ("../../escaped.pdf", payload, "application/pdf"))],
        )
        assert (container.settings.pdf_directory / "escaped.pdf").exists()
        assert not (container.settings.pdf_directory.parent.parent / "escaped.pdf").exists()

    def test_a_second_upload_of_the_same_name_does_not_overwrite(
        self, client: TestClient, corpus_dir: Path
    ) -> None:
        payload = (corpus_dir / "manual_zh.pdf").read_bytes()
        files = [("files", ("dup.pdf", payload, "application/pdf"))]
        client.post("/api/documents/upload", files=files)
        second = client.post("/api/documents/upload", files=files)
        assert second.json()["saved"] == ["dup (2).pdf"]

    def test_uploaded_files_are_picked_up_by_the_next_run(
        self, client: TestClient, corpus_dir: Path, container
    ) -> None:
        for path in container.settings.pdf_directory.glob("*.pdf"):
            path.unlink()
        payload = (corpus_dir / "manual_zh.pdf").read_bytes()
        client.post(
            "/api/documents/upload",
            files=[("files", ("only.pdf", payload, "application/pdf"))],
        )
        status = _index(client)
        assert status["indexed_documents"] == 1
        assert [d["filename"] for d in client.get("/api/documents").json()] == ["only.pdf"]


class TestRemoveOneDocument:
    def test_its_passages_and_record_go_but_the_file_stays(
        self, client: TestClient, container
    ) -> None:
        _index(client)
        before = container.qdrant.count_points()
        document = next(
            d for d in client.get("/api/documents").json() if d["filename"] == "manual_zh.pdf"
        )

        response = client.delete(f"/api/documents/{document['document_id']}")
        assert response.status_code == 200
        body = response.json()
        assert body["filename"] == "manual_zh.pdf"
        assert body["chunks_removed"] == document["chunks"]
        assert body["file_kept"] is True

        assert container.qdrant.count_points() == before - document["chunks"]
        assert "manual_zh.pdf" not in [d["filename"] for d in client.get("/api/documents").json()]
        assert (container.settings.pdf_directory / "manual_zh.pdf").exists()

    def test_removing_an_unknown_document_is_a_404(self, client: TestClient) -> None:
        assert client.delete("/api/documents/" + "f" * 64).status_code == 404

    def test_a_removed_document_returns_on_the_next_run(
        self, client: TestClient, container
    ) -> None:
        _index(client)
        document = next(
            d for d in client.get("/api/documents").json() if d["filename"] == "manual_zh.pdf"
        )
        client.delete(f"/api/documents/{document['document_id']}")
        _index(client)
        assert "manual_zh.pdf" in [d["filename"] for d in client.get("/api/documents").json()]


class TestClearIndex:
    def test_every_passage_and_record_is_dropped(self, client: TestClient, container) -> None:
        _index(client)
        assert container.qdrant.count_points() > 0

        response = client.post("/api/index/clear")
        assert response.status_code == 200
        body = response.json()
        assert body["documents_removed"] > 0
        assert body["passages_removed"] > 0
        assert body["files_kept"] is True

        assert container.qdrant.count_points() == 0
        assert client.get("/api/documents").json() == []

    def test_the_pdf_files_are_left_alone(self, client: TestClient, container) -> None:
        _index(client)
        client.post("/api/index/clear")
        assert list(container.settings.pdf_directory.glob("*.pdf"))

    def test_searching_after_a_clear_returns_nothing(self, client: TestClient) -> None:
        _index(client)
        client.post("/api/index/clear")
        assert client.post("/api/search", json={"query": "滤芯"}).json()["results"] == []

    def test_indexing_again_after_a_clear_rebuilds_everything(
        self, client: TestClient, container
    ) -> None:
        first = _index(client)
        client.post("/api/index/clear")
        second = _index(client)
        assert second["indexed_documents"] == first["indexed_documents"]
        assert container.qdrant.count_points() == first["total_chunks"]


class TestJobHistory:
    def test_a_run_is_recorded(self, client: TestClient) -> None:
        _index(client)
        jobs = client.get("/api/index/jobs").json()
        assert len(jobs) == 1
        assert jobs[0]["status"] == "completed"
        assert jobs[0]["indexed"] == 3
        assert jobs[0]["processed"] == jobs[0]["total"]
        assert jobs[0]["finished_at"] is not None

    def test_jobs_accumulate_newest_first(self, client: TestClient) -> None:
        _index(client)
        _index(client)
        jobs = client.get("/api/index/jobs").json()
        assert len(jobs) == 2
        assert jobs[0]["started_at"] >= jobs[1]["started_at"]
        assert jobs[0]["skipped"] == 3  # the second run skipped what the first indexed

    def test_the_trigger_is_recorded(self, client: TestClient) -> None:
        client.post("/api/index", json={"trigger": "upload"})
        assert client.get("/api/index/jobs").json()[0]["trigger"] == "upload"

    def test_history_survives_a_new_app_instance(self, client: TestClient, container) -> None:
        _index(client)
        from app.main import create_app

        with TestClient(create_app(container=container)) as fresh:
            assert len(fresh.get("/api/index/jobs").json()) == 1

    def test_the_limit_is_respected(self, client: TestClient) -> None:
        _index(client)
        _index(client)
        assert len(client.get("/api/index/jobs?limit=1").json()) == 1

    def test_status_reports_the_job_id_of_the_last_run(self, client: TestClient) -> None:
        status = _index(client)
        assert status["job_id"] == client.get("/api/index/jobs").json()[0]["job_id"]


class TestSingleJobRule:
    def test_removal_is_refused_while_a_run_is_in_progress(
        self, client: TestClient, container
    ) -> None:
        container.indexing.start(container.settings.pdf_directory)
        try:
            response = client.delete("/api/documents/" + "a" * 64)
            assert response.status_code == 409
        finally:
            container.indexing.run(container.settings.pdf_directory)

    def test_clearing_is_refused_while_a_run_is_in_progress(
        self, client: TestClient, container
    ) -> None:
        container.indexing.start(container.settings.pdf_directory)
        try:
            assert client.post("/api/index/clear").status_code == 409
        finally:
            container.indexing.run(container.settings.pdf_directory)

    def test_a_second_run_is_refused_while_one_is_in_progress(
        self, client: TestClient, container
    ) -> None:
        container.indexing.start(container.settings.pdf_directory)
        try:
            response = client.post("/api/index", json={})
            assert response.status_code == 409
            assert response.json()["status"] == "already_running"
        finally:
            container.indexing.run(container.settings.pdf_directory)


class TestDocumentDetail:
    def test_every_stored_field_is_exposed(self, client: TestClient) -> None:
        _index(client)
        document = next(
            d for d in client.get("/api/documents").json() if d["filename"] == "manual_zh.pdf"
        )
        assert document["file_size"] > 0
        assert len(document["file_hash"]) == 64
        assert document["modified_at"] is not None
        assert document["pages"] == 3
        assert document["title"]
        assert document["error_message"] is None

    def test_an_unsupported_document_carries_its_reason(self, client: TestClient) -> None:
        _index(client)
        scan = next(
            d for d in client.get("/api/documents").json() if d["filename"] == "empty_scan_zh.pdf"
        )
        assert scan["status"] == "unsupported"
        assert "scanned" in scan["error_message"]



class TestOpeningTheSourceFile:
    def test_an_indexed_pdf_is_served_inline(self, client: TestClient) -> None:
        _index(client)
        document = next(
            d for d in client.get("/api/documents").json() if d["filename"] == "manual_zh.pdf"
        )

        response = client.get(f"/api/documents/{document['document_id']}/file")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert "inline" in response.headers["content-disposition"]
        assert response.content.startswith(b"%PDF-")

    def test_an_indexed_word_file_downloads(
        self, client: TestClient, container, docx_dir: Path
    ) -> None:
        import shutil

        shutil.copy(docx_dir / "manual_ko.docx", container.settings.pdf_directory)
        _index(client)
        document = next(
            d for d in client.get("/api/documents").json() if d["filename"] == "manual_ko.docx"
        )
        assert document["file_type"] == "docx"
        assert document["pages_approximate"] is True

        response = client.get(f"/api/documents/{document['document_id']}/file")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        assert "attachment" in response.headers["content-disposition"]
        assert response.content.startswith(b"PK")

    def test_a_pdf_is_listed_with_exact_pages(self, client: TestClient) -> None:
        _index(client)
        document = next(
            d for d in client.get("/api/documents").json() if d["filename"] == "manual_zh.pdf"
        )
        assert document["file_type"] == "pdf"
        assert document["pages_approximate"] is False

    def test_an_unknown_document_is_a_404(self, client: TestClient) -> None:
        assert client.get(f"/api/documents/{'f' * 64}/file").status_code == 404

    def test_a_file_deleted_from_the_folder_is_a_404(self, client: TestClient, container) -> None:
        _index(client)
        document = next(
            d for d in client.get("/api/documents").json() if d["filename"] == "manual_zh.pdf"
        )
        (container.settings.pdf_directory / "manual_zh.pdf").unlink()

        response = client.get(f"/api/documents/{document['document_id']}/file")
        assert response.status_code == 404
        assert "no longer in any folder in the library" in response.json()["detail"]

    def test_a_record_pointing_outside_the_folder_is_refused(
        self, client: TestClient, container, tmp_path
    ) -> None:
        # A manifest row is the only input, so a doctored row must not turn into a
        # read of any file on the machine.
        _index(client)
        document = next(
            d for d in client.get("/api/documents").json() if d["filename"] == "manual_zh.pdf"
        )
        outsider = tmp_path / "outside.pdf"
        outsider.write_bytes(b"%PDF-1.4 secret")

        record = container.manifest.get(document["document_id"])
        record.filepath = str(outsider)
        record.alt_filepaths = []
        container.manifest.upsert(record)

        assert client.get(f"/api/documents/{document['document_id']}/file").status_code == 404
