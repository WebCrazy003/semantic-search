"""One-time online download of BAAI/bge-m3 into models/bge-m3.

Everything after this runs offline. The ONNX exports and images in the repository
are skipped because sentence-transformers does not use them.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TARGET = REPO_ROOT / "models" / "bge-m3"
REPO_ID = "BAAI/bge-m3"

# sentence-transformers needs all of these to load a model from a plain directory.
REQUIRED = [
    "config.json",
    "sentence_bert_config.json",
    "modules.json",
    "1_Pooling/config.json",
    "tokenizer_config.json",
]
WEIGHTS = ["model.safetensors", "pytorch_model.bin"]
TOKENIZER = ["tokenizer.json", "sentencepiece.bpe.model"]


def main() -> int:
    # This script is the one place allowed to reach the network.
    os.environ["HF_HUB_OFFLINE"] = "0"
    os.environ["TRANSFORMERS_OFFLINE"] = "0"
    from huggingface_hub import snapshot_download

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {REPO_ID} into {TARGET} ...")
    snapshot_download(
        repo_id=REPO_ID,
        local_dir=str(TARGET),
        ignore_patterns=["onnx/*", "*.onnx", "imgs/*", "*.msgpack", "*.h5"],
        max_workers=4,
    )

    missing = [name for name in REQUIRED if not (TARGET / name).exists()]
    if not any((TARGET / name).exists() for name in WEIGHTS):
        missing.append(" or ".join(WEIGHTS))
    if not any((TARGET / name).exists() for name in TOKENIZER):
        missing.append(" or ".join(TOKENIZER))

    if missing:
        print("FAIL  download incomplete, missing:")
        for name in missing:
            print(f"        {name}")
        return 1

    size_gb = sum(p.stat().st_size for p in TARGET.rglob("*") if p.is_file()) / 1024**3
    print(f"OK    model ready at {TARGET} ({size_gb:.2f} GB)")
    print("      you can now disconnect from the network")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
