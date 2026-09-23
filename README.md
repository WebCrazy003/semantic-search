# DocSage — find knowledge locally

Semantic search over Chinese and Korean PDFs and Word (.docx) files, running
entirely on one machine. No
cloud API, no external search service, and no internet connection once the model is
downloaded.

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

## Setup

Once, with the network on. This is the development setup on macOS and Linux; to
build a Windows release skip to
[Windows: building an offline release](#windows-building-an-offline-release).

    cd backend && uv venv --python 3.12 && uv sync --all-groups && cd ..
    uv run --directory backend python ../scripts/download_model.py
    npm --prefix frontend install
    cp .env.example .env

From then on, no network is needed.

## Running

Three processes:

    docker compose up -d
    uv run --directory backend uvicorn app.main:app --host 127.0.0.1 --port 8000
    npm --prefix frontend run dev

Then open http://127.0.0.1:5173. Put PDF or Word files in `documents/` and press
**Index documents** on the Documents tab.

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
version comes from the [VERSION](VERSION) file. Expect about 6 GB and 20 to 50
minutes; re-runs reuse the downloaded model.

### What the release contains

    run.bat              start, and open the browser
    stop.bat             stop
    check.bat            prove the installation works
    README-FIRST.txt     instructions for whoever ends up using it
    .env                 settings, with QDRANT_PATH already set
    VERSION.txt          version, build date and build machine
    documents\           where they drop PDF and Word files
    backend\app\         the application
    frontend\dist\       the built interface
    models\bge-m3\       the embedding model
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

## GPU indexing on Windows

PyPI's PyTorch for Windows is CPU-only, so on Windows `torch` comes from PyTorch's
own CUDA index instead ([pyproject.toml](backend/pyproject.toml), `[tool.uv.sources]`).
macOS keeps the PyPI wheel and uses the Apple GPU (mps).

| | |
|---|---|
| PyTorch build | `2.14.0+cu130` (CUDA 13.0), from `download.pytorch.org/whl/cu130` |
| Cards | GeForce RTX 20, 30, 40 and 50-series (GTX 16 too). Tested first on the RTX 5060 |
| Kernels in the build | `sm_75` (RTX 20), `sm_86` (RTX 30, and RTX 40 through it), `sm_120` (RTX 50); `prepare-offline.bat` fails the build if any is missing |
| Driver | NVIDIA display driver **580 or newer**. No CUDA Toolkit is needed; the runtime ships inside the wheel |
| Not supported | GTX 10-series and older, AMD and Intel GPUs. They index on the CPU |

`cu130` is used because it is the oldest PyTorch CUDA index that has the locked torch
with Blackwell (RTX 50) kernels. `cu126` has no RTX 50 support and `cu128` does not
publish this torch version.

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

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/health/ready` | Qdrant, collection, model, point count |
| POST | `/api/search` | Semantic search |
| POST | `/api/index` | Start an indexing run |
| GET | `/api/index/status` | Progress and failures of the current or last run |
| GET | `/api/documents` | Indexed documents with page and passage counts |

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

## Serving the UI on the local network

By default everything binds to `127.0.0.1` and nothing is reachable from the network.
To open the UI from a phone or another machine on the same network:

    npm --prefix frontend run dev:lan

In a Windows release, `run.bat lan` does the same and prints the address.

The UI is then at `http://<this-machine-ip>:5173`, or port 8000 on Windows. In the
development setup only the Vite dev server listens on the network; the backend and
Qdrant stay on `127.0.0.1`, and API calls from the other device are proxied through
Vite. On Windows the single process binds `0.0.0.0` directly.

**There is no authentication.** Anyone who can reach that address can search every
indexed document, read the passages, open the PDFs, remove documents and clear the
index. Use this on a network you trust, and go back to `npm --prefix frontend run dev`
when you are finished. macOS and Windows may each ask once whether to allow
incoming connections; that prompt is this server.

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
- Query text is never logged.

## Out of scope for this version

OCR for scanned PDFs, legacy `.doc`, `.odt` and `.rtf`, keyword and hybrid search,
reranking, LLM answers, folder watching, PDF preview, user accounts, GPUs other than
NVIDIA RTX. Image-only PDFs and encrypted files are reported as `unsupported` rather
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
| Indexing is slow | The Indexing page says which device is used. On Windows with an RTX card, update the NVIDIA driver to 580+ |
| Windows: "the NVIDIA GPU could not be used" | Driver older than 580, or a card older than RTX 20; it runs on the CPU meanwhile |
| Windows: PyTorch will not import | Run `runtime\vc_redist.x64.exe` as administrator |
| Windows: run.bat says the release is incomplete | Copy the release folder across again, whole |
| Windows: anything else | `check.bat` in the release folder |
| Windows: "already running" | `stop.bat`, then `run.bat` |
| Embedded store errors about a lock | Two processes opened `qdrant_storage/`; stop the app first |
