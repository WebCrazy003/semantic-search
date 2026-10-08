# Accounts, document ownership and admin user management: Spec

**Date:** 2026-09-29
**Branch:** `main` (following the house convention of the previous specs)
**Status:** Implemented 2026-09-30 (all four slices)

Four things, delivered as four slices:

1. **Accounts and sessions** — setup, register, log in, log out, change a password, and
   reset one by username with an admin's approval
2. **Ownership, visibility and isolation** — every document has an owner and is private
   or public; a user sees and searches their own documents plus public ones
3. **Administration** — admins manage users, approve password resets, see every document
   and make any of them public; Settings and Admin become admin-only
4. **Documentation** — user spec, README, Windows notes

Slices 1 and 2 must ship **together**. After slice 1 alone every logged-in user still sees
every document, which is worse than no login at all because it looks private and isn't.
Slice 1 may land on `main` behind no flag only if slice 2 follows before the next
`prepare-offline.bat` release.

---

## 0. Current state (checked against the code)

| Area | Today | Where |
|---|---|---|
| Identity | None. Every request is anonymous and can do everything | — |
| Route protection | None. No dependency guards any router | [main.py:71](backend/app/main.py:71) |
| Reachability | Loopback by default; `run.bat lan` binds `0.0.0.0` "with no login" | [run.bat:4](windows/run.bat:4), [run.bat:22](windows/run.bat:22) |
| Document id | `document_id = file_hash` — content-addressed, owner-free | [indexing_service.py:229](backend/app/services/indexing_service.py:229) |
| Duplicates | Same content in two places is indexed once; extra paths go to `alt_filepaths` | [indexing_service.py:345](backend/app/services/indexing_service.py:345) |
| Uploads | Copied into the root of `PDF_DIRECTORY`, no record of who sent them | [documents.py:72](backend/app/api/documents.py:72) |
| Index request | Accepts **any** `directory` from the client | [request_models.py:25](backend/app/models/request_models.py:25) |
| Sweep | Deletes every manifest id not seen in *this* run, whatever the run's scope | [indexing_service.py:292](backend/app/services/indexing_service.py:292) |
| Search | One Qdrant query, optional `language` / `document_id` filters from the client | [qdrant_service.py:194](backend/app/services/qdrant_service.py:194) |
| Qdrant payload | No owner or visibility field. Keyword indexes on `document_id`, `filename`, `language` | [qdrant_service.py:29](backend/app/services/qdrant_service.py:29) |
| Manifest | SQLite, documented as a **derived cache** rebuilt from Qdrant | [manifest_service.py:2](backend/app/services/manifest_service.py:2) |
| Folders | Any caller can register any absolute path on the machine | [folders.py:41](backend/app/api/folders.py:41) |
| Settings page | UI preferences in `localStorage`, device status, a link to Admin | [SettingsPage.tsx](frontend/src/pages/SettingsPage.tsx), [settings.ts:1](frontend/src/settings/settings.ts:1) |
| Admin page | Extraction, passages and index-schema inspectors, open to anyone | [AdminPage.tsx](frontend/src/pages/AdminPage.tsx), [admin.py](backend/app/api/admin.py) |
| API client | `fetch` with no credentials handling; errors become `Error(detail)` | [api.ts:177](frontend/src/services/api.ts:177) |
| Routing | `HashRouter`, five routes, unknown → `#/` | [App.tsx:67](frontend/src/App.tsx:67) |
| CORS | `allow_credentials=False`, methods `GET`/`POST` | [main.py:63](backend/app/main.py:63) |

### Five consequences that shape the design

**a. Ownership has to be decided by where a file lives, not only by a database row.**
The manifest is a cache that `scripts/rebuild_manifest.py` regenerates from Qdrant, and
`POST /api/index/clear` drops the whole collection. If ownership lived only in a table,
either of those would orphan every user's documents. So each user's uploads live in
their own folder, `PDF_DIRECTORY/users/<user_id>/`, and **the owner of a file is a pure
function of its path** (§2.2). The owner is also written into every Qdrant point, so a
rebuild recovers it, and a clear-then-rescan recovers it from disk.

**b. The content-addressed id cannot stay owner-free.** Today two users uploading the
same manual get one `document_id` and one set of passages; whoever deletes it deletes it
for both, and the second upload is silently a duplicate of a document the uploader cannot
see. Document ids for user-owned files therefore include the owner (§2.3). Library
documents keep `document_id = file_hash`, so **no existing point is re-keyed** by the
migration.

**c. The index endpoint and the sweep are unsafe as soon as there are two users.**
`IndexRequest.directory` lets any caller index any folder on the machine and then search
it, and the sweep deletes everything outside a narrow run. Both are fixed as part of
slice 2, not left as follow-ups: a non-admin's run is always scoped to their own folder,
and a run only sweeps documents under the roots it scanned (§2.5).

**d. Accounts and access decisions cannot live in the manifest.** Users, password
hashes, sessions, reset requests and "this document is public" are not derivable from
anything; putting them in a file described as "a derived cache" invites someone to
delete it to fix a count. They get their own SQLite file, `data/access.db`, their own
service, and are never touched by `rebuild_manifest.py` or "Clear the index".

**e. Public is a decision, not a property of the file.** Unlike ownership, nothing on disk
says a document is public, so a clear-then-rescan could only restore it if the decision is
stored outside the index. It lives in `access.db` (§2.4) and is re-applied to each
document's passages whenever that document is indexed.

---

## 1. Accounts and sessions

### 1.1 Requirements

- R1.1 Anyone who can reach the app can **create an account** with a username and a
  password, while registration is open (§3.3). No email, no phone number, no other field.
- R1.2 A user **logs in** with username and password and stays logged in across browser
  restarts until they log out or the session expires (§1.5).
- R1.3 A user who forgot their password **requests a reset with only their username**.
  An admin approves the request, and the user then sets a new password in the same
  browser (§1.6). No email, no phone, no recovery code to keep.
