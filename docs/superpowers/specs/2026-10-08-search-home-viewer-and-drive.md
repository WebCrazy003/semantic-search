# Search-first home, document viewer and Drive-style document manager: Spec

**Date:** 2026-10-08
**Branch:** `main` (following the house convention of the previous specs)
**Status:** Implemented 2026-10-08 (all four slices). Where the build differs from the
text below, see "As built" at the end.

Three things, delivered as three slices that can ship one at a time:

1. **A search-first shell.** The first screen looks like google.com: the DocSage
   wordmark, one search box, and only a settings button and an avatar at the top right.
   After a search the layout becomes a results page, like Google's. There is no login
   screen: logging in, settings and changing a password all happen in modals. Logged-out
   visitors can search public documents.
2. **A document viewer.** Selecting a result opens the PDF or Word file itself in the
   slide-in panel, scrolled to the passage, with the passage highlighted. The same viewer
   opens full-size in a new tab.
3. **A Drive-style document manager** in its own browser tab. Folders kept in the
   database, uploads that are always indexed, an **Index** action for anything uploaded
   but not indexed, a small progress panel at the bottom right, moving files between
   folders, and a minimised summary instead of the charts.

Slice 4 is documentation.

### Decisions already made

| Question | Decision |
|---|---|
| What can a logged-out visitor do? | Search, ask and open **public** documents. Logging in adds their own documents. |
| Google extras in the mockup: "I'm Feeling Lucky", the microphone, image search, the "Images" link and the apps grid | **Not built.** The home has a search box and nothing else. |
| Where does the folder structure live? | **In the database** (`data/access.db`). Files stay where they are on disk; a move changes one row (§0a). |
| Can a file move to another owner? | **No.** Moves stay within one owner's tree (§0b). |
| Who starts indexing after an upload? | **The server.** Anything uploaded but not indexed can also be indexed by hand with **Index** (§3.3). |
| Public documents searchable without login on a LAN install? | **Accepted.** The docs say so (slice 4). |

---

## 0. Current state (checked against the code)

| Area | Today | Where |
|---|---|---|
| Routes | `HashRouter`. Login, register, forgot password, setup and change password are full pages. Everything else is behind `RequireAuth`. | [App.tsx](frontend/src/App.tsx), [guards.tsx](frontend/src/app/guards.tsx) |
| Header | A bar with the logo, **Search** and **Documents** nav buttons, an admin-only settings gear, and the account menu | [App.tsx](frontend/src/App.tsx) |
| Start page | `HeroPage`: a marketing panel with stats, the raster logo and four feature cards | [HeroPage.tsx](frontend/src/pages/HeroPage.tsx) |
| Settings | A full page, admin only, with five tabs: Appearance, Search, Developer, Administration, System. All of it is browser `localStorage` except the System tab. A regular user reaches Appearance through a modal in the account menu. | [SettingsPage.tsx](frontend/src/pages/SettingsPage.tsx), [AccountMenu.tsx](frontend/src/components/AccountMenu.tsx) |
| Account menu | A text button with the username. Items: Appearance, Change password, Users (admin), Log out. | [AccountMenu.tsx](frontend/src/components/AccountMenu.tsx) |
| Result panel | A right `Drawer`, 560 px wide, showing the **passage text**, tags and a relevance ring. "Open in the PDF" opens the browser's PDF viewer at `#page=N` in a new tab. A `.docx` can only be **downloaded**. | [SearchPage.tsx](frontend/src/pages/SearchPage.tsx), [ResultDetail.tsx](frontend/src/components/ResultDetail.tsx) |
| Anonymous access | None to content. The search, indexing and documents routers all need `active_user`. `optional_user` exists but only `/api/auth/status` uses it. | [main.py:90](backend/app/main.py:90), [auth.py:86](backend/app/auth.py:86) |
| Readiness | `GET /api/health/ready` (answers available or not) needs a login | [api/health.py](backend/app/api/health.py), [api.ts:286](frontend/src/services/api.ts:286) |
| Search hit | `document_id`, `filename`, `page_start`, `page_end`, `chunk_index`, `heading`, `text`, `file_type`, … There are **no character offsets or boxes**. The text overlaps the previous chunk and repeats the heading, so it is not a clean substring of the page. | [response_models.py](backend/app/models/response_models.py), [chunk_service.py](backend/app/services/chunk_service.py) |
| DOCX pages | Approximate, taken from page-break markers (`pages_approximate`). A file with no markers is one page. | [docx_service.py](backend/app/services/docx_service.py) |
| File route | `GET /api/documents/{id}/file`: `inline` for PDF, `attachment` for DOCX. Admin, owner or public. | [documents.py:148](backend/app/api/documents.py:148) |
| Documents page | Aggregate charts, an "Add documents" card, flat document tables (Mine and Public, or All for admins), and a "Clear the index" card | [DocumentsPage.tsx](frontend/src/pages/DocumentsPage.tsx) |
| Upload | Saves into `documents/users/<uid>/` **flat**. **Does not start indexing**: the browser chains `startIndexing` after the upload, so closing the tab between the two leaves files unindexed. | [documents.py:99](backend/app/api/documents.py:99), [useLibrary.ts](frontend/src/hooks/useLibrary.ts) |
| Indexing runs | **One global lock.** A second `POST /api/index` while any run is going gets 409; nothing queues it. | [indexing_service.py:158](backend/app/services/indexing_service.py:158) |
| Folders | `/api/folders` is about admin-registered **library roots** on disk, not user folders. Inside `users/<uid>/` there are no subfolders today, but discovery uses `rglob` and `owner_for` reads only the first path part, so `users/<uid>/a/b/x.pdf` is already indexed with the right owner. | [folders.py](backend/app/api/folders.py), [ownership.py:32](backend/app/services/ownership.py:32) |
| Document id | `sha256` of the content, plus the owner for user files. **The path is not part of it**, so moving a file within one owner keeps its id. | [ownership.py:46](backend/app/services/ownership.py:46) |
| Moved files (bug) | A file moved on disk within one owner is skipped as already indexed, but its manifest `filepath` and its Qdrant `filepath`/`folder` are **not updated**. `/file` then returns 404 and hits show the old location. | [indexing_service.py:313](backend/app/services/indexing_service.py:313) |

