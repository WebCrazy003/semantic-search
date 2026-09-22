# backend/tests/test_indexing_service.py
import shutil
from pathlib import Path

import pytest
from qdrant_client import QdrantClient

from app.services.chunk_service import ChunkConfig, Chunker
from app.services.extractors import ExtractorRegistry
from app.services.indexing_service import IndexingService
from app.services.manifest_service import ManifestService
from app.services.pdf_service import PdfService
from app.services.qdrant_service import QdrantService
from tests.conftest import CharTokenCounter, FakeEmbeddingService

DIMENSION = 1024


@pytest.fixture
def qdrant() -> QdrantService:
    service = QdrantService(
        client=QdrantClient(location=":memory:"),
        collection="pdf_passages",
        vector_size=DIMENSION,
    )
    service.ensure_collection()
    return service


@pytest.fixture
def manifest(tmp_path: Path) -> ManifestService:
    service = ManifestService(tmp_path / "manifest.db")
    service.initialise()
    return service


@pytest.fixture
def documents_dir(tmp_path: Path, corpus_dir: Path) -> Path:
    target = tmp_path / "documents"
    shutil.copytree(corpus_dir, target)
    return target


@pytest.fixture
def indexer(
    qdrant: QdrantService, manifest: ManifestService, documents_dir: Path
) -> IndexingService:
    return IndexingService(
        extractors=ExtractorRegistry([PdfService(min_document_chars=20, extract_tables=True)]),
        chunker=Chunker(tokenizer=CharTokenCounter(), config=ChunkConfig()),
        embedder=FakeEmbeddingService(dimension=DIMENSION),
        qdrant=qdrant,
        manifest=manifest,
        default_directory=documents_dir,
    )


def run(indexer: IndexingService, directory: Path | None = None, force: bool = False):
    assert indexer.start(directory, force) is True
    indexer.run(directory, force)
    return indexer.snapshot()


class TestFirstRun:
    def test_every_supported_document_is_indexed(self, indexer: IndexingService) -> None:
        status = run(indexer)
        assert status.status == "completed"
        assert status.total_documents == 4
        assert status.indexed_documents == 3
        assert status.unsupported_documents == 1
        assert status.failed_documents == 0
        assert status.total_chunks > 0

    def test_points_land_in_qdrant(self, indexer: IndexingService, qdrant: QdrantService) -> None:
        status = run(indexer)
        assert qdrant.count_points() == status.total_chunks

    def test_the_manifest_records_pages_and_chunks(
        self, indexer: IndexingService, manifest: ManifestService
    ) -> None:
        run(indexer)
        records = {record.filename: record for record in manifest.all_documents()}
        assert records["manual_zh.pdf"].status == "indexed"
        assert records["manual_zh.pdf"].pages == 3
        assert records["manual_zh.pdf"].chunks > 0
        assert records["manual_zh.pdf"].language == "zh"
        assert records["manual_ko.pdf"].language == "ko"

    def test_an_image_only_pdf_is_marked_unsupported_not_failed(
        self, indexer: IndexingService, manifest: ManifestService
    ) -> None:
        run(indexer)
        record = next(
            r for r in manifest.all_documents() if r.filename == "empty_scan_zh.pdf"
        )
        assert record.status == "unsupported"
        assert record.chunks == 0
        assert "scanned" in (record.error_message or "")

    def test_timestamps_are_set(self, indexer: IndexingService) -> None:
        status = run(indexer)
        assert status.started_at is not None
        assert status.finished_at is not None
        assert status.finished_at >= status.started_at


class TestRepeatRuns:
    def test_unchanged_files_are_skipped(self, indexer: IndexingService) -> None:
        run(indexer)
        status = run(indexer)
        assert status.indexed_documents == 0
        assert status.skipped_documents == 3
        assert status.unsupported_documents == 1

    def test_skipping_does_not_change_the_point_count(
        self, indexer: IndexingService, qdrant: QdrantService
    ) -> None:
        first = run(indexer)
        run(indexer)
        assert qdrant.count_points() == first.total_chunks

    def test_force_reindexes_everything_without_duplicating_points(
        self, indexer: IndexingService, qdrant: QdrantService
    ) -> None:
        first = run(indexer)
        second = run(indexer, force=True)
        assert second.indexed_documents == 3
        assert second.skipped_documents == 0
        assert qdrant.count_points() == first.total_chunks


