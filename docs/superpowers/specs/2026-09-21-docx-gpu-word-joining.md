# DOCX import, GPU indexing on Windows, whole-word PDF extraction: Spec

**Date:** 2026-09-21
**Branch:** `main` (as requested; no feature branch)
**Status:** Approved 2026-09-22, ready to implement

Three independent changes. Each one ships and gets tested on its own, in this order:

1. **Whole words from PDFs** (small, and only touches extraction)
2. **DOCX import** (the biggest; generalises "PDF" to "document" in the pipeline)
3. **GPU indexing on Windows** (mostly packaging, plus runtime safeguards)

---

## 0. Current state (checked against the code)

| Area | Today | Where |
|---|---|---|
| File discovery | Only `*.pdf`, found with `rglob` | `indexing_service.py:216` `_discover` |
| Upload | Rejects anything that is not `.pdf` with a `%PDF-` header | `api/documents.py:85-99` |
| Folder counts | `pdf_count` counts `.pdf` only | `api/folders.py:123` `_count_pdfs` |
| Extraction | `PdfService` (PyMuPDF), hard-wired into `IndexingService` | `pdf_service.py`, `indexing_service.py:66` |
| Serving files | Always `application/pdf`, inline | `api/documents.py:133` |
| UI | Import accepts `application/pdf,.pdf`; results say "Open page N in the PDF" | `ImportPanel.tsx:36`, `SearchResult.tsx:86` |
| Device choice | `resolve_device("auto")` tries mps, then cuda, then cpu | `embedding_service.py:35` |
| Windows torch | `uv.lock` resolves `torch` from PyPI; `prepare-offline.bat` installs from `uv export` | `pyproject.toml`, `prepare-offline.bat:106-117` |
| Line joining | `join_wrapped_lines` joins the lines of **one** PyMuPDF block; de-hyphenates only `[A-Za-z]-` | `text_service.py:73` |

### Why the GPU is not used on Windows

The code already picks `cuda` when it can. The cause is packaging: **the `torch` wheel for Windows on PyPI is CPU-only.** CUDA builds for Windows come only from `download.pytorch.org/whl/cuXXX`. So on Windows `torch.cuda.is_available()` is always `False`, whatever GPU and driver the machine has. (On Linux the PyPI wheel ships with CUDA, which is why `uv.lock` has `nvidia-*` packages for Linux only.)

### Why words come out broken

`join_wrapped_lines` only covers one case: an ASCII letter followed by `-` at the end of a line, with both lines in the same block. It misses:

1. **Soft hyphen (U+00AD).** A line that ends `main­` doesn't match `[A-Za-z]-$`, so it gets joined with a space. Then `normalize_text` removes the soft hyphen and leaves `main tenance`. This is a real bug.
2. **Other hyphen characters:** U+2010 `‐`, U+2011 `‑`, and letters beyond ASCII (`é`, `ü`, and so on).
3. **Korean words broken mid-word.** Korean documents set with character-level wrapping (common in HWP and Word exports) break a word with no hyphen. The Hangul rule always adds a space, so `유지보수` becomes `유지 보수`.
4. **Words split across blocks.** PyMuPDF often puts one visual paragraph into several blocks, for example one per line or around an inline image. Joining never happens across blocks.
5. **Words split across pages.** A hyphenated word at the bottom of page N continues on page N+1. Chunks never cross pages (`CHUNK_ALLOW_CROSS_PAGE=false`), so both halves are indexed as fragments.

---

## 1. Whole words from PDFs

### 1.1 Requirements

- R1.1 A word that is visually split over lines, blocks in the same column, or a page break is extracted as **one word** with no hyphen and no space inside it.
- R1.2 Real hyphenated compounds must survive: `state-of-the-art`, `COVID-19`, `e-mail`, `2024-09-21`, `ISO-9001`.
- R1.3 Chinese behaviour doesn't change: no space ever goes between two Han characters.
- R1.4 Korean: no space at a mid-word break, and a space kept where the break was between words.
- R1.5 Nothing gets worse on the existing fixtures or on `backend/eval/relevance_set.json`.

