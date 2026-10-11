"""One-time online download of the local models into models/.

    download_model.py                  BAAI/bge-m3 into models/bge-m3 (search)
    download_model.py reranker         BAAI/bge-reranker-v2-m3 into models/bge-reranker-v2-m3
    download_model.py llm              the answer model, one GGUF file, into models/llm
    download_model.py bge-m3 reranker llm   all three

Everything after this runs offline. The ONNX exports and images in the repositories
are skipped because sentence-transformers does not use them.
"""

from __future__ import annotations

import hashlib
import os
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WEIGHTS = ["model.safetensors", "pytorch_model.bin"]
TOKENIZER = ["tokenizer.json", "sentencepiece.bpe.model"]


@dataclass(frozen=True)
class Model:
    repo_id: str
    target: Path
    # Files sentence-transformers needs to load the model from a plain directory.
    required: tuple[str, ...]


MODELS = {
    "bge-m3": Model(
        "BAAI/bge-m3",
        REPO_ROOT / "models" / "bge-m3",
        (
            "config.json",
            "sentence_bert_config.json",
            "modules.json",
            "1_Pooling/config.json",
            "tokenizer_config.json",
        ),
    ),
    # Reorders search hits before an answer is written from them. A cross-encoder,
    # so it has no pooling config of its own.
    "reranker": Model(
        "BAAI/bge-reranker-v2-m3",
        REPO_ROOT / "models" / "bge-reranker-v2-m3",
        ("config.json", "tokenizer_config.json"),
    ),
}


# The model that writes answers: a single quantised file llama-server loads. Apache-2.0.
LLM_REPO = "unsloth/Qwen3-4B-Instruct-2507-GGUF"
LLM_FILE = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
LLM_TARGET = REPO_ROOT / "models" / "llm"

# Tries per model. The first goes through the hub's Xet backend, which is fast but
# drops the whole file when a slow or flaky connection breaks a chunk ("CAS Client
# Error ... error decoding response body"); the rest use plain HTTPS. Either way the
# hub deletes a partial file when a download fails, so these models restart; they
# are small next to the answer model, which download_llm resumes itself.
ATTEMPTS = 4

# The answer model gives up only after this many tries in a row that add no bytes,
# about a quarter of an hour of a dead connection (a VPN reconnecting, say).
LLM_STALLED_TRIES = 20
CHUNK = 1024 * 1024


def with_retries(name: str, fetch: Callable[[], object]) -> bool:
    from huggingface_hub import constants

    for attempt in range(1, ATTEMPTS + 1):
        try:
            fetch()
            return True
        except Exception as exc:  # network, disk or hub errors all end the same way
            print(f"WARN  {name}: attempt {attempt} of {ATTEMPTS} failed: {exc}")
        if not constants.HF_HUB_DISABLE_XET:
            print("      switching to plain HTTPS downloads")
            constants.HF_HUB_DISABLE_XET = True
        if attempt < ATTEMPTS:
            time.sleep(5 * attempt)
    print(f"FAIL  {name}: download did not complete")
    return False


def fetch_range(url: str, headers: dict[str, str], part: Path, size: int) -> None:
    """Append to `part` from where it stops until it holds `size` bytes."""
    import httpx
    from tqdm import tqdm

    have = part.stat().st_size if part.exists() else 0
    timeout = httpx.Timeout(30.0, read=60.0)
    with httpx.stream(
        "GET", url, headers={**headers, "Range": f"bytes={have}-"}, follow_redirects=True, timeout=timeout
    ) as response:
        response.raise_for_status()
        if response.status_code != 206:  # the server ignored the range: start over
            have = 0
        with part.open("ab" if have else "wb") as f, tqdm(
            total=size, initial=have, unit="B", unit_scale=True, desc=LLM_FILE
        ) as bar:
            for chunk in response.iter_bytes(CHUNK):
                f.write(chunk)
                bar.update(len(chunk))


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while block := f.read(16 * CHUNK):
            digest.update(block)
    return digest.hexdigest()