class TestDuplicates:
    """Identical bytes in two places is one document with two known paths.

    These assertions deliberately never name which path becomes the primary one: that
    depends on directory walk order, which is not a behaviour worth pinning.
    """

    def test_identical_content_in_two_folders_is_indexed_once(
        self, indexer: IndexingService, documents_dir: Path, manifest: ManifestService
    ) -> None:
        copies = documents_dir / "copies"
        copies.mkdir()
        shutil.copy(documents_dir / "manual_zh.pdf", copies / "manual_zh_copy.pdf")
        status = run(indexer)
        assert status.total_documents == 5
        assert status.indexed_documents == 3
        assert status.skipped_documents == 1
        assert len(manifest.all_documents()) == 4

    def test_both_paths_are_recorded_against_one_document(
        self, indexer: IndexingService, documents_dir: Path, manifest: ManifestService
    ) -> None:
        original = documents_dir / "manual_zh.pdf"
        copies = documents_dir / "copies"
        copies.mkdir()
        duplicate = copies / "manual_zh_copy.pdf"
        shutil.copy(original, duplicate)

        run(indexer)
        document_id = PdfService.compute_file_hash(original)
        record = manifest.get(document_id)
        assert record is not None
        assert set(record.known_paths) == {str(original), str(duplicate)}

    def test_the_duplicate_contributes_no_extra_points(
        self, indexer: IndexingService, documents_dir: Path, qdrant: QdrantService
    ) -> None:
        baseline = run(indexer).total_chunks
        copies = documents_dir / "copies"
        copies.mkdir()
        shutil.copy(documents_dir / "manual_zh.pdf", copies / "manual_zh_copy.pdf")
        run(indexer)
        assert qdrant.count_points() == baseline


def rewrite_with_one_page_removed(path: Path, scratch: Path) -> None:
    """Change a PDF's content, and so its hash, keeping it a valid and unique PDF.

    Copying another fixture over it would produce identical bytes and so be treated as
    a duplicate rather than a modification, which is not what these tests are about.
    """
    import fitz

    staged = scratch / "staged.pdf"
    with fitz.open(path) as document:
        document.delete_page(0)
        document.save(str(staged))
    path.write_bytes(staged.read_bytes())


class TestModifiedAndDeletedFiles:
    def test_a_modified_file_replaces_its_old_points(
        self,
        indexer: IndexingService,
        documents_dir: Path,
        manifest: ManifestService,
        tmp_path: Path,
    ) -> None:
        target = documents_dir / "manual_zh.pdf"
        run(indexer)
        old_id = PdfService.compute_file_hash(target)
        assert manifest.get(old_id) is not None

        rewrite_with_one_page_removed(target, tmp_path)
        new_id = PdfService.compute_file_hash(target)
        assert new_id != old_id

        status = run(indexer)
        assert status.indexed_documents == 1
        assert status.deleted_documents == 1
        assert manifest.get(old_id) is None
        updated = manifest.get(new_id)
        assert updated is not None
        assert updated.pages == 2  # one page was removed
        assert updated.filename == "manual_zh.pdf"

    def test_the_old_points_are_gone_from_qdrant(
        self, indexer: IndexingService, documents_dir: Path, qdrant: QdrantService, tmp_path: Path
    ) -> None:
        target = documents_dir / "manual_zh.pdf"
        run(indexer)
        old_id = PdfService.compute_file_hash(target)
        rewrite_with_one_page_removed(target, tmp_path)
        run(indexer)
        stored_ids = {payload["document_id"] for payload in qdrant.iter_document_payloads()}
        assert old_id not in stored_ids
        assert PdfService.compute_file_hash(target) in stored_ids

    def test_a_deleted_file_has_its_points_removed(
        self, indexer: IndexingService, documents_dir: Path, qdrant: QdrantService
    ) -> None:
        run(indexer)
        (documents_dir / "manual_ko.pdf").unlink()
        status = run(indexer)
        assert status.deleted_documents == 1
        filenames = {payload["filename"] for payload in qdrant.iter_document_payloads()}
        assert "manual_ko.pdf" not in filenames

    def test_a_deleted_file_leaves_the_manifest(
        self, indexer: IndexingService, documents_dir: Path, manifest: ManifestService
    ) -> None:
        run(indexer)
        (documents_dir / "manual_ko.pdf").unlink()
        run(indexer)
        assert "manual_ko.pdf" not in {r.filename for r in manifest.all_documents()}

    def test_deleting_one_of_two_duplicate_paths_keeps_the_document(
        self, indexer: IndexingService, documents_dir: Path, qdrant: QdrantService
    ) -> None:
        original = documents_dir / "manual_zh.pdf"
        copies = documents_dir / "copies"
        copies.mkdir()
        duplicate = copies / "manual_zh_copy.pdf"
        shutil.copy(original, duplicate)
        run(indexer)
        document_id = PdfService.compute_file_hash(original)

        duplicate.unlink()
        status = run(indexer)
        assert status.deleted_documents == 0
        stored_ids = {payload["document_id"] for payload in qdrant.iter_document_payloads()}
        assert document_id in stored_ids


