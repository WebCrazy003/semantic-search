# backend/tests/test_qdrant_service.py
from datetime import UTC, datetime

import pytest
from qdrant_client import QdrantClient

from app.models.domain import Chunk, DocumentMeta
from app.models.request_models import SearchFilters
from app.services.qdrant_service import QdrantService, point_id_for

DIMENSION = 8  # small vectors keep the tests readable


def meta(document_id: str, filename: str, language: str | None = "zh") -> DocumentMeta:
    return DocumentMeta(
        document_id=document_id,
        filename=filename,
        filepath=f"/documents/{filename}",
        folder="/documents",
        file_hash=document_id,
        modified_at=datetime(2026, 9, 20, 12, 0, tzinfo=UTC),
        language=language,
        title="手册",
    )


def chunk(document_id: str, index: int, text: str, page: int = 1) -> Chunk:
    return Chunk(
        document_id=document_id,
        page_start=page,
        page_end=page,
        chunk_index=index,
        text=text,
        heading="第一章",
        token_count=len(text),
        kind="text",
    )


def unit_vector(seed: int) -> list[float]:
    raw = [float((seed + offset) % 7 + 1) for offset in range(DIMENSION)]
    norm = sum(value * value for value in raw) ** 0.5
    return [value / norm for value in raw]


@pytest.fixture
def service() -> QdrantService:
    service = QdrantService(
        client=QdrantClient(location=":memory:"),
        collection="pdf_passages",
        vector_size=DIMENSION,
        upsert_batch=2,
    )
    service.ensure_collection()
    return service


class TestCollection:
    def test_ensure_collection_creates_it(self, service: QdrantService) -> None:
        assert service.collection_exists() is True

    def test_ensure_collection_is_idempotent(self, service: QdrantService) -> None:
        service.ensure_collection()
        service.ensure_collection()
        assert service.count_points() == 0

    def test_a_dimension_mismatch_is_reported(self) -> None:
        client = QdrantClient(location=":memory:")
        QdrantService(client=client, collection="c", vector_size=DIMENSION).ensure_collection()
        with pytest.raises(RuntimeError, match="vector size"):
            QdrantService(client=client, collection="c", vector_size=DIMENSION + 1).ensure_collection()


class TestPointIds:
    def test_the_same_document_and_chunk_always_give_the_same_id(self) -> None:
        assert point_id_for("a" * 64, 7) == point_id_for("a" * 64, 7)

    def test_different_chunks_give_different_ids(self) -> None:
        assert point_id_for("a" * 64, 7) != point_id_for("a" * 64, 8)

    def test_different_documents_give_different_ids(self) -> None:
        assert point_id_for("a" * 64, 7) != point_id_for("b" * 64, 7)


class TestUpsert:
    def test_chunks_are_stored_with_the_required_payload_fields(
        self, service: QdrantService
    ) -> None:
        document = meta("a" * 64, "manual_zh.pdf")
        service.upsert_chunks([chunk("a" * 64, 0, "更换滤芯之前必须关闭电源。")], [unit_vector(1)], document)
        assert service.count_points() == 1

        hits = service.search(vector=unit_vector(1), top_k=1)
        hit = hits[0]
        assert hit.document_id == "a" * 64
        assert hit.filename == "manual_zh.pdf"
        assert hit.filepath == "/documents/manual_zh.pdf"
        assert hit.page_start == 1
        assert hit.page_end == 1
        assert hit.chunk_index == 0
        assert hit.text == "更换滤芯之前必须关闭电源。"
        assert hit.heading == "第一章"
        assert hit.language == "zh"
        assert hit.score > 0.99

    def test_upserting_the_same_chunks_twice_does_not_duplicate_points(
        self, service: QdrantService
    ) -> None:
        document = meta("a" * 64, "manual_zh.pdf")
        chunks = [chunk("a" * 64, index, f"第{index}段") for index in range(3)]
        vectors = [unit_vector(index) for index in range(3)]
        service.upsert_chunks(chunks, vectors, document)
        service.upsert_chunks(chunks, vectors, document)
        assert service.count_points() == 3

    def test_batches_larger_than_the_batch_size_are_all_stored(
        self, service: QdrantService
    ) -> None:
        document = meta("a" * 64, "manual_zh.pdf")
        chunks = [chunk("a" * 64, index, f"第{index}段") for index in range(5)]
        service.upsert_chunks(chunks, [unit_vector(i) for i in range(5)], document)
        assert service.count_points() == 5

    def test_mismatched_chunk_and_vector_counts_are_rejected(
        self, service: QdrantService
    ) -> None:
        with pytest.raises(ValueError, match="same length"):
            service.upsert_chunks([chunk("a" * 64, 0, "x")], [], meta("a" * 64, "m.pdf"))

    def test_upserting_nothing_is_a_no_op(self, service: QdrantService) -> None:
        service.upsert_chunks([], [], meta("a" * 64, "m.pdf"))
        assert service.count_points() == 0