def download_llm() -> bool:
    """One large file, fetched by hand so a dropped connection keeps what arrived.

    The bytes collect in <file>.part beside the target and every retry asks only for
    the rest, so a break at 43% picks up at 43%. The file is checked against the
    size and SHA-256 the hub publishes before it takes its real name.
    """
    from huggingface_hub import get_hf_file_metadata, hf_hub_url
    from huggingface_hub.utils import build_hf_headers

    target = LLM_TARGET / LLM_FILE
    part = target.with_name(target.name + ".part")
    LLM_TARGET.mkdir(parents=True, exist_ok=True)
    url = hf_hub_url(LLM_REPO, LLM_FILE)
    headers = build_hf_headers()
    print(f"downloading {LLM_REPO}/{LLM_FILE} into {LLM_TARGET} ...")

    meta = None
    stalled = 0
    while meta is None or not part.exists() or part.stat().st_size < meta.size:
        before = part.stat().st_size if part.exists() else 0
        try:
            meta = meta or get_hf_file_metadata(url, headers=headers)
            fetch_range(url, headers, part, meta.size)
        except Exception as exc:  # DNS, TLS, timeouts and resets all mean "try again"
            print(f"WARN  llm: {exc}")
        after = part.stat().st_size if part.exists() else 0
        stalled = 0 if after > before else stalled + 1
        if meta is not None and after >= meta.size:
            break
        if stalled >= LLM_STALLED_TRIES:
            print(f"FAIL  llm: no progress in {stalled} tries; {after / 1024**3:.2f} GB kept in {part.name}")
            return False
        wait = min(60, 5 * stalled) or 2
        print(f"      resuming from {after / 1024**3:.2f} GB in {wait}s ...")
        time.sleep(wait)

    if part.stat().st_size != meta.size:
        print(f"FAIL  llm: {part.name} is larger than the published size; delete it and run again")
        return False
    expected = (meta.etag or "").strip('"').lower()
    if len(expected) == 64:
        print("      checking SHA-256 ...")
        if sha256_of(part) != expected:
            part.unlink()
            print("FAIL  llm: the file is corrupt and was deleted; run this again")
            return False
    part.replace(target)
    print(f"OK    llm ready at {target} ({target.stat().st_size / 1024**3:.2f} GB)")
    return True


def download(name: str, model: Model) -> bool:
    from huggingface_hub import snapshot_download

    model.target.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {model.repo_id} into {model.target} ...")
    fetch = partial(
        snapshot_download,
        repo_id=model.repo_id,
        local_dir=str(model.target),
        ignore_patterns=["onnx/*", "*.onnx", "imgs/*", "assets/*", "*.msgpack", "*.h5"],
        max_workers=4,
    )
    if not with_retries(name, fetch):
        return False

    missing = [file for file in model.required if not (model.target / file).exists()]
    if not any((model.target / file).exists() for file in WEIGHTS):
        missing.append(" or ".join(WEIGHTS))
    if not any((model.target / file).exists() for file in TOKENIZER):
        missing.append(" or ".join(TOKENIZER))
    if missing:
        print(f"FAIL  {name}: download incomplete, missing:")
        for file in missing:
            print(f"        {file}")
        return False

    size_gb = sum(p.stat().st_size for p in model.target.rglob("*") if p.is_file()) / 1024**3
    print(f"OK    {name} ready at {model.target} ({size_gb:.2f} GB)")
    return True


# Every name the script accepts, and how to fetch it.
DOWNLOADS: dict[str, Callable[[], bool]] = {
    **{name: partial(download, name, model) for name, model in MODELS.items()},
    "llm": download_llm,
}


def main(argv: list[str]) -> int:
    names = argv or ["bge-m3"]
    unknown = [name for name in names if name not in DOWNLOADS]
    if unknown:
        print(f"unknown model(s): {', '.join(unknown)}; choose from {', '.join(DOWNLOADS)}")
        return 2

    # This script is the one place allowed to reach the network.
    os.environ["HF_HUB_OFFLINE"] = "0"
    os.environ["TRANSFORMERS_OFFLINE"] = "0"
    if not all([DOWNLOADS[name]() for name in names]):
        return 1
    print("      you can now disconnect from the network")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