class TestErrorIsolation:
    def test_a_corrupt_pdf_does_not_stop_the_other_documents(
        self, indexer: IndexingService, documents_dir: Path
    ) -> None:
        (documents_dir / "broken.pdf").write_bytes(b"%PDF-1.7\nnot actually a pdf")
        status = run(indexer)
        assert status.failed_documents == 1
        assert status.indexed_documents == 3
        assert status.status == "completed"

    def test_the_failure_is_reported_with_detail(
        self, indexer: IndexingService, documents_dir: Path
    ) -> None:
        (documents_dir / "broken.pdf").write_bytes(b"%PDF-1.7\nnot actually a pdf")
        status = run(indexer)
        failure = next(f for f in status.failures if f.filename == "broken.pdf")
        assert failure.filepath.endswith("broken.pdf")
        assert failure.error_type
        assert failure.error_message
        assert failure.timestamp is not None

    def test_a_failed_document_is_retried_on_the_next_run(
        self, indexer: IndexingService, documents_dir: Path
    ) -> None:
        (documents_dir / "broken.pdf").write_bytes(b"%PDF-1.7\nnot actually a pdf")
        run(indexer)
        status = run(indexer)
        assert status.failed_documents == 1  # retried, not silently skipped


class TestDirectoryHandling:
    def test_an_empty_directory_completes_with_nothing_indexed(
        self, indexer: IndexingService, tmp_path: Path
    ) -> None:
        empty = tmp_path / "empty"
        empty.mkdir()
        status = run(indexer, directory=empty)
        assert status.status == "completed"
        assert status.total_documents == 0

    def test_a_missing_directory_fails_cleanly(
        self, indexer: IndexingService, tmp_path: Path
    ) -> None:
        status = run(indexer, directory=tmp_path / "does-not-exist")
        assert status.status == "failed"
        assert status.failures
        assert "directory" in status.failures[0].error_message

    def test_nested_folders_are_scanned(
        self, indexer: IndexingService, documents_dir: Path
    ) -> None:
        nested = documents_dir / "contracts" / "2026"
        nested.mkdir(parents=True)
        shutil.copy(documents_dir / "manual_ko.pdf", nested / "contract_ko.pdf")
        status = run(indexer)
        # Same bytes, so it is a duplicate, but it was still discovered.
        assert status.total_documents == 5

    def test_hidden_and_resource_fork_files_are_ignored(
        self, indexer: IndexingService, documents_dir: Path
    ) -> None:
        (documents_dir / "._manual_zh.pdf").write_bytes(b"resource fork junk")
        (documents_dir / ".hidden.pdf").write_bytes(b"hidden junk")
        status = run(indexer)
        assert status.total_documents == 4
        assert status.failed_documents == 0

    def test_uppercase_extensions_are_discovered(
        self, indexer: IndexingService, documents_dir: Path, corpus_dir: Path
    ) -> None:
        shutil.copy(corpus_dir / "manual_zh.pdf", documents_dir / "UPPER.PDF")
        status = run(indexer)
        assert status.total_documents == 5


class TestConcurrency:
    def test_start_refuses_a_second_run_while_one_is_reserved(
        self, indexer: IndexingService
    ) -> None:
        assert indexer.start(None, False) is True
        assert indexer.start(None, False) is False
        indexer.run(None, False)  # releases the reservation
        assert indexer.start(None, False) is True

    def test_snapshot_reports_running_between_start_and_run(
        self, indexer: IndexingService
    ) -> None:
        indexer.start(None, False)
        assert indexer.snapshot().status == "running"
        indexer.run(None, False)
        assert indexer.snapshot().status == "completed"

    def test_snapshot_before_any_run_is_idle(self, indexer: IndexingService) -> None:
        status = indexer.snapshot()
        assert status.status == "idle"
        assert status.total_documents == 0