class TestSearch:
    @pytest.fixture
    def populated(self, service: QdrantService) -> QdrantService:
        service.upsert_chunks(
            [chunk("a" * 64, 0, "中文内容"), chunk("a" * 64, 1, "更多中文", page=2)],
            [unit_vector(1), unit_vector(2)],
            meta("a" * 64, "manual_zh.pdf", language="zh"),
        )
        service.upsert_chunks(
            [chunk("b" * 64, 0, "한국어 내용")],
            [unit_vector(3)],
            meta("b" * 64, "manual_ko.pdf", language="ko"),
        )
        return service

    def test_top_k_limits_the_number_of_results(self, populated: QdrantService) -> None:
        assert len(populated.search(vector=unit_vector(1), top_k=2)) == 2

    def test_results_are_ordered_by_descending_score(self, populated: QdrantService) -> None:
        scores = [hit.score for hit in populated.search(vector=unit_vector(1), top_k=3)]
        assert scores == sorted(scores, reverse=True)

    def test_a_language_filter_restricts_results(self, populated: QdrantService) -> None:
        hits = populated.search(
            vector=unit_vector(1), top_k=10, filters=SearchFilters(language="ko")
        )
        assert [hit.filename for hit in hits] == ["manual_ko.pdf"]

    def test_a_document_filter_restricts_results(self, populated: QdrantService) -> None:
        hits = populated.search(
            vector=unit_vector(1), top_k=10, filters=SearchFilters(document_id="b" * 64)
        )
        assert len(hits) == 1
        assert hits[0].document_id == "b" * 64

    def test_both_filters_apply_together(self, populated: QdrantService) -> None:
        hits = populated.search(
            vector=unit_vector(1),
            top_k=10,
            filters=SearchFilters(language="zh", document_id="b" * 64),
        )
        assert hits == []

    def test_empty_filters_are_ignored(self, populated: QdrantService) -> None:
        hits = populated.search(vector=unit_vector(1), top_k=10, filters=SearchFilters())
        assert len(hits) == 3

    def test_searching_an_empty_collection_returns_nothing(
        self, service: QdrantService
    ) -> None:
        assert service.search(vector=unit_vector(1), top_k=10) == []


class TestDeletion:
    def test_deleting_a_document_removes_only_its_points(self, service: QdrantService) -> None:
        service.upsert_chunks(
            [chunk("a" * 64, 0, "甲"), chunk("a" * 64, 1, "乙")],
            [unit_vector(1), unit_vector(2)],
            meta("a" * 64, "a.pdf"),
        )
        service.upsert_chunks([chunk("b" * 64, 0, "丙")], [unit_vector(3)], meta("b" * 64, "b.pdf"))
        service.delete_document("a" * 64)
        remaining = service.search(vector=unit_vector(3), top_k=10)
        assert [hit.document_id for hit in remaining] == ["b" * 64]

    def test_deleting_an_unknown_document_is_harmless(self, service: QdrantService) -> None:
        service.delete_document("z" * 64)
        assert service.count_points() == 0


class TestPayloadIteration:
    def test_iter_document_payloads_yields_one_entry_per_point(
        self, service: QdrantService
    ) -> None:
        service.upsert_chunks(
            [chunk("a" * 64, 0, "甲"), chunk("a" * 64, 1, "乙", page=3)],
            [unit_vector(1), unit_vector(2)],
            meta("a" * 64, "a.pdf"),
        )
        payloads = list(service.iter_document_payloads())
        assert len(payloads) == 2
        assert {payload["page_end"] for payload in payloads} == {1, 3}
        assert all("text" not in payload for payload in payloads)
