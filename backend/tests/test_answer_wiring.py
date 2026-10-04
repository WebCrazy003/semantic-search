"""Whether answers are on, from the settings and where search runs."""

import asyncio
from pathlib import Path

import pytest

from app.config import Settings
from app.deps import answers_enabled, build_answers, build_reranker
from app.services.answer_service import AnswerService

URL = "http://127.0.0.1:8081/v1"


def settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[arg-type]


def model_name(settings: Settings, device: str) -> str | None:
    """The answer model build_answers wires in, its connections closed afterwards."""
    service: AnswerService = build_answers(settings, device)
    asyncio.run(service.aclose())
    return service.model_name


@pytest.mark.parametrize("device", ["cuda", "mps"])
def test_on_with_a_model_server_and_a_gpu(device: str) -> None:
    assert answers_enabled(settings(llm_url=URL), device)
    assert model_name(settings(llm_url=URL), device) == "local"


def test_off_without_a_model_server() -> None:
    assert not answers_enabled(settings(llm_url=""), "cuda")
    assert model_name(settings(llm_url=""), "cuda") is None


def test_off_on_a_cpu_by_default() -> None:
    assert not answers_enabled(settings(llm_url=URL), "cpu")
    assert model_name(settings(llm_url=URL), "cpu") is None


def test_on_a_cpu_when_a_gpu_is_not_required() -> None:
    assert answers_enabled(settings(llm_url=URL, llm_require_gpu=False), "cpu")


def test_no_reranker_is_loaded_when_answers_are_off(tmp_path: Path) -> None:
    # The folder exists, so only the answers switch can be keeping it unloaded.
    assert build_reranker(settings(llm_url=URL, reranker_model_path=str(tmp_path)), "cpu") is None


def test_a_missing_reranker_folder_is_not_fatal(tmp_path: Path) -> None:
    missing = tmp_path / "nowhere"
    assert build_reranker(settings(llm_url=URL, reranker_model_path=str(missing)), "mps") is None
