# Offline Semantic PDF Search

Semantic search over Chinese and Korean PDFs, running entirely on one machine. No
cloud API, no external search service, and no internet connection once the model is
downloaded.

## How it works

    PDFs -> PyMuPDF -> chunker -> BGE-M3 -> Qdrant -> FastAPI -> React

- **Extraction** is page by page, with heading and table detection.
- **Chunking** is measured in BGE-M3 tokens, not characters, because Chinese and
  Korean tokenize differently from English.
- **Embeddings** are BGE-M3 dense vectors, 1024 dimensions, cosine similarity, one
  shared vector space for every language.
- **Storage** is a single Qdrant collection, `pdf_passages`, one point per passage.
- **A SQLite manifest** at `data/manifest.db` holds per-document bookkeeping. It is a
  derived cache; `scripts/rebuild_manifest.py` regenerates it from Qdrant.

## Setup

Once, with the network on:

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

Then open http://127.0.0.1:5173. Put PDFs in `documents/` and press
**Index documents** on the Documents tab.

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

The UI is then at `http://<this-machine-ip>:5173`. Only the Vite dev server listens on
the network; the backend and Qdrant stay on `127.0.0.1`, and API calls from the other
device are proxied through Vite, so nothing else is exposed.

**There is no authentication.** Anyone who can reach that address can search every
indexed document, read the passages, open the PDFs, remove documents and clear the
index. Use this on a network you trust, and go back to `npm --prefix frontend run dev`
when you are finished. macOS may ask once whether to allow incoming connections for
Node; that prompt is this server.

## Offline guarantees

- `ALLOW_MODEL_DOWNLOAD=false` sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`,
  and the backend refuses to start if `models/bge-m3` is missing rather than
  downloading it.
- Qdrant runs with telemetry disabled and both ports bound to `127.0.0.1`.
- The backend binds to `127.0.0.1`.
- The frontend loads no webfonts and no CDN scripts.
- Passage text is never logged unless `DEBUG_LOG_TEXT=true`.
- Query text is never logged.

## Out of scope for this version

OCR for scanned PDFs, keyword and hybrid search, reranking, LLM answers, folder
watching, PDF preview, user accounts. Image-only PDFs are reported as `unsupported`
rather than failing the run.

## Troubleshooting

| Symptom | Check |
|---|---|
| Backend will not start | `models/bge-m3` exists; rerun `scripts/download_model.py` |
| Search returns nothing | `scripts/check_qdrant.py` for the point count, then index |
| "Cannot reach the backend" in the UI | Uvicorn is on 127.0.0.1:8000 |
| A PDF is `unsupported` | It is image-only or encrypted; OCR is out of scope |
| Document counts look wrong | `scripts/rebuild_manifest.py` |
| Indexing is slow | Raise `EMBEDDING_BATCH_SIZE`, or set `EMBEDDING_DEVICE=mps` |
