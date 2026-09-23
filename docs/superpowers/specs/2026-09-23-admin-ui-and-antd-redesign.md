# Admin pages and an Ant Design interface: Spec

**Date:** 2026-09-23
**Branch:** `main` (following the house convention of the previous spec)
**Status:** Draft, awaiting approval

Two things, delivered as five shippable slices. Each slice leaves the app working:

1. **Shell** — routing, Ant Design, the settings gear (everything else hangs off this)
2. **Hero page** — the new landing screen
3. **Search page** — polished search row, height-limited cards, detail side panel
4. **Documents page** — aggregation diagrams, the minimise animation, the add-documents card
5. **Settings and Admin** — UI config, extraction inspector, index-structure inspector

Slices 2–4 are user-visible polish and touch only the frontend. Slice 5 is the only one
that adds backend endpoints.

---

## 0. Current state (checked against the code)

| Area | Today | Where |
|---|---|---|
| Navigation | Three tabs (`search`/`documents`/`indexing`), all mounted, hidden with `hidden` | [App.tsx:19](frontend/src/App.tsx:19) |
| Routing | None. No router dependency, no URLs, no deep links | `frontend/package.json` |
| UI library | None. 1065 lines of hand-written CSS | [styles.css](frontend/src/styles.css) |
| Landing | The Search tab is the landing screen. No introduction anywhere | [App.tsx:35](frontend/src/App.tsx:35) |
| Search controls | One row: input + button, then two bare `<select>`s for top-K and language | [SearchPage.tsx:38](frontend/src/pages/SearchPage.tsx:38) |
| Search input width | `.search-bar input` flexes to fill the row; no max width | `styles.css` |
| Result card | Unbounded height; long passages truncate to a "Show more" inline expansion | [SearchResult.tsx:66](frontend/src/components/SearchResult.tsx:66) |
| Result detail | Inline expansion only. No panel, no per-result detail view | [SearchResult.tsx:69](frontend/src/components/SearchResult.tsx:69) |
| Documents page | A three-number text summary and a table. No charts | [DocumentsPage.tsx:22](frontend/src/pages/DocumentsPage.tsx:22) |
| Adding documents | Lives on a separate **Indexing** tab: folders, upload, progress, history, clear | [IndexingPage.tsx:14](frontend/src/pages/IndexingPage.tsx:14) |
| Live progress | `useLibrary` polls every 500 ms while a job runs, 5 s when idle | [useLibrary.ts:29](frontend/src/hooks/useLibrary.ts:29) |
| Settings | None. `top_k` and language reset on reload | [SearchPage.tsx:18](frontend/src/pages/SearchPage.tsx:18) |
| Admin | None | — |
| Backend routes | `health`, `search`, `index`, `documents`, `folders`, all under `/api` | [main.py:68](backend/app/main.py:68) |
| Static serving | `StaticFiles(directory=FRONTEND_DIST, html=True)` mounted at `/` | [main.py:76](backend/app/main.py:76) |
| Extracted text | **Never persisted.** Only chunk text reaches Qdrant | [indexing_service.py:249](backend/app/services/indexing_service.py:249) |
| Chunk payload | Has `chunk_index`, `page_start/end`, `heading`, `token_count`, `kind`, `text` | [qdrant_service.py:143](backend/app/services/qdrant_service.py:143) |
| Qdrant reads | `count_points()`, and `iter_document_payloads()` which drops `text` | [qdrant_service.py:224](backend/app/services/qdrant_service.py:224) |
| Manifest schema | `documents`, `index_jobs`, `library_folders` | [manifest_service.py:22](backend/app/services/manifest_service.py:22) |

### Three consequences that shape the design

**a. Extracted text has to be produced on demand.** The pipeline extracts, chunks,
embeds and throws the extraction away. Nothing on disk holds "what the PDF said before
it was cut up", which is exactly what the admin page needs in order to answer "did this
extract correctly?". So `GET /api/admin/documents/{id}/extraction` **re-runs the
extractor** against the file on disk. That costs a second or two per document and needs
the file to still exist — both acceptable for an admin tool, and it has the advantage of
showing what *today's* extractor produces, which is what you want when debugging an
extraction bug. It is never cached to disk: caching page text would duplicate document
content outside Qdrant for no benefit (§7).

