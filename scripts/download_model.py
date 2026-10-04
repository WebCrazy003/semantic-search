"""One-time online download of the local models into models/.

    download_model.py                  BAAI/bge-m3 into models/bge-m3 (search)
    download_model.py reranker         BAAI/bge-reranker-v2-m3 into models/bge-reranker-v2-m3
    download_model.py llm              the answer model, one GGUF file, into models/llm
    download_model.py bge-m3 reranker llm   all three

Everything after this runs offline. The ONNX exports and images in the repositories
are skipped because sentence-transformers does not use them.
"""

from __future__ import annotations

import os
import sys
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


def download_llm() -> bool:
    from huggingface_hub import hf_hub_download

    LLM_TARGET.mkdir(parents=True, exist_ok=True)
    print(f"downloading {LLM_REPO}/{LLM_FILE} into {LLM_TARGET} ...")
    try:
        path = Path(hf_hub_download(LLM_REPO, LLM_FILE, local_dir=str(LLM_TARGET)))
    except Exception as exc:  # network, disk or hub errors all end the same way
        print(f"FAIL  llm: {exc}")
        return False
    print(f"OK    llm ready at {path} ({path.stat().st_size / 1024**3:.2f} GB)")
    return True


def download(name: str, model: Model) -> bool:
    from huggingface_hub import snapshot_download

    model.target.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {model.repo_id} into {model.target} ...")
    snapshot_download(
        repo_id=model.repo_id,
        local_dir=str(model.target),
        ignore_patterns=["onnx/*", "*.onnx", "imgs/*", "assets/*", "*.msgpack", "*.h5"],
        max_workers=4,
    )

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
