# backend/tests/test_integration_end_to_end.py
"""Real model, real Qdrant. Run with: pytest -m integration

These tests write to a dedicated collection so they never touch the real index.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from qdrant_client import QdrantClient

from app.config import get_settings
from app.deps import Container, build_extractors, chunk_config_from
from app.main import create_app
from app.models.request_models import SearchFilters, SearchRequest
from app.services.chunk_service import Chunker
from app.services.embedding_service import BgeEmbeddingService
from app.services.indexing_service import IndexingService
from app.services.manifest_service import ManifestService
from app.services.qdrant_service import QdrantService
from app.services.search_service import SearchService
from app.services.tokenizer_service import BgeTokenizer

pytestmark = pytest.mark.integration

COLLECTION = "pdf_passages_itest"


@pytest.fixture(scope="module")
def settings():
    resolved = get_settings()
    if not resolved.bge_model_path.exists():
        pytest.skip("model not downloaded; run scripts/download_model.py")
    return resolved


@pytest.fixture(scope="module")
def client_factory(settings):
    def make() -> QdrantClient:
        return QdrantClient(url=settings.qdrant_url, timeout=settings.qdrant_timeout)

    try:
        probe = make()
        probe.get_collections()
        probe.close()
    except Exception:
        pytest.skip("Qdrant is not reachable; run docker compose up -d")
    return make


@pytest.fixture(scope="module")
def model(settings):
    tokenizer = BgeTokenizer(settings.bge_model_path)
    embedder = BgeEmbeddingService(
        model_path=settings.bge_model_path,
        device=settings.embedding_device,
        batch_size=settings.embedding_batch_size,
        max_seq_length=settings.embedding_max_seq_length,
        expected_dimension=settings.vector_size,
    )
    return tokenizer, embedder


@pytest.fixture(scope="module")
def corpus(tmp_path_factory, corpus_dir: Path) -> Path:
    target = tmp_path_factory.mktemp("itest-corpus") / "documents"
    shutil.copytree(corpus_dir, target)
    return target


def build_container(settings, client_factory, model, corpus: Path, manifest_path: Path) -> Container:
    tokenizer, embedder = model
    qdrant = QdrantService(
        client=client_factory(),
        collection=COLLECTION,
        vector_size=settings.vector_size,
        upsert_batch=settings.qdrant_upsert_batch,
    )
    manifest = ManifestService(manifest_path)
    chunker = Chunker(tokenizer=tokenizer, config=chunk_config_from(settings))
    extractors = build_extractors(settings)
    return Container(
        settings=settings,
        tokenizer=tokenizer,
        embedder=embedder,
        qdrant=qdrant,
        manifest=manifest,
        chunker=chunker,
        extractors=extractors,
        indexing=IndexingService(
            extractors=extractors,
            chunker=chunker,
            embedder=embedder,
            qdrant=qdrant,
            manifest=manifest,
            default_directory=corpus,
        ),
        search=SearchService(
            embedder=embedder,
            qdrant=qdrant,
            default_top_k=settings.default_top_k,
            max_top_k=settings.max_top_k,
        ),
    )


@pytest.fixture(scope="module")
def indexed(settings, client_factory, model, corpus, tmp_path_factory):
    manifest_path = tmp_path_factory.mktemp("itest-manifest") / "manifest.db"
    container = build_container(settings, client_factory, model, corpus, manifest_path)
    container.manifest.initialise()
    admin = client_factory()
    if admin.collection_exists(COLLECTION):
        admin.delete_collection(COLLECTION)
    container.qdrant.ensure_collection()

    assert container.indexing.start(corpus, force=True)
    container.indexing.run(corpus, force=True)
    status = container.indexing.snapshot()
    assert status.status == "completed", status.failures
    assert status.indexed_documents == 3

    yield container, manifest_path, status

    container.close()
    if admin.collection_exists(COLLECTION):
        admin.delete_collection(COLLECTION)
    admin.close()


class TestIndexing:
    def test_the_corpus_is_indexed(self, indexed) -> None:
        container, _, status = indexed
        assert status.total_chunks > 0
        assert container.qdrant.count_points() == status.total_chunks

    def test_chinese_and_korean_documents_are_both_present(self, indexed) -> None:
        container, _, _ = indexed
        languages = {record.language for record in container.manifest.all_documents()}
        assert {"zh", "ko"} <= languages


class TestSameLanguageRetrieval:
    def test_a_chinese_query_finds_the_chinese_filter_passage(self, indexed) -> None:
        container, _, _ = indexed
        results = container.search.search(SearchRequest(query="如何更换滤芯", top_k=5)).results
        top = results[0]
        assert top.filename == "manual_zh.pdf"
        assert "滤芯" in top.text

    def test_a_korean_query_finds_the_korean_filter_passage(self, indexed) -> None:
        container, _, _ = indexed
        results = container.search.search(SearchRequest(query="필터 교체 방법", top_k=5)).results
        assert any(hit.filename == "manual_ko.pdf" and "필터" in hit.text for hit in results[:3])

    def test_retrieval_is_semantic_not_keyword(self, indexed) -> None:
        container, _, _ = indexed
        # The query says 保养 and 时间安排; the target page says 维护, 每周, 每月.
        results = container.search.search(SearchRequest(query="设备保养的时间安排", top_k=5)).results
        assert any("维护" in hit.text or "每月" in hit.text for hit in results)


class TestCrossLanguageRetrieval:
    def test_a_korean_query_can_reach_a_chinese_passage(self, indexed) -> None:
        container, _, _ = indexed
        results = container.search.search(
            SearchRequest(query="필터를 교체하기 전에 전원을 끄십시오", top_k=10)
        ).results
        assert any(hit.filename == "manual_zh.pdf" for hit in results)

    def test_an_english_query_can_reach_a_cjk_passage(self, indexed) -> None:
        container, _, _ = indexed
        results = container.search.search(
            SearchRequest(query="switch off the main power before replacing the filter", top_k=10)
        ).results
        assert any(hit.filename in {"manual_zh.pdf", "manual_ko.pdf"} for hit in results)


class TestFilters:
    def test_a_language_filter_restricts_to_korean(self, indexed) -> None:
        container, _, _ = indexed
        response = container.search.search(
            SearchRequest(query="압력", top_k=10, filters=SearchFilters(language="ko"))
        )
        assert response.count > 0
        assert {hit.filename for hit in response.results} == {"manual_ko.pdf"}


class TestPerformance:
    def test_a_search_completes_within_a_second(self, indexed) -> None:
        container, _, _ = indexed
        container.search.search(SearchRequest(query="warm the cache", top_k=5))  # discard
        response = container.search.search(SearchRequest(query="如何更换滤芯", top_k=10))
        assert response.took_ms < 1000, f"search took {response.took_ms}ms"


class TestPersistenceAcrossRestart:
    def test_a_fresh_process_finds_the_same_passages(
        self, indexed, settings, client_factory, model, corpus
    ) -> None:
        _, manifest_path, status = indexed
        # A brand new container, as if the backend had been restarted.
        restarted = build_container(settings, client_factory, model, corpus, manifest_path)
        restarted.manifest.initialise()
        restarted.qdrant.ensure_collection()
        try:
            assert restarted.qdrant.count_points() == status.total_chunks
            results = restarted.search.search(SearchRequest(query="如何更换滤芯", top_k=5)).results
            assert results[0].filename == "manual_zh.pdf"
            assert len(restarted.manifest.all_documents()) == 4
        finally:
            restarted.close()

    def test_a_second_run_skips_everything(self, indexed, corpus) -> None:
        container, _, _ = indexed
        assert container.indexing.start(corpus, force=False)
        container.indexing.run(corpus, force=False)
        status = container.indexing.snapshot()
        assert status.indexed_documents == 0
        assert status.skipped_documents == 3


class TestApiThroughTheRealStack:
    def test_the_api_serves_a_real_search(self, indexed) -> None:
        from fastapi.testclient import TestClient

        container, _, _ = indexed
        with TestClient(create_app(container=container)) as client:
            assert client.get("/api/health").json() == {"status": "ok"}
            ready = client.get("/api/health/ready").json()
            assert ready["status"] == "ready"
            assert ready["embedding_dimension"] == 1024

            body = client.post("/api/search", json={"query": "보증 기간", "top_k": 5}).json()
            assert body["count"] > 0
            assert body["results"][0]["filename"].endswith(".pdf")

            documents = client.get("/api/documents").json()
            assert len(documents) == 4


class TestOfflineEnforcement:
    def test_offline_environment_variables_are_set(self, settings) -> None:
        import os

        assert os.environ["HF_HUB_OFFLINE"] == "1"
        assert os.environ["TRANSFORMERS_OFFLINE"] == "1"

    def test_a_missing_model_path_fails_rather_than_downloading(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError, match="download_model"):
            BgeEmbeddingService(
                model_path=tmp_path / "absent", device="cpu", batch_size=1, max_seq_length=512
            )