- R1.4 A logged-in user can **change their password** (current + new).
- R1.5 A fresh install has **no users**. The first account is created on a one-time setup
  screen and is an admin (§1.7).
- R1.6 **Everyone logs in.** Every page except log in, register, forgot password and
  setup requires a session; every `/api` route except those in §1.8 returns **401**
  without one. There is no switch to turn this off.
- R1.7 Nothing about authentication needs the network: no identity provider, no CDN, no
  mail server. Hashing uses the Python standard library (no new wheel to bundle).

### 1.2 Data model — `data/access.db`

A new file next to the manifest, opened by a new `AccessStore` in
`backend/app/services/access_store.py`, with the same connection settings as
`ManifestService` (WAL, `busy_timeout=5000`, `check_same_thread=False`).

```sql
CREATE TABLE users (
    user_id               TEXT PRIMARY KEY,     -- uuid4 hex; also the upload folder name
    username              TEXT NOT NULL,        -- as typed, for display
    username_key          TEXT NOT NULL UNIQUE, -- lower-cased, for lookups
    password_hash         TEXT NOT NULL,        -- "scrypt$n$r$p$salt_b64$hash_b64"
    role                  TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    disabled              INTEGER NOT NULL DEFAULT 0,
    must_change_password  INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL,
    last_login_at         TEXT,
    password_changed_at   TEXT NOT NULL
);

CREATE TABLE sessions (
    token_hash    TEXT PRIMARY KEY,             -- sha256 hex of the cookie value
    user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    expires_at    TEXT NOT NULL                 -- absolute cap, never extended
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE reset_requests (
    request_id         TEXT PRIMARY KEY,        -- uuid4 hex
    user_id            TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash         TEXT NOT NULL UNIQUE,    -- sha256 hex of the requester's token
    status             TEXT NOT NULL CHECK (status IN
                         ('pending', 'approved', 'denied', 'completed', 'expired', 'superseded')),
    client_ip          TEXT,
    created_at         TEXT NOT NULL,
    expires_at         TEXT NOT NULL,
    decided_at         TEXT,
    decided_by         TEXT                     -- admin user_id
);
CREATE INDEX idx_reset_requests_status ON reset_requests(status);

CREATE TABLE public_documents (
    document_id  TEXT PRIMARY KEY,              -- absent row = private
    made_public_by TEXT NOT NULL,               -- admin user_id
    made_public_at TEXT NOT NULL
);

CREATE TABLE app_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL                        -- JSON
);
-- seeded: ('registration_open', 'true')
```

- `user_id` is opaque and never changes, so a folder name never has to be renamed and a
  username never appears in a filesystem path.
- The raw session token and the raw reset-request token are **never stored**, only their
  SHA-256. Both are high-entropy random values, so a fast hash is correct for them; the
  password is the only low-entropy secret and the only one that gets scrypt.

### 1.3 Usernames and passwords

| Rule | Value | Why |
|---|---|---|
| Username length | 3–32 characters | Readable in a table and a header |
| Username characters | English only: `A–Z a–z 0–9 . _ -`, must start with a letter or digit — `^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$` | Typeable on any keyboard without an IME; no look-alike characters; no spaces or slashes |
| Username uniqueness | On `username_key` = `lower()` | `Kim` and `kim` are the same account |
| Reserved usernames | `admin`, `root`, `system`, `library` (by key) | `library` is the pseudo-owner in §2.2; the rest avoid impersonation |
| Password length | 8–128 characters | NIST 800-63B: length, no composition rules |
| Password must not equal | the username (case-insensitive) | Cheapest guess there is |

Passwords are hashed with `hashlib.scrypt(n=2**14, r=8, p=1, dklen=32)` and a 16-byte
random salt. The parameters are stored in the hash string so they can be raised later;
on a successful login with older parameters the hash is re-computed and stored.
Comparison is `hmac.compare_digest`. A login for an **unknown** username still runs one
scrypt against a fixed dummy hash, so response time does not reveal which usernames exist.

### 1.4 Endpoints — `backend/app/api/auth.py`, prefix `/api/auth`

| Method & path | Body | Success | Failure |
|---|---|---|---|
| `GET /status` | — | `{setup_required, registration_open, user \| null}` | never fails |
| `POST /setup` | `{username, password}` | 201 `{user}`, sets cookie | 409 if any user exists; 403 if the request is not from loopback |
| `POST /register` | `{username, password}` | 201 `{user}`, sets cookie | 403 registration closed; 409 username taken; 422 rules in §1.3 |
| `POST /login` | `{username, password}` | 200 `{user}`, sets cookie | 401 `Wrong username or password`; 403 `This account is disabled` |
| `POST /logout` | — | 204, clears cookie, deletes the session row | — |
| `GET /me` | — | 200 `{user}` (admins also get `pending_reset_requests: int`) | 401 |
| `POST /password` | `{current_password, new_password}` | 204; every **other** session of this user is revoked | 400 wrong current password; 422 rules |
| `POST /reset-requests` | `{username}` | 202 `{request_token, expires_at}` | 429 throttled |
| `POST /reset-requests/status` | `{request_token}` | 200 `{status, expires_at}` | — |
| `POST /reset-requests/complete` | `{request_token, new_password}` | 200 `{user}`; all sessions revoked; sets a new cookie | 400 `This request is not approved or has expired`; 422 rules |

`user` in every response is `{user_id, username, role, must_change_password}` — never a
hash or a token.

Errors are deliberately uniform: login and reset requests never say whether the username
exists. The one exception is `403 This account is disabled`, which is only returned
**after** the password has been verified, so it tells an attacker nothing they didn't
already have. The reset-request token travels in a POST body, never in a URL.

### 1.5 Sessions

- Cookie `docsage_session`: 32 random bytes, `secrets.token_urlsafe`, `HttpOnly`,
  `SameSite=Strict`, `Path=/`. `Secure` only when `AUTH_COOKIE_SECURE=true` (the app is
  served over plain HTTP on loopback and on the LAN, where `Secure` would stop the
  cookie being sent at all).
