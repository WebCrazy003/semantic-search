# backend/tests/test_accounts_upgrade.py
"""An install from before accounts keeps everything, re-embeds nothing, and the
scripts that rebuild or recover state understand owners (spec §2.4, §1.7)."""

from __future__ import annotations

import importlib.util
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

from qdrant_client import QdrantClient, models

from app.models.domain import Chunk, DocumentMeta
from app.services.access_store import AccessStore
from app.services.manifest_service import ManifestService
from app.services.passwords import verify_password
from app.services.qdrant_service import QdrantService

REPO = Path(__file__).resolve().parents[2]

_OLD_MANIFEST = """
CREATE TABLE documents (
    document_id TEXT PRIMARY KEY, filename TEXT NOT NULL, filepath TEXT NOT NULL,
    file_hash TEXT NOT NULL, file_size INTEGER NOT NULL, modified_at TEXT NOT NULL,
    pages INTEGER NOT NULL DEFAULT 0, chunks INTEGER NOT NULL DEFAULT 0, language TEXT,
    title TEXT, status TEXT NOT NULL, error_type TEXT, error_message TEXT,
    indexed_at TEXT NOT NULL, alt_filepaths TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE index_jobs (
    job_id TEXT PRIMARY KEY, trigger TEXT NOT NULL, directory TEXT NOT NULL,
    status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
    total INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0,
    indexed INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
    unsupported INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0, chunks INTEGER NOT NULL DEFAULT 0,
    failures TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO documents VALUES ('abc', 'old.pdf', '/docs/old.pdf', 'abc', 1, '2026-01-01T00:00:00+00:00',
    2, 3, 'zh', NULL, 'indexed', NULL, NULL, '2026-01-01T00:00:00+00:00', '[]');
INSERT INTO index_jobs (job_id, trigger, directory, status, started_at)
    VALUES ('j1', 'scan', '/docs', 'completed', '2026-01-01T00:00:00+00:00');
"""


def _load_script(name: str):  # noqa: ANN202
    spec = importlib.util.spec_from_file_location(name, REPO / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class TestManifestUpgrade:
    def test_an_old_manifest_gains_owner_columns_and_keeps_its_rows(self, tmp_path: Path) -> None:
        path = tmp_path / "manifest.db"
        with sqlite3.connect(path) as connection:
            connection.executescript(_OLD_MANIFEST)

        manifest = ManifestService(path)
        manifest.initialise()
        record = manifest.get("abc")
        assert record is not None
        assert (record.owner_id, record.visibility, record.chunks) == ("library", "private", 3)
        assert manifest.recent_jobs()[0].scope == "library"
        manifest.initialise()  # a second start changes nothing
        assert len(manifest.all_documents()) == 1
        manifest.close()


class TestQdrantUpgrade:
    def test_old_points_become_library_and_private_without_re_embedding(self) -> None:
        qdrant = QdrantService(QdrantClient(location=":memory:"), "c", vector_size=4)
        qdrant.ensure_collection()
        meta = DocumentMeta(
            document_id="abc",
            filename="old.pdf",
            filepath="/docs/old.pdf",
            folder="/docs",
            file_hash="abc",
            modified_at=datetime.now(UTC),
        )
        chunk = Chunk("abc", 1, 1, 0, "text", None, 1)
        payload = QdrantService._payload(chunk, meta, "library", "private")
        del payload["owner_id"], payload["visibility"]
        qdrant._client.upsert(
            "c", points=[models.PointStruct(id=1, vector=[0.1, 0.2, 0.3, 0.4], payload=payload)]
        )

        before = qdrant._client.retrieve("c", ids=[1], with_vectors=True)[0].vector

        assert qdrant.assign_unowned_to_library() == 1
        stored = qdrant._client.retrieve("c", ids=[1], with_payload=True, with_vectors=True)[0]
        assert stored.payload["owner_id"] == "library"
        assert stored.payload["visibility"] == "private"
        assert stored.payload["document_id"] == "abc"
        assert stored.vector == before  # payload only: the vector is untouched
        assert qdrant.assign_unowned_to_library() == 0


class TestRebuildManifest:
    def test_owner_and_visibility_come_back(self, tmp_path: Path) -> None:
        module = _load_script("rebuild_manifest")
        docs = tmp_path / "documents"
        payloads = [
            {"document_id": "u1doc", "filename": "a.pdf", "filepath": str(docs / "users/u1/a.pdf"),
             "file_hash": "h1", "page_end": 2, "owner_id": "u1", "visibility": "public"},
            {"document_id": "u1doc", "filename": "a.pdf", "filepath": str(docs / "users/u1/a.pdf"),
             "file_hash": "h1", "page_end": 3, "owner_id": "u1", "visibility": "public"},
            # From before accounts: owner from the path, visibility from access.db.
            {"document_id": "old", "filename": "b.pdf", "filepath": str(docs / "users/u2/b.pdf"),
             "page_end": 1},
            {"document_id": "lib", "filename": "c.pdf", "filepath": str(docs / "c.pdf"),
             "page_end": 1},
        ]
        records = {
            record.document_id: record
            for record in module.records_from_payloads(payloads, docs, public_ids={"lib"})
        }
        assert records["u1doc"].owner_id == "u1"
        assert records["u1doc"].visibility == "public"
        assert records["u1doc"].chunks == 2
        assert records["u1doc"].pages == 3
        assert records["u1doc"].file_hash == "h1"
        assert records["old"].owner_id == "u2"
        assert records["old"].visibility == "private"
        assert records["lib"].owner_id == "library"
        assert records["lib"].visibility == "public"


class TestResetAdmin:
    def test_it_restores_an_admin_who_must_change_the_password(self, tmp_path: Path) -> None:
        module = _load_script("reset_admin")
        store = AccessStore(tmp_path / "access.db")
        store.initialise()
        user = store.create_user("boss", "not-a-real-hash", role="user")
        store.update_user(user.user_id, disabled=True)

        password, created = module.reset_admin(store, "boss")
        restored = store.find_user("boss")
        assert created is False
        assert restored is not None
        assert (restored.role, restored.disabled, restored.must_change_password) == (
            "admin",
            False,
            True,
        )
        assert verify_password(password, store.password_hash(restored.user_id) or "")

    def test_it_creates_the_account_when_missing(self, tmp_path: Path) -> None:
        module = _load_script("reset_admin")
        store = AccessStore(tmp_path / "access.db")
        store.initialise()
        _, created = module.reset_admin(store, "rescuer")
        assert created is True
        assert store.find_user("rescuer").role == "admin"


class TestConcurrentUse:
    def test_many_threads_reading_sessions_at_once_get_whole_rows(self, tmp_path: Path) -> None:
        """Every request looks its session up from a threadpool; the browser sends
        several at once. Rows read by one thread must not be garbled by another."""
        from concurrent.futures import ThreadPoolExecutor
        from datetime import timedelta

        store = AccessStore(tmp_path / "access.db")
        store.initialise()
        user = store.create_user("kim", "hash", role="user")
        token = store.create_session(user.user_id, timedelta(days=30))

        def look_up(_: int) -> str | None:
            found = store.session_user(token, timedelta(days=7))
            store.list_users()
            return found.username if found else None

        with ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(look_up, range(2000)))
        assert set(results) == {"kim"}
