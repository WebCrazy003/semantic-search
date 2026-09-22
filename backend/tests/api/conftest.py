# backend/tests/api/conftest.py
"""Builds the app with a container of fakes, so API tests need no model and no Docker."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from qdrant_client import QdrantClient

from app.config import Settings
from app.deps import Container, build_extractors
from app.main import create_app
from app.services.chunk_service import ChunkConfig, Chunker
from app.services.indexing_service import IndexingService
from app.services.manifest_service import ManifestService
from app.services.qdrant_service import QdrantService
from app.services.search_service import SearchService
from tests.conftest import CharTokenCounter, FakeEmbeddingService


@pytest.fixture
def api_documents_dir(tmp_path: Path, corpus_dir: Path) -> Path:
    target = tmp_path / "documents"
    shutil.copytree(corpus_dir, target)
    return target


@pytest.fixture
def container(tmp_path: Path, api_documents_dir: Path) -> Container:
    settings = Settings(
        _env_file=None,
        pdf_directory=str(api_documents_dir),
        manifest_path=str(tmp_path / "manifest.db"),
        default_top_k=10,
        max_top_k=100,
    )
    tokenizer = CharTokenCounter()
    embedder = FakeEmbeddingService(dimension=settings.vector_size)
    qdrant = QdrantService(
        client=QdrantClient(location=":memory:"),
        collection=settings.qdrant_collection,
        vector_size=settings.vector_size,
    )
    manifest = ManifestService(settings.manifest_path)
    chunker = Chunker(tokenizer=tokenizer, config=ChunkConfig())
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
            default_directory=settings.pdf_directory,
        ),
        search=SearchService(
            embedder=embedder,
            qdrant=qdrant,
            default_top_k=settings.default_top_k,
            max_top_k=settings.max_top_k,
        ),
    )


@pytest.fixture
def client(container: Container) -> TestClient:
    with TestClient(create_app(container=container)) as test_client:
        yield test_client