**b. Deep links need either a hash or a backend change.** `StaticFiles(html=True)`
serves `index.html` for `/`, but returns 404 for an unknown path like `/admin`. Rather
than add an SPA catch-all to `main.py` (which has to be careful not to shadow `/api` or
`/docs`), this spec uses **`HashRouter`**: URLs become `/#/admin`, reload and bookmark
work, and the backend is untouched. If browser-style paths are wanted later, swapping to
`BrowserRouter` plus a catch-all route is a contained follow-up.

**c. The Indexing tab's contents do not disappear.** "We don't need tabs" removes the
tab bar, not the functionality. Folders, upload, job progress, job history and "clear the
index" all move onto the Documents page (§4), so no feature is lost in the redesign.

---

## 1. Shell: routing, Ant Design, navigation

### 1.1 Requirements

- R1.1 Five routes: `#/` (hero), `#/search`, `#/documents`, `#/settings`, `#/admin`.
  An unknown route redirects to `#/`.
- R1.2 A settings button is in the **top-right of every page**, including the hero.
- R1.3 The tab bar is gone. The header carries the product name (linking to the hero)
  and direct links to Search and Documents.
- R1.4 Search state (query, results, scroll) survives navigating away and back within
  a session.
- R1.5 Everything renders with no network access: no CDN, no webfont fetch, no remote
  icon sprite.

### 1.2 Dependencies

Added to `frontend/package.json` (all bundled by Vite, nothing fetched at runtime):

| Package | Why |
|---|---|
| `antd` ^5 | The component library the requirement names |
| `@ant-design/icons` ^5 | Icons, as React components — no sprite request |
| `react-router-dom` ^7 | `HashRouter`, `NavLink`, `useNavigate` |

Deliberately **not** added:

- `@ant-design/plots` / any charting library. The three diagrams in §4 are a donut, a
  bar row and a stat strip. Hand-rolled inline SVG plus antd's `Progress` and
  `Statistic` costs ~120 lines and no dependency, versus ~500 kB of G2 for three
  charts, on an app whose install is already a 2.5 GB model download.
- Any animation library. §4.4 is a CSS transition.
- Any webfont. antd's default font stack is system fonts; `-fontFamily` stays as is.

`prepare-offline.bat` needs no change: it already runs `npm --prefix frontend install`
and `run build` on a machine with internet, and ships only `frontend/dist` (`prepare-offline.bat:172`).

### 1.3 Design

- `main.tsx` wraps the app in `<ConfigProvider theme={...}>` and `<HashRouter>`.
- `App.tsx` becomes a layout shell: antd `Layout` with `Header` and `Content`, and
  `<Routes>`. The `useLibrary()` hook lifts to a `LibraryProvider` context so Documents,
  Admin and the hero counters share one poller instead of three.
- R1.4 is met by keeping search state in a `SearchProvider` context above the routes,
  not in `SearchPage` local state. Routes themselves unmount normally.
- Theme tokens come from the settings store (§5), so `ConfigProvider` re-renders when
  the user changes theme or density. Dark mode uses antd's `theme.darkAlgorithm`.
- The 1065-line `styles.css` is cut down to what antd does not cover: the result
  passage clamp, the aggregation-card collapse transition, the SVG chart styles, and
  the highlight mark. Anything antd handles is deleted, not left dead.

---

## 2. Hero page (`#/`)

### 2.1 Requirements

- R2.1 States, in one screen without scrolling at 1280×800: what the tool does, that it
  runs entirely locally, and what it can search.
- R2.2 Two large primary actions: **Search documents** → `#/search`, and
  **Manage documents** → `#/documents`.
- R2.3 Three or four feature points, each with an icon, covering: meaning-based search,
  cross-language search (Chinese / Korean / English), PDF and Word support, and privacy.