- **Idle timeout 7 days, absolute cap 30 days**, both settings. `last_seen_at` is
  written at most once a minute per session, so reads do not become writes.
- Expired rows are deleted at startup and whenever a lookup finds one expired.
- Disabling a user, deleting a user, an admin password reset, a completed reset request,
  and a change of role **revoke all of that user's sessions**. A password change by the
  user revokes all **other** sessions.
- **CSRF:** `SameSite=Strict` stops cross-site requests carrying the cookie. As a second
  layer, every non-`GET` `/api` request must carry the header `X-DocSage: 1`; a request
  without it gets 403. `api.ts` adds it to every call, including multipart uploads. A
  plain HTML form on another site cannot set a custom header.
- Why not JWT: revocation. Disabling a user must take effect on their next request, and a
  row in SQLite gives that for free; a signed token would need a denylist, which is a
  session table by another name.

### 1.6 Forgot password: username + admin approval

With no email or phone, the only thing that can confirm "this is really Kim" is an admin
who knows Kim. So the user asks with just their username and an admin approves it. There
is no code to copy, remember or read out. There are two ways a password gets reset:

1. **The user asks, an admin approves** (below).
2. **An admin resets it directly**, without any request, from the Users page (§3.2).

```
User (forgot password page)             Server                          Admin (Users page)
───────────────────────────             ──────                          ──────────────────
types "kim", presses Request  ───────►  creates a pending request
sees: "Your request was sent to                                        sees: kim · 10:42 ·
 an administrator"                                                      192.168.0.23 [Approve] [Deny]
 (page polls every 15 s)                                        ◄────── presses Approve
                                        request approved
page switches to "Set a new password"
enters new password twice     ───────►  password set, all sessions
                                        revoked, logged in
```

**Requesting** — `#/forgot-password`, one field: username.

- `POST /reset-requests` creates a pending request and returns a random `request_token`
  (32 bytes). The user never sees the token: the browser keeps `{username, request_token}`
  in `localStorage` (wrapped in try/catch) and uses it to check the status and, once
  approved, to set the new password. Closing the tab and coming back in the same browser
  resumes the request.
- The page says: "Your request was sent to an administrator. Once they approve it, this
  page lets you set a new password. The request expires in 24 hours." It polls
  `/reset-requests/status` every 15 seconds.
- **Unknown usernames** get a response of exactly the same shape, but nothing is stored,
  and its status stays `pending` until it expires. So the form never reveals whether an
  account exists. The cost: a typo waits 24 hours for nothing, so the page also says
  "Check the username is spelled correctly."
- **One open request per user.** A new request for the same user marks the previous one
  `superseded`, so the admin queue holds at most one row per user and an old token stops
  working.
- Throttled: 5 requests per client IP per hour, then 429. This keeps the admin queue
  from being flooded.

**Approving** — the admin's Users page (§3.2) shows **Password reset requests** at the
top when any are pending: username, time, the requester's IP, [Approve] [Deny]. Admins see
a count badge on the account menu (from `pending_reset_requests` in `/auth/me`, refreshed
every 60 seconds).

- **Approve** is one click with a confirmation: "Approve the password reset for kim?
  Whoever made this request will be able to set a new password for this account."
- **Deny** is one click. The requester's page says "An administrator declined this
  request."
- An admin **cannot approve a request for their own account**. With a second admin that
  one approves; with a single admin, `scripts/reset_admin.py` is the way back (§1.7).
- Approving a request for a **disabled** account is allowed but does not enable it; the
  row shows a `Disabled` tag so the admin knows.

**Completing** — as soon as the status is `approved`, the requester's page shows new
password + confirm. `POST /reset-requests/complete` sets the password, clears
`must_change_password`, revokes all sessions, marks the request `completed`, and logs the
user in. Only the browser that made the request holds the token, so only it can finish
the reset.

**Timing.** A pending request expires **24 hours** after it was made. An approved request
must be completed within **1 hour** of approval. Expired requests are marked on lookup and
swept at startup.

**What the admin is trusting.** Approving hands the account to *whoever made the
request*, and anyone who can reach the app can request a reset for any username,
including an admin's. The request row shows when and from which IP it came, but the app
cannot tell who is at that browser, so the admin should approve only a request they were
expecting — for example, Kim said they forgot their password and the time and IP match.
An unexpected request should be denied. Requests, approvals and denials are logged with
username, admin and IP (§6).

**Logins are not throttled**: failed attempts never lock an account or make anyone wait.

### 1.7 First run

- When `users` is empty, `GET /api/auth/status` returns `setup_required: true` and every
  other page redirects to `#/setup`.
- `POST /api/auth/setup` is accepted **only from a loopback client**
  (`request.client.host` in `127.0.0.1`, `::1`). Someone on the LAN cannot race the
  owner to become admin of a `run.bat lan` install. From a non-loopback address the setup
  page says: "Finish setting up DocSage on the computer it is installed on."
- Setup creates an **admin**. Afterwards `/setup` returns 409 forever.
- **Lockout recovery:** `scripts/reset_admin.py <username>` (run on the machine, app
  running or not) sets a new temporary password, clears `disabled`, sets
  `role='admin'` and `must_change_password`, and prints the password. If the username
  does not exist it creates it as an admin. This is how a sole admin who forgot their
  password gets back in, since nobody else can approve their request; it needs
  filesystem access, which is the right bar.

### 1.8 Authorisation dependencies — `backend/app/auth.py`

```python
def current_user(request, container) -> User            # 401 if no valid session
def active_user(user = Depends(current_user)) -> User   # 403 password_change_required
def admin_user(user = Depends(active_user)) -> User     # 403 if role != 'admin'
```

- `active_user` rejects every route except `GET /auth/me`, `POST /auth/password` and
  `POST /auth/logout` while `must_change_password` is set, with
  `403 {"detail": "password_change_required"}`, which the UI turns into the
  change-password screen.