### Three consequences that shape the design

**a. Folders live in the database; files never move on disk.** Uploads keep landing flat
in `documents/users/<uid>/`, so ownership stays a pure function of the path (accounts
spec §0a) and nothing about indexing changes. The folder tree and which folder each file
sits in are rows in `data/access.db`. That database is the one that is backed up, not
the manifest, which is a rebuildable cache. So clearing the index, rebuilding the
manifest or re-indexing never loses the folder structure, and backing up `data/` saves
it. A move is one `UPDATE`. There is no rename on disk, no Qdrant write and no
re-embedding, so it is instant, cannot leave disk and index out of step, and works while
indexing runs, even on files not indexed yet.

The cost: the folder layout cannot be seen in Explorer or Finder, and it cannot be
rebuilt from disk. A lost `access.db` puts every file back at the root of its tree,
already the case for accounts, which is why the README says to back it up.

**b. Moves stay within one owner.** Moving a file to another owner (library ↔ user,
user ↔ user) would mean moving it on disk, which changes its document id, re-embeds it
and drops its public flag. **This spec allows moves within one owner's tree only.**

**c. Highlighting has to be found in the browser.** No offsets or boxes are stored, and
the chunk text is not a clean substring of the page. The viewer therefore finds the
passage in the rendered document's text layer on the pages the hit names (§2.3). Storing
offsets at index time would mean re-indexing every document, so it stays a later option
(§6).

---

## 1. Slice 1: search-first shell

### 1.1 Layout

**Home (`#/`), logged in or not:**

```
                                                         [⚙]  (D)     ← or [Log in]

                              DocSage                        ← wordmark, "Doc" + "Sage"

              [ 🔍  Search or ask in Chinese, Korean or English     ]

                                                                       (privacy line)
```

- The mockup's buttons ("DocSage Search", "I'm Feeling Lucky"), the microphone, the
  camera, "Images" and the apps grid are **left out**. Enter searches.
- The search box is rounded and centred, at most 584 px wide and 46 px high, and focused
  on load.
- The footer keeps the one-line privacy note in small, quiet type, as Google's footer
  does.
- The colours follow the theme. The dark theme matches the mockup: background `#202124`,
  search box `#303134`, "Sage" in the brand blue. The wordmark is text, not an image.
- `HeroPage` and its stats and feature cards are **removed**.

**Results (`#/search?q=…`):**

```
 DocSage  [ 🔍  how often should the seals be replaced     ✕ ]          [⚙]  (D)
 ───────────────────────────────────────────────────────────────────────────────
 12 results · 84 ms     [10 results ▾] [Any language ▾] [Mine and public ▾]
 ┌ Answer ─────────────────────────────┐
 │ …streamed answer with [1] [2]…      │
 └─────────────────────────────────────┘
 Maintenance manual.pdf · p. 14 · Public
 Seal replacement intervals          ← heading, as the blue title line
 …snippet with the query terms bold…
```

- The header is one row: a small wordmark (a link home), the search box, and the same
  top-right buttons. It sticks to the top.
- The filters become one quiet "tools" row under the header, as Google's "Tools" row
  does. They are the same filters as today: results per search, language, and scope (or
  owner and visibility for admins). A logged-out visitor sees no scope filter, because
  they only ever see public documents.
- The answer panel sits above the results, where Google puts its AI overview. Its
  behaviour does not change.
- Each result shows the source line (filename · page · Public tag), the heading or first
  line as a title, and a two-line snippet. Clicking anywhere on it opens the viewer
  (slice 2).