- R2.4 Shows live library numbers (documents indexed, passages searchable) when the
  backend is reachable, and says so plainly when it is not.
- R2.5 When nothing is indexed yet, the primary action is **Add your first documents**,
  not Search.

### 2.2 Design

- antd `Typography` for the headline and lede; two `Button size="large" type="primary"` /
  `type="default"` in a `Space`, each at least 200 px wide with an icon
  (`SearchOutlined`, `FolderOpenOutlined`).
- Feature points are a `Row`/`Col` of four bordered `Card`s, each with an
  `@ant-design/icons` glyph at 32 px in the accent colour: `BulbOutlined` (meaning),
  `GlobalOutlined` (languages), `FilePdfOutlined` + `FileWordOutlined` (formats),
  `LockOutlined` (privacy).
- The illustration (R2.3 "proper images") is **one inline SVG component**, not a raster
  asset: a stylised document stack with a magnifier, drawn with `currentColor` and the
  accent token so it themes with light/dark. No file in `public/`, nothing to 404 offline.
- Live numbers come from the library context: `documents.filter(status === 'indexed').length`
  and the sum of `chunks`, rendered with the existing `CountUp` component inside antd
  `Statistic`. On a fetch failure the strip renders "Backend not reachable" with a
  `Tag color="warning"`, and R2.2's buttons still work.
- The footer line ("Runs entirely on this machine. No document leaves it.") is kept and
  promoted to a visible badge on the hero.

---

## 3. Search page (`#/search`)

### 3.1 Requirements

- R3.1 The search input has a **maximum width of 680 px** and is centred, not stretched
  to the viewport.
- R3.2 Top-K and language become compact controls attached to the search row, not two
  loose full-width `<select>`s with wrapping labels.
- R3.3 A result card has a **bounded height**, and at least **three whole cards are
  visible without scrolling** on a 1280×800 viewport.
- R3.4 Clicking a card opens the **full detail on the right**, with the complete passage
  text, every field, and the open/download action.
- R3.5 A button on this page leads to the Documents page for adding more documents.
- R3.6 Keyboard and IME behaviour does not regress: Enter submits, and an in-progress
  IME composition never submits (the existing `isComposing` guard, `SearchBar.tsx:23`).

### 3.2 Layout

```
┌──────────────────────────────────────────── header · ⚙ ──┐
│                  [ search input ≤680px ] [Search]        │
│                  Results: 10 ▾   Language: Any ▾         │
├────────────────────────────┬─────────────────────────────┤
│ 12 results · 340 ms        │  ┌ detail ────────────────┐ │
│ ┌ card 1 ─── ≤192px ─────┐ │  │ filename · Page 12     │ │
│ ├ card 2 ────────────────┤ │  │ score 0.62 · zh        │ │
│ ├ card 3 ────────────────┤ │  │ heading                │ │
│ │ ...scrolls             │ │  │ full passage text      │ │
│ └────────────────────────┘ │  │ [Open page 12 ↗]       │ │
│ [+ Add more documents]     │  └────────────────────────┘ │
└────────────────────────────┴─────────────────────────────┘
```

- The search row is a `Space.Compact` of `Input` + `Button type="primary"`, wrapped in a
  `div` with `max-width: 680px; margin-inline: auto`. Top-K and language sit under it as
  small `Select`s with `variant="filled"`, `size="small"`, in a centred `Space`.
- Results list and detail are a two-column `Row` at `≥1200px` viewport width
  (`Col span={14}` / `span={10}`). Below 1200 px the detail becomes an antd `Drawer`
  with `placement="right"`, `width={min(520, 90vw)}`. The breakpoint is antd's `xl`.
- **R3.3 arithmetic**, 1280×800: header 64 + search block 116 + result meta 32 +
  add-documents row 48 + page padding 48 = 308 px of chrome, leaving 492 px. Three cards
  at `max-height: 152px` plus two 12 px gaps = 480 px. So: **card `max-height: 152px`,
  `gap: 12px`**, passage text clamped with `-webkit-line-clamp: 3` (configurable to 4 or
  6 in settings, §5 — 4 and 6 raise the max-height to 176 and 224 and drop the guarantee
  to 3 cards at 1280×900, which the settings help text says).