- Routers are guarded at `include_router(..., dependencies=[...])` in `main.py`, so a new
  route added to an existing router is protected by default. `auth` is included without
  a router-level guard and guards its own routes.
- **Public routes:** `GET /api/health`, `GET /api/auth/status`, `POST /api/auth/setup`,
  `/register`, `/login`, `/reset-requests`, `/reset-requests/status`,
  `/reset-requests/complete`, and the static UI mount. Nothing else.
- A test walks `app.routes` and fails if any `/api` route outside that list can be
  called without a session (§8, T1.9). That is what stops a future router being added
  unguarded.

---

## 2. Ownership, visibility and isolation

### 2.1 Requirements

- R2.1 Every document has exactly one **owner**: a user, or the **library** (§2.2).
- R2.2 Every document is **private** (the default) or **public**. Only an admin can make
  a document public or private again, and an admin can do it to **any** document —
  a user's upload or a library document.
- R2.3 A non-admin user can list, open, download and search **their own documents and
  public documents**, and remove **only their own**. Any other document is
  indistinguishable from one that does not exist: the API answers **404**, never 403.
- R2.4 A user's uploads are stored in their own folder and indexed as theirs.
- R2.5 Two users uploading the same file each get their own document; removing one
  never affects the other.
- R2.6 Clearing the index, rebuilding the manifest, or a full rescan never changes who
  owns what or what is public.
- R2.7 Existing installs keep every indexed document, with no re-embedding.

### 2.2 Who owns a file

One function, `owner_for(path) -> str`, in a new `backend/app/services/ownership.py`,
used by indexing, the rebuild script and the migration:

```
PDF_DIRECTORY/users/<user_id>/**   →  owner = <user_id>
anything else                       →  owner = "library"
```

- **Library** documents are everything that was not uploaded by a user: files put in
  `PDF_DIRECTORY` by hand, files in registered folders, and **every document indexed
  before this change**. They start **private**, so only admins see them, until an admin
  makes them public (§2.8). For an upgrade, that means regular users see nothing of the
  existing collection until an admin publishes it.
- An upload by an **admin** goes to that admin's own `users/<user_id>/` folder like
  anyone else's. Admins see everything regardless, so this only matters if the admin is
  later demoted: they keep their own uploads.
- A `users/<id>/` folder whose id is not a user (the account was deleted outside the app)
  is **skipped** by indexing with a logged warning, not indexed as library. Otherwise
  deleting a user row by hand would hand their files to the library.

### 2.3 Document ids

| Owner | `document_id` |
|---|---|
| `library` | `file_hash` — unchanged, so existing points and manifest rows keep their ids |
| a user | `sha256(f"user:{user_id}:{file_hash}")` hex |

Dedup (`alt_filepaths`) therefore only ever happens **within one owner**: the same file
twice in one user's folder is indexed once; the same file in two users' folders is two
documents. Point ids stay `uuid5(document_id:chunk_index)` and remain unique.

### 2.4 Storage changes

**Manifest** — additive, applied by `ManifestService.initialise()` when the column is
missing (checked with `PRAGMA table_info`, as `describe()` already does):

```sql
ALTER TABLE documents  ADD COLUMN owner_id   TEXT NOT NULL DEFAULT 'library';
ALTER TABLE documents  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_visibility ON documents(visibility);
ALTER TABLE index_jobs ADD COLUMN started_by TEXT;           -- user_id, NULL for old rows
ALTER TABLE index_jobs ADD COLUMN scope      TEXT NOT NULL DEFAULT 'library';  -- 'library' | user_id
```

`DocumentRecord` and `JobRecord` gain the fields. `all_documents()`, `totals()` and
`status_breakdown()` gain an optional `readable_by` argument that adds
`WHERE owner_id = ? OR visibility = 'public'`, plus an optional `owner_id` for the admin's
filter.

**Qdrant payload** — `owner_id` and `visibility` are added to `QdrantService._payload`,
to `_INDEXED_PAYLOAD_FIELDS` (keyword indexes) and to `_SUMMARY_FIELDS`, and described in
`admin.py`'s `_PAYLOAD_FIELDS` (the existing test enforces that last one).

**Where "public" is remembered.** The source of truth is the `public_documents` table in
`access.db` (§1.2). The manifest column and the payload field are copies for fast
filtering. When indexing stores a document it reads `public_documents` and writes the
matching `visibility` into the payload and the manifest, so a clear-then-rescan or a
manifest rebuild comes back with the same documents public.

**Visibility follows the file when it changes.** A modified file hashes to a new
`document_id`. When indexing stores a document at a path whose previous manifest record
had a different id and was public, it adds the new id to `public_documents` before the
sweep removes the old one. An admin who publishes a manual does not have to publish it
again after someone saves a new version of it.

**Migration of existing points**, at startup after `ensure_collection()`: one
`client.set_payload(payload={"owner_id": "library", "visibility": "private"}, points=Filter(must=[IsEmptyCondition(is_empty=PayloadField(key="owner_id"))]))`.
It rewrites payload only, no vectors, and is a no-op on every start after the first.
Logged as `assigned N existing passages to the library`.

**`scripts/rebuild_manifest.py`** reads `owner_id` and `visibility` from the payload,
falling back to `owner_for(filepath)` and to `public_documents` for any point that lacks
them.

### 2.5 Indexing

- `POST /api/index` from a **non-admin**: `directory` is **ignored**, the run's scope is
  `users/<own id>/`, `trigger` is forced to `upload`. From an **admin**: unchanged
  (library + every folder, or one `directory`), and an admin may also pass
  `scope: "<user_id>"` to re-index one user's folder.
- A full library run (admin, no directory) covers `PDF_DIRECTORY` including `users/`,
  so a single scan re-indexes everyone after a clear. Each file's owner comes from
  `owner_for()`, its id from §2.3, its visibility from `public_documents`.
