# backend/tests/test_manifest_service.py
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.services.manifest_service import DocumentRecord, ManifestService


@pytest.fixture
def manifest(tmp_path: Path) -> ManifestService:
    service = ManifestService(tmp_path / "manifest.db")
    service.initialise()
    return service


def record(document_id: str, filename: str = "a.pdf", status: str = "indexed") -> DocumentRecord:
    return DocumentRecord(
        document_id=document_id,
        filename=filename,
        filepath=f"/documents/{filename}",
        file_hash=document_id,
        file_size=1234,
        modified_at=datetime(2026, 9, 20, tzinfo=UTC),
        pages=3,
        chunks=12,
        language="zh",
        title="手册",
        status=status,
        error_type=None,
        error_message=None,
        indexed_at=datetime(2026, 9, 20, 13, 0, tzinfo=UTC),
        alt_filepaths=[],
    )


class TestLifecycle:
    def test_initialise_creates_the_database_file(self, tmp_path: Path) -> None:
        path = tmp_path / "nested" / "manifest.db"
        ManifestService(path).initialise()
        assert path.exists()

    def test_initialise_is_idempotent(self, manifest: ManifestService) -> None:
        manifest.initialise()
        assert manifest.all_documents() == []

    def test_an_unknown_document_returns_none(self, manifest: ManifestService) -> None:
        assert manifest.get("z" * 64) is None


class TestUpsertAndRead:
    def test_a_document_round_trips(self, manifest: ManifestService) -> None:
        manifest.upsert(record("a" * 64))
        stored = manifest.get("a" * 64)
        assert stored is not None
        assert stored.filename == "a.pdf"
        assert stored.pages == 3
        assert stored.chunks == 12
        assert stored.language == "zh"
        assert stored.status == "indexed"
        assert stored.modified_at == datetime(2026, 9, 20, tzinfo=UTC)

    def test_upserting_twice_updates_rather_than_duplicates(
        self, manifest: ManifestService
    ) -> None:
        manifest.upsert(record("a" * 64))
        manifest.upsert(record("a" * 64, status="failed"))
        assert len(manifest.all_documents()) == 1
        stored = manifest.get("a" * 64)
        assert stored is not None
        assert stored.status == "failed"

    def test_all_documents_is_ordered_by_filename(self, manifest: ManifestService) -> None:
        manifest.upsert(record("c" * 64, filename="zebra.pdf"))
        manifest.upsert(record("a" * 64, filename="alpha.pdf"))
        manifest.upsert(record("b" * 64, filename="middle.pdf"))
        assert [d.filename for d in manifest.all_documents()] == [
            "alpha.pdf",
            "middle.pdf",
            "zebra.pdf",
        ]

    def test_alternate_paths_round_trip(self, manifest: ManifestService) -> None:
        stored = record("a" * 64)
        stored.alt_filepaths = ["/documents/copies/a.pdf", "/documents/backup/a.pdf"]
        manifest.upsert(stored)
        loaded = manifest.get("a" * 64)
        assert loaded is not None
        assert loaded.alt_filepaths == ["/documents/copies/a.pdf", "/documents/backup/a.pdf"]

    def test_known_paths_includes_the_primary_and_the_alternates(
        self, manifest: ManifestService
    ) -> None:
        stored = record("a" * 64)
        stored.alt_filepaths = ["/documents/copies/a.pdf"]
        assert stored.known_paths == ["/documents/a.pdf", "/documents/copies/a.pdf"]


class TestDeletionAndCounts:
    def test_delete_removes_a_document(self, manifest: ManifestService) -> None:
        manifest.upsert(record("a" * 64))
        manifest.delete("a" * 64)
        assert manifest.get("a" * 64) is None

    def test_deleting_an_unknown_document_is_harmless(self, manifest: ManifestService) -> None:
        manifest.delete("z" * 64)

    def test_document_ids_returns_every_stored_id(self, manifest: ManifestService) -> None:
        manifest.upsert(record("a" * 64, filename="a.pdf"))
        manifest.upsert(record("b" * 64, filename="b.pdf"))
        assert manifest.document_ids() == {"a" * 64, "b" * 64}

    def test_totals_sum_the_indexed_documents_only(self, manifest: ManifestService) -> None:
        manifest.upsert(record("a" * 64, filename="a.pdf"))
        manifest.upsert(record("b" * 64, filename="b.pdf", status="failed"))
        totals = manifest.totals()
        assert totals.documents == 1
        assert totals.chunks == 12
        assert totals.pages == 3


class TestPersistence:
    def test_data_survives_reopening_the_database(self, tmp_path: Path) -> None:
        path = tmp_path / "manifest.db"
        first = ManifestService(path)
        first.initialise()
        first.upsert(record("a" * 64))
        first.close()

        second = ManifestService(path)
        second.initialise()
        assert second.get("a" * 64) is not None

    def test_replace_all_swaps_the_whole_table(self, manifest: ManifestService) -> None:
        manifest.upsert(record("a" * 64, filename="old.pdf"))
        manifest.replace_all([record("b" * 64, filename="new.pdf")])
        assert [d.filename for d in manifest.all_documents()] == ["new.pdf"]