- The card keeps today's content — filename, page label, score, language tag, heading,
  clamped passage — as an antd `Card size="small" hoverable`. The score becomes a
  `Progress type="circle" size={36}` so it reads at a glance. The old inline
  "Show more" expansion is **removed**: the detail panel replaces it (R3.4).
- Selection: clicking the card, or Enter/Space when focused, selects it; the selected
  card gets `border-color: token.colorPrimary`. `↑`/`↓` move the selection when the list
  has focus. The first result is selected automatically after a search, so the panel is
  never empty next to a populated list.
- The detail panel shows every field of `SearchHit` including `filepath` and
  `chunk_index`, the unclamped text with query highlighting, and the existing open /
  download link (`SearchResult.tsx:86`). It also gets an **"Inspect passages"** link to
  `#/admin?document={id}&chunk={n}` (§6), visible only when the settings toggle
  "Show admin links" is on.
- R3.5 is a `Button type="dashed" icon={<PlusOutlined/>}` below the list:
  "Add more documents" → `navigate('/documents')`.
- Empty and error states become antd `Empty` and `Alert type="error"`, keeping today's
  wording, including the "Cannot reach the backend" message from `api.ts`.

---

## 4. Documents page (`#/documents`)

This page absorbs the Indexing tab (§0c).

### 4.1 Requirements

- R4.1 Shows the indexed-document list, with everything `DocumentList` shows today.
- R4.2 Shows **aggregate diagrams at the top**: status breakdown, per-language split,
  and top documents by passage count, plus the headline numbers.
- R4.3 An **Add documents** button; pressing it **animates the aggregation cards to a
  minimised state** and reveals a new card for adding documents.
- R4.4 The add-documents card carries folder management, file upload, the **Index
  documents** action, and **real-time progress**.
- R4.5 A button leads to the Search page.
- R4.6 The destructive "Clear the index" action survives, still behind a confirmation.

### 4.2 Aggregation diagrams

Three cards in a `Row`, all computed client-side from the documents the library context
already holds — no new endpoint:

| Card | Diagram | Data |
|---|---|---|
| Library | Four `Statistic`s: documents, searchable, passages, pages | counts over `documents[]` |
| By status | Inline SVG **donut**, one arc per status, with a legend | `groupBy(status)` — indexed / unsupported / failed / duplicate |
| By language | Horizontal `Progress` bars, one per language, longest first | `groupBy(language ?? 'unknown')` |
| Largest documents | Inline SVG **bar chart**, top 5 by `chunks` | `sortBy(-chunks).slice(0,5)` |

Chart colours come from antd theme tokens (`colorSuccess`, `colorWarning`, `colorError`,
`colorInfo`, `colorPrimary`) so light and dark both work, and each series also carries a
text label — colour is never the only channel. Every chart has a `<title>` and a
`role="img"` `aria-label` summarising it in words, and a visually-hidden table of the
same numbers, so the diagrams are readable by a screen reader.

### 4.3 Add-documents card

One antd `Card` titled "Add documents", containing, in order:

1. **Folders** — today's `FolderPanel`, rebuilt on antd `List` + `Input.Search` + `Popconfirm`.
2. **Upload** — today's `ImportPanel`, rebuilt on antd `Upload.Dragger`, accepting
   `.pdf,.docx` and calling the same `uploadDocuments()`.
3. **Index documents** — the primary button; disabled while a job runs.
4. **Progress** — an antd `Progress` driven by `processed_documents / total_documents`,
   the current filename and stage, and a live counter strip
   (indexed / skipped / unsupported / failed). Fed by the existing 500 ms poll
   (`useLibrary.ts:29`); no new polling and no websocket.
5. **Failures** — `Alert type="warning"` listing `status.failures` with file and reason.
6. **Recent jobs** — today's `JobHistory` on an antd `Table`, collapsed in a `Collapse`.

