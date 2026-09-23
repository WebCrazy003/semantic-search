# backend/tests/api/test_admin.py
"""The admin endpoints: what the extractor produced, and how the index is built."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.admin import _PAYLOAD_FIELDS, _overlap
from app.deps import Container
from app.models.domain import Chunk, DocumentMeta
from app.services.qdrant_service import QdrantService


def _indexed(client: TestClient, filename: str = "manual_zh.pdf") -> dict:
    client.post("/api/index", json={})
    documents = client.get("/api/documents").json()
    return next(entry for entry in documents if entry["filename"] == filename)


class TestIndexSchema:
    def test_it_reports_the_real_collection(self, client: TestClient) -> None:
        client.post("/api/index", json={})
        body = client.get("/api/admin/index/schema").json()["qdrant"]

        assert body["exists"] is True
        assert body["collection"] == "pdf_passages"
        assert body["vector_size"] == 1024
        assert "Cosine" in body["distance"]
        assert body["points_count"] > 0

    def test_an_empty_collection_reports_no_passages(self, client: TestClient) -> None:
        """The collection is created at startup, so it exists before anything is in it."""
        body = client.get("/api/admin/index/schema").json()["qdrant"]
        assert body["exists"] is True
        assert body["points_count"] == 0

    def test_it_reports_the_payload_indexes_the_store_really_has(
        self, client: TestClient
    ) -> None:
        """An embedded Qdrant has none, and saying so is the point of the page.

        Payload indexes are a server-Qdrant feature; embedded mode filters without
        them. Reporting the store's own answer is what makes this page trustworthy,
        so this asserts the endpoint does not invent the fields we asked for.
        """
        client.post("/api/index", json={})
        body = client.get("/api/admin/index/schema").json()["qdrant"]
        assert body["payload_indexes"] == []

    def test_every_payload_field_written_is_documented(self) -> None:
        """Guards against a new payload field appearing with no explanation."""
        chunk = Chunk(
            document_id="d",
            chunk_index=0,
            text="text",
            page_start=1,
            page_end=1,
            heading=None,
            token_count=3,
        )
        meta = DocumentMeta(
            document_id="d",
            filename="a.pdf",
            filepath="/documents/a.pdf",
            folder="/documents",
            file_hash="h",
            modified_at=datetime.now(UTC),
        )
        written = set(QdrantService._payload(chunk, meta))
        documented = {field.name for field in _PAYLOAD_FIELDS}
        assert written == documented

    def test_it_reports_the_manifest_tables_and_row_counts(self, client: TestClient) -> None:
        client.post("/api/index", json={})
        manifest = client.get("/api/admin/index/schema").json()["manifest"]

        tables = {table["name"]: table for table in manifest["tables"]}
        assert set(tables) >= {"documents", "index_jobs", "library_folders"}
        assert tables["documents"]["rows"] == 4
        assert tables["index_jobs"]["rows"] == 1

        columns = {column["name"]: column for column in tables["documents"]["columns"]}
        assert columns["document_id"]["pk"] is True
        assert columns["filename"]["notnull"] is True
        assert "idx_documents_status" in tables["documents"]["indexes"]

    def test_it_breaks_the_documents_down_by_status(self, client: TestClient) -> None:
        client.post("/api/index", json={})
        manifest = client.get("/api/admin/index/schema").json()["manifest"]
        assert manifest["status_breakdown"]["indexed"] == 3
        assert manifest["status_breakdown"]["unsupported"] == 1

    def test_the_chunking_block_is_the_settings_in_force(
        self, client: TestClient, container: Container
    ) -> None:
        chunking = client.get("/api/admin/index/schema").json()["chunking"]
        assert chunking["target_tokens"] == container.settings.chunk_target_tokens
        assert chunking["max_tokens"] == container.settings.chunk_max_tokens
        assert chunking["overlap_tokens"] == container.settings.chunk_overlap_tokens
        assert chunking["allow_cross_page"] == container.settings.chunk_allow_cross_page

    def test_the_embedding_block_describes_the_model(self, client: TestClient) -> None:
        embedding = client.get("/api/admin/index/schema").json()["embedding"]
        assert embedding["vector_size"] == 1024
        assert embedding["max_seq_length"] == 512


class TestExtraction:
    def test_it_returns_the_pages_the_extractor_produced(self, client: TestClient) -> None:
        document = _indexed(client)
        body = client.get(f"/api/admin/documents/{document['document_id']}/extraction").json()

        assert body["filename"] == "manual_zh.pdf"
        assert body["file_type"] == "pdf"
        assert body["pages"] == 3
        assert [page["page_number"] for page in body["page_views"]] == [1, 2, 3]
        assert body["page_views"][0]["text"]
        assert body["page_views"][0]["char_count"] > 0
        assert body["extracted_ms"] >= 0

    def test_it_returns_the_blocks_of_a_page(self, client: TestClient) -> None:
        document = _indexed(client)
        body = client.get(f"/api/admin/documents/{document['document_id']}/extraction").json()
        kinds = {block["kind"] for block in body["page_views"][0]["blocks"]}
        assert kinds <= {"heading", "paragraph", "table"}
        assert kinds

    def test_it_pages_a_long_document(self, client: TestClient) -> None:
        document = _indexed(client)
        body = client.get(
            f"/api/admin/documents/{document['document_id']}/extraction",
            params={"page": 2, "per_page": 1},
        ).json()
        assert [page["page_number"] for page in body["page_views"]] == [2]
        assert body["page"] == 2

    def test_a_word_file_says_its_pages_are_approximate(self, client: TestClient) -> None:
        documents = [
            entry
            for entry in (_indexed(client), *client.get("/api/documents").json())
            if entry["filename"].endswith(".docx")
        ]
        if not documents:
            pytest.skip("the API corpus holds no .docx fixture")
        body = client.get(f"/api/admin/documents/{documents[0]['document_id']}/extraction").json()
        assert body["pages_approximate"] is True

    def test_it_notices_a_file_that_changed_since_indexing(
        self, client: TestClient, api_documents_dir: Path
    ) -> None:
        document = _indexed(client)
        before = client.get(f"/api/admin/documents/{document['document_id']}/extraction").json()
        assert before["file_hash_matches_manifest"] is True

        path = api_documents_dir / "manual_zh.pdf"
        path.write_bytes(path.read_bytes() + b"\n%% edited\n")

        after = client.get(f"/api/admin/documents/{document['document_id']}/extraction").json()
        assert after["file_hash_matches_manifest"] is False

    def test_an_unknown_document_is_404(self, client: TestClient) -> None:
        response = client.get("/api/admin/documents/nope/extraction")
        assert response.status_code == 404

    def test_a_deleted_file_is_410(self, client: TestClient, api_documents_dir: Path) -> None:
        document = _indexed(client)
        (api_documents_dir / "manual_zh.pdf").unlink()

        response = client.get(f"/api/admin/documents/{document['document_id']}/extraction")
        assert response.status_code == 410
        assert "no longer" in response.json()["detail"]

    def test_an_unreadable_file_is_422(self, client: TestClient) -> None:
        document = _indexed(client, "empty_scan_zh.pdf")
        response = client.get(f"/api/admin/documents/{document['document_id']}/extraction")
        assert response.status_code == 422
        assert response.json()["detail"]

    def test_the_page_size_is_capped(self, client: TestClient) -> None:
        document = _indexed(client)
        response = client.get(
            f"/api/admin/documents/{document['document_id']}/extraction",
            params={"per_page": 500},
        )
        assert response.status_code == 422


class TestChunks:
    def test_it_returns_the_passages_in_order(self, client: TestClient) -> None:
        document = _indexed(client)
        body = client.get(f"/api/admin/documents/{document['document_id']}/chunks").json()

        indexes = [chunk["chunk_index"] for chunk in body["chunks"]]
        assert indexes == sorted(indexes)
        assert body["total_chunks"] == document["chunks"]
        assert body["chunks"][0]["text"]
        assert body["chunks"][0]["point_id"]
        assert body["pages_covered"] > 0

    def test_it_respects_offset_and_limit(self, client: TestClient) -> None:
        document = _indexed(client)
        all_chunks = client.get(
            f"/api/admin/documents/{document['document_id']}/chunks"
        ).json()["chunks"]
        if len(all_chunks) < 2:
            pytest.skip("the fixture produced a single passage")

        window = client.get(
            f"/api/admin/documents/{document['document_id']}/chunks",
            params={"offset": 1, "limit": 1},
        ).json()
        assert [chunk["chunk_index"] for chunk in window["chunks"]] == [
            all_chunks[1]["chunk_index"]
        ]
        assert window["total_chunks"] == len(all_chunks)

    def test_an_unknown_document_is_404(self, client: TestClient) -> None:
        assert client.get("/api/admin/documents/nope/chunks").status_code == 404


class TestOverlap:
    @pytest.mark.parametrize(
        ("previous", "current", "expected"),
        [
            ("abc def ghi", "ghi jkl", (0, 3)),
            ("...关闭主电源开关。", "关闭主电源开关。然后", (0, 8)),
            ("nothing shared", "completely different", (0, 0)),
            ("", "anything", (0, 0)),
            ("anything", "", (0, 0)),
        ],
    )
    def test_it_measures_the_repeated_prefix(
        self, previous: str, current: str, expected: tuple[int, int]
    ) -> None:
        assert _overlap(previous, current) == expected

    def test_it_looks_past_a_repeated_heading(self) -> None:
        """The shipped configuration repeats the heading, so the repeat is not first.

        Without this, the overlap would read zero on every document the app indexes
        with CHUNK_REPEAT_HEADING on, and the passage view would show nothing.
        """
        previous = "…and then close the main power switch."
        current = "Safety\n\nclose the main power switch. Then remove the cover."
        start, length = _overlap(previous, current, "Safety")

        assert current[start : start + length] == "close the main power switch."

    def test_a_heading_that_is_not_repeated_changes_nothing(self) -> None:
        assert _overlap("abc def ghi", "ghi jkl", "Some heading") == (0, 3)

    def test_the_first_passage_of_a_document_overlaps_nothing(self, client: TestClient) -> None:
        document = _indexed(client)
        body = client.get(f"/api/admin/documents/{document['document_id']}/chunks").json()
        assert body["chunks"][0]["overlap_with_previous"] == 0


class TestReadOnly:
    @pytest.mark.parametrize(
        "path",
        [
            "/api/admin/index/schema",
            "/api/admin/documents/any/extraction",
            "/api/admin/documents/any/chunks",
        ],
    )
    @pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
    def test_nothing_here_accepts_a_write(
        self, client: TestClient, path: str, method: str
    ) -> None:
        response = getattr(client, method)(path)
        assert response.status_code == 405