### 1.2 Design

**a. Keep what PyMuPDF knows about line endings.** In `_page_blocks`, pass each line forward as a small record instead of a stripped string:

```python
@dataclass(frozen=True, slots=True)
class RawLine:
    text: str            # spans joined, stripped
    trailing_space: bool # the raw span text ended with whitespace before the strip
    x0: float; x1: float; y0: float; y1: float
```

Extract with the default dict flags **minus** `TEXT_PRESERVE_LIGATURES` (so `ﬁ` becomes `fi` and `ﬁlter` is the word `filter`) and minus `TEXT_PRESERVE_IMAGES`. Not `TEXT_DEHYPHENATE`: our own rules below replace it and cover more cases.

**b. Rewrite `join_wrapped_lines(lines: list[RawLine], *, trailing_space_reliable: bool) -> str`.** The old signature stays as a thin wrapper for other callers. Rules, checked in order for each line boundary (`prev` → `next`):

| # | Condition | Join |
|---|---|---|
| 1 | `prev` ends in a soft hyphen U+00AD | remove it, no space |
| 2 | `prev` ends in `letter + [-‐‑]`, `next` starts with a **lowercase** letter (Unicode `\p{Ll}`, any script) | remove hyphen, no space (`mainte-` + `nance`) |
| 3 | `prev` ends in `letter/digit + [-‐‑]`, `next` starts with uppercase or a digit | keep hyphen, no space (`COVID-` + `19`, `ISO-` + `9001`) |
| 4 | `prev` ends in Han/full-width, `next` starts in Han/full-width | no space (unchanged) |
| 5 | `prev` ends in Hangul, `next` starts with Hangul, `trailing_space_reliable` and `not prev.trailing_space` | **no space** (mid-word break) |
| 6 | everything else | one space (unchanged) |

Two more rules were added during implementation: a line-end hyphen whose word already contains a hyphen is a compound and keeps it (`state-of-the-` + `art`), and a line that starts with closing punctuation (`.`, `)`, `。`...) never takes a space before it.

Rule 2 knowingly turns `e-` + `mail` into `email`. That's acceptable: the embedding model treats the two the same, and the other choice leaves far more broken words behind.

**c. Decide whether trailing-space evidence is reliable, per document.** PDF generators disagree: some keep the space at the end of a wrapped line and some drop it. Before joining anything, `PdfService.extract` does one pass over every line that is followed by another line in the same block:

- Count the lines that end in Hangul, and among them the ones with `trailing_space`.
- `trailing_space_reliable = hangul_line_ends >= 20 and with_space / hangul_line_ends >= 0.2`

If the generator keeps spaces, word-wrapped lines have them and character-wrapped lines don't, so a line with none is a mid-word break. If the generator drops every space (share near 0), we have no evidence either way, so rule 5 turns itself off and we keep today's behaviour of adding a space. That's the safe failure mode: a space too many slightly hurts snippet display but not semantic search. Log the decision at DEBUG with the counts.

Add `PDF_KOREAN_MIDWORD_JOIN=auto|on|off` (default `auto`) so a user can force the behaviour for a corpus the heuristic gets wrong.

**d. Merge paragraph blocks that continue each other (same page).** After the blocks are placed and sorted, merge paragraph block *B* into the paragraph *A* just before it when all of these hold:

- both are `paragraph` (never a heading or table)
- `abs(B.x0 - A.x0) <= 0.5 * body_font_size` (same column)
- `0 <= B.y0 - A.last_line.y1 <= 0.6 * A.line_height` (no paragraph gap; double line spacing is about 0.5)
- `A` doesn't end with a sentence terminator, optionally followed by closing quotes, brackets or citation marks (`上。[5]` ends a paragraph)
- `B` doesn't start with a list marker (`•`, `1.`, `(2)`, `①`...)
- neither block is monospaced (code listings keep one block per line)