- The query lives in the URL (`?q=`), so Back returns to the previous search, and a
  results link can be bookmarked or opened in a new tab. Typing a new query and pressing
  Enter replaces it.
- The "Add more documents" button above the results goes away. Adding documents now
  belongs to the document manager.

**Top-right buttons, on every screen:**

| Button | Logged out | Logged in |
|---|---|---|
| Settings ⚙ | Opens the settings modal | Same |
| Avatar | A **Log in** button (primary, like Google's "Sign in") that opens the login modal | A round avatar with the username's first letter, its colour derived from the username. It opens the account menu. A red badge shows pending reset requests for admins. |

### 1.2 Account menu (logged in)

```
  (D)  deepblue   [Admin]
  ─────────────────────────
  📁  Manage documents        ↗   ← opens #/drive in a new tab
  🔑  Change password             ← modal
  👥  Users (3)                   ← admin only, page
  🛠  Admin tools                 ← admin only, page (today's #/admin)
  ─────────────────────────
  ↪  Log out                      ← stays on the current screen, now logged out
```

- **Manage documents** calls `window.open('#/drive', '_blank', 'noopener')`. The session
  cookie is shared, so the new tab is already logged in.
- **Appearance** moves into the settings modal and leaves this menu.
- Logging out keeps the visitor on the same screen. A results page re-runs the search,
  which now returns public documents only.

### 1.3 Modals that replace pages

| Modal | Opened by | Contents | Notes |
|---|---|---|---|
| **Log in** | The Log in button; any 401 from an action that needs a login | Username, password, "Forgot your password?", "Create an account" (only if registration is open) | Register and forgot-password are **steps inside the same modal**, not separate pages. On success the modal closes and the current screen refreshes in place. |
| **Change password** | Account menu; forced after login when `must_change_password` | The current form | When forced, it cannot be closed: there is no ✕, Esc does nothing and the mask is not clickable, the only other action is Log out, and it opens on every screen until the password is changed. |
| **Settings** | ⚙ | The tabs below | Width 720. The tab is remembered in `localStorage`, not in the URL. |
| **First-run setup** | `setup_required` from `/api/auth/status` | The current setup form | It cannot be closed. It appears only when there are no users. The backend's loopback rule stays. |

**Settings tabs by role:**

| Tab | Logged out | User | Admin |
|---|---|---|---|
| Appearance (today's `AppearanceSettings`) | ✓ | ✓ | ✓ |
| Search (answers switch, results per search, default language, preview lines, highlight terms) | ✓ | ✓ | ✓ |
| Developer | — | — | ✓ |
| Administration (Manage users, Admin tools, and the "registration open" switch moved here from the Users page) | — | — | ✓ |
| System (privacy note, `DeviceStatus`) | — | ✓ | ✓ |

These settings stay browser-local, as today. Only "registration open" is stored on the
server.

### 1.4 Routes after slice 1

| Route | What it shows |
|---|---|
| `#/` | Home |
| `#/search?q=` | Results. Without `q` it redirects to `#/`. |
| `#/drive` | Document manager (slice 3; until then, today's Documents page) |
| `#/view/:documentId?chunk=&q=` | Full-tab viewer (slice 2) |
| `#/admin`, `#/admin/users` | Unchanged pages, admin only, under the compact header |
| `#/login`, `#/register`, `#/forgot-password`, `#/settings`, `#/account/password`, `#/setup`, `#/documents` | **Redirects** for old bookmarks: to `#/` with the matching modal open, and `#/documents` to `#/drive` |

`RequireAuth` remains only on `#/drive`, which shows the login modal over an empty page
when logged out, and on the admin pages. `PublicOnly`, `LoginPage`, `RegisterPage`,
`ForgotPasswordPage`, `ChangePasswordPage`, `SettingsPage`, `HeroPage` and `SetupPage`
are removed. Their form bodies are kept as components inside the modals.

### 1.5 Backend: anonymous access to public documents

A logged-out request is scoped to public documents, using the same filter a user's
"Only public" choice uses today.

| Route | Today | After |
|---|---|---|
| `POST /api/search` | `active_user` | `optional_user`. Anonymous: `AccessScope(user_id=None…)` must **not** be used, since that means admin. Use a new `AccessScope.anonymous()` that is `mode="public"` with no user. |
| `POST /api/ask` | `active_user` | Same as search. Retrieval is public-only, so the answer can only cite public passages. |
| `GET /api/documents/{id}/file` | `active_user` + `readable_or_404` | `optional_user`. Anonymous may read only `visibility == public`. Otherwise 404, never 401, so the response does not reveal that the document exists. |
| `GET /api/documents/{id}/passages/{chunk_index}` (new, §2.4) | — | Same rule as `/file` |
| `GET /api/health/ready` | `active_user` | `optional_user`. Anonymous gets the answers-available flag only, with no device or model details. |
| Everything else (`/documents` list, `/index`, upload, delete, admin) | — | Unchanged: login required |

- **The guard moves from the router to the route.** The search router is mounted
  without `signed_in` ([main.py:90](backend/app/main.py:90)), and each route declares
  `optional_user` or `active_user` itself. A test enumerates every route and asserts its
  guard, so a future route cannot be public by accident.
- **A user who must change their password** is treated as anonymous on these routes
  until they change it. This matches today's rule that such a user can read nothing.
- **Redaction stays.** An anonymous hit has `filepath=""`, `owner_id=None` and
  `is_mine=false`.
- **CSRF.** `/api/search` and `/api/ask` are POSTs and already need `X-DocSage: 1`. The
  anonymous client sends it like any other.
- **Exposure.** With `run.bat lan`, public documents become searchable by anyone on the
  network without an account. That is the intent of "public", but the README and
  `README-FIRST.txt` must say it in so many words (slice 4).

### 1.6 Slice 1 acceptance

- S1.1 Logged out, `#/` shows the wordmark, the search box, ⚙ and **Log in**, and no nav
  bar.
- S1.2 Logged out, a search returns public hits only. A private document's text never
  appears (backend test, with private and public documents from two owners).
- S1.3 Logged out, `/file` and `/passages` of a private document return 404, and of a
  public document return 200.
- S1.4 Enter on home navigates to `#/search?q=…` with the results layout, and ⚙ and the
  avatar are still there. Back returns home.
- S1.5 ⚙ opens a modal, never a page. A logged-out visitor sees two tabs, a user four,
  an admin five.
- S1.6 Log in → the modal closes, the avatar shows the first letter, and the current
  results refresh to include the user's own documents.
- S1.7 `must_change_password` → the change-password modal cannot be dismissed.
- S1.8 Account menu → "Manage documents" calls `window.open` with `#/drive` and
  `_blank`.
- S1.9 Each old route redirects as in §1.4.
- S1.10 A route-guard table test covers every `/api` route.

---

## 2. Slice 2: the document viewer

### 2.1 Behaviour

- Clicking a result opens the **right-hand panel with the document itself**. The
  passage text block, the relevance ring and the tag row are removed from the panel. The
  relevance score moves to developer mode, and the passage is shown by highlighting it in
  place.
- The panel width is `clamp(560px, 50vw, 960px)`. On a screen at least 1200 px wide the
  result list stays visible and clickable beside it, as today. Clicking another result
  swaps the document, or just scrolls if it is the same document.
- **Panel header:** filename, page indicator (`14 / 220`), zoom − / +, **Open in new
  tab** (↗ `#/view/<id>?chunk=<n>&q=<query>`), **Download**, close.
- ↑/↓ in the result list keep moving the panel along, as today.
- The full-tab viewer (`#/view/…`) is the same component at full width, with the compact
  header. It works logged out for public documents.

### 2.2 Rendering

| Type | Library | How |
|---|---|---|
| PDF | `pdfjs-dist` (bundled; the worker is served from our own build, no CDN) | Fetch `/api/documents/{id}/file` as an `ArrayBuffer`. Render pages lazily as they scroll into view, with the text layer on. Scroll to `page_start`. |
| DOCX | `docx-preview` (bundled) | Fetch the same URL as a `Blob` (the `attachment` disposition does not matter to `fetch`), then `renderAsync` into the panel with page breaks on. |

- Both libraries must work with no network. Nothing may load from outside `127.0.0.1`,
  including the pdf.js worker, CMaps and standard fonts (copy them into `dist/` at build
  time and point `cMapUrl` / `standardFontDataUrl` there). Acceptance V2.7 checks this.
- A file that cannot be rendered (corrupt, password-protected, or a DOCX feature
  docx-preview lacks) shows "Can't preview this file" with **Download** and a passage-text
  fallback (today's `ResultDetail` body).

### 2.3 Highlighting the passage

The viewer receives the hit (`text`, `heading`, `page_start`, `page_end`) and the query.

1. **Passage text.** `passageBody(hit)` (heading stripped), split into segments at
   sentence ends (`。！？.!?;`) and line breaks. Segments shorter than 8 characters are
   dropped.
2. **Normalise both sides the same way:**
   - NFKC
   - Drop soft hyphens and end-of-line hyphens (`-\n`), as the extractor joins them
   - Collapse whitespace to one space
   - Remove whitespace between two CJK characters, because PDF text layers split CJK runs
     at arbitrary points
3. **Search window.** PDF: the text layer of `page_start-1 … page_end+1`, joined in
   reading order, with a map from each normalised character back to its text-layer item
   and offset. DOCX: the whole rendered document's text nodes, because DOCX pages are
   approximate. Matches nearest to the approximate page win ties.
4. **Mark every segment found**, exact match first, then the longest common substring of
   at least 60% of the segment. The overlap from the previous chunk is simply another
   segment; marking it is harmless.
5. **Paint.** PDF: overlay rectangles computed from the text-layer spans' boxes; spans
   are not rewritten, so selection and copy keep working. DOCX: wrap the matched ranges in
   `<mark class="passage-hit">`.
6. **Scroll** the first mark into the middle of the panel.
7. **Query terms** get a second, lighter highlight across the visible pages when
   "Highlight query terms" is on, using the same term splitter as the snippets
   (`highlight()` in [passage.tsx](frontend/src/components/passage.tsx)).
8. **Fallback.** If under 30% of the passage's characters were found, show a quiet notice
   ("Couldn't pinpoint the passage; showing page 14"), scroll to `page_start`, and keep
   the query-term highlights.

The colours are `--passage-hit` (amber, 35% alpha) and `--term-hit` (yellow, 25%), each
defined for light and dark.

### 2.4 Backend

- **`GET /api/documents/{id}/passages/{chunk_index}`** →
  `{document_id, chunk_index, text, heading, page_start, page_end, file_type}`. The full
  tab uses it to get the passage when opened from a link. Access is as in §1.5. It reads
  from Qdrant by point id `uuid5(document_id:chunk_index)`.
- `/file` gains `ETag: <file_hash>` and `Cache-Control: private, max-age=0,
  must-revalidate`, so moving between hits in the same document does not download it
  again.

### 2.5 Slice 2 acceptance

- V2.1 A PDF hit on page 14 renders the PDF, scrolled so page 14 is visible, with at
  least one `.passage-hit` overlay.
- V2.2 A DOCX hit renders the document, with a `<mark class="passage-hit">` around the
  passage.
- V2.3 Highlight coverage on the eval set. The answer eval documents plus one Korean and
  one Chinese PDF, run through a scripted test of the matcher on extracted text, give at
  least 90% of hits found at ≥ 30% coverage. This is a Vitest test of the pure matcher on
  fixtures, not a browser test.
- V2.4 CJK text whose PDF text layer is split mid-word still matches (unit test on the
  normaliser).
- V2.5 "Open in new tab" opens `#/view/<id>?chunk=<n>&q=…`, which renders the same
  document and highlight, including logged out for a public document.
- V2.6 A corrupt file shows the fallback with Download, and no exception is thrown.
- V2.7 No request leaves `127.0.0.1` while viewing (network log in the browser test).

---

## 3. Slice 3: the Drive-style document manager

### 3.1 Layout (`#/drive`, its own tab)

```
 DocSage  Documents                     [ 🔍 Search in documents ]         [⚙] (D)
 ┌───────────────────┬────────────────────────────────────────────────────────────┐
 │ [ + New ]         │ My documents › Manuals › Pumps              [☰ list|▦ grid]  │
 │                   │ ┌────────────────────────────────────────────────────────┐ │
 │ 📁 My documents   │ │ Name              Status      Pages  Modified   Size     │ │
 │   ▸ Manuals       │ │ 📁 Seals                       —     Oct 3      —        │ │
 │   ▸ Reports       │ │ 📄 P-200 manual.pdf ✓ Indexed  220   Oct 2      14 MB    │ │
 │ 🌐 Public         │ │ 📄 Notes.docx      ⟳ Indexing  ~4    Oct 8      40 KB    │ │
 │ 📚 Library  (adm) │ │ 📄 Scan.pdf        ⚠ No text   12    Oct 8      2 MB     │ │
 │ 👥 Users    (adm) │ └────────────────────────────────────────────────────────┘ │
 │                   │                                                            │
 │ 34 documents      │                                     ┌ Indexing 2 of 5 ───┐ │
 │ 5,812 passages    │                                     │ ✓ a.pdf            │ │
 │ 2 need attention ›│                                     │ ⟳ b.docx  40%      │ │
 └───────────────────┴─────────────────────────────────────┴────────────────────┴─┘
```

- **Left rail:**
  - **New** opens a menu: Upload files, New folder.
  - The folder tree.
  - **Public** (documents shared with everyone, read-only for those who don't own them).
  - For admins, **Library** (the library tree, including registered folders) and
    **Users** (each user's tree).
- **Main area:** breadcrumb, a list/grid toggle (remembered), sortable columns, and
  multi-select with checkboxes and Shift/⌘-click.
- **The summary is minimised** to the three lines at the bottom of the rail: documents,
  passages, and "*n* need attention", which filters the list to failed or unsupported
  documents. The charts (`LibraryAggregates` full view) are gone from this page. The
  admin page keeps them.
- **Clear the index** moves to Settings › Administration, admin only, with the same
  confirmation.
- **The search box in the header filters by filename** within the current view. It is
  not semantic search; that stays in the main tab.
- **"Not indexed" in the rail.** When the tree holds files that are not indexed, the
  rail shows **Index now (*n*)** above the summary (§3.3).
- **Status chips:**
  - Uploading
  - Waiting to index (queued)
  - Indexing
  - Indexed
  - **Not indexed**: on disk, with no index record and nothing queued, e.g. after a
    restart cleared the queue
  - No text (needs OCR)
  - Failed (with the error on hover)
  - Duplicate: an identical file already indexed elsewhere under the same owner

### 3.2 Actions

| Action | Where | Who |
|---|---|---|
| Upload files | **New**, drag files onto the main area (into the current folder), drag onto a folder in the tree | The tree's owner (admins: the library and any user) |
| New folder, rename folder | **New**, right-click | Same |
| Open | Double-click or Enter: a file opens `#/view/<id>` in a new tab (no chunk, no highlight); a folder opens it | Anyone who can read it |
| Move to… | Right-click, a toolbar button with a folder picker, or **drag and drop** onto a folder in the list, the tree or the breadcrumb | Owner, within the same owner's tree only (§0b). Works on any file, whatever its status, including while indexing runs. |
| **Index** | Right-click, toolbar (for a selection), **Index now (*n*)** in the rail (for the whole tree) | Owner, admin |
| **Retry** | Right-click a Failed file | Same. Re-extracts with `force`. |
| Download | Right-click | Anyone who can read it |
| Make public / private | Right-click, toolbar | Admin |
| Delete | Right-click, toolbar, Delete key; confirmation | Owner. A folder: confirm with the count of documents inside. |

- **Renaming files is not offered.** The name shown is the file's name on disk, which is
  also the name search results show. A rename that changed only the manager would make
  the two disagree.
- Deleting a file that is being indexed or queued is refused with "Wait until it is
  indexed". This is the only action a run blocks.
- A drop target in another owner's tree shows a "not allowed" cursor and does nothing.
- Files in registered external library folders (the `/api/folders` roots outside
  `documents/`) can be placed in library folders like any other file, since a move does
  not touch the disk. Delete still only un-indexes them, as today; DocSage does not
  delete files it does not hold.

### 3.3 Indexing: automatic after upload, and by hand

**The server starts indexing after an upload, not the browser.** Closing the tab can no
longer leave files unindexed.

- `POST /api/documents/upload` gains a `folder_id` form field (default: the tree root).
  It saves the files flat into the owner's directory as today, records each file's
  folder (§3.5), then calls `indexing.request_run(scope=<owner>, paths=<saved files>,
  trigger="upload")`.
- **`request_run` queues instead of refusing.** If no run is going, it starts one. If one
  is going, the request joins a pending queue; requests for the same scope merge their
  paths. When a run ends, the next pending request starts. `POST /api/index` uses the
  same path and returns `202 {status: "queued"}` instead of 409. The single-run lock
  stays: one run at a time keeps memory use bounded on a 16 GB machine.

**Index by hand.** Files can still end up uploaded but not indexed:

- the server stopped while they were queued (the queue is in memory)
- a run failed part-way
- an admin dropped files into `documents/` by hand
- they failed and the cause is now fixed

For those:

- `POST /api/drive/index {owner, file_ids?: [...], force?: false}` queues a run limited to
  those files, or to every not-indexed file in the tree when `file_ids` is omitted (the
  rail's **Index now (*n*)**). It returns 202 with the number queued. **Retry** is the
  same call with `force: true` for one failed file.
- **A path-limited run must not sweep.** Today a run deletes every record in its scope
  that it did not see ([indexing_service.py:387](backend/app/services/indexing_service.py:387)).
  A run given `paths` processes only those files and skips the sweep entirely; otherwise
  indexing one file would un-index every other file the owner has. This is the riskiest
  line in the slice, and it gets its own test (D3.4).
- **On startup** the backend compares each tree's files on disk with the manifest. If any
  user has files that are neither indexed, failed nor unsupported, it queues a run for
  them, so a restart mid-queue heals by itself. The comparison is a directory listing
  plus one manifest query; it does not hash files.

"Not indexed" is computed, not stored: the file is on disk, has no manifest record at
its path, and is not in the current or pending run.

### 3.4 The progress panel (bottom right)

A small floating panel, 360 px wide, like Drive's upload panel. It appears as soon as an
upload or an **Index** action starts, and it stays on the manager page only.

- **Header:** "Uploading 3 files" → "Indexing 2 of 5" → "5 files indexed" (or "4
  indexed, 1 failed"), with collapse ▾ and close ✕. Close is allowed only when nothing is
  uploading; indexing carries on regardless.
- **One row per file:**
  - Upload progress from `XMLHttpRequest.upload.onprogress` (`fetch` has no upload
    progress).
  - Then "Waiting to index".
  - Then "Indexing · reading / splitting / embedding 40%", from `current_stage` and
    `current_file_progress`.
  - Then ✓ or ⚠ with the reason, and **Retry** on a failure.
  - A finished row links to the file in the list.
- **Data:** `GET /api/index/status` gains `my_files: [{file_id, name, state, stage?,
  progress?, document_id?, error?}]`. These are the caller's own files in the current and
  pending runs. Other people's runs stay redacted as today. The panel polls every second
  while it has unfinished rows, and every 5 s otherwise; this replaces today's library
  poller on this page.
- With reduced motion on, progress bars do not animate.

### 3.5 Backend: folders in the database

Two new tables in `data/access.db`, the database that is backed up (§0a), managed by a
new `DriveStore` beside `AccessStore`:

```sql
CREATE TABLE drive_folders (
    folder_id   TEXT PRIMARY KEY,           -- uuid4
    tree        TEXT NOT NULL,              -- a user_id, or 'library'
    parent_id   TEXT REFERENCES drive_folders(folder_id) ON DELETE CASCADE,  -- NULL = root
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (tree, parent_id, name)          -- see note on NULL below
);

CREATE TABLE drive_files (
    file_id     TEXT PRIMARY KEY,           -- uuid4, stable for the life of the file
    tree        TEXT NOT NULL,
    path        TEXT NOT NULL UNIQUE,       -- the file on disk, as the manifest stores it
    folder_id   TEXT REFERENCES drive_folders(folder_id) ON DELETE SET NULL,  -- NULL = root
    added_at    TEXT NOT NULL
);
```

- **A file is keyed by its path on disk, not its document id.** The path never changes
  (files do not move), and it exists from the moment of upload, before there is any
  document id. The document id is joined in from the manifest by path, and it changes
  when the content does, which would orphan a row keyed by id. Two identical uploads are
  two files with one document id; the second shows **Duplicate**.
- SQLite treats NULLs as distinct in `UNIQUE`, so root-level name uniqueness is enforced
  in `DriveStore`, inside the same transaction as the insert.
- **Reconciliation.**
  - A file on disk with no `drive_files` row appears at the root of its tree, and gets
    its row the first time it is listed. This covers existing documents after the
    upgrade, and files an admin drops into `documents/` by hand.
  - A row whose file is gone from disk is deleted on listing and by the indexing sweep.
  - Deleting a document through DocSage deletes its row.
  - Registered external folders contribute their files to the library tree in the same
    way.
- **Upgrade.** No migration. Every existing document appears at the root of its owner's
  tree, or the library's.

New router `/api/drive`, guarded by `active_user`. `tree` is `me`, or for admins a user
id or `library`. A non-admin's `tree` must be `me` (403 otherwise).

| Route | Body / query | Does |
|---|---|---|
| `GET /api/drive/tree?tree=` | — | Every folder in the tree, nested: `{folder_id, name, folders[], file_count}` |
| `GET /api/drive/list?tree=&folder_id=` | — | The folders and files directly in a folder. Files are `{file_id, name, size, modified_at, state, ...DocumentSummary fields when indexed}`. |
| `POST /api/drive/folders` | `{tree, parent_id, name}` | Creates a folder. 409 if the name exists there. |
| `PATCH /api/drive/folders/{folder_id}` | `{name?, parent_id?}` | Renames and/or moves a folder. 400 if it would go inside itself or a descendant. |
| `DELETE /api/drive/folders/{folder_id}` | — | Deletes the folder, its subfolders and their files (as `DELETE /api/documents/{id}`, so library files are only un-indexed). 409 if any file in it is being indexed or queued. |
| `POST /api/drive/move` | `{tree, file_ids: [...], folder_ids: [...], to: folder_id \| null}` | Moves files and folders: `UPDATE`s only. 403 if any item or the target is in another tree; 400 for a folder moved into its own subtree. Name clashes among folders get " (2)". |
| `POST /api/drive/index` | `{tree, file_ids?, force?}` | §3.3 |
| `GET /api/drive/public` | — | Public documents, flat, with the owner's username |

- **Names** are trimmed, 1 to 120 characters, with no `/`, `\` or NUL, and not `.` or
  `..`. They are never used as paths, so there is no traversal risk, but they appear in
  breadcrumbs and must stay readable.
- **Depth** is limited to 20 levels and a tree to 5,000 folders, so a runaway client
  cannot make listing slow.

**Fix the moved-file bug** (§0) in this slice too, even though DocSage itself no longer
moves files. An admin can still move library files by hand. In `_process`, when an
already indexed id is found at a different path and its recorded path no longer exists,
update the manifest and Qdrant `filepath`/`filename`/`folder` instead of skipping
silently, and move the `drive_files` row to the new path, keeping its folder.

### 3.6 Slice 3 acceptance

- D3.1 Upload two files into `Manuals` → both appear in the panel, go through uploading,
  waiting and indexing to indexed, and are listed in `Manuals`. On disk they are in
  `documents/users/<uid>/`.
- D3.2 Close the tab right after the upload request returns → the files are still
  indexed (backend test: upload returns, the run is queued, the run completes, with no
  client call).
- D3.3 An upload while another user's run is going is queued, not refused, and runs
  afterwards.
- D3.4 **Index on one file does not un-index the others.** The owner has ten indexed
  files; `POST /api/drive/index` with one `file_id` leaves all ten records and their
  Qdrant points in place.
- D3.5 **Index now** on a tree with three not-indexed files indexes exactly those three;
  the embedder sees no other file.
- D3.6 A restart with files still queued → after startup they are queued again and
  indexed.
- D3.7 Moving files and folders writes only `drive_*` rows. Qdrant, the manifest and the
  disk are unchanged (asserted), and the move succeeds while a run is going.
- D3.8 After `POST /api/index/clear` and a full re-index, and after
  `scripts/rebuild_manifest.py`, every file is still in its folder.
- D3.9 A move into another tree returns 403, a folder into its own subtree returns 400,
  and the UI offers neither.
- D3.10 Existing documents (an upgraded install) all appear at the root of their tree.
  A file deleted by hand on disk disappears from the listing and its row is gone.
- D3.11 A file moved by hand on disk heals on the next run and keeps its folder (the
  regression test for the bug in §0).
- D3.12 The summary shows three lines. No chart renders on `#/drive`.
- D3.13 Logged out, `#/drive` shows the login modal. After logging in it loads in place.

---

## 4. Slice 4: documentation

- `docs/user-spec.md`: the new home and results, the viewer, the manager, the modals, and
  what logged-out visitors can do.
- `README.md`: the anonymous public search, and the "Accounts and ownership" section
  updated with folders and moves within an owner. `data/access.db` now also holds the
  folder structure, so "back it up" covers that too, and the folders are not visible on
  disk.
- `windows/README-FIRST.txt`: with `run.bat lan`, **public documents can be searched by
  anyone on the network without logging in**.
- The accounts spec: a note that §1.6's "everyone logs in" is superseded for public
  documents by this spec.

---

## 5. Not in scope

- "I'm Feeling Lucky", voice search, image search, the "Images" link, the apps grid
- Moving documents between owners, or between the library and a user. That would need
  re-embedding and carrying the public flag, so it gets its own spec if wanted.
- Renaming files (§3.2), and showing the folder layout on disk
- Filtering search results by folder. That would need the folder in every Qdrant point
  and a re-write on every move, which is what keeping folders in the database avoids.
- Sharing with specific users (Drive's "Share"). Visibility stays private or public.
- Editing documents, version history, trash and restore
- Folder upload (dropping a whole directory). Files only for now.
- OCR for scanned PDFs. They keep showing "No text".

## 6. Risks and later options

| Risk | Mitigation |
|---|---|
| Highlight coverage is poor on PDFs with odd text layers (columns, tables) | The fallback in §2.3 step 8, plus acceptance V2.3 on real files. Later: store the PyMuPDF block boxes per chunk at index time (they are already computed in `_page_regions` and thrown away) and highlight from boxes, which needs a re-index. |
| `docx-preview` renders some documents differently from Word | The full-tab view and Download are always one click away |
| Anonymous `/api/ask` loads the LLM for anyone on a LAN install | The model is local and runs one request at a time (`-np 1`). Accepted. A per-address limit can be added later if it matters. |
| Large PDFs (500+ pages) in the panel | Lazy page rendering. Only the hit's pages render at first. |
| The bundle grows by about 1.5 MB with pdf.js and docx-preview | Load both with dynamic `import()` when the viewer first opens, so the home page stays light |

## 7. Order and size

Slice 1 → 2 → 3. Each can ship alone:

- **Slice 1** is mostly frontend, with a small backend change for anonymous scope.
- **Slice 2** is frontend plus one endpoint.
- **Slice 3** is the largest: the folder tables and router, the run queue with
  path-limited runs, the startup check and the bug fix, plus the new page.

A plan with tasks per slice follows this spec in `docs/superpowers/plans/`.

---

## As built (2026-10-08)

What differs from the text above, and why:

- **Settings tabs (S1.5).** A logged-in user sees three tabs (Appearance, Search, System),
  as the §1.3 table says; S1.5's "four" was a miscount.
- **The "registration open" switch** stays on the Users page, which the Administration
  tab links to, rather than moving into the tab.
- **`GET /api/drive/public`** was not added. The Public view reads `GET /api/documents`,
  which already returns the public documents a caller may read.
- **Uploads go into one's own tree only.** In the Library and other users' views, upload
  is not offered; the Library is filled by putting files into `documents/` and indexing
  them there.
- **Deleting a file** that has no index record yet (Not indexed) is not offered; it can be
  indexed and then deleted.
- **Moves while indexing:** allowed for every file, as §0a makes them rows only. Deleting
  still waits for a run to finish (409), as `DELETE /api/documents/{id}` always has.
- **Indexing queue:** `request_run()` reserves or queues; `drain()` runs the reservation
  and then everything queued behind it. A path-limited run never sweeps. Uploads left
  waiting by a restart are queued again at startup (`resume_uploads` in `main.py`).
- **The highlight** in Word files uses the CSS Custom Highlight API, falling back to
  `<mark>` where the browser lacks it; in PDFs it is boxes measured from pdf.js's text
  layer, as §2.3 says.
- **The old Documents page** and its parts (aggregate charts, import card, job panel,
  document table) were removed with it.