"Clear the index" (R4.6) stays at the bottom of the page in a `Card` with
`Popconfirm` + a red `danger` button, out of the add-documents flow.

### 4.4 The minimise animation

- Default state: aggregation cards expanded, add-documents card absent.
- Pressing **Add documents** sets `adding = true`:
  - the aggregation row animates to a minimised strip — the donut and bar charts fade
    and collapse to height 0, the four `Statistic`s shrink into a single inline row of
    `label: value` pairs;
  - the add-documents card mounts and animates in from `opacity: 0; translateY(-8px)`.
- Mechanism: a CSS transition on `grid-template-rows: 1fr` → `0fr` on a wrapper with
  `overflow: hidden`, plus `opacity`, **240 ms `ease-out`**. This animates to content
  height without measuring it in JS.
- A **Show summary** affordance on the minimised strip reverses it. Starting an indexing
  job does not auto-collapse or auto-expand anything; the user stays in control.
- The animation is skipped (state flips instantly) when either
  `prefers-reduced-motion: reduce` is set or the settings "Animations" toggle is off (§5).
- R4.5 is a `Button icon={<SearchOutlined/>}` in the page header → `navigate('/search')`.

---

## 5. Settings page (`#/settings`)

### 5.1 Requirements

- R5.1 Reached from the gear button in the top-right of every page.
- R5.2 Contains a clearly-labelled link to the Admin page.
- R5.3 Contains UI configuration that actually takes effect, and persists across restarts.
- R5.4 Settings are stored **only on this machine** and are never sent to the backend.
- R5.5 A **Reset to defaults** action.

### 5.2 The settings

| Setting | Values | Default | Effect |
|---|---|---|---|
| Theme | System / Light / Dark | System | `ConfigProvider` algorithm |
| Accent colour | 5 presets | antd blue | `token.colorPrimary` |
| Density | Comfortable / Compact | Comfortable | `ConfigProvider componentSize` + `token.sizeStep` |
| Results per search | 5 / 10 / 20 / 50 | 10 | Default `top_k`, replacing `SearchPage.tsx:18` |
| Default language filter | Any / zh / ko / en | Any | Search page initial filter |
| Passage preview lines | 3 / 4 / 6 | 3 | Result-card clamp (§3.2) |
| Detail view | Auto / Always drawer | Auto | Side panel vs `Drawer` (§3.2) |
| Highlight query terms | on / off | on | The existing `highlight()` in `SearchResult.tsx` |
| Animations | on / off | on | §4.4, and antd `motion` |
| Show admin links | on / off | off | The "Inspect passages" link in §3.2 |

### 5.3 Design

- One `useSettings()` hook over a `SettingsProvider`, persisted to `localStorage` under
  the single key `semantic-search.ui.v1` as one JSON object. Unknown or malformed
  content is ignored and defaults are used, so a hand-edited or stale value cannot break
  the app. No cookies, no backend call, no telemetry (R5.4, and §7).
- The page is an antd `Form layout="horizontal"` grouped into `Card`s: Appearance,
  Search, Advanced.
- R5.2: a `Card` titled "Administration" with body text "Inspect extracted text, the
  index structure, and how passages were split", and a `Button` → `#/admin`. It is a
  plain link, not a hidden or password-gated route: the whole app is already bound to
  loopback (`api_host: 127.0.0.1`, `config.py:82`) and there are no user accounts.
- A read-only "Backend" block at the bottom shows `GET /api/health/ready` — model
  loaded, device, precision, batch size, fallback reason — reusing `DeviceStatus`.

---

## 6. Admin page (`#/admin`)

Three sections, on an antd `Tabs` **within the page** (the tabs R1.3 removes are the
top-level navigation tabs; a tab strip inside one admin screen is a different thing —
if that reading is wrong, these become three collapsible sections instead).

### 6.1 Requirements

- R6.1 **Extracted text**: pick any known document and see the text the extractor
  produces from it, page by page, to judge whether extraction is correct.
- R6.2 **Index structure**: see how the index is built — the Qdrant collection's
  configuration and size, the manifest's tables and row counts, and the chunking
  settings in force.