When they merge, the boundary goes through the same `join_wrapped_lines` rules. Only then is the block normalised. This means `PageBlock` sorting and merging have to work on geometry, so `_page_blocks` carries a private `_Placed(y, x, kind, lines: list[RawLine])` until the end and builds `PageBlock`s last.

**e. Cross-page continuation.** In `extract`, after all the pages are built, for each page pair `(N, N+1)`:

- Take the last paragraph block of N and the first paragraph block of N+1 (skip header and footer lines: any block within 5% of the page's top or bottom edge that repeats on 3 or more pages is treated as a running header or footer and ignored for this check. This is the cheap version: compare the normalised text of each page's first and last block).
- If the boundary matches rule 1, 2 or 5, move the **first token** of N+1's first block onto the end of N's last block (the token is up to the first whitespace; for rule 5, up to the first space or punctuation), and remove it from N+1.
- Recompute `ExtractedPage.text` for both pages.

The word belongs to the page it starts on, which is the page the UI opens.

**f. `normalize_text` ordering fix.** Leave U+00AD out of `_ZERO_WIDTH` when it's the last character of a line, so the join rules see it; strip it after joining. Simplest version: `_ZERO_WIDTH` keeps U+00AD, but `join_wrapped_lines` runs on raw text *before* `normalize_text`. It already does for paragraphs, so the fix is to make sure the table-cell path (`replace("\n", " ")` in `_tables`) also goes through `join_wrapped_lines` for each cell.

### 1.3 Tests (`test_text_service.py`, `test_pdf_service.py`)

- Unit, for each rule in the table, including `e-mail`, `COVID-19`, `2024-09-21` across a line break, and U+2010/U+00AD.
- Korean: `["유지보", "수 주기"]` joins to `유지보수 주기` when reliable and to `유지보 수 주기` when not.
- Fixtures (`make_fixtures.py`) add three PDFs built with PyMuPDF's `insert_textbox` at a narrow width so wrapping really happens:
  - `wrap_en.pdf`: hyphenated English, including one word split across the page break
  - `wrap_ko_charwrap.pdf`: Korean split mid-word, with trailing spaces at word-wrap points
  - `wrap_multiblock.pdf`: one paragraph deliberately written as three `insert_text` calls, so it comes out as three blocks
- Regression: the existing `manual_zh/ko/mixed` fixtures produce byte-identical page text, or any diff is reviewed and accepted in the PR.
- Run `backend/eval/run_eval.py` before and after, and put both numbers in the commit message.

---

## 2. DOCX import

### 2.1 Requirements

- R2.1 `.docx` files are discovered, uploaded, indexed, searched and opened exactly like PDFs.
- R2.2 Headings, paragraphs and tables are extracted with the same `PageBlock` kinds, so chunking and search need no changes.
- R2.3 Results show an approximate page where one can be worked out, and never claim a false precision.
- R2.4 Password-protected and corrupt files are reported as `unsupported` or `failed`, never crash the run.
- R2.5 Works fully offline and in the Windows release, with no Word, LibreOffice or COM needed.
- **Out of scope:** legacy `.doc`, `.odt`, `.rtf`, text inside embedded images, headers and footers, footnotes, comments, and tracked-change *deletions*.

### 2.2 Library

`python-docx>=1.1` (pure Python, depends on `lxml`, and ships Windows wheels). Add it to `pyproject.toml` and relock. Using raw `lxml` for the few things python-docx doesn't expose (page-break markers, `w:outlineLvl`, and `w:ins` and `w:sdt` content) is fine.

### 2.3 Architecture: an extractor per format

Create `backend/app/services/extractors.py`:

```python
class ExtractionUnsupportedError(Exception): ...   # scanned, encrypted, empty
class ExtractionError(Exception): ...              # unreadable

class DocumentExtractor(Protocol):
    suffixes: tuple[str, ...]          # (".pdf",) / (".docx",)
    media_type: str                    # for FileResponse
    def extract(self, path: Path, *, document_id: str, file_hash: str) -> ExtractedDocument: ...

class ExtractorRegistry:
    def __init__(self, extractors: list[DocumentExtractor]) -> None: ...
    def for_path(self, path: Path) -> DocumentExtractor | None
    @property
    def suffixes(self) -> frozenset[str]
```

