"""Load BGE-M3 with Hugging Face forced offline and check the vector geometry.

Proves three things the specification asks for: the model loads with no network,
the dense vectors are 1024-dimensional, and multilingual similarity is sane.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = REPO_ROOT / "models" / "bge-m3"


def main() -> int:
    if not MODEL_DIR.exists():
        print(f"FAIL  {MODEL_DIR} does not exist; run scripts/download_model.py first")
        return 1

    import numpy as np
    from sentence_transformers import SentenceTransformer

    started = time.perf_counter()
    model = SentenceTransformer(str(MODEL_DIR))
    print(f"OK    loaded in {time.perf_counter() - started:.1f}s on {model.device}")

    dimension = model.get_sentence_embedding_dimension()
    print(f"      dimension: {dimension}")
    if dimension != 1024:
        print("FAIL  expected 1024 dimensions")
        return 1

    # BGE-M3 needs no query instruction prefix. Do not add one anywhere.
    texts = [
        "更换滤芯之前必须关闭主电源。",
        "필터를 교체하기 전에 주 전원을 끄십시오.",
        "The warranty covers manufacturing defects for two years.",
    ]
    vectors = model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)
    norms = np.linalg.norm(vectors, axis=1)
    print(f"      norms: {np.round(norms, 4).tolist()}")

    zh_ko = float(vectors[0] @ vectors[1])
    zh_en = float(vectors[0] @ vectors[2])
    print(f"      cosine(zh, ko translation): {zh_ko:.4f}")
    print(f"      cosine(zh, unrelated en):   {zh_en:.4f}")
    if zh_ko <= zh_en:
        print("FAIL  translations should be closer than unrelated text")
        return 1
    print("OK    offline multilingual embedding works")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
