# backend/tests/api/conftest.py
"""Builds the app with a container of fakes, so API tests need no model and no Docker.

`client` is logged in as an administrator, who can reach every route, so the tests that
predate accounts keep testing what they always did. The corpus is copied into the
documents folder and becomes that admin's uploads, as setup does with files already there. `anon` has no session, and
`user_client("kim")` is a fresh regular user with their own session.
"""

from __future__ import annotations

import shutil
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from qdrant_client import QdrantClient

from app.config import Settings
from app.deps import Container, build_extractors
from app.main import create_app
from app.services.access_store import AccessStore
from app.services.chunk_service import ChunkConfig, Chunker
from app.services.device_usage import DeviceUsageMonitor
from app.services.indexing_service import IndexingService
from app.services.library_migration import adopt_library
from app.services.manifest_service import ManifestService
from app.services.ownership import user_folder
from app.services.passwords import hash_password
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
        access_db_path=str(tmp_path / "access.db"),
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
    access = AccessStore(settings.access_db_path)
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
            access=access,
        ),
        search=SearchService(
            embedder=embedder,
            qdrant=qdrant,
            default_top_k=settings.default_top_k,
            max_top_k=settings.max_top_k,
        ),
        access=access,
        device_monitor=DeviceUsageMonitor(device="cpu", name="CPU"),
    )


CSRF = {"X-DocSage": "1"}
ADMIN_NAME = "boss"
PASSWORD = "correct horse battery"


@pytest.fixture
def app(container: Container):  # noqa: ANN201
    return create_app(container=container)


@pytest.fixture
def client(app, container: Container) -> Iterator[TestClient]:  # noqa: ANN001
    """An administrator. Entering it runs the app's startup, which the others rely on."""
    with TestClient(app, headers=CSRF) as test_client:
        container.access.create_user(ADMIN_NAME, hash_password(PASSWORD), role="admin")
        adopt_library(container)
        login(test_client, ADMIN_NAME)
        yield test_client


@pytest.fixture
def admin_dir(client: TestClient, container: Container) -> Path:
    """The admin's upload folder, where the corpus is once `client` has started."""
    admin = container.access.find_user(ADMIN_NAME)
    assert admin is not None
    return user_folder(container.settings.pdf_directory, admin.user_id)


@pytest.fixture
def anon(app, client: TestClient) -> TestClient:  # noqa: ANN001
    """No session. Depends on `client` only so the app has started."""
    return TestClient(app, headers=CSRF)


@pytest.fixture
def user_client(app, client: TestClient, container: Container) -> Callable[..., TestClient]:  # noqa: ANN001
    """Make a regular user (or another admin) and return a client logged in as them."""

    def make(username: str, role: str = "user") -> TestClient:
        container.access.create_user(username, hash_password(PASSWORD), role=role)
        other = TestClient(app, headers=CSRF)
        login(other, username)
        return other

    return make


def login(test_client: TestClient, username: str, password: str = PASSWORD) -> None:
    response = test_client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text