- **The sweep is scoped.** `_sweep_deleted` only considers manifest documents with at
  least one known path under one of the run's roots. A run over one user's folder can
  no longer delete anybody else's documents, and an admin's run over one registered
  folder can no longer delete the rest of the library. (This also fixes the latent bug in
  §0: an admin run with `directory` set sweeps everything outside it today.) When the
  sweep removes a document for good, its `public_documents` row goes too.
- **One run at a time**, as now: the run lock stays global, because the embedder and the
  embedded Qdrant are single-writer. A user whose upload finds a run in progress gets
  the existing 409. Their files are already saved, so the UI waits for the running job
  to finish (it already polls status) and retries once, and says so:
  "Your files are saved. Another indexing run is in progress; yours will start after it."
  If the browser is closed first, the next run over their folder or the library picks
  them up. A real queue is out of scope (§9).
- `started_by` and `scope` are recorded on the job row.

### 2.6 API behaviour by role

"Own" means `owner_id == current_user.user_id`. "Readable" means own **or** public.
"404" means the response is exactly the one for a non-existent id.

| Route | Non-admin | Admin |
|---|---|---|
| `POST /api/search` | Readable documents only, via a filter **added server-side** (§2.7). Optional `scope`: `all` (default), `mine`, `public` | All documents. Optional `filters.owner_id` (a user id or `library`) and `visibility` |
| `GET /api/documents` | Readable only. Each row gains `visibility` and `is_mine` | All; optional `?owner_id=` and `?visibility=`. Rows also carry `owner_id`, `owner_username` (`null` for library) |
| `POST /api/documents/upload` | Saves to `users/<me>/` | Saves to `users/<me>/` |
| `GET /api/documents/{id}/file` | Readable, else 404 | Any |
| `DELETE /api/documents/{id}` | Own, else 404 — **including public documents owned by someone else**. Deletes the uploaded file(s) as well as the passages (§2.9) | Any. Library: unindex only, file kept (as today). User-owned: as for the owner |
| `PUT /api/documents/{id}/visibility` | 403 | `{visibility: "public" \| "private"}` (§2.8) |
| `POST /api/index` | Own folder only (§2.5) | As today, plus `scope` |
| `GET /api/index/status` | Full detail if the running job's `scope` is theirs; otherwise `status` and progress counts only, with `directory`, `current_file` and `failures` set to `null` / `[]` | Full detail |
| `GET /api/index/jobs` | Jobs with `scope = me` | All, with `started_by_username` |
| `POST /api/index/clear` | 403 | As today (all owners). Uploaded files and `public_documents` stay; a rescan restores every owner and every public flag (§0a, §0e) |
| `GET/POST/DELETE /api/folders` | 403 | As today. Registered folders are library content |
| `GET /api/health/ready` | Allowed, but `points` is the count of passages they can search | As today |
| `/api/admin/*` | 403 | As today, plus §3 |

A user's own public document still counts as **theirs**: they can delete it, and it shows
in their list with a `Public` tag. They cannot make it private again — only an admin can
change visibility, as the requirement says.

### 2.7 The search filter

Built in `SearchService.search()` from an `AccessScope` the route passes in, never from
`SearchRequest`, so no client field can widen it:

```python
# non-admin, scope=all
Filter(must=[*client_filters,
             Filter(should=[Match("owner_id", me), Match("visibility", "public")])])
# non-admin, scope=mine    → must += Match("owner_id", me)
# non-admin, scope=public  → must += Match("visibility", "public")
# admin                    → client_filters, plus owner_id / visibility if given
```

`SearchFilters.owner_id` and `visibility` are honoured only for admins and otherwise
**ignored** (not an error, so an old client does not break). Each hit gains `visibility`
and `is_mine`; admins also get `owner_username`. Non-admins are **not** shown who owns a
public document they didn't upload — it reads as "Public", so publishing a document does
not also publish who uploaded it.

### 2.8 Making documents public

- `PUT /api/documents/{id}/visibility` (admin) inserts or deletes the `public_documents`
  row, then updates the manifest row and runs one
  `client.set_payload({"visibility": ...}, points=Filter(document_id = id))` — payload
  only, no re-embedding, so it takes about a second even for a large document.
- `POST /api/admin/documents/visibility` `{document_ids: [...], visibility}` does the same
  for up to 500 documents at once, for publishing a whole library after an upgrade.
  Returns `{updated, not_found}`.
- Both are refused with 409 while an indexing run is in progress: the run may be about to
  re-write that document's payload with the value it read earlier. Visibility changes are
  rare and quick, so waiting for the run is simpler and safer than a per-document lock.
- Deleting a public document (by its owner or an admin), or deleting its owner's account,
  removes it and its `public_documents` row. Disabling the owner does **not** hide their
  public documents; the admin can make them private if that is wanted.

### 2.9 Removing a user's document

A library document is "unindexed, file kept", because the file is the machine owner's
and a rescan should find it again. A user's upload is different: it is a **copy the app
made**, and leaving it on disk means the next rescan resurrects a document the user
deleted. So for a user-owned document, `DELETE` removes the passages, the manifest row,
the `public_documents` row, **and every known path of it inside `users/<owner>/`**. Paths
outside that folder are never deleted (they cannot exist for a user document, but the
check is explicit). The response gains `file_kept: false`.

---

## 3. Administration

### 3.1 Requirements

- R3.1 An admin can list every registered user, with role, status, document count,
  public document count, passage count, created and last-login time.
- R3.2 An admin can **create** a user, **disable / enable** one, **promote / demote**
  one, **reset** one's password, and **delete** one.
- R3.3 An admin can **approve or deny password reset requests** (§1.6).
- R3.4 An admin can open, search and remove **any** document, filter by owner and
  visibility, see every document's owner, and **make any document public or private**.
- R3.5 An admin can open or close **self-registration**.
- R3.6 **Only admins can see the Settings page** and the Admin page. For anyone else the
  header has no settings button, the routes redirect to `#/search`, and the backend
  routes answer 403. The **Appearance** part of Settings is available to everyone from
  the account menu (§3.4).