class TestLiveProgress:
    """The UI needs numbers that move while a run is in flight, not only at the end."""

    def test_passages_are_counted_while_a_document_is_still_being_embedded(
        self, indexer: IndexingService, corpus_dir: Path
    ) -> None:
        seen: list[int] = []

        original = indexer._embedder.embed_documents

        def spy(texts: list[str]) -> list[list[float]]:
            seen.append(indexer.snapshot().total_chunks)
            return original(texts)

        indexer._embedder.embed_documents = spy  # type: ignore[method-assign]
        run(indexer)

        # The counter seen by the second and later batches already includes earlier ones.
        assert seen, "the fake embedder was never called"
        assert indexer.snapshot().total_chunks > max(seen)

    def test_the_current_file_and_stage_are_reported_during_a_run(
        self, indexer: IndexingService
    ) -> None:
        stages: list[tuple[str | None, str | None]] = []

        original = indexer._chunker.chunk_document

        def spy(document):  # type: ignore[no-untyped-def]
            snapshot = indexer.snapshot()
            stages.append((snapshot.current_file, snapshot.current_stage))
            return original(document)

        indexer._chunker.chunk_document = spy  # type: ignore[method-assign]
        run(indexer)

        assert any(name and stage for name, stage in stages)
        assert all(stage == "splitting into passages" for _, stage in stages)

    def test_nothing_is_left_in_progress_once_the_run_ends(
        self, indexer: IndexingService
    ) -> None:
        status = run(indexer)
        assert status.current_file is None
        assert status.current_stage is None
        assert status.current_file_progress == 0.0

    def test_within_file_progress_reaches_the_end_of_each_document(
        self, indexer: IndexingService
    ) -> None:
        # Sampled as each document is filed away, which is the moment after its last
        # batch of passages has been written.
        progress: list[float] = []

        original = indexer._store_record

        def spy(*args, **kwargs):  # type: ignore[no-untyped-def]
            progress.append(indexer.snapshot().current_file_progress)
            return original(*args, **kwargs)

        indexer._store_record = spy  # type: ignore[method-assign]
        run(indexer)

        assert progress
        assert max(progress) == 1.0


class TestWordDocuments:
    @pytest.fixture
    def mixed_indexer(
        self, qdrant: QdrantService, manifest: ManifestService, tmp_path: Path, docx_dir: Path,
        corpus_dir: Path,
    ) -> tuple[IndexingService, Path]:
        from app.services.docx_service import DocxService

        folder = tmp_path / "mixed"
        folder.mkdir()
        shutil.copy(corpus_dir / "manual_zh.pdf", folder)
        shutil.copy(docx_dir / "manual_ko.docx", folder)
        shutil.copy(docx_dir / "locked.docx", folder)
        (folder / "~$manual_ko.docx").write_bytes(b"Word's lock file")
        (folder / "notes.doc").write_bytes(b"legacy")
        indexer = IndexingService(
            extractors=ExtractorRegistry([PdfService(), DocxService()]),
            chunker=Chunker(tokenizer=CharTokenCounter(), config=ChunkConfig()),
            embedder=FakeEmbeddingService(dimension=DIMENSION),
            qdrant=qdrant,
            manifest=manifest,
            default_directory=folder,
        )
        return indexer, folder

    def test_pdf_and_docx_are_indexed_together(
        self, mixed_indexer: tuple[IndexingService, Path], manifest: ManifestService
    ) -> None:
        indexer, folder = mixed_indexer
        assert indexer.start(folder)
        indexer.run(folder)
        status = indexer.snapshot()
        assert status.total_documents == 3  # the lock file and the .doc are not found
        assert status.indexed_documents == 2
        assert status.unsupported_documents == 1
        by_name = {record.filename: record for record in manifest.all_documents()}
        assert by_name["manual_ko.docx"].status == "indexed"
        assert by_name["manual_ko.docx"].pages == 2
        assert by_name["locked.docx"].status == "unsupported"
