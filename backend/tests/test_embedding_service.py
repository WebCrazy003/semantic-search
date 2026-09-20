# backend/tests/test_embedding_service.py
import math
from pathlib import Path

import pytest

from app.config import get_settings
from app.services.embedding_service import BgeEmbeddingService, resolve_device
from tests.conftest import FakeEmbeddingService


class TestDeviceResolution:
    def test_explicit_device_is_returned_unchanged(self) -> None:
        assert resolve_device("cpu") == "cpu"
        assert resolve_device("mps") == "mps"

    def test_auto_resolves_to_something_torch_understands(self) -> None:
        assert resolve_device("auto") in {"cpu", "mps", "cuda"}


class TestFake:
    def test_the_fake_satisfies_the_protocol_shape(self) -> None:
        fake = FakeEmbeddingService()
        vectors = fake.embed_documents(["a", "b"])
        assert len(vectors) == 2
        assert len(vectors[0]) == 1024
        assert math.isclose(sum(v * v for v in vectors[0]) ** 0.5, 1.0, rel_tol=1e-6)

    def test_the_fake_is_deterministic(self) -> None:
        assert FakeEmbeddingService().embed_query("x") == FakeEmbeddingService().embed_query("x")


@pytest.fixture(scope="module")
def service() -> BgeEmbeddingService:
    settings = get_settings()
    if not settings.bge_model_path.exists():
        pytest.skip("model not downloaded; run scripts/download_model.py")
    return BgeEmbeddingService(
        model_path=settings.bge_model_path,
        device="cpu",
        batch_size=4,
        max_seq_length=512,
    )


@pytest.mark.integration
class TestRealModel:
    def test_dimension_is_1024(self, service: BgeEmbeddingService) -> None:
        assert service.dimension == 1024

    def test_document_vectors_are_l2_normalized(self, service: BgeEmbeddingService) -> None:
        vectors = service.embed_documents(["更换滤芯", "필터 교체"])
        for vector in vectors:
            assert len(vector) == 1024
            assert math.isclose(sum(v * v for v in vector) ** 0.5, 1.0, rel_tol=1e-4)

    def test_query_vectors_are_l2_normalized(self, service: BgeEmbeddingService) -> None:
        vector = service.embed_query("如何更换滤芯")
        assert math.isclose(sum(v * v for v in vector) ** 0.5, 1.0, rel_tol=1e-4)

    def test_query_and_document_paths_embed_identical_text_identically(
        self, service: BgeEmbeddingService
    ) -> None:
        # Proves no instruction prefix is being added on either side.
        text = "更换滤芯之前必须关闭主电源。"
        from_query = service.embed_query(text)
        from_document = service.embed_documents([text])[0]
        similarity = sum(a * b for a, b in zip(from_query, from_document, strict=True))
        assert math.isclose(similarity, 1.0, rel_tol=1e-4)

    def test_a_chinese_query_is_closer_to_its_korean_translation_than_to_unrelated_text(
        self, service: BgeEmbeddingService
    ) -> None:
        query = service.embed_query("필터 교체 방법")
        translation, unrelated = service.embed_documents(
            [
                "在更换滤芯之前，必须先关闭主电源开关。",
                "本设备自购买之日起提供两年保修服务。",
            ]
        )
        close = sum(a * b for a, b in zip(query, translation, strict=True))
        far = sum(a * b for a, b in zip(query, unrelated, strict=True))
        assert close > far

    def test_batching_produces_the_same_vectors_as_one_at_a_time(
        self, service: BgeEmbeddingService
    ) -> None:
        texts = [f"第{index}段测试内容。" for index in range(9)]
        batched = service.embed_documents(texts)
        individually = [service.embed_documents([text])[0] for text in texts]
        for left, right in zip(batched, individually, strict=True):
            similarity = sum(a * b for a, b in zip(left, right, strict=True))
            assert math.isclose(similarity, 1.0, rel_tol=1e-3)

    def test_embedding_an_empty_list_returns_an_empty_list(
        self, service: BgeEmbeddingService
    ) -> None:
        assert service.embed_documents([]) == []

    def test_an_empty_query_is_rejected(self, service: BgeEmbeddingService) -> None:
        with pytest.raises(ValueError, match="empty"):
            service.embed_query("   ")


def test_a_missing_model_directory_fails_fast(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="download_model"):
        BgeEmbeddingService(
            model_path=tmp_path / "nope", device="cpu", batch_size=4, max_seq_length=512
        )
