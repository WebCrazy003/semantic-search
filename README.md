# DocSage — find knowledge locally

Semantic search over Chinese and Korean PDFs and Word (.docx) files, with written
answers to questions in English, Chinese or Korean, running entirely on one machine.
No cloud API, no external search service, and no internet connection once the models
are downloaded.

## How it works

    PDF  -> PyMuPDF     \
                          -> chunker -> BGE-M3 -> Qdrant -> FastAPI -> React
    DOCX -> python-docx /

- **Extraction** is page by page, with heading and table detection.
- **Chunking** is measured in BGE-M3 tokens, not characters, because Chinese and
  Korean tokenize differently from English.
- **Embeddings** are BGE-M3 dense vectors, 1024 dimensions, cosine similarity, one
  shared vector space for every language.
- **Storage** is a single Qdrant collection, `pdf_passages`, one point per passage.
- **A SQLite manifest** at `data/manifest.db` holds per-document bookkeeping. It is a
  derived cache; `scripts/rebuild_manifest.py` regenerates it from Qdrant.
- **Accounts** live in `data/access.db`: users, sessions, password reset requests and
  which documents are public. Nothing can rebuild it, so back it up.

Answers (`POST /api/ask`) are retrieval-augmented generation on top of that search:

    question -> the same search, same access scope -> results to the browser at once
             -> bge-reranker-v2-m3 over the results on screen -> best 6 passages
             -> local LLM (llama-server) -> answer streamed with [n] citations

- **The answer is in the question's language**, decided in code from its script and
  stated in the prompt; a first sentence in the wrong language is held back and the
  answer restarted once. Fixed messages come from templates in all three languages.
- **The reranker's score** separates answerable questions from unanswerable ones,
  which the search score cannot; below `RAG_MIN_SCORE` the answer is "not found"
  without asking the model.
- **The model runs in its own process**, OpenAI-compatible, on `127.0.0.1`. Search
  works the same whether it is there or not.

See [the plan](docs/superpowers/plans/2026-10-04-natural-language-answers.md) for the
design and the measurements behind it.

## Accounts and ownership

Everyone logs in. The first start asks for an administrator account, which can only be
created from the machine DocSage runs on. After that, people sign up with a username and
password (an admin can turn sign-up off) and see only their own documents plus the
ones an administrator has made public. Admins see everything.

- **Ownership comes from where a file lives.** Uploads go to
  `documents/users/<user_id>/`; everything else in `documents/` and in registered
  folders is the *library*, visible to admins until they publish it. Clearing the index
  or rebuilding the manifest therefore never changes who owns what.
- **Forgotten passwords** are reset by username with an admin's approval, or by an admin
  directly. There is no email.
- **Locked out?** `uv run --directory backend python ../scripts/reset_admin.py <username>`
  prints a temporary password and makes that account an active admin.
- **Upgrading** an install from before accounts: everything already indexed becomes
  library, private to admins, with no re-embedding. Publish it from the Documents page.

See [the spec](docs/superpowers/specs/2026-09-29-accounts-and-document-ownership.md) for
the design.

## Setup