- R6.3 **Passages**: for one document, see every passage, in order, with its index, page
  range, heading, token count and text, and see where one passage overlaps the next.
- R6.4 Everything on this page is **read-only**. No admin endpoint mutates anything.
- R6.5 A document that no longer exists on disk, or that failed extraction, reports that
  clearly instead of erroring blankly.

### 6.2 New backend endpoints

A new `backend/app/api/admin.py`, `include_router(admin.router, prefix="/api")` in
`main.py` before the static mount. All GET.

**`GET /api/admin/index/schema`** → `IndexSchemaResponse`

```jsonc
{
  "qdrant": {
    "collection": "pdf_passages",
    "exists": true,
    "vector_size": 1024,
    "distance": "Cosine",
    "points_count": 4821,
    "segments_count": 2,
    "payload_indexes": ["document_id", "language", "filename"],
    "payload_fields": [                       // one row per field the writer sets
      {"name": "document_id", "type": "keyword", "indexed": true,
       "description": "Which document the passage came from"},
      {"name": "page_start", "type": "integer", "indexed": false, "description": "..."}
      // ... every key of QdrantService._payload, qdrant_service.py:143
    ]
  },
  "manifest": {
    "path": "data/manifest.db",
    "tables": [
      {"name": "documents", "rows": 17,
       "columns": [{"name": "document_id", "type": "TEXT", "pk": true, "notnull": true}, ...],
       "indexes": ["idx_documents_filename", "idx_documents_status"]}
      // documents, index_jobs, library_folders
    ],
    "status_breakdown": {"indexed": 15, "unsupported": 1, "failed": 1}
  },
  "chunking": {
    "target_tokens": 300, "max_tokens": 450, "min_tokens": 80, "overlap_tokens": 50,
    "preserve_headings": true, "repeat_heading": true,
    "allow_cross_page": false, "prefer_paragraph_boundaries": true,
    "prefer_sentence_boundaries": true
  },
  "embedding": {"model": "bge-m3", "vector_size": 1024, "device": "mps",
                "precision": "float32", "max_seq_length": 512}
}
```

Column and index lists come from SQLite's own `PRAGMA table_info` / `PRAGMA index_list`,
so the page shows the database's real shape rather than a copy of the DDL that can drift.
The `payload_fields` descriptions are a literal in `admin.py` next to a comment pointing
at `_payload`; a test asserts the two key sets match, so adding a payload field without
documenting it fails CI.

**`GET /api/admin/documents/{document_id}/extraction?page=&per_page=`** → `ExtractionResponse`

Re-runs the registered extractor (§0a) and returns, per page: `page_number`, `text`,
`char_count`, and `blocks` as `{kind, heading, text}` where `kind` ∈ `paragraph | heading | table`.
Paged (default `per_page=5`, max 25) because a 300-page manual is megabytes of text.
Response also carries `document_id`, `filename`, `file_type`, `pages`, `extracted_ms`,
`language`, `pages_approximate`, and `file_hash_matches_manifest` — a `false` there means
the file changed since it was indexed, which the UI shows as a warning, since the
extraction on screen is then not what the index holds.

Errors, all as a JSON `detail` (R6.5):
`404` unknown document · `410` file no longer at any known path · `422`
`ExtractionUnsupportedError` (encrypted / image-only, with the reason) · `500`
`ExtractionError`.

**`GET /api/admin/documents/{document_id}/chunks?offset=&limit=`** → `ChunkListResponse`

Scrolls Qdrant with a `document_id` filter, `with_payload=True`, `with_vectors=False`,
ordered by `chunk_index`. Each item: `chunk_index`, `point_id`, `page_start`, `page_end`,
`heading`, `kind`, `token_count`, `char_count`, `text`, and the overlap span the UI
shades: `overlap_start` and `overlap_with_previous`.

