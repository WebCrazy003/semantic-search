from pathlib import Path

import pytest

from app.config import REPO_ROOT, Settings


def test_defaults_match_the_specification() -> None:
    settings = Settings(_env_file=None)
    assert settings.qdrant_collection == "pdf_passages"
    assert settings.vector_size == 1024
    assert settings.default_top_k == 10
    assert settings.chunk_target_tokens == 300
    assert settings.chunk_max_tokens == 450
    assert settings.chunk_min_tokens == 80
    assert settings.chunk_overlap_tokens == 50
    assert settings.chunk_preserve_headings is True
    assert settings.chunk_repeat_heading is True
    assert settings.chunk_allow_cross_page is False
    assert settings.api_host == "127.0.0.1"


def test_relative_paths_resolve_against_the_repository_root() -> None:
    settings = Settings(_env_file=None, pdf_directory="./documents")
    assert settings.pdf_directory == REPO_ROOT / "documents"
    assert settings.pdf_directory.is_absolute()


def test_absolute_paths_are_left_alone(tmp_path: Path) -> None:
    settings = Settings(_env_file=None, pdf_directory=str(tmp_path))
    assert settings.pdf_directory == tmp_path


def test_env_vars_override_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEFAULT_TOP_K", "25")
    monkeypatch.setenv("CHUNK_ALLOW_CROSS_PAGE", "true")
    settings = Settings(_env_file=None)
    assert settings.default_top_k == 25
    assert settings.chunk_allow_cross_page is True


def test_max_tokens_below_target_is_rejected() -> None:
    with pytest.raises(ValueError, match="chunk_max_tokens"):
        Settings(_env_file=None, chunk_target_tokens=300, chunk_max_tokens=200)


def test_overlap_not_smaller_than_target_is_rejected() -> None:
    with pytest.raises(ValueError, match="chunk_overlap_tokens"):
        Settings(_env_file=None, chunk_target_tokens=300, chunk_overlap_tokens=300)


def test_cors_origins_parse_from_a_comma_separated_string() -> None:
    settings = Settings(_env_file=None, cors_origins="http://a.test,http://b.test")
    assert settings.cors_origin_list == ["http://a.test", "http://b.test"]


def test_qdrant_path_is_unset_by_default() -> None:
    settings = Settings(_env_file=None)
    assert settings.qdrant_path is None
    assert settings.embedded_qdrant is False


def test_blank_qdrant_path_means_use_the_server() -> None:
    """An operator who comments out the value should not get an embedded store."""
    settings = Settings(_env_file=None, qdrant_path="   ")
    assert settings.qdrant_path is None
    assert settings.embedded_qdrant is False


def test_qdrant_path_switches_to_embedded_and_resolves(tmp_path: Path) -> None:
    settings = Settings(_env_file=None, qdrant_path="./qdrant_storage")
    assert settings.qdrant_path == REPO_ROOT / "qdrant_storage"
    assert settings.embedded_qdrant is True

    absolute = Settings(_env_file=None, qdrant_path=str(tmp_path))
    assert absolute.qdrant_path == tmp_path


def test_gpu_settings_default_to_auto() -> None:
    settings = Settings(_env_file=None)
    assert settings.embedding_batch_size_gpu is None
    assert settings.embedding_precision == "auto"
    assert settings.docx_enabled is True
    assert settings.pdf_korean_midword_join == "auto"


def test_gpu_batch_size_accepts_auto_or_a_number(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDING_BATCH_SIZE_GPU", "auto")
    assert Settings(_env_file=None).embedding_batch_size_gpu is None
    monkeypatch.setenv("EMBEDDING_BATCH_SIZE_GPU", "48")
    assert Settings(_env_file=None).embedding_batch_size_gpu == 48


def test_an_unknown_precision_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDING_PRECISION", "int4")
    with pytest.raises(ValueError):
        Settings(_env_file=None)