- `PdfUnsupportedError` and `PdfExtractionError` become subclasses of the generic errors, so existing `except` clauses and tests keep working.
- `compute_file_hash` moves to a module-level function in `extractors.py`, and `PdfService.compute_file_hash` stays as an alias.
- `IndexingService` takes an `ExtractorRegistry` instead of a `PdfService`. `_discover` filters on `registry.suffixes`. `_process` looks up the extractor for each path and catches the generic errors.
- `deps.py` builds the registry from `PdfService` and `DocxService`, with DOCX included only if `settings.docx_enabled`.
- Also skip `~$*.docx` (Word lock files): add `"~$"` to `_IGNORED_PREFIXES`.

### 2.4 `DocxService` (`backend/app/services/docx_service.py`)

Walk the body **in document order** (paragraphs and tables mixed together; python-docx's `document.iter_inner_content()`).

| DOCX element | Becomes |
|---|---|
| Paragraph whose style, or any style it's based on, has `w:outlineLvl` 0-8, **or** style id matches `^(Heading\d|Title)$` | `PageBlock("heading")` |
| Other non-empty paragraph | `PageBlock("paragraph")` |
| Table | `PageBlock("table")` through the shared markdown helper (move `_table_markdown` into `extractors.py`); merged cells de-duplicated; a nested table flattened into its cell's text |
| Text in `w:ins` (tracked insertion) and `w:sdt` (content controls) | included |
| `w:del`, `w:instrText` (field codes) | excluded |
| `w:br` (line break) and `w:cr` inside a paragraph | newline, then joined with `join_wrapped_lines` |
| `w:softHyphen` | dropped; `w:noBreakHyphen` becomes `-` |
| `w:tab` | a space |

Detecting headings by `outlineLvl` matters: Korean and Chinese Word versions give built-in heading styles localised names (`제목 1`, `标题 1`), but the outline level is always there.

**Pages.** DOCX has no fixed pages. Page numbers are approximated from:

1. `w:br w:type="page"` (a hard page break the author inserted), and
2. `w:lastRenderedPageBreak` (written by Word each time it saves, marking where it last laid out a page),
3. `w:sectPr` whose type isn't `continuous` (a section break that starts a new page).

Each marker starts a new `ExtractedPage`. With no markers at all (files written by tools other than Word), the whole document is page 1. The manifest stores `page_count` as usual. A new manifest column, `pages_approximate INTEGER NOT NULL DEFAULT 0`, is set to 1 for DOCX. It's added with `ALTER TABLE ... ADD COLUMN` behind a `PRAGMA table_info` check, the same way any later columns will be added.

**Errors.**

- Not a zip, or no `word/document.xml`: `ExtractionError`.
- An OLE compound file (`D0 CF 11 E0` magic) with a `.docx` suffix, which is how an encrypted DOCX looks: `ExtractionUnsupportedError("password-protected")`.
- Less than `PDF_MIN_DOCUMENT_CHARS` of text: `ExtractionUnsupportedError`. Rename the setting to `MIN_DOCUMENT_CHARS` and keep reading the old name as a fallback.
- Metadata: `title` from `core_properties.title`, and `modified_at` from the file's mtime, as for PDFs.

### 2.5 API changes

| Endpoint | Change |
|---|---|
| `POST /documents/upload` | Accept `.pdf` (header `%PDF-`) and `.docx` (header `PK\x03\x04`, and `zipfile` finds `word/document.xml`). Otherwise the rejection reason is `"not a PDF or Word (.docx) file"`. |
| `GET /documents/{id}/file` | `media_type` comes from the extractor: PDF inline as today; DOCX `application/vnd.openxmlformats-officedocument.wordprocessingml.document` with `content_disposition_type="attachment"`, since browsers can't display it. |
| `GET /documents` | Add `file_type: "pdf" \| "docx"` and `pages_approximate: bool` |
| `POST /search` hits | Add `file_type` (from a new Qdrant payload field, falling back to the filename suffix for points indexed before this change, so no re-index is needed) |
| `GET /folders` | Add `document_count` (all supported types). Keep `pdf_count` for one release, marked deprecated, then remove it. |

### 2.6 UI changes

- `ImportPanel.tsx`: `accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"`; heading "Import PDF or Word files"; the "Which files can be searched" list adds `.docx` and notes that `.doc` isn't supported.
- `SearchResult.tsx`: for `docx` the label is `Page ~N` (or no page label when the document has one page), and the link reads **"Download the Word file ↗"** with no `#page=`.
- `DocumentList.tsx`: a small `PDF`/`DOCX` badge.
- `FolderPanel.tsx`: "N documents on disk" using `document_count`.
- Update `README.md` and `docs/user-spec.md` wherever they say PDF but mean "document".

### 2.7 Tests

- `make_fixtures.py` gains `build_docx_*` with python-docx: Korean with a `제목 1` heading, Chinese with a table containing merged cells, one with hard page breaks, one with a tracked insertion and deletion, and a fake encrypted file (OLE magic bytes).
- `test_docx_service.py`: block kinds and order, page numbering from each marker type, the error cases, soft hyphen and line break handling.
- `test_indexing_service.py`: a mixed folder with PDF and DOCX discovers both and skips `~$lock.docx`.
- API tests: upload accepts and rejects the right files; `/file` media type and disposition; the new response fields.
- Frontend: `ImportPanel`, `SearchResult` and `DocumentList` tests for the DOCX variants.
- `test_offline_wiring.py`: `docx` imports with the network off.

---

## 3. GPU indexing on Windows 10/11

### 3.1 Requirements

- R3.1 On a Windows 10 or 11 machine with an **NVIDIA** GPU and a recent enough driver, indexing and search run on the GPU with no configuration.
- R3.2 On a machine without one (or with an AMD or Intel GPU), the same release runs on the CPU exactly as today, with no errors.
- R3.3 The user can see which device is in use.
- R3.4 A GPU problem at runtime (out of memory, driver too old) never fails an indexing run. The work falls back and continues.
- **Targeted cards:** NVIDIA GeForce RTX 20, 30, 40 and 50-series (details in §3.2), tested first on the RTX 5060.
- **Out of scope:** GTX 10-series and older NVIDIA cards; AMD and Intel GPUs on Windows (DirectML and XPU are not mature enough to justify a second torch build). They use the CPU.

### 3.2 Packaging (the actual fix)

**`backend/pyproject.toml`**: route Windows torch to the CUDA index and leave macOS and Linux alone:

```toml
[[tool.uv.index]]
name = "pytorch-cu128"
url = "https://download.pytorch.org/whl/cu128"
explicit = true

[tool.uv.sources]
torch = [{ index = "pytorch-cu128", marker = "sys_platform == 'win32'" }]
```

- **Target GPUs: every NVIDIA GeForce RTX generation, from the RTX 20-series to the RTX 50-series, plus later cards where the driver allows.** The primary test card is the **RTX 5060**.

  | Generation | Examples | Architecture | Compute capability | Covered by `cu128` |
  |---|---|---|---|---|
  | RTX 20 (and GTX 16) | 2060, 2070, 2080, 1660 | Turing | `sm_75` | yes, native kernels |
  | RTX 30 | 3050, 3060, 3070, 3080, 3090 | Ampere | `sm_86` | yes, native kernels |
  | RTX 40 | 4060, 4070, 4080, 4090 | Ada Lovelace | `sm_89` | yes, runs the `sm_86` kernels (binary compatible within major version 8) |
  | RTX 50 | **5060**, 5070, 5080, 5090 | Blackwell | `sm_120` | yes, native kernels; **needs CUDA 12.8 or newer** |
  | Later generations | not released yet | unknown | above `sm_120` | best effort: works only if the wheel embeds PTX (`compute_120`) that the driver can JIT-compile. Covered by the startup probe (§3.3), which falls back to CPU with a clear reason if it can't. Supporting a new generation properly means rebuilding the release with a newer `cuXXX` index. |

- **Why `cu128`:** it is the oldest CUDA build that includes Blackwell (`sm_120`), and it still includes Turing (`sm_75`), so one build covers RTX 20 through RTX 50. `cu126` and older don't run on RTX 50 cards. `cu130` also covers this range if the locked torch version is only published there; either is fine as long as the build check below passes.
- **Driver:** NVIDIA driver **570 or newer** on every card (that's the minimum for CUDA 12.8). RTX 50 cards ship with it; older cards may need a driver update, and the startup probe reports "driver too old" rather than failing.
- **Not targeted:** GTX 10-series and earlier (Pascal `sm_61`, Maxwell), and Volta. `cu128` builds no longer include them. They fall back to CPU with a readable reason.
- **Build check:** after installing, `torch.cuda.get_arch_list()` must include `sm_75`, `sm_86` and `sm_120`, and should include a `compute_*` PTX entry for forward compatibility (log a warning at build time if it doesn't). Record the index, minimum driver and full architecture list in the README.
- Relock with `uv lock`. macOS stays on the PyPI wheel (MPS), and Linux keeps its current resolution.

**`prepare-offline.bat`**:

- Step 4: after `uv export`, confirm that `requirements.txt` pins torch as `torch==X+cu128` or contains the pytorch index line. If `uv export` drops the explicit index, write it in: `--extra-index-url https://download.pytorch.org/whl/cu128` plus `--index-strategy unsafe-best-match` on the `uv pip install` in step 5, with torch pinned to the `+cu128` local version.
- New check after step 5: run the bundled Python with `import torch; assert torch.version.cuda, 'CPU-only torch was installed'`. If it fails, the build fails. This check has to run even on a build machine with no GPU, because it inspects the build, not the hardware.
- Update the size estimate in the README (about 3 GB becomes about 5.5 GB, since the CUDA runtime DLLs ship inside the torch wheel) and the time estimate.
- The release needs **no CUDA Toolkit** on the target, only the NVIDIA display driver. Say so in `README-FIRST.txt`.

### 3.3 Runtime (`embedding_service.py`, `config.py`)

- `resolve_device("auto")`: try cuda **before** mps (they never both exist, but cuda is the case that matters now). When cuda is available, also run a 1×1 tensor on the device inside `try` to catch "driver too old" and "no kernel image for this architecture" early. If that fails, log a WARNING that says why and use cpu.
- New setting `EMBEDDING_PRECISION=auto|fp32|fp16` (default `auto`, which means fp16 on cuda and fp32 elsewhere). With fp16, call `self._model.half()` after loading. BGE-M3 vectors in fp16 differ from fp32 by less than 1e-3 in cosine, so existing indexes stay compatible. The eval harness must confirm no drop in quality.
- `EMBEDDING_BATCH_SIZE` stays for CPU and MPS. A new `EMBEDDING_BATCH_SIZE_GPU` (default `auto`) applies on cuda. VRAM across the targeted cards ranges from 4 GB (RTX 3050 laptop) to 32 GB (RTX 5090), so `auto` picks from the card's total memory: below 6 GB, 8; below 10 GB, 16 (for example the 8 GB RTX 5060); below 16 GB, 32; otherwise 64. A number overrides it. The OOM fallback below still covers mistakes.
- fp16 is safe on every targeted card: all RTX generations have tensor cores with fp16 support.
- **OOM fallback** in `_encode`: catch `torch.cuda.OutOfMemoryError`, call `torch.cuda.empty_cache()`, halve the batch size and retry, down to 1. If batch 1 still runs out of memory, move the model to cpu for the rest of the process and log a WARNING. The new batch size lasts for the rest of the process.
- Log once at startup: `device=cuda:0 name="NVIDIA GeForce RTX 3060" vram=12.0GB precision=fp16 batch=32 torch=2.14.0+cu128 cuda=12.8`.
- Expose the details through a `device_info()` method on the embedding service, returning `{"device", "name", "precision", "batch_size", "fallback_reason"}`.

### 3.4 Visibility

- `GET /health/ready` adds `embedding_device`, `embedding_device_name` and `embedding_fallback_reason`.
- The Indexing page shows a line such as "Running on GPU: NVIDIA GeForce RTX 3060", or "Running on CPU", with the fallback reason if there is one.
- `windows/check.bat` and `scripts/verify_install.py` print the torch build (`+cu128` or `+cpu`), `torch.cuda.is_available()`, the GPU name and the driver version (from `nvidia-smi` if it's on PATH). A CPU-only machine is reported as OK, with a note.
- `.env.example`: fix the comment "auto picks mps on Apple Silicon, else cpu" and document the new settings.

### 3.5 Tests

- Unit (no GPU needed; monkeypatch `torch.cuda`): `resolve_device` order and fallback when the probe fails; precision resolution; batch size selection; the OOM retry loop halves the batch and ends on cpu (with a fake model that raises `OutOfMemoryError` above a threshold).
- `test_config.py`: the new settings and their defaults.
- Health API test for the new fields.
- **Manual acceptance on real Windows hardware** (must be done before this is called complete, and the result recorded in the PR):
  1. Windows 11 with an NVIDIA GeForce RTX 5060: `check.bat` shows `+cu128` and the GPU; index the fixture set and the eval corpus; the log shows `device=cuda:0`; record the time against CPU.
  2. Windows 10 or 11 with no NVIDIA GPU: same release, `check.bat` OK, indexing runs on cpu.
  3. At least one older RTX card (RTX 20, 30 or 40-series), same release: GPU used, batch size chosen for its VRAM, eval numbers match the RTX 5060 run.
  4. An NVIDIA machine with a driver that's too old, or a GTX 10-series card, if one is available: falls back to cpu with a readable reason.

---

## 4. Order of work and commits (all on `main`)

1. `feat(pdf): join words split across lines, blocks and pages` (§1)
2. `refactor: extractor registry, generic extraction errors` (§2.3, no behaviour change, all tests green)
3. `feat: import and index .docx files` (§2.4-2.7)
4. `feat(windows): CUDA PyTorch build and GPU indexing` (§3)
5. `docs: README and user spec for DOCX and GPU`

After each commit, `uv run --directory backend pytest`, `ruff check`, and `npm --prefix frontend test` all pass. Commits 1 and 4 include the before and after numbers from the eval harness.

## 5. Changes made during implementation

- **`file_type` and `pages_approximate` are derived from the filename suffix**, not stored in a new Qdrant payload field or manifest column. Same answer, and existing indexes need no migration. `pages_approximate` is false for a Word file with 0 pages (unsupported), so the UI never shows `~0`.
- **`PDF_MIN_DOCUMENT_CHARS` was not renamed**; DOCX uses the same setting. Renaming it would touch every existing `.env` for no behaviour change.
- **A page marker in the middle of a Word paragraph moves the page on after the paragraph**, rather than splitting the paragraph. That way no paragraph, and no word Word happened to break at, is ever cut in two. A break on a page with nothing on it yet is ignored, which also stops Word's paired hard and rendered breaks from counting twice.
- **One-row Word tables** are treated as layout and indexed as paragraphs.

## 6. Decisions (2026-09-22)

1. **GPUs:** NVIDIA RTX 20 through RTX 50-series, with the RTX 5060 as the primary test card; later cards on a best-effort basis. `cu128`, driver 570 or newer (§3.2).
2. **Release:** one release with CUDA PyTorch, about 5.5 GB, which falls back to CPU on machines without a supported GPU (§3.2).
3. **Hyphen at a line end followed by a lowercase letter:** always removed, so `e-` + `mail` becomes `email` (§1.2 rule 2). No keep-hyphen list.
4. **Opening a DOCX result:** download the file (§2.5, §2.6).

No open decisions remain.