Once, with the network on. This is the development setup on macOS and Linux; to
build a Windows release skip to
[Windows: building an offline release](#windows-building-an-offline-release).

    cd backend && uv venv --python 3.12 && uv sync --all-groups && cd ..
    uv run --directory backend python ../scripts/download_model.py bge-m3 reranker llm
    npm --prefix frontend install
    cp .env.example .env

`bge-m3` alone is enough for search; `reranker` (2.3 GB) and `llm` (2.5 GB) add written
answers. Answers also need `llama-server` from [llama.cpp](https://github.com/ggml-org/llama.cpp)
(`brew install llama.cpp` on macOS) and `LLM_URL` set in `.env`. From then on, no
network is needed.

## Running

Three processes, and a fourth for written answers:

    docker compose up -d
    uv run --directory backend uvicorn app.main:app --host 127.0.0.1 --port 8000
    npm --prefix frontend run dev
    llama-server -m models/llm/Qwen3-4B-Instruct-2507-Q4_K_M.gguf \
        --host 127.0.0.1 --port 8081 -c 8192 -ngl 99 -np 1 --no-webui

Start `llama-server` before the backend; started after it, answers appear once the
page next checks, within half a minute. Without it, with `LLM_URL` empty, or when search
runs on the CPU (see `LLM_REQUIRE_GPU` in `.env.example`), the search page works exactly
as before and shows no answer box.

Then open http://127.0.0.1:5173, create the administrator account, and import PDF or
Word files with **Add documents** on the Documents tab. Importing starts indexing by
itself. When an admin imports, the run covers the whole `documents/` folder, so files put
there by hand are indexed as the library at the same time; a regular user's import
indexes only their own uploads.

## Windows: building an offline release

`prepare-offline.bat` turns this repository into a finished release: a folder that
runs on any 64-bit Windows machine with **no network, no Python, no Node, no Docker
and no installation step**. The person receiving it copies the folder wherever they
like and double-clicks `run.bat`.

Run it on a Windows machine that has an internet connection:

    prepare-offline.bat          build the folder
    prepare-offline.bat zip      build the folder and a .zip beside it

It installs uv and Node.js if they are missing, fetches a relocatable CPython, and
writes everything into `release\docsage-<version>-win64-offline\`. The
version comes from the [VERSION](VERSION) file. Expect about 11 GB and 30 to 60
minutes; re-runs reuse the downloaded models and llama-server, kept in `models\`
and `.build\`. GitHub downloads that drop are resumed and retried.

Rebuilding deletes the release folder first, along with any accounts, index and
documents in it: back up `data\`, `qdrant_storage\` and `documents\` from a release
that has been used before running it again.

### What the release contains

    run.bat              start the answer model and DocSage, and open the browser
    stop.bat             stop both
    check.bat            prove the installation works
    README-FIRST.txt     instructions for whoever ends up using it
    .env                 settings, with QDRANT_PATH already set
    VERSION.txt          version, build date and build machine
    documents\           where they drop PDF and Word files
    backend\app\         the application
    frontend\dist\       the built interface
    models\bge-m3\       the embedding model
    models\bge-reranker-v2-m3\   the reranker, used only for answers
    models\llm\          the answer model, one GGUF file
    llama\              llama-server (llama.cpp, CUDA 12 build) and its CUDA runtime
    runtime\python\      CPython, carried with the release
    runtime\lib\         every library, pinned by uv.lock
    runtime\vc_redist.x64.exe

There is no virtual environment, because a virtual environment records absolute
paths and would break the moment the folder moved. `run.bat` instead puts
`runtime\lib` on `PYTHONPATH` and runs `runtime\python\python.exe` directly, so
every path is relative to the folder. It can be moved, renamed, or put on a
network drive, and it keeps working.

`check.bat` runs [verify_install.py](scripts/verify_install.py), which imports every
dependency, reads and writes the embedded vector store, and loads BGE-M3 with Hugging
Face forced offline. It is the quickest way to tell a broken copy from a broken
machine.

### How the offline release differs from development

- **No Qdrant server.** `QDRANT_PATH` switches [deps.py](backend/app/deps.py) to an
  embedded Qdrant that keeps its vectors in a folder. Payload indexes do not exist in
  that mode, so filtered search scans instead of using an index, and only one process
  may hold the folder at a time: stop the app before running `check_qdrant.py` or
  `rebuild_manifest.py` against it. Both scripts follow the same setting, so they talk
  to whichever store is configured.
- **No Node and no Vite.** The API serves `frontend/dist` when that folder exists, so
  the release is one process on one port with no proxy. In development the folder is
  absent and Vite serves the UI as before.
- **An NVIDIA GPU does the embedding when there is one.** See below.
- **`run.bat` starts the answer model.** When `llama\llama-server.exe` and a GGUF in
  `models\llm` are present it opens `llama-server` on `127.0.0.1:8081` in a minimised
  window titled "Answer Model" and sets `LLM_URL` to it, unless `.env` already sets
  `LLM_URL`. `stop.bat` stops it. Without an NVIDIA GPU answers stay off, as in
  development, until `.env` says `LLM_REQUIRE_GPU=false`.

## GPU indexing on Windows

PyPI's PyTorch for Windows is CPU-only, so on Windows `torch` comes from PyTorch's
own CUDA index instead ([pyproject.toml](backend/pyproject.toml), `[tool.uv.sources]`).
macOS keeps the PyPI wheel and uses the Apple GPU (mps).

| | |
|---|---|
| PyTorch build | `2.11.0+cu128` (CUDA 12.8), from `download.pytorch.org/whl/cu128` |
| Cards | GeForce RTX 20, 30, 40 and 50-series (GTX 16 too). Tested first on the RTX 5060 |
| Kernels in the build | `sm_75` (RTX 20), `sm_86` (RTX 30, and RTX 40 through it), `sm_120` (RTX 50); `prepare-offline.bat` fails the build if any is missing |
| Driver | NVIDIA display driver **528 or newer**, and **570 or newer** on RTX 50 (the oldest drivers those cards run). Any later driver works too. No CUDA Toolkit is needed; the runtime ships inside the wheel |
| Not supported | GTX 10-series and older, AMD and Intel GPUs. They index on the CPU |

`cu128` is the oldest PyTorch CUDA index with Blackwell (RTX 50) kernels. As a CUDA 12
build it runs on any driver from 528 up, through NVIDIA's minor-version compatibility;
`cu130` (CUDA 13) would need 580+. `cu126` has no RTX 50 support. `cu128` stops at
torch 2.11, so torch is capped below 2.12 on every platform.

At startup the backend runs a test kernel on the GPU before trusting it. A driver that
is too old or a card the build has no kernels for falls back to the CPU, with the
reason shown on the Indexing page and in `/api/health/ready`. On the GPU:

- **fp16.** About twice as fast and half the memory. Vectors are re-normalized in
  fp32 and are compatible with an index built on the CPU, so nothing needs
  re-indexing. `EMBEDDING_PRECISION=fp32` turns it off.
- **Batch size from graphics memory.** 8 below 6 GB, 16 below 10 GB (the 8 GB
  RTX 5060), 32 below 16 GB, 64 above. `EMBEDDING_BATCH_SIZE_GPU` overrides it.
- **Out of memory never fails a run.** The batch is halved and retried; at batch 1
  the model moves to the CPU for the rest of the process.

`check.bat` prints the torch build, the GPU it found and the driver version.
`scripts/gpu_report.py` does the same from a command prompt.

## Word documents

`.docx` files are indexed alongside PDFs, with the same headings, paragraphs and
tables. Tracked insertions are indexed and deletions are not. A Word file has no fixed
pages, so page numbers come from the page breaks Word records when it saves and are
shown as approximate (`Page ~3`). Files written by other tools may record none and
are then one page. Results offer the file as a download, because browsers cannot
display it. Legacy `.doc` is not supported; save it as `.docx` in Word. Set
`DOCX_ENABLED=false` to index PDFs only.

## API

Every route but `/api/health` and the account routes needs a session cookie, and every
request that changes something needs the header `X-DocSage: 1`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness (no login) |
| GET | `/api/health/ready` | Qdrant, collection, model, point count, whether answers are available |
| GET/POST | `/api/auth/...` | Status, setup, register, login, logout, password, reset requests |
| POST | `/api/search` | Semantic search over what the caller may read |
| POST | `/api/ask` | The same search, then a written answer, as server-sent events: `results`, `sources`, `delta`…, then `done` or `error` |
| POST | `/api/index` | Start an indexing run (a user's covers only their uploads) |
| GET | `/api/index/status` | Progress and failures of the current or last run |
| GET | `/api/documents` | Documents the caller may read, with page and passage counts |
| PUT | `/api/documents/{id}/visibility` | Admin: make a document public or private |
| * | `/api/admin/...` | Admin: users, reset requests, bulk visibility, sign-up, inspectors |

Interactive docs are at http://127.0.0.1:8000/docs.

## Tests

    uv run --directory backend pytest -q                 # fast: no model, no Docker
    uv run --directory backend pytest -m integration -q  # needs the model and Qdrant
    npm --prefix frontend test

The fast suite substitutes a character-counting tokenizer, a hash-based fake embedder,
and an in-memory Qdrant, so it runs in seconds.

## Tuning retrieval

    uv run --directory backend python -m eval.run_eval --all-presets

This indexes a generated Chinese and Korean corpus under each chunking preset and
reports recall@1, recall@k, and MRR, split by same-language and cross-language cases.
Set the chunk settings in `.env` to whichever preset wins and re-index with
`{"force": true}`.

### Measured results

Run on the generated Chinese and Korean fixture corpus (3 documents, 11 cases) with
BGE-M3 on Apple Silicon (mps), 2026-09-20:

| Preset | target / max / overlap | recall@1 | recall@5 | MRR | passages |
|---|---|---|---|---|---|
| A | 200 / 300 / 40 | 0.45 | 1.00 | 0.689 | 10 |
| B | 300 / 450 / 50 | 0.45 | 1.00 | 0.689 | 10 |
| C | 450 / 650 / 75 | 0.45 | 1.00 | 0.689 | 10 |

Split by group, identically for all three presets: same-language recall@1 = 0.62,
MRR = 0.760; cross-language recall@1 = 0.00, MRR = 0.500, i.e. the translated
passage is consistently ranked second. Median query latency is 46 to 48 ms.

The fixture pages are short enough that all three presets produce nearly the same
passages, so this corpus cannot separate them. The default stays at preset B. Re-run
the comparison against your own documents before changing the chunk settings.

## Measuring answers

    uv run --directory backend python -m eval.run_answer_eval --label my-run
    uv run --directory backend python -m eval.run_answer_eval --no-rerank

Needs BGE-M3, the reranker and a running `llama-server`. It indexes three generated
manuals (Chinese, Korean, English) into an in-memory Qdrant and asks 15 questions
across every question and document language, five of them unanswerable, scoring
retrieval, citations, answer language, exact facts and refusals, and printing where
the "not found" threshold can go. On an Apple M1 with the default settings, 2026-10-04:
14 of 15 pass, with a median of 3.6 s per answer. The one failure is a correct "the
weight is not stated" that still carries a citation.

## Serving the UI on the local network

By default everything binds to `127.0.0.1` and nothing is reachable from the network.
To open the UI from a phone or another machine on the same network:

    npm --prefix frontend run dev:lan

In a Windows release, `run.bat lan` does the same and prints the address.

The UI is then at `http://<this-machine-ip>:5173`, or port 8000 on Windows. In the
development setup only the Vite dev server listens on the network; the backend and
Qdrant stay on `127.0.0.1`, and API calls from the other device are proxied through
Vite. On Windows the single process binds `0.0.0.0` directly.

Everyone on the network has to log in, and sees only their own documents and public
ones. The connection is plain HTTP, though, so passwords and documents cross the
network unencrypted: use this on a network you trust. macOS and Windows may each ask
once whether to allow incoming connections; that prompt is this server.

## Offline guarantees

- `ALLOW_MODEL_DOWNLOAD=false` sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`,
  and the backend refuses to start if `models/bge-m3` is missing rather than
  downloading it.
- Qdrant runs with telemetry disabled and both ports bound to `127.0.0.1`, and with
  `QDRANT_PATH` set there is no Qdrant process and no port at all.
- The backend binds to `127.0.0.1` unless it is told otherwise.
- A Windows release carries its own interpreter and libraries, pinned by `uv.lock`,
  so nothing is installed or fetched on the machine that runs it.
- The frontend loads no webfonts and no CDN scripts.
- Passage text is never logged unless `DEBUG_LOG_TEXT=true`.
- Query text is never logged, and neither is an answer: only counts and timings.
- The answer model runs on this machine. `llama-server` is started on `127.0.0.1`, so
  even with `run.bat lan` only the backend is reachable from the network.

## Out of scope for this version

OCR for scanned PDFs, legacy `.doc`, `.odt` and `.rtf`, keyword and hybrid search,
follow-up questions in a conversation, folder watching, PDF preview, email password
reset, HTTPS, and for search, GPUs other than NVIDIA RTX and Apple Silicon. Image-only PDFs and encrypted files are reported as `unsupported` rather
than failing the run.

## Troubleshooting

| Symptom | Check |
|---|---|
| Backend will not start | `models/bge-m3` exists; rerun `scripts/download_model.py` |
| Search returns nothing | `scripts/check_qdrant.py` for the point count, then index |
| "Cannot reach the backend" in the UI | Uvicorn is on 127.0.0.1:8000 |
| A PDF is `unsupported` | It is image-only or encrypted; OCR is out of scope |
| A Word file is `unsupported` | It is password-protected, or an old `.doc` renamed `.docx` |
| Document counts look wrong | `scripts/rebuild_manifest.py` |
| No admin can log in | `scripts/reset_admin.py <username>` on the machine itself |
| A user cannot see a document | It is private to its owner; an admin can make it public |
| Indexing is slow | The Indexing page says which device is used. On Windows with an RTX card, update the NVIDIA driver to 528+ (570+ on RTX 50) |
| Windows: "the NVIDIA GPU could not be used" | Driver older than 528 (570 on RTX 50), or a card older than RTX 20; it runs on the CPU meanwhile |
| Windows: PyTorch will not import | Run `runtime\vc_redist.x64.exe` as administrator |
| Windows: run.bat says the release is incomplete | Copy the release folder across again, whole |
| Windows: anything else | `check.bat` in the release folder |
| Windows: "already running" | `stop.bat`, then `run.bat` |
| Embedded store errors about a lock | Two processes opened `qdrant_storage/`; stop the app first |
| No answer box on the search page | `LLM_URL` is empty, `llama-server` is not running, search runs on the CPU, or answers are switched off (account menu → Appearance; admins also Settings → Search) |
| Log: "answers are off: search runs on the CPU" | No usable GPU, `EMBEDDING_DEVICE=cpu`, or the GPU failed at load (the reason is in the log). An answer on a CPU takes about a minute; `LLM_REQUIRE_GPU=false` turns answers on anyway |
| Log: "no reranker at ..." | `scripts/download_model.py reranker`; until then answers use the search order |
| An answer is in the wrong language | Rare; it is checked and restarted once. Try `run_answer_eval.py` against the model you are using |