**The overlap is not at character zero.** With `CHUNK_REPEAT_HEADING` on — the shipped
default — each passage opens with its section heading and the repeated tail of the
previous passage begins *after* it. Measuring a plain common prefix therefore reads zero
on every document the app indexes, which is how this was found: checked against the real
corpus, all 8 documents sampled reported no overlap. `_overlap` skips a repeated heading
before matching and returns `(start, length)`, after which all 8 report it correctly.
Default `limit=50`, max 200. Totals: `total_chunks`, `total_tokens`, `pages_covered`.

Needs two small additions to `QdrantService`:

- `collection_info() -> dict` — wraps `client.get_collection`, returns `None` when the
  collection does not exist rather than raising.
- `iter_chunks(document_id, offset, limit)` — `client.scroll` with a
  `FieldCondition(key="document_id")` filter and full payload.

### 6.3 Frontend

- **Document picker**, shared by the Extracted-text and Passages tabs: an antd `Select`
  with `showSearch`, listing every document from the library context with its status tag.
  Preselected from the `?document=` query parameter so the §3.2 "Inspect passages" link
  lands on the right document, and `?chunk=` scrolls that passage into view and
  highlights it.
- **Extracted text tab**: `Pagination` over pages, a `Segmented` control for
  *Page text* / *Blocks*, monospace rendering with `white-space: pre-wrap`, per-page char
  count, and a `Tag` on any page with 0 characters ("no extractable text — likely a
  scanned page"). A "Copy page text" button. A `Descriptions` header with filename, type,
  page count, detected language, extraction time, and the hash-mismatch warning.
- **Index structure tab**: `Descriptions` for the Qdrant block, `Table`s for payload
  fields and for each manifest table's columns, a `Descriptions` for chunking and
  embedding. Each block has one sentence of plain-language explanation above it — the
  point of the page is to make the structure understandable, not to dump JSON. A
  "Copy as JSON" button gives the raw response for a bug report.
- **Passages tab**: a virtualised `List` of passage cards, each showing
  `#index · Page a–b · N tokens · kind`, the heading, and the text, with the region that
  overlaps the previous passage rendered with a tinted background and a tooltip
  ("50 characters repeated from passage #4, so a sentence split across a boundary can
  still be found"). Above the list, a strip of totals and a small SVG histogram of token
  counts per passage, which makes an over- or under-sized chunk obvious at a glance.

---

## 7. Privacy

The privacy claims in `docs/user-spec.md` §8 constrain this work, and the admin page is
the part most able to break them:

- Admin endpoints are read-only, same-origin, and served on the same loopback-bound app.
  No new listener, no new binding (`api_host: 127.0.0.1`, `config.py:82`).
- Extraction results are held in memory for the length of the request only. Nothing is
  written to disk, and nothing is logged at INFO. Page text is logged only when the
  existing `debug_log_text` setting is on (`config.py:86`).
- Settings live in `localStorage`, never in a request body (R5.4).
- No analytics, no error reporting, no font or icon fetch (R1.5).

---

## 8. Tests

**Backend** (`backend/tests/api/test_admin.py`, new):

- `/api/admin/index/schema` reports the real collection size, distance, point count and
  payload indexes against the test Qdrant, and the real manifest tables against a
  temporary manifest.
- The documented `payload_fields` key set equals the keys `QdrantService._payload`
  actually writes (guards against drift).
- Chunking values in the response equal `Settings` values.
- `/extraction` on a fixture PDF returns the pages and text the extractor produces;
  on a fixture DOCX it reports `pages_approximate: true`.
- `/extraction` returns 404 unknown, 410 file deleted from disk, 422 for the encrypted
  fixture, and reports `file_hash_matches_manifest: false` after the file is edited.
- `/chunks` returns passages in `chunk_index` order, respects `offset`/`limit`, and
  computes `overlap_with_previous` correctly for a known overlapping pair.
- Every admin route rejects non-GET methods.
- Existing `test_static_ui.py` still passes: `/api` routes and `/docs` are matched before
  the static mount.

**Frontend** (Vitest + Testing Library, in `frontend/src/__tests__/`):

- `App.test.tsx`: each of the five hash routes renders its page; an unknown route
  redirects to the hero; the gear is present on every route.
- `HeroPage.test.tsx`: both primary buttons navigate; the empty library swaps the
  primary action to "Add your first documents" (R2.5); a failing readiness call still
  renders the buttons.
- `SearchPage.test.tsx` (extended): the input has the max-width class; selecting a
  result fills the detail panel; the first result is auto-selected; `↑`/`↓` move the
  selection; the IME guard still blocks submission mid-composition (R3.6); the
  "Add more documents" button navigates.
- `SearchResult.test.tsx` (extended): the card clamps to the configured line count and
  no longer renders a "Show more" button.
- `DocumentsPage.test.tsx` (extended): charts render the right numbers and the
  screen-reader table matches them; pressing **Add documents** applies the minimised
  class and mounts the add card; pressing it with the animations setting off applies the
  end state with no transition class; progress reflects a running job.
- `SettingsPage.test.tsx` (new): each setting persists to `localStorage` and takes
  effect (theme swaps the algorithm, results-per-search changes the search request's
  `top_k`); malformed stored JSON falls back to defaults; reset restores them; the admin
  link is present.
- `AdminPage.test.tsx` (new): each tab renders from a mocked response; the page selector
  pages through extraction; a 0-character page shows the scanned-page tag; the overlap
  region is marked; `?document=&chunk=` preselects and highlights.
- `api.test.ts` (extended): the three admin calls build the right URLs and surface
  backend `detail` messages.
- `IndexingPage.test.tsx` is **deleted** along with the page (§9.5). Everything it
  covered — folder add/remove, upload, starting a job, progress, clear-with-confirmation
  — moves into `DocumentsPage.test.tsx` as assertions on the add-documents card, so the
  merge loses no coverage.

**Not automated, checked by hand before calling it done:** that three result cards really
fit without scrolling at 1280×800, that the minimise animation reads as intended, and
that dark mode is legible on all five pages.

---

## 9. Assumptions and open points

1. ~~**"Location input"**~~ — resolved 2026-09-23: this meant the **search input**, and
   its placement and width. Addressed by R3.1 and §3.2: capped at 680 px, centred, with
   top-K and language as compact controls beneath it rather than two loose full-width
   selects.
2. ~~**Ant Design v5**~~ — **built on v6** (6.6.5). v6 supports React 19 natively, so the
   `@ant-design/v5-patch-for-react-19` shim v5 would have needed is not required.
   `@ant-design/icons` v6 alongside it.
3. **No authentication** on the admin page (§5.3). Everything is loopback-bound and
   single-user.
4. The result-card height numbers in §3.2 are derived for 1280×800. On a shorter window
   fewer cards fit; the requirement is met at the stated size.
5. ~~Documents and Indexing merge into one page~~ — **confirmed 2026-09-23.** The
   Indexing screen is gone as a destination: folders, upload, the Index action, live
   progress and job history all live in the add-documents card on the Documents page
   (§4.3), and "Clear the index" sits at the foot of that page (§4.6). `IndexingPage.tsx`
   and its test are deleted rather than left unrouted, and `#/indexing` is not a route.

---

## 10. Done means

- Opening the app lands on the hero, which explains the tool and offers the two actions,
  with no tab bar anywhere.
- The gear reaches Settings from every page; Settings reaches Admin.
- Changing theme, density, results-per-search and preview lines visibly changes the app,
  and survives a restart of the browser.
- On a 1280×800 window, a search shows three whole result cards with no scrolling, the
  input is not wider than 680 px, and clicking a card fills the right-hand detail panel.
- The Documents page opens with the diagrams; pressing **Add documents** minimises them
  with a visible transition and reveals the add card; indexing from that card shows
  progress in real time and the numbers in the diagrams move when it finishes.
- On the Admin page, picking an indexed PDF shows its extracted text page by page and it
  matches the original pages; the index-structure tab shows the real collection size,
  point count and manifest tables; the passages tab shows every passage of that document
  in order with its overlap marked.
- Every backend and frontend test passes, the frontend builds, and the built app runs
  from the backend's static mount with the network off.
