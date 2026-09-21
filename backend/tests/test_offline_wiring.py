"""Embedded Qdrant: an offline install has no server to talk to."""

from __future__ import annotations

from pathlib import Path

from qdrant_client.local.qdrant_local import QdrantLocal

from app.config import Settings
from app.deps import build_qdrant_client


def test_unset_qdrant_path_gives_a_server_client() -> None:
    client = build_qdrant_client(Settings(_env_file=None))
    assert not isinstance(client._client, QdrantLocal)


def test_qdrant_path_gives_an_embedded_client_and_creates_the_directory(tmp_path: Path) -> None:
    store = tmp_path / "vectors"
    client = build_qdrant_client(Settings(_env_file=None, qdrant_path=str(store)))
    try:
        assert isinstance(client._client, QdrantLocal)
        assert store.is_dir()
    finally:
        client.close()