- R3.7 There is always at least one active admin: the last one cannot be disabled,
  demoted or deleted, and an admin cannot do any of those to themselves.

### 3.2 Endpoints — `backend/app/api/users.py`, prefix `/api/admin`, all `admin_user`

| Method & path | Body | Result |
|---|---|---|
| `GET /users` | — | `[{user_id, username, role, disabled, must_change_password, created_at, last_login_at, documents, public_documents, passages}]` |
| `POST /users` | `{username, role}` | 201 `{user, temporary_password}`; `must_change_password` set |
| `PATCH /users/{id}` | `{role?, disabled?}` | 200 `{user}`; sessions revoked on either change |
| `POST /users/{id}/reset-password` | `{new_password?, must_change: bool = true}` | 200 `{temporary_password \| null}` — the admin types a new password, or leaves it empty to have one generated and shown once. Pending reset requests superseded, sessions revoked |
| `DELETE /users/{id}` | `?documents=delete` (required) | 200 `{documents_removed, passages_removed, files_removed}` |
| `GET /reset-requests` | — | Pending requests: `[{request_id, username, user_disabled, created_at, expires_at, client_ip}]` |
| `POST /reset-requests/{id}/approve` | — | 200; 403 own account; 409 not pending |
| `POST /reset-requests/{id}/deny` | — | 200; 409 not pending |
| `POST /documents/visibility` | `{document_ids, visibility}` | 200 `{updated, not_found}` (§2.8) |
| `GET /auth-settings` | — | `{registration_open}` |
| `PUT /auth-settings` | `{registration_open}` | 200 same |

- **Manual reset.** From any user's row an admin can press **Reset password**, with no
  request needed. The dialog offers "Type a new password" (the §1.3 rules apply) or
  "Generate one" (16 characters from an unambiguous alphabet, shown once with a Copy
  button), and a "Must change it at next login" checkbox, ticked by default. The admin
  passes the password on in person. Either way the password is never stored in plain
  text, and the admin's own account cannot be reset this way (they use Change password).
- **Deleting a user** deletes the account, its sessions and reset requests, every
  document it owns (passages, manifest rows, public flags) and its `users/<id>/` folder.
  The explicit `?documents=delete` makes a client that forgets what this does fail with
  422 instead of silently destroying files. Refused with 409 while an indexing run is in
  progress, like the other destructive routes.
- R3.7 violations return 409 with a sentence the UI shows as is, e.g.
  "DocSage needs at least one active administrator."

### 3.3 Registration switch

`registration_open` defaults to **true** (the requirement is that users can create an
account). When closed, the register page says "Registration is closed. Ask an
administrator for an account." and `POST /register` returns 403. Admin-created users
(`POST /admin/users`) work either way.

### 3.4 What is admin-only on the frontend

- `#/settings`, `#/admin` and `#/admin/users` are wrapped in `<RequireAdmin>`; a
  non-admin is redirected to `#/search`.
- The header's settings gear renders only for admins.
- The Documents page, for a non-admin, shows the **add documents** card (upload, no
  folder picker), **My documents** (with a `Public` tag on any an admin has published)
  and **Public documents** (read-only: open and search, no remove), and their own job
  progress. The folders card, "Clear the index" and other users' history are not
  rendered.
- **Everyone can change the theme.** The Settings page's **Appearance** card (theme,
  accent colour, density) is extracted into `src/components/AppearanceSettings.tsx` and
  rendered in two places: on the Settings page for admins, and in an **Appearance**
  dialog opened from the account menu for every user. It still writes to the same
  per-browser `localStorage` store, never to the backend.
- The rest of the Settings page (Search defaults, Administration, Backend) stays
  admin-only. Non-admins keep the search page's inline top-K and language controls.

---

## 4. Frontend

### 4.1 New pieces

| File | What |
|---|---|
| `src/app/AuthContext.tsx` | Loads `GET /api/auth/status` at start; holds `user`, `setupRequired`, `registrationOpen`, `pendingResetRequests`; `login`, `logout`, `register`, `refresh` (every 60 s for admins). Mounted **outside** `LibraryProvider` and `SearchProvider`, which mount only once there is a user, so nothing polls `/api/documents` before login |
| `src/app/guards.tsx` | `RequireAuth`, `RequireAdmin`, `RequireSetup` route wrappers |
| `src/pages/LoginPage.tsx` | Username, password, "Forgot password?", "Create an account" (hidden when closed) |
| `src/pages/RegisterPage.tsx` | Username, password, confirm; rules shown inline |
| `src/pages/ForgotPasswordPage.tsx` | Username → request; then a waiting state (polls every 15 s); then new password + confirm when approved; denied and expired states; resumes from `localStorage` |
| `src/pages/SetupPage.tsx` | First admin; explains it must be done on this computer |
| `src/pages/ChangePasswordPage.tsx` | Also the forced screen when `must_change_password` |
| `src/components/AccountMenu.tsx` | Header dropdown: username + role tag, Appearance, Change password, Log out; for admins a badge with the pending reset count linking to Users |
| `src/components/AppearanceSettings.tsx` | Theme, accent, density — moved out of `SettingsPage.tsx`, shared by Settings and the account menu's Appearance dialog |
| `src/pages/UsersPage.tsx` | Admin, `#/admin/users`: **Password reset requests** (Approve with a confirmation, Deny); the users `Table` with row actions including **Reset password** (type or generate); Create user; registration switch. Linked from the Admin page, Settings and the account-menu badge |
| `src/components/VisibilityTag.tsx` | `Public` / `Private` tag; for admins a switch that calls `PUT .../visibility` |

### 4.2 Changes

- `api.ts` `call()`: sends `credentials: 'same-origin'` and `X-DocSage: 1` on every
  non-`GET`; on **401** it notifies `AuthContext`, which clears the user and routes to
  `#/login` keeping the intended route in `?next=`; on **403
  `password_change_required`** it routes to `#/account/password`. The existing
  "Cannot reach the backend" message is kept for network failures.
