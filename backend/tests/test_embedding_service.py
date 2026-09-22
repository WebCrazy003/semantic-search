# backend/tests/test_embedding_service.py
import math
from pathlib import Path

import pytest

from app.config import get_settings
from app.services.embedding_service import (
    BgeEmbeddingService,
    gpu_batch_size,
    probe_device,
    resolve_device,
)
from tests.conftest import FakeEmbeddingService


class TestDeviceResolution:
    def test_explicit_device_is_returned_unchanged(self) -> None:
        assert resolve_device("cpu") == "cpu"
        assert resolve_device("mps") == "mps"

    def test_auto_resolves_to_something_torch_understands(self) -> None:
        assert resolve_device("auto") in {"cpu", "mps", "cuda"}


class _Props:
    def __init__(self, name: str, memory_gb: float) -> None:
        self.name = name
        self.total_memory = int(memory_gb * 1024**3)
        self.major, self.minor = 12, 0


@pytest.fixture
def fake_cuda(monkeypatch: pytest.MonkeyPatch):
    """Make torch believe an NVIDIA GPU is present. Returns a knob to break it."""
    import torch

    state = {"works": True, "memory_gb": 8.0, "name": "NVIDIA GeForce RTX 5060"}
    real_ones = torch.ones

    def ones(*args, device=None, **kwargs):
        if device == "cuda":
            if not state["works"]:
                raise RuntimeError("CUDA error: no kernel image is available for execution")
            return real_ones(*args, **kwargs)
        return real_ones(*args, device=device, **kwargs)

    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "synchronize", lambda: None)
    monkeypatch.setattr(torch.cuda, "empty_cache", lambda: None)
    monkeypatch.setattr(
        torch.cuda,
        "get_device_properties",
        lambda index: _Props(state["name"], state["memory_gb"]),
    )
    monkeypatch.setattr(torch, "ones", ones)
    monkeypatch.setattr(torch.version, "cuda", "13.0")
    return state


class FakeModel:
    """Stands in for SentenceTransformer; runs out of memory above a batch size."""

    def __init__(self, device: str, oom_above: int | None = None) -> None:
        self.device = device
        self.oom_above = oom_above
        self.max_seq_length = 0
        self.fp16 = False
        self.batches: list[int] = []

    def get_sentence_embedding_dimension(self) -> int:
        return 1024

    def half(self) -> None:
        self.fp16 = True

    def float(self) -> None:
        self.fp16 = False

    def to(self, device: str) -> None:
        self.device = device

    def encode(self, texts, batch_size, **kwargs):
        import numpy as np

        self.batches.append(batch_size)
        if self.device == "cuda" and self.oom_above is not None and batch_size > self.oom_above:
            raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")
        vectors = np.ones((len(texts), 1024), dtype=np.float16 if self.fp16 else np.float32)
        return vectors / np.float32(32.0)


def _service(tmp_path: Path, device: str = "auto", oom_above: int | None = None, **kwargs):
    models: list[FakeModel] = []

    def loader(path: Path, on: str) -> FakeModel:
        models.append(FakeModel(on, oom_above))
        return models[-1]

    service = BgeEmbeddingService(model_path=tmp_path, device=device, loader=loader, **kwargs)
    return service, models[-1]


class TestGpu:
    def test_an_nvidia_gpu_is_chosen_first(self, fake_cuda) -> None:
        assert probe_device("auto") == ("cuda", None)

    def test_a_gpu_that_fails_a_test_kernel_falls_back_to_cpu(self, fake_cuda) -> None:
        fake_cuda["works"] = False
        device, reason = probe_device("auto")
        assert device == "cpu"
        assert "no kernel image" in reason

    def test_asking_for_cuda_that_does_not_work_falls_back_with_a_reason(
        self, fake_cuda
    ) -> None:
        fake_cuda["works"] = False
        device, reason = probe_device("cuda")
        assert device == "cpu" and reason

    def test_batch_size_follows_graphics_memory(self) -> None:
        assert gpu_batch_size(4.0) == 8  # RTX 3050 laptop
        assert gpu_batch_size(8.0) == 16  # RTX 5060
        assert gpu_batch_size(12.0) == 32  # RTX 3060
        assert gpu_batch_size(24.0) == 64  # RTX 4090

    def test_on_the_gpu_the_model_runs_in_fp16_with_a_sized_batch(
        self, fake_cuda, tmp_path: Path
    ) -> None:
        service, model = _service(tmp_path)
        info = service.device_info()
        assert (info.device, info.name, info.precision, info.batch_size) == (
            "cuda",
            "NVIDIA GeForce RTX 5060",
            "fp16",
            16,
        )
        assert info.memory_gb == 8.0
        assert model.fp16 is True

    def test_fp16_vectors_are_renormalized_to_unit_length(
        self, fake_cuda, tmp_path: Path
    ) -> None:
        service, _ = _service(tmp_path)
        vector = service.embed_query("필터 교체")
        assert math.isclose(sum(v * v for v in vector) ** 0.5, 1.0, rel_tol=1e-6)

    def test_an_explicit_gpu_batch_size_wins(self, fake_cuda, tmp_path: Path) -> None:
        service, _ = _service(tmp_path, batch_size_gpu=48)
        assert service.device_info().batch_size == 48

    def test_precision_can_be_forced_to_fp32(self, fake_cuda, tmp_path: Path) -> None:
        service, model = _service(tmp_path, precision="fp32")
        assert service.device_info().precision == "fp32"
        assert model.fp16 is False

    def test_fp16_is_refused_on_the_cpu(self, tmp_path: Path) -> None:
        service, model = _service(tmp_path, device="cpu", precision="fp16")
        assert service.device_info().precision == "fp32"
        assert model.fp16 is False

    def test_out_of_memory_halves_the_batch_and_carries_on(
        self, fake_cuda, tmp_path: Path
    ) -> None:
        service, model = _service(tmp_path, oom_above=4)
        vectors = service.embed_documents(["a"] * 20)
        assert len(vectors) == 20
        assert model.batches == [16, 8, 4]
        assert service.device_info().device == "cuda"
        assert service.device_info().batch_size == 4  # and it stays there

    def test_out_of_memory_at_batch_one_moves_to_the_cpu(
        self, fake_cuda, tmp_path: Path
    ) -> None:
        service, model = _service(tmp_path, oom_above=0, batch_size=8)
        vectors = service.embed_documents(["a", "b"])
        assert len(vectors) == 2
        info = service.device_info()
        assert (info.device, info.precision, info.batch_size) == ("cpu", "fp32", 8)
        assert "out of memory" in info.fallback_reason
        assert model.device == "cpu" and model.fp16 is False

    def test_a_model_that_will_not_load_on_the_gpu_loads_on_the_cpu(
        self, fake_cuda, tmp_path: Path
    ) -> None:
        def loader(path: Path, on: str) -> FakeModel:
            if on == "cuda":
                raise RuntimeError("CUDA out of memory while loading")
            return FakeModel(on)

        service = BgeEmbeddingService(model_path=tmp_path, loader=loader)
        info = service.device_info()
        assert info.device == "cpu"
        assert "did not load on the GPU" in info.fallback_reason

    def test_other_errors_are_not_swallowed(self, fake_cuda, tmp_path: Path) -> None:
        service, model = _service(tmp_path)

        def broken(*args, **kwargs):
            raise ValueError("bad input")

        model.encode = broken
        with pytest.raises(ValueError):
            service.embed_query("x")


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
