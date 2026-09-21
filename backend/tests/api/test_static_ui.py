"""The API also serves the built interface, so an install needs no Node."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main
from app.deps import Container


def test_the_api_serves_the_built_interface_when_it_is_present(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, container: Container
) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>built</title>", encoding="utf-8")
    monkeypatch.setattr(main, "FRONTEND_DIST", dist)

    with TestClient(main.create_app(container=container)) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert "built" in page.text
        # The mount must not shadow the API or the docs.
        assert client.get("/api/health").status_code == 200
        assert client.get("/docs").status_code == 200


def test_without_a_build_the_api_still_starts(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, container: Container
) -> None:
    monkeypatch.setattr(main, "FRONTEND_DIST", tmp_path / "absent")
    with TestClient(main.create_app(container=container)) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/").status_code == 404