- `App.tsx`: routes `#/login`, `#/register`, `#/forgot-password`, `#/setup`,
  `#/account/password`, `#/admin/users`; the account menu at the right of the header;
  the gear only for admins.
- `DocumentList`: a **Visibility** column for everyone. For admins also an **Owner**
  column (username, or a `Library` tag), owner and visibility filters, the visibility
  switch per row, and row selection with **Make public** / **Make private** bulk actions.
- `SearchPage`: for everyone a compact **Show: All / Mine / Public** select next to top-K
  and language. For admins it becomes **Owner: Everyone / Library / <user>** plus a
  visibility filter. Result cards show a `Public` tag; admins also see the owner.
- `HeroPage`: its live numbers come from the scoped `/api/documents`, so a user sees what
  they can search. Its empty state ("Add your first documents") now fires per user.
- Logging out clears `SearchContext` so the next person at the same browser does not see
  the previous user's last results.

---

## 5. Configuration

Added to `Settings` in [config.py](backend/app/config.py) and to `.env.example`:

| Setting | Default | |
|---|---|---|
| `ACCESS_DB_PATH` | `./data/access.db` | Resolved against the repo root like `MANIFEST_PATH` |
| `AUTH_SESSION_IDLE_DAYS` | `7` | |
| `AUTH_SESSION_MAX_DAYS` | `30` | |
| `AUTH_COOKIE_SECURE` | `false` | Set `true` only behind HTTPS |
| `AUTH_RESET_REQUEST_HOURS` | `24` | How long a pending reset request waits for an admin |

The user uploads folder is derived, `PDF_DIRECTORY / "users"`, not configured, so it can
never be pointed outside the library's allow-list in `get_document_file`.

CORS `allow_methods` gains `PATCH`, `PUT`, `DELETE` (only relevant to cross-origin dev
setups; the Vite proxy and the production mount are same-origin).

---

## 6. Security notes

- **Isolation is enforced in exactly two places**: the Qdrant filter in `SearchService`
  (§2.7) and a `readable_or_404(document_id, user)` / `owned_or_404(...)` pair every
  document route calls. No route reads a document from the manifest without going
  through one of them; a test asserts each document route returns 404 for another user's
  private id (§8, T2.4).
- Registering folders becomes admin-only because a folder is an arbitrary server path; a
  user who could register `C:\Users\someone-else` could index and search it.
- Upload filenames keep going through `_safe_name`, and the target directory is
  `users/<user_id>`, where `user_id` comes from the session, never from the request.
- Passwords, temporary passwords, session tokens and reset-request tokens are never
  logged. The existing rule that search queries are not logged is
  unchanged. Reset requests, approvals and denials are logged with username, admin and
  IP, so an admin can see who asked for what.
- The privacy promise in [user-spec.md §8](docs/user-spec.md) is unchanged in substance:
  accounts are stored on the machine, nothing goes to the network. The line "reachable
  only from your own machine" already has an exception for `run.bat lan`; the user spec
  now says that on the LAN, **each person needs an account, sees their own documents and
  the ones an admin made public, and nobody else's**.
- Out of scope, stated so nobody assumes it: HTTPS, 2FA, a full audit log, password breach
  lists, per-user storage quotas.

---

## 7. Slices and files

### Slice 1 — Accounts and sessions

- New: `app/services/access_store.py`, `app/services/passwords.py`, `app/auth.py`,
  `app/api/auth.py`, `scripts/reset_admin.py`.
- Changed: `config.py` (§5), `deps.py` (`Container.access`), `main.py` (open `access.db`
  in the lifespan, delete expired sessions and reset requests, guard routers, CSRF
  header middleware).
- Frontend: `AuthContext`, guards, login / register / forgot-password / setup /
  change-password pages, `AccountMenu`, `AppearanceSettings`, `api.ts` changes.
- The approve / deny endpoints ship here too (in `users.py`), so a reset is never
  requestable without being approvable; their UI arrives in slice 3, and until then
  `scripts/reset_admin.py` covers a forgotten password.

### Slice 2 — Ownership, visibility and isolation (ships with slice 1)

- New: `app/services/ownership.py`.
- Changed: `manifest_service.py` (columns, readable / owner-scoped reads),
  `qdrant_service.py` (payload, indexes, `AccessScope` filter, `set_visibility`,
  migration), `indexing_service.py` (owner, id and visibility per file, carrying
  visibility to a new version, scoped sweep, `started_by` / `scope`), `search_service.py`
  (`AccessScope`), `api/documents.py` (readable / owned checks, visibility route),
  `api/indexing.py`, `api/folders.py`, `api/health.py`, `models/request_models.py`,
  `models/response_models.py`, `scripts/rebuild_manifest.py`.
- Frontend: Documents page per role (Mine / Public), `Show` select on search, `Public`
  tags, scoped hero numbers, clear search on logout.

### Slice 3 — Administration

- New: rest of `app/api/users.py`, `frontend/src/pages/UsersPage.tsx`,
  `VisibilityTag.tsx`.
- Changed: `admin.py` routes guarded `admin_user`, `App.tsx` (gear, `RequireAdmin`,
  reset badge), `SearchPage` owner and visibility filters, `DocumentList` owner column,
  visibility switch and bulk actions.

### Slice 4 — Documentation

- `docs/user-spec.md`: new "Accounts" section (sign-up, forgot password and admin
  approval, public documents); §3 and §4 per role; §8 privacy wording for LAN use; §11
  add "no email-based reset, by design".
- `README.md` and `windows/README-FIRST.txt`: first-run setup, approving reset requests,
  publishing documents, what to do when locked out (`scripts\reset_admin.py`).
- `windows/run.bat` line 4: drop "with no login".

---

## 8. Acceptance tests

