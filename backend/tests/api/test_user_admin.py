# backend/tests/api/test_user_admin.py
"""Managing accounts, resetting passwords, publishing in bulk (spec §3)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from tests.api.conftest import ADMIN_NAME, CSRF, login


def _users(client: TestClient) -> dict[str, dict]:
    return {row["username"]: row for row in client.get("/api/admin/users").json()}


def _upload_and_index(test_client: TestClient, path: Path, name: str) -> None:
    test_client.post(
        "/api/documents/upload",
        files=[("files", (name, path.read_bytes(), "application/pdf"))],
    )
    assert test_client.post("/api/index", json={}).status_code == 202


class TestListing:
    def test_users_are_listed_with_their_counts(
        self, client: TestClient, user_client, corpus_dir: Path
    ) -> None:
        kim = user_client("kim")
        _upload_and_index(kim, corpus_dir / "manual_zh.pdf", "a.pdf")
        doc_id = kim.get("/api/documents").json()[0]["document_id"]
        client.put(f"/api/documents/{doc_id}/visibility", json={"visibility": "public"})

        row = _users(client)["kim"]
        assert row["role"] == "user"
        assert row["documents"] == 1
        assert row["public_documents"] == 1
        assert row["passages"] > 0
        assert row["last_login_at"] is not None

    def test_admins_see_owners_and_can_filter_by_them(
        self, client: TestClient, user_client, corpus_dir: Path
    ) -> None:
        kim = user_client("kim")
        _upload_and_index(kim, corpus_dir / "manual_zh.pdf", "kim.pdf")
        client.post("/api/index", json={})
        kim_id = _users(client)["kim"]["user_id"]

        rows = client.get(f"/api/documents?owner_id={kim_id}").json()
        assert [row["filename"] for row in rows] == ["kim.pdf"]
        assert rows[0]["owner_username"] == "kim"
        own = client.get(f"/api/documents?owner_id={_users(client)['boss']['user_id']}").json()
        assert len(own) == 4 and all(row["owner_username"] == "boss" for row in own)

        hits = client.post(
            "/api/search", json={"query": "manual", "top_k": 50, "filters": {"owner_id": kim_id}}
        ).json()["results"]
        assert hits and {hit["owner_username"] for hit in hits} == {"kim"}


class TestManaging:
    def test_create_user_gives_a_one_time_password_that_must_be_changed(
        self, client: TestClient, anon: TestClient
    ) -> None:
        response = client.post("/api/admin/users", json={"username": "newbie", "role": "user"})
        assert response.status_code == 201
        body = response.json()
        assert len(body["temporary_password"]) == 16
        assert body["user"]["must_change_password"] is True
        login(anon, "newbie", body["temporary_password"])

    def test_create_user_works_when_sign_up_is_closed(self, client: TestClient) -> None:
        client.put("/api/admin/auth-settings", json={"registration_open": False})
        assert client.post("/api/admin/users", json={"username": "newbie"}).status_code == 201

    def test_disabling_logs_the_user_out(self, client: TestClient, user_client) -> None:
        kim = user_client("kim")
        kim_id = _users(client)["kim"]["user_id"]
        assert client.patch(f"/api/admin/users/{kim_id}", json={"disabled": True}).status_code == 200
        assert kim.get("/api/auth/me").status_code == 401

    def test_a_disabled_users_public_documents_stay_public(
        self, client: TestClient, user_client, corpus_dir: Path
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload_and_index(kim, corpus_dir / "manual_zh.pdf", "kim.pdf")
        doc_id = kim.get("/api/documents").json()[0]["document_id"]
        client.put(f"/api/documents/{doc_id}/visibility", json={"visibility": "public"})
        client.patch(f"/api/admin/users/{_users(client)['kim']['user_id']}", json={"disabled": True})
        assert [row["filename"] for row in lee.get("/api/documents").json()] == ["kim.pdf"]

    def test_promoting_makes_an_admin(self, client: TestClient, user_client) -> None:
        kim = user_client("kim")
        kim_id = _users(client)["kim"]["user_id"]
        client.patch(f"/api/admin/users/{kim_id}", json={"role": "admin"})
        # A role change logs them out, so the new role applies from the next login.
        assert kim.get("/api/auth/me").status_code == 401
        login(kim, "kim")
        assert kim.get("/api/admin/users").status_code == 200

    def test_an_admin_cannot_act_on_their_own_account(self, client: TestClient) -> None:
        me = _users(client)[ADMIN_NAME]["user_id"]
        assert client.patch(f"/api/admin/users/{me}", json={"disabled": True}).status_code == 409
        assert client.patch(f"/api/admin/users/{me}", json={"role": "user"}).status_code == 409
        assert client.delete(f"/api/admin/users/{me}?documents=delete").status_code == 409
        assert client.post(f"/api/admin/users/{me}/reset-password", json={}).status_code == 403

    def test_another_admin_can_be_demoted(self, client: TestClient, user_client) -> None:
        user_client("second", role="admin")
        second_id = _users(client)["second"]["user_id"]
        response = client.patch(f"/api/admin/users/{second_id}", json={"role": "user"})
        assert response.status_code == 200
        assert response.json()["role"] == "user"


class TestLastAdmin:
    """Since nobody can act on their own account, the acting admin and the target are
    already two active admins, so through the API alone this guard is a backstop, for
    example against two admins demoting each other at the same moment. The count is
    forced to one to exercise it."""

    def test_the_last_active_admin_cannot_be_demoted_disabled_or_deleted(
        self, client: TestClient, user_client, container, monkeypatch  # noqa: ANN001
    ) -> None:
        user_client("second", role="admin")
        second_id = _users(client)["second"]["user_id"]
        monkeypatch.setattr(container.access, "active_admin_count", lambda: 1)

        for response in (
            client.patch(f"/api/admin/users/{second_id}", json={"role": "user"}),
            client.patch(f"/api/admin/users/{second_id}", json={"disabled": True}),
            client.delete(f"/api/admin/users/{second_id}?documents=delete"),
        ):
            assert response.status_code == 409
            assert response.json()["detail"] == "DocSage needs at least one active administrator"
        assert _users(client)["second"]["role"] == "admin"


class TestPasswords:
    def test_a_generated_reset_must_be_changed_at_next_login(
        self, client: TestClient, user_client, app  # noqa: ANN001
    ) -> None:
        kim = user_client("kim")
        kim_id = _users(client)["kim"]["user_id"]
        response = client.post(f"/api/admin/users/{kim_id}/reset-password", json={})
        temp = response.json()["temporary_password"]
        assert temp and len(temp) == 16
        assert kim.get("/api/auth/me").status_code == 401  # logged out everywhere

        fresh = TestClient(app, headers=CSRF)
        login(fresh, "kim", temp)
        assert fresh.get("/api/documents").status_code == 403

    def test_a_typed_password_without_forcing_a_change(
        self, client: TestClient, user_client, app  # noqa: ANN001
    ) -> None:
        user_client("kim")
        kim_id = _users(client)["kim"]["user_id"]
        response = client.post(
            f"/api/admin/users/{kim_id}/reset-password",
            json={"new_password": "chosen by the admin", "must_change": False},
        )
        assert response.json()["temporary_password"] is None
        fresh = TestClient(app, headers=CSRF)
        login(fresh, "kim", "chosen by the admin")
        assert fresh.post("/api/search", json={"query": "x"}).status_code == 200

    def test_a_typed_password_follows_the_rules(self, client: TestClient, user_client) -> None:
        user_client("kim")
        kim_id = _users(client)["kim"]["user_id"]
        response = client.post(
            f"/api/admin/users/{kim_id}/reset-password", json={"new_password": "short"}
        )
        assert response.status_code == 422

    def test_a_manual_reset_cancels_an_open_request(
        self, client: TestClient, user_client, anon: TestClient
    ) -> None:
        user_client("kim")
        anon.post("/api/auth/reset-requests", json={"username": "kim"})
        kim_id = _users(client)["kim"]["user_id"]
        client.post(f"/api/admin/users/{kim_id}/reset-password", json={})
        assert client.get("/api/admin/reset-requests").json() == []


class TestDeleting:
    def test_deleting_a_user_removes_everything_they_own(
        self, client: TestClient, user_client, corpus_dir: Path, container  # noqa: ANN001
    ) -> None:
        kim, lee = user_client("kim"), user_client("lee")
        _upload_and_index(kim, corpus_dir / "manual_zh.pdf", "kim.pdf")
        _upload_and_index(lee, corpus_dir / "manual_ko.pdf", "lee.pdf")
        kim_id = _users(client)["kim"]["user_id"]
        folder = container.settings.pdf_directory / "users" / kim_id
        assert folder.is_dir()

        refused = client.delete(f"/api/admin/users/{kim_id}")
        assert refused.status_code == 422

        response = client.delete(f"/api/admin/users/{kim_id}?documents=delete")
        assert response.status_code == 200
        body = response.json()
        assert body["documents_removed"] == 1
        assert body["passages_removed"] > 0
        assert body["files_removed"] == 1
        assert not folder.exists()
        assert "kim" not in _users(client)
        assert kim.get("/api/auth/me").status_code == 401
        assert [row["filename"] for row in lee.get("/api/documents").json()] == ["lee.pdf"]


class TestBulkVisibility:
    def test_publish_several_at_once(self, client: TestClient, user_client) -> None:
        client.post("/api/index", json={})
        ids = [row["document_id"] for row in client.get("/api/documents?status=indexed").json()]
        response = client.post(
            "/api/documents/visibility",
            json={"document_ids": [*ids[:2], "f" * 64], "visibility": "public"},
        )
        assert response.json() == {"updated": 2, "not_found": ["f" * 64]}
        kim = user_client("kim")
        assert len(kim.get("/api/documents").json()) == 2
