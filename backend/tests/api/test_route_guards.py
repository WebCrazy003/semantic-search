# backend/tests/api/test_route_guards.py
"""Nothing under /api is reachable without a session, except the public list (spec §1.8)
and the routes open to visitors, who read public documents only (2026-10-08 spec §1.5).

The routes are read from the app's own OpenAPI schema, not from a hand-kept list, so a
router added later without a guard fails here.
"""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

PUBLIC = {
    ("GET", "/api/health"),
    ("GET", "/api/auth/status"),
    ("POST", "/api/auth/setup"),
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/reset-requests"),
    ("POST", "/api/auth/reset-requests/status"),
    ("POST", "/api/auth/reset-requests/complete"),
}

# Answer a visitor, scoped to public documents. tests/api/test_visitors.py checks the
# scope; this only checks that the list is deliberate.
VISITORS = {
    ("POST", "/api/search"),
    ("POST", "/api/ask"),
    ("GET", "/api/health/ready"),
    ("GET", "/api/documents/{document_id}/file"),
    ("GET", "/api/documents/{document_id}/passages/{chunk_index}"),
}

ADMIN_ONLY_PREFIXES = ("/api/admin/",)
ADMIN_ONLY = {("POST", "/api/index/clear")}


def _routes(app) -> list[tuple[str, str]]:  # noqa: ANN001
    return [
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        if path.startswith("/api/")
        for method in operations
    ]


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x" * 64, path)


def _call(test_client: TestClient, method: str, path: str) -> int:
    return test_client.request(method, _concrete(path), json={}).status_code


def test_the_public_list_is_real(app) -> None:  # noqa: ANN001
    assert PUBLIC | VISITORS <= set(_routes(app))


def test_every_other_route_needs_a_session(app, anon: TestClient) -> None:  # noqa: ANN001
    guarded = [route for route in _routes(app) if route not in PUBLIC | VISITORS]
    assert guarded, "expected guarded routes"
    for method, path in guarded:
        assert _call(anon, method, path) == 401, f"{method} {path} answered without a session"


def test_admin_routes_refuse_a_regular_user(app, user_client) -> None:  # noqa: ANN001
    kim = user_client("kim")
    admin_only = [
        route
        for route in _routes(app)
        if route[1].startswith(ADMIN_ONLY_PREFIXES) or route in ADMIN_ONLY
    ]
    assert len(admin_only) > 10
    for method, path in admin_only:
        assert _call(kim, method, path) == 403, f"{method} {path} let a regular user through"


@pytest.mark.parametrize("method,path", sorted(PUBLIC))
def test_public_routes_answer_without_a_session(
    anon: TestClient, method: str, path: str
) -> None:
    assert _call(anon, method, path) != 401


@pytest.mark.parametrize("method,path", sorted(VISITORS))
def test_visitor_routes_answer_without_a_session(
    anon: TestClient, method: str, path: str
) -> None:
    assert _call(anon, method, path) != 401