Backend tests use the existing fakes in `backend/tests/conftest.py` and a temporary
`access.db`; frontend tests use Vitest + Testing Library as today.

**Slice 1**

- T1.1 Setup from loopback creates an admin; a second setup is 409; setup from a non-loopback client is 403.
- T1.2 Register → logged in; duplicate username differing only in case → 409; reserved name → 422; 7-char password → 422; `김철수` or `kim chul` → 422 (English only, no spaces).
- T1.3 Login wrong password and unknown username return identical 401 bodies.
- T1.4 Forty failed logins for one username, then the right password → 200; logins never lock.
- T1.5 Reset happy path: request → status `pending` → admin approves → status `approved` → complete sets the password, logs in, and every earlier session of that user is 401.
- T1.6 Reset request for an unknown username returns the same shape as for a real one, stores nothing, and never appears in the admin's list.
- T1.7 Complete before approval → 400; complete 61 minutes after approval → 400; pending request older than 24 h → `expired`.
- T1.8 Deny → requester's status `denied` and complete is 400; an admin approving their own account's request → 403.
- T1.9 Every `/api` route not in the public list (§1.8) returns 401 without a cookie — computed by walking `app.routes`, not a hand-kept list.
- T1.10 A second request for the same user supersedes the first; the first token's status is `superseded` and it cannot complete.
- T1.11 Password change revokes other sessions but keeps the current one; expired (idle and absolute) sessions are 401.
- T1.12 A non-`GET` without `X-DocSage: 1` is 403.
- T1.13 `must_change_password` → 403 `password_change_required` on `/api/search`; allowed on `/auth/password`.
- T1.14 No password or token appears in captured logs during the above.
- F1.1 Unauthenticated visit to `#/search` lands on `#/login?next=/search` and returns there after login.
- F1.2 Forgot-password page: after a reload it resumes the waiting state; when status becomes `approved` it shows the new-password form.

**Slice 2**

- T2.1 Users A and B upload different files; A's search never returns B's private passages, including when A passes B's `document_id` as a filter.
- T2.2 An admin makes B's document public → A's search returns it with `visibility: public`, `is_mine: false` and no owner name; A can open its file; A's `DELETE` on it is 404.
- T2.3 A's `scope: mine` excludes public documents; `scope: public` excludes A's own private ones.
- T2.4 For `GET /file` and `DELETE`, another user's private id → 404 with the same body as an unknown id.
- T2.5 A and B upload the same file → two documents with different ids; A deletes theirs; B's still searches.
- T2.6 A user's `POST /api/index` with `directory: "/"` indexes only their own folder.
- T2.7 A run over A's folder does not remove any of B's or the library's documents (scoped sweep).
- T2.8 Clear index + full rescan restores every owner **and every public flag**.
- T2.9 A public library file is edited on disk and re-indexed → the new version is public, the old id is gone from `public_documents`.
- T2.10 An existing manifest and collection with no `owner_id` start up, become library + private, keep their ids, and re-embed nothing (the fake embedder records zero calls).
- T2.11 `rebuild_manifest.py` reproduces `owner_id` and `visibility`.
- T2.12 A user's `DELETE` removes their uploaded file from disk; an admin's `DELETE` of a library document keeps the file.
- T2.13 A `users/<unknown-id>/` folder is skipped, not indexed as library.
- T2.14 A visibility change during an indexing run → 409.

**Slice 3**

- T3.1 Non-admin gets 403 on `/api/admin/*`, `/api/folders`, `/api/index/clear` and `PUT .../visibility`.
- T3.2 Admin lists users with correct document, public-document and passage counts.
- T3.3 Disabling a user makes their next request 401; login then returns 403 disabled; their public documents stay public.
- T3.4 The last admin cannot be demoted, disabled or deleted; an admin cannot act on themselves.
- T3.5 Deleting a user removes their documents, passages, public flags and folder; other users unaffected.
- T3.6 Admin reset with a generated password → user logs in with it → forced to change it. Admin reset with a typed password and "must change" unticked → user logs in and is not forced. A typed password that breaks §1.3 → 422. An admin resetting their own account → 403.
- T3.7 Registration closed → register 403; admin-created user still works.
- T3.8 Bulk visibility on 3 ids, one unknown → `{updated: 2, not_found: [id]}`.
- F3.1 A non-admin sees no gear, and `#/settings`, `#/admin` and `#/admin/users` redirect to `#/search`.
- F3.2 An admin sees the Owner column and filters; filtering by owner narrows results; toggling a row's visibility switch updates its tag.
- F3.3 A non-admin opens Appearance from the account menu, switches to dark, and the theme changes.
- F3.4 A pending reset request shows a badge in the admin's account menu; Approve asks for confirmation, and the badge count drops afterwards.

---

## 9. Out of scope

- A queue of indexing runs (one global run, as today; §2.5).
- Sharing a document with specific users or groups — a document is private or public to
  everyone, nothing in between.
- Users publishing their own documents — only admins change visibility.
- Moving a document between owners.
- Per-user quotas, email, SSO/LDAP, 2FA, HTTPS termination.
- An "authentication off" switch for single-person installs.

---

## 10. Decisions

All answered on 2026-09-29.

**Q1. Password reset.** The user requests a reset with their username only; an admin
approves or denies it with one click; the requesting browser then sets the new password
(§1.6). No codes of any kind. Admins can also reset any user's password manually, typing
one or generating one (§3.2).

**Q2. Who sees what.** Documents are private to their owner by default. **An admin can
make any document public**, and every user can see and search public documents (§2.8).
Library documents — everything indexed before the upgrade, the documents folder and
registered folders — start private, visible only to admins, until published.

**Q3. Settings for regular users.** Anyone can change the theme. The Appearance card is
available to every user from the account menu; the rest of Settings stays admin-only
(§3.4).

**Q4. Single-person installs.** Everyone logs in, with no `AUTH_ENABLED` switch.

**Q5. Username characters.** English letters, digits and `. _ -` only (§1.3).
