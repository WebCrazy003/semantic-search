# backend/tests/api/test_accounts.py
"""Setup, sign-up, login, sessions, password changes and reset requests (spec §1)."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.api.conftest import ADMIN_NAME, CSRF, PASSWORD, login

LOOPBACK = ("127.0.0.1", 50000)
LAN = ("192.168.0.23", 50000)


def _age_sessions(container, **columns: datetime) -> None:  # noqa: ANN001
    assignments = ", ".join(f"{name} = ?" for name in columns)
    container.access._execute(
        f"UPDATE sessions SET {assignments}", [value.isoformat() for value in columns.values()]
    )


def _request_reset(anon: TestClient, username: str) -> str:
    response = anon.post("/api/auth/reset-requests", json={"username": username})
    assert response.status_code == 202, response.text
    return response.json()["request_token"]


def _status(anon: TestClient, token: str) -> str:
    return anon.post("/api/auth/reset-requests/status", json={"request_token": token}).json()[
        "status"
    ]


def _pending_id(client: TestClient, username: str) -> str:
    rows = client.get("/api/admin/reset-requests").json()
    return next(row["request_id"] for row in rows if row["username"] == username)


# ---------------------------------------------------------------------- setup


class TestSetup:
    @pytest.fixture
    def empty(self, app) -> Iterator[TestClient]:  # noqa: ANN001
        with TestClient(app, headers=CSRF, client=LOOPBACK) as test_client:
            yield test_client

    def test_a_fresh_install_asks_for_setup(self, empty: TestClient) -> None:
        body = empty.get("/api/auth/status").json()
        assert body == {"setup_required": True, "registration_open": True, "user": None}

    def test_setup_from_this_computer_creates_an_admin_and_logs_in(
        self, empty: TestClient
    ) -> None:
        response = empty.post("/api/auth/setup", json={"username": "Owner", "password": PASSWORD})
        assert response.status_code == 201
        assert response.json()["user"]["role"] == "admin"
        assert empty.get("/api/auth/me").json()["user"]["username"] == "Owner"
        assert empty.get("/api/auth/status").json()["setup_required"] is False

    def test_setup_happens_once(self, empty: TestClient) -> None:
        empty.post("/api/auth/setup", json={"username": "owner", "password": PASSWORD})
        again = empty.post("/api/auth/setup", json={"username": "other", "password": PASSWORD})
        assert again.status_code == 409

    def test_setup_from_the_network_is_refused(self, app, empty: TestClient) -> None:  # noqa: ANN001
        remote = TestClient(app, headers=CSRF, client=LAN)
        response = remote.post("/api/auth/setup", json={"username": "owner", "password": PASSWORD})
        assert response.status_code == 403
        assert "computer it is installed on" in response.json()["detail"]

    def test_nobody_can_register_before_setup(self, empty: TestClient) -> None:
        response = empty.post("/api/auth/register", json={"username": "kim", "password": PASSWORD})
        assert response.status_code == 403


# ------------------------------------------------------------------- register


class TestRegister:
    def test_a_new_account_is_logged_in_as_a_user(self, anon: TestClient) -> None:
        response = anon.post("/api/auth/register", json={"username": "Kim", "password": PASSWORD})
        assert response.status_code == 201
        assert response.json()["user"]["role"] == "user"
        assert anon.get("/api/auth/me").status_code == 200

    def test_a_username_differing_only_in_case_is_taken(self, anon: TestClient) -> None:
        anon.post("/api/auth/register", json={"username": "Kim", "password": PASSWORD})
        other = anon.post("/api/auth/register", json={"username": "kIM", "password": PASSWORD})
        assert other.status_code == 409

    @pytest.mark.parametrize("name", ["admin", "Library", "ROOT", "system"])
    def test_reserved_names_are_refused(self, anon: TestClient, name: str) -> None:
        response = anon.post("/api/auth/register", json={"username": name, "password": PASSWORD})
        assert response.status_code == 422

    @pytest.mark.parametrize("name", ["김철수", "kim chul", "ab", "-kim", "a" * 33, "kim/x"])
    def test_usernames_are_english_letters_digits_and_dot_dash_underscore(
        self, anon: TestClient, name: str
    ) -> None:
        response = anon.post("/api/auth/register", json={"username": name, "password": PASSWORD})
        assert response.status_code == 422

    def test_a_short_password_is_refused(self, anon: TestClient) -> None:
        response = anon.post("/api/auth/register", json={"username": "kim", "password": "7chars!"})
        assert response.status_code == 422

    def test_the_password_cannot_be_the_username(self, anon: TestClient) -> None:
        response = anon.post(
            "/api/auth/register", json={"username": "kimchulsoo", "password": "KimChulSoo"}
        )
        assert response.status_code == 422

    def test_closed_registration_is_refused(self, client: TestClient, anon: TestClient) -> None:
        client.put("/api/admin/auth-settings", json={"registration_open": False})
        response = anon.post("/api/auth/register", json={"username": "kim", "password": PASSWORD})
        assert response.status_code == 403
        assert anon.get("/api/auth/status").json()["registration_open"] is False


# ---------------------------------------------------------------------- login


class TestLogin:
    def test_a_wrong_password_and_an_unknown_user_look_the_same(self, anon: TestClient) -> None:
        wrong = anon.post("/api/auth/login", json={"username": ADMIN_NAME, "password": "nope-nope"})
        unknown = anon.post("/api/auth/login", json={"username": "ghost", "password": "nope-nope"})
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json() == unknown.json()

    def test_repeated_failures_never_lock_the_account(self, anon: TestClient) -> None:
        for _ in range(40):
            anon.post("/api/auth/login", json={"username": ADMIN_NAME, "password": "wrong-pass"})
        response = anon.post("/api/auth/login", json={"username": ADMIN_NAME, "password": PASSWORD})
        assert response.status_code == 200

    def test_a_disabled_account_is_told_so_only_with_the_right_password(
        self, client: TestClient, user_client, anon: TestClient
    ) -> None:
        user_client("kim")
        kim = client.get("/api/admin/users").json()
        kim_id = next(row["user_id"] for row in kim if row["username"] == "kim")
        client.patch(f"/api/admin/users/{kim_id}", json={"disabled": True})

        wrong = anon.post("/api/auth/login", json={"username": "kim", "password": "wrong-pass"})
        right = anon.post("/api/auth/login", json={"username": "kim", "password": PASSWORD})
        assert wrong.status_code == 401
        assert right.status_code == 403

    def test_logout_ends_the_session(self, user_client) -> None:
        kim = user_client("kim")
        assert kim.post("/api/auth/logout").status_code == 204
        assert kim.get("/api/auth/me").status_code == 401

    def test_the_cookie_is_http_only_and_same_site_strict(self, anon: TestClient) -> None:
        response = anon.post("/api/auth/login", json={"username": ADMIN_NAME, "password": PASSWORD})
        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie
        assert "samesite=strict" in cookie


# ------------------------------------------------------------------- sessions


class TestSessions:
    def test_an_idle_session_expires(self, client: TestClient, container) -> None:  # noqa: ANN001
        _age_sessions(container, last_seen_at=datetime.now(tz=UTC) - timedelta(days=8))
        assert client.get("/api/auth/me").status_code == 401

    def test_a_session_has_an_absolute_limit(self, client: TestClient, container) -> None:  # noqa: ANN001
        _age_sessions(container, expires_at=datetime.now(tz=UTC) - timedelta(seconds=1))
        assert client.get("/api/auth/me").status_code == 401

    def test_changing_your_password_logs_out_your_other_sessions_only(
        self, app, client: TestClient  # noqa: ANN001
    ) -> None:
        other = TestClient(app, headers=CSRF)
        login(other, ADMIN_NAME)
        response = client.post(
            "/api/auth/password",
            json={"current_password": PASSWORD, "new_password": "a brand new password"},
        )
        assert response.status_code == 204
        assert client.get("/api/auth/me").status_code == 200
        assert other.get("/api/auth/me").status_code == 401

    def test_a_wrong_current_password_is_refused(self, client: TestClient) -> None:
        response = client.post(
            "/api/auth/password",
            json={"current_password": "not it at all", "new_password": "a brand new password"},
        )
        assert response.status_code == 400


class TestCsrfHeader:
    def test_a_write_without_the_header_is_refused(self, app, client: TestClient) -> None:  # noqa: ANN001
        bare = TestClient(app)
        response = bare.post("/api/auth/login", json={"username": ADMIN_NAME, "password": PASSWORD})
        assert response.status_code == 403

    def test_reads_do_not_need_it(self, app, client: TestClient) -> None:  # noqa: ANN001
        assert TestClient(app).get("/api/auth/status").status_code == 200


class TestMustChangePassword:
    def test_everything_but_changing_it_is_refused(
        self, client: TestClient, anon: TestClient
    ) -> None:
        created = client.post("/api/admin/users", json={"username": "newbie"}).json()
        login(anon, "newbie", created["temporary_password"])

        blocked = anon.post("/api/search", json={"query": "anything"})
        assert blocked.status_code == 403
        assert blocked.json()["detail"] == "password_change_required"
        assert anon.get("/api/auth/me").json()["user"]["must_change_password"] is True

        changed = anon.post(
            "/api/auth/password",
            json={
                "current_password": created["temporary_password"],
                "new_password": "my own password now",
            },
        )
        assert changed.status_code == 204
        assert anon.post("/api/search", json={"query": "anything"}).status_code == 200


# ------------------------------------------------------------- reset requests


class TestResetRequests:
    def test_request_approve_and_complete(
        self, app, client: TestClient, user_client, anon: TestClient  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        token = _request_reset(anon, "kim")
        assert _status(anon, token) == "pending"
        assert client.get("/api/auth/me").json()["pending_reset_requests"] == 1

        approved = client.post(f"/api/admin/reset-requests/{_pending_id(client, 'kim')}/approve")
        assert approved.status_code == 204
        assert _status(anon, token) == "approved"

        done = anon.post(
            "/api/auth/reset-requests/complete",
            json={"request_token": token, "new_password": "remembered it now"},
        )
        assert done.status_code == 200
        assert done.json()["user"]["username"] == "kim"
        assert anon.get("/api/auth/me").status_code == 200
        # Every earlier session of that account is gone.
        assert kim.get("/api/auth/me").status_code == 401
        login(TestClient(app, headers=CSRF), "kim", "remembered it now")

    def test_an_unknown_username_looks_the_same_and_stores_nothing(
        self, client: TestClient, anon: TestClient
    ) -> None:
        response = anon.post("/api/auth/reset-requests", json={"username": "ghost"})
        assert response.status_code == 202
        assert set(response.json()) == {"request_token", "expires_at"}
        assert _status(anon, response.json()["request_token"]) == "pending"
        assert client.get("/api/admin/reset-requests").json() == []

    def test_it_cannot_complete_before_approval(self, user_client, anon: TestClient) -> None:
        user_client("kim")
        token = _request_reset(anon, "kim")
        response = anon.post(
            "/api/auth/reset-requests/complete",
            json={"request_token": token, "new_password": "too early for this"},
        )
        assert response.status_code == 400

    def test_an_approval_lapses_after_an_hour(
        self, client: TestClient, user_client, anon: TestClient, container  # noqa: ANN001
    ) -> None:
        user_client("kim")
        token = _request_reset(anon, "kim")
        client.post(f"/api/admin/reset-requests/{_pending_id(client, 'kim')}/approve")
        container.access._execute(
            "UPDATE reset_requests SET expires_at = ?",
            [(datetime.now(tz=UTC) - timedelta(minutes=1)).isoformat()],
        )
        assert _status(anon, token) == "expired"
        response = anon.post(
            "/api/auth/reset-requests/complete",
            json={"request_token": token, "new_password": "too late for this"},
        )
        assert response.status_code == 400

    def test_a_pending_request_expires_after_a_day(
        self, client: TestClient, user_client, anon: TestClient, container  # noqa: ANN001
    ) -> None:
        user_client("kim")
        token = _request_reset(anon, "kim")
        container.access._execute(
            "UPDATE reset_requests SET expires_at = ?",
            [(datetime.now(tz=UTC) - timedelta(seconds=1)).isoformat()],
        )
        assert _status(anon, token) == "expired"
        assert client.get("/api/admin/reset-requests").json() == []

    def test_deny(self, client: TestClient, user_client, anon: TestClient) -> None:
        user_client("kim")
        token = _request_reset(anon, "kim")
        denied = client.post(f"/api/admin/reset-requests/{_pending_id(client, 'kim')}/deny")
        assert denied.status_code == 204
        assert _status(anon, token) == "denied"
        response = anon.post(
            "/api/auth/reset-requests/complete",
            json={"request_token": token, "new_password": "should not work"},
        )
        assert response.status_code == 400

    def test_an_admin_cannot_approve_their_own_reset(
        self, client: TestClient, anon: TestClient
    ) -> None:
        _request_reset(anon, ADMIN_NAME)
        response = client.post(
            f"/api/admin/reset-requests/{_pending_id(client, ADMIN_NAME)}/approve"
        )
        assert response.status_code == 403

    def test_a_second_request_supersedes_the_first(
        self, client: TestClient, user_client, anon: TestClient
    ) -> None:
        user_client("kim")
        first = _request_reset(anon, "kim")
        second = _request_reset(anon, "kim")
        assert _status(anon, first) == "superseded"
        assert len(client.get("/api/admin/reset-requests").json()) == 1

        client.post(f"/api/admin/reset-requests/{_pending_id(client, 'kim')}/approve")
        stale = anon.post(
            "/api/auth/reset-requests/complete",
            json={"request_token": first, "new_password": "the old token's go"},
        )
        assert stale.status_code == 400
        assert _status(anon, second) == "approved"

    def test_requests_are_throttled_per_address(self, anon: TestClient) -> None:
        for _ in range(5):
            anon.post("/api/auth/reset-requests", json={"username": "ghost"})
        response = anon.post("/api/auth/reset-requests", json={"username": "ghost"})
        assert response.status_code == 429


class TestSecretsStayOutOfLogs:
    def test_no_password_or_token_is_logged(
        self, client: TestClient, user_client, anon: TestClient, caplog  # noqa: ANN001
    ) -> None:
        caplog.set_level(logging.DEBUG)
        user_client("kim")
        token = _request_reset(anon, "kim")
        client.post(f"/api/admin/reset-requests/{_pending_id(client, 'kim')}/approve")
        anon.post(
            "/api/auth/reset-requests/complete",
            json={"request_token": token, "new_password": "secret-new-password"},
        )
        generated = client.post("/api/admin/users", json={"username": "newbie"}).json()

        logged = caplog.text
        for secret in (PASSWORD, token, "secret-new-password", generated["temporary_password"]):
            assert secret not in logged
        assert "docsage_session" not in logged
