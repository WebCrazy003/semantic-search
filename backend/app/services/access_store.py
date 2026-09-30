# backend/app/services/access_store.py
"""Accounts, sessions, password reset requests and which documents are public.

A separate SQLite file from the manifest on purpose. The manifest is a cache that
scripts/rebuild_manifest.py regenerates and "Clear the index" empties; nothing in here
can be recomputed from anything, so nothing ever rebuilds or clears it.

Raw session and reset tokens are never stored, only their SHA-256.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.logging_config import get_logger
from app.services.passwords import new_token, token_hash, username_key

logger = get_logger("access")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id               TEXT PRIMARY KEY,
    username              TEXT NOT NULL,
    username_key          TEXT NOT NULL UNIQUE,
    password_hash         TEXT NOT NULL,
    role                  TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    disabled              INTEGER NOT NULL DEFAULT 0,
    must_change_password  INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL,
    last_login_at         TEXT,
    password_changed_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash    TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    expires_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS reset_requests (
    request_id   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    status       TEXT NOT NULL CHECK (status IN
                   ('pending', 'approved', 'denied', 'completed', 'expired', 'superseded')),
    client_ip    TEXT,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    decided_at   TEXT,
    decided_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_reset_requests_status ON reset_requests(status);

CREATE TABLE IF NOT EXISTS public_documents (
    document_id     TEXT PRIMARY KEY,
    made_public_by  TEXT NOT NULL,
    made_public_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('registration_open', 'true');
"""

# How long an approved request stays usable. Short, because approval hands the account
# to whoever holds the token.
APPROVED_REQUEST_TTL = timedelta(hours=1)
# last_seen_at is written at most this often, so reading a session is not a write.
_TOUCH_INTERVAL = timedelta(minutes=1)


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _iso(moment: datetime) -> str:
    return moment.isoformat()


def _parse(text: str | None) -> datetime | None:
    return datetime.fromisoformat(text) if text else None


class UsernameTakenError(Exception):
    pass


class _Result:
    """The rows of one statement, already read, with the cursor's familiar methods."""

    def __init__(self, rows: list[sqlite3.Row], rowcount: int) -> None:
        self._rows = rows
        self.rowcount = rowcount

    def fetchone(self) -> sqlite3.Row | None:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[sqlite3.Row]:
        return self._rows

    def __iter__(self) -> Iterator[sqlite3.Row]:
        return iter(self._rows)


@dataclass(frozen=True)
class User:
    user_id: str
    username: str
    role: str  # user | admin
    disabled: bool
    must_change_password: bool
    created_at: datetime
    last_login_at: datetime | None
    password_changed_at: datetime

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


@dataclass(frozen=True)
class ResetRequest:
    request_id: str
    user_id: str
    username: str
    user_disabled: bool
    status: str
    client_ip: str | None
    created_at: datetime
    expires_at: datetime
    decided_at: datetime | None
    decided_by: str | None


class AccessStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._connection: sqlite3.Connection | None = None
        # One connection shared by the request threadpool and the indexing thread.
        # sqlite3 connections are not safe for concurrent use, so every call holds this.
        self._lock = threading.RLock()

    def initialise(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            connection = self._connect()
            connection.executescript(_SCHEMA)
        logger.info("access store ready at %s", self._path)

    def _connect(self) -> sqlite3.Connection:
        if self._connection is None:
            self._connection = sqlite3.connect(
                self._path, check_same_thread=False, isolation_level=None
            )
            self._connection.row_factory = sqlite3.Row
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA busy_timeout=5000")
            self._connection.execute("PRAGMA foreign_keys=ON")
        return self._connection

    def close(self) -> None:
        with self._lock:
            if self._connection is not None:
                self._connection.close()
                self._connection = None

    def _execute(self, sql: str, params: Iterable[object] = ()) -> _Result:
        """Run one statement and read its rows while still holding the lock.

        Returning the cursor instead would let the caller fetch after the lock is
        released, while another thread runs a statement on the same connection, and
        the rows come back garbled.
        """
        with self._lock:
            cursor = self._connect().execute(sql, tuple(params))
            return _Result(cursor.fetchall(), cursor.rowcount)

    def _transaction(self, statements: list[tuple[str, tuple[object, ...]]]) -> None:
        with self._lock:
            connection = self._connect()
            connection.execute("BEGIN IMMEDIATE")
            try:
                for sql, params in statements:
                    connection.execute(sql, params)
            except Exception:
                connection.execute("ROLLBACK")
                raise
            connection.execute("COMMIT")

    # ------------------------------------------------------------------ users

    def has_users(self) -> bool:
        return self._execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None

    def create_user(
        self,
        username: str,
        password_hash: str,
        role: str = "user",
        must_change_password: bool = False,
    ) -> User:
        now = _iso(_now())
        user_id = uuid.uuid4().hex
        try:
            self._execute(
                "INSERT INTO users (user_id, username, username_key, password_hash, role, "
                "must_change_password, created_at, password_changed_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    user_id,
                    username,
                    username_key(username),
                    password_hash,
                    role,
                    int(must_change_password),
                    now,
                    now,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise UsernameTakenError(username) from exc
        logger.info("created %s account %s", role, username)
        user = self.get_user(user_id)
        assert user is not None
        return user

    def get_user(self, user_id: str) -> User | None:
        row = self._execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        return _user(row) if row else None

    def find_user(self, username: str) -> User | None:
        row = self._execute(
            "SELECT * FROM users WHERE username_key = ?", (username_key(username),)
        ).fetchone()
        return _user(row) if row else None

    def password_hash(self, user_id: str) -> str | None:
        row = self._execute(
            "SELECT password_hash FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        return str(row["password_hash"]) if row else None

    def list_users(self) -> list[User]:
        rows = self._execute("SELECT * FROM users ORDER BY username_key").fetchall()
        return [_user(row) for row in rows]

    def user_ids(self) -> set[str]:
        return {str(row["user_id"]) for row in self._execute("SELECT user_id FROM users")}

    def usernames(self) -> dict[str, str]:
        """user_id → username, for labelling owners in lists."""
        return {
            str(row["user_id"]): str(row["username"])
            for row in self._execute("SELECT user_id, username FROM users")
        }

    def active_admin_count(self) -> int:
        row = self._execute(
            "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled = 0"
        ).fetchone()
        return int(row["count"])

    def update_user(
        self, user_id: str, role: str | None = None, disabled: bool | None = None
    ) -> User | None:
        if role is not None:
            self._execute("UPDATE users SET role = ? WHERE user_id = ?", (role, user_id))
        if disabled is not None:
            self._execute(
                "UPDATE users SET disabled = ? WHERE user_id = ?", (int(disabled), user_id)
            )
        return self.get_user(user_id)

    def set_password(self, user_id: str, password_hash: str, must_change: bool) -> None:
        self._execute(
            "UPDATE users SET password_hash = ?, must_change_password = ?, "
            "password_changed_at = ? WHERE user_id = ?",
            (password_hash, int(must_change), _iso(_now()), user_id),
        )

    def record_login(self, user_id: str) -> None:
        self._execute(
            "UPDATE users SET last_login_at = ? WHERE user_id = ?", (_iso(_now()), user_id)
        )

    def delete_user(self, user_id: str) -> bool:
        cursor = self._execute("DELETE FROM users WHERE user_id = ?", (user_id,))
        return bool(cursor.rowcount)

    # --------------------------------------------------------------- sessions

    def create_session(self, user_id: str, max_age: timedelta) -> str:
        token = new_token()
        now = _now()
        self._execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (token_hash(token), user_id, _iso(now), _iso(now), _iso(now + max_age)),
        )
        return token

    def session_user(self, token: str, idle: timedelta) -> User | None:
        """The user behind a session token, or None if it is unknown or expired."""
        hashed = token_hash(token)
        row = self._execute(
            "SELECT * FROM sessions WHERE token_hash = ?", (hashed,)
        ).fetchone()
        if row is None:
            return None
        now = _now()
        last_seen = datetime.fromisoformat(row["last_seen_at"])
        if now >= datetime.fromisoformat(row["expires_at"]) or now - last_seen >= idle:
            self._execute("DELETE FROM sessions WHERE token_hash = ?", (hashed,))
            return None
        if now - last_seen >= _TOUCH_INTERVAL:
            self._execute(
                "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", (_iso(now), hashed)
            )
        return self.get_user(str(row["user_id"]))

    def delete_session(self, token: str) -> None:
        self._execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))

    def revoke_sessions(self, user_id: str, keep_token: str | None = None) -> int:
        if keep_token is None:
            cursor = self._execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        else:
            cursor = self._execute(
                "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
                (user_id, token_hash(keep_token)),
            )
        return int(cursor.rowcount or 0)

    def purge_expired(self, idle: timedelta) -> int:
        """Drop expired sessions and mark lapsed reset requests. Run at startup."""
        now = _now()
        cursor = self._execute(
            "DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?",
            (_iso(now), _iso(now - idle)),
        )
        self._execute(
            "UPDATE reset_requests SET status = 'expired' "
            "WHERE status IN ('pending', 'approved') AND expires_at <= ?",
            (_iso(now),),
        )
        return int(cursor.rowcount or 0)

    # --------------------------------------------------------- reset requests

    def create_reset_request(
        self, user_id: str, client_ip: str | None, ttl: timedelta
    ) -> str:
        """A new pending request. Any open request for the same user is superseded, so
        the admin queue holds at most one per user and an old token stops working."""
        token = new_token()
        now = _now()
        self._transaction(
            [
                (
                    "UPDATE reset_requests SET status = 'superseded' "
                    "WHERE user_id = ? AND status IN ('pending', 'approved')",
                    (user_id,),
                ),
                (
                    "INSERT INTO reset_requests (request_id, user_id, token_hash, status, "
                    "client_ip, created_at, expires_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)",
                    (
                        uuid.uuid4().hex,
                        user_id,
                        token_hash(token),
                        client_ip,
                        _iso(now),
                        _iso(now + ttl),
                    ),
                ),
            ]
        )
        return token

    def reset_request_by_token(self, token: str) -> ResetRequest | None:
        return self._one_request("r.token_hash = ?", token_hash(token))

    def reset_request(self, request_id: str) -> ResetRequest | None:
        return self._one_request("r.request_id = ?", request_id)

    def pending_reset_requests(self) -> list[ResetRequest]:
        self._expire_requests()
        rows = self._execute(
            _REQUEST_SELECT + " WHERE r.status = 'pending' ORDER BY r.created_at"
        ).fetchall()
        return [_request(row) for row in rows]

    def pending_reset_count(self) -> int:
        self._expire_requests()
        row = self._execute(
            "SELECT COUNT(*) AS count FROM reset_requests WHERE status = 'pending'"
        ).fetchone()
        return int(row["count"])

    def decide_reset_request(self, request_id: str, approve: bool, admin_id: str) -> bool:
        """Approve or deny a pending request. False if it is no longer pending."""
        now = _now()
        if approve:
            cursor = self._execute(
                "UPDATE reset_requests SET status = 'approved', decided_at = ?, "
                "decided_by = ?, expires_at = ? "
                "WHERE request_id = ? AND status = 'pending' AND expires_at > ?",
                (_iso(now), admin_id, _iso(now + APPROVED_REQUEST_TTL), request_id, _iso(now)),
            )
        else:
            cursor = self._execute(
                "UPDATE reset_requests SET status = 'denied', decided_at = ?, decided_by = ? "
                "WHERE request_id = ? AND status = 'pending'",
                (_iso(now), admin_id, request_id),
            )
        return bool(cursor.rowcount)

    def complete_reset_request(self, request_id: str) -> None:
        self._execute(
            "UPDATE reset_requests SET status = 'completed' WHERE request_id = ?", (request_id,)
        )

    def supersede_reset_requests(self, user_id: str) -> None:
        self._execute(
            "UPDATE reset_requests SET status = 'superseded' "
            "WHERE user_id = ? AND status IN ('pending', 'approved')",
            (user_id,),
        )

    def _one_request(self, where: str, value: str) -> ResetRequest | None:
        self._expire_requests()
        row = self._execute(_REQUEST_SELECT + f" WHERE {where}", (value,)).fetchone()
        return _request(row) if row else None

    def _expire_requests(self) -> None:
        self._execute(
            "UPDATE reset_requests SET status = 'expired' "
            "WHERE status IN ('pending', 'approved') AND expires_at <= ?",
            (_iso(_now()),),
        )

    # ------------------------------------------------------- public documents

    def public_ids(self) -> set[str]:
        return {
            str(row["document_id"])
            for row in self._execute("SELECT document_id FROM public_documents")
        }

    def is_public(self, document_id: str) -> bool:
        row = self._execute(
            "SELECT 1 FROM public_documents WHERE document_id = ?", (document_id,)
        ).fetchone()
        return row is not None

    def make_public(self, document_ids: Iterable[str], by: str) -> None:
        now = _iso(_now())
        with self._lock:
            connection = self._connect()
            connection.executemany(
                "INSERT OR IGNORE INTO public_documents (document_id, made_public_by, "
                "made_public_at) VALUES (?, ?, ?)",
                [(document_id, by, now) for document_id in document_ids],
            )

    def make_private(self, document_ids: Iterable[str]) -> None:
        with self._lock:
            self._connect().executemany(
                "DELETE FROM public_documents WHERE document_id = ?",
                [(document_id,) for document_id in document_ids],
            )

    def carry_public(self, old_id: str, new_id: str) -> bool:
        """Keep a document public across a new version of its file. True if it was."""
        row = self._execute(
            "SELECT made_public_by FROM public_documents WHERE document_id = ?", (old_id,)
        ).fetchone()
        if row is None:
            return False
        self.make_public([new_id], by=str(row["made_public_by"]))
        return True

    # --------------------------------------------------------------- settings

    def registration_open(self) -> bool:
        return bool(self._setting("registration_open", True))

    def set_registration_open(self, value: bool) -> None:
        self._execute(
            "INSERT INTO app_settings (key, value) VALUES ('registration_open', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps(bool(value)),),
        )

    def _setting(self, key: str, default: object) -> object:
        row = self._execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default


_REQUEST_SELECT = (
    "SELECT r.*, u.username AS username, u.disabled AS user_disabled "
    "FROM reset_requests r JOIN users u ON u.user_id = r.user_id"
)


def _user(row: sqlite3.Row) -> User:
    return User(
        user_id=str(row["user_id"]),
        username=str(row["username"]),
        role=str(row["role"]),
        disabled=bool(row["disabled"]),
        must_change_password=bool(row["must_change_password"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        last_login_at=_parse(row["last_login_at"]),
        password_changed_at=datetime.fromisoformat(row["password_changed_at"]),
    )


def _request(row: sqlite3.Row) -> ResetRequest:
    return ResetRequest(
        request_id=str(row["request_id"]),
        user_id=str(row["user_id"]),
        username=str(row["username"]),
        user_disabled=bool(row["user_disabled"]),
        status=str(row["status"]),
        client_ip=row["client_ip"],
        created_at=datetime.fromisoformat(row["created_at"]),
        expires_at=datetime.fromisoformat(row["expires_at"]),
        decided_at=_parse(row["decided_at"]),
        decided_by=row["decided_by"],
    )
