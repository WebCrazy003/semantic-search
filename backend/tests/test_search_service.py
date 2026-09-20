# backend/tests/test_search_service.py
import pytest
from qdrant_client import QdrantClient

from app.models.domain import Chunk
from app.models.request_models import SearchFilters, SearchRequest
from app.services.qdrant_service import QdrantService
from app.services.search_service import SearchService
from tests.conftest import FakeEmbeddingService
from tests.test_qdrant_service import meta as make_meta

DIMENSION = 1024


def chunk(document_id: str, index: int, text: str) -> Chunk:
    return Chunk(
        document_id=document_id,
        page_start=index + 1,
        page_end=index + 1,
        chunk_index=index,
        text=text,
        heading=None,
        token_count=len(text),
        kind="text",
    )


def build(texts: list[str], default_top_k: int = 10) -> SearchService:
    qdrant = QdrantService(
        client=QdrantClient(location=":memory:"),
        collection="pdf_passages",
        vector_size=DIMENSION,
    )
    qdrant.ensure_collection()
    embedder = FakeEmbeddingService(dimension=DIMENSION)
    qdrant.upsert_chunks(
        [chunk("a" * 64, index, text) for index, text in enumerate(texts)],
        embedder.embed_documents(texts),
        make_meta("a" * 64, "manual.pdf"),
    )
    return SearchService(
        embedder=embedder, qdrant=qdrant, default_top_k=default_top_k, max_top_k=100
    )


@pytest.fixture
def service() -> SearchService:
    return build(["更换滤芯的步骤", "保修条款说明", "필터 교체 절차"])


class TestSearch:
    def test_an_exact_passage_query_ranks_that_passage_first(
        self, service: SearchService
    ) -> None:
        response = service.search(SearchRequest(query="更换滤芯的步骤"))
        assert response.results[0].text == "更换滤芯的步骤"
        assert response.results[0].score > 0.99

    def test_the_response_echoes_the_query_and_counts_the_results(
        self, service: SearchService
    ) -> None:
        response = service.search(SearchRequest(query="保修条款说明"))
        assert response.query == "保修条款说明"
        assert response.count == len(response.results) == 3

    def test_duration_is_measured(self, service: SearchService) -> None:
        assert service.search(SearchRequest(query="保修")).took_ms >= 0

    def test_top_k_is_honoured(self, service: SearchService) -> None:
        assert len(service.search(SearchRequest(query="保修", top_k=2)).results) == 2

    def test_top_k_defaults_to_the_configured_value(self) -> None:
        service = build([f"第{index}段内容" for index in range(10)], default_top_k=3)
        assert len(service.search(SearchRequest(query="第1段内容")).results) == 3

    def test_top_k_above_the_maximum_is_clamped(self, service: SearchService) -> None:
        response = service.search(SearchRequest(query="保修", top_k=5000))
        assert response.count == 3  # clamped to max_top_k, then to what exists

    def test_filters_are_passed_through(self, service: SearchService) -> None:
        response = service.search(
            SearchRequest(query="保修", filters=SearchFilters(language="ko"))
        )
        assert response.count == 0

    def test_a_whitespace_only_query_is_rejected(self, service: SearchService) -> None:
        with pytest.raises(ValueError, match="empty"):
            service.search(SearchRequest(query="   "))

    def test_results_carry_every_field_the_ui_needs(self, service: SearchService) -> None:
        hit = service.search(SearchRequest(query="更换滤芯的步骤")).results[0]
        assert hit.filename == "manual.pdf"
        assert hit.page_start >= 1
        assert hit.text
        assert 0.0 <= hit.score <= 1.0
