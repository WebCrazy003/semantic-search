"""Check that an offline install actually works, before anyone tries to use it.

Run by setup.bat as its last step. It proves the pieces an offline machine cannot
repair by itself: the wheels imported, the embedded vector store reads and writes,
the interface was built, and the model loads with the network forced off.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

REQUIRED_IMPORTS = [
    ("torch", "PyTorch"),
    ("fastapi", "FastAPI"),
    ("uvicorn", "Uvicorn"),
    ("pymupdf", "PyMuPDF"),
    ("qdrant_client", "Qdrant client"),
    ("sentence_transformers", "sentence-transformers"),
]


def check_imports() -> bool:
    import importlib

    ok = True
    for module, label in REQUIRED_IMPORTS:
        try:
            importlib.import_module(module)
        except Exception as exc:  # noqa: BLE001 - the reason matters more than the type
            print(f"FAIL  {label} does not import: {exc}")
            if module == "torch":
                print("      usually the Visual C++ redistributable is missing;")
                print("      run runtime\\vc_redist.x64.exe as administrator")
            ok = False
    if ok:
        print(f"OK    dependencies import ({len(REQUIRED_IMPORTS)} checked)")
    return ok


def check_interface() -> bool:
    index = REPO_ROOT / "frontend" / "dist" / "index.html"
    if not index.is_file():
        print(f"FAIL  {index} is missing; the interface was not built into the bundle")
        return False
    print("OK    the built interface is present")
    return True


def check_embedded_store() -> bool:
    """Write and read a point in a throwaway store, the way the app will."""
    from qdrant_client import QdrantClient, models

    with tempfile.TemporaryDirectory() as tmp:
        client = QdrantClient(path=tmp)
        try:
            client.create_collection(
                "probe",
                vectors_config=models.VectorParams(size=4, distance=models.Distance.COSINE),
            )
            client.upsert(
                "probe",
                points=[models.PointStruct(id=1, vector=[1.0, 0.0, 0.0, 0.0], payload={"n": 1})],
                wait=True,
            )
            found = client.query_points(
                collection_name="probe", query=[1.0, 0.0, 0.0, 0.0], limit=1
            )
            if not found.points:
                print("FAIL  the embedded vector store returned nothing")
                return False
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL  the embedded vector store does not work: {exc}")
            return False
        finally:
            client.close()
    print("OK    the embedded vector store reads and writes")
    return True


def check_configuration() -> bool:
    from app.config import get_settings

    settings = get_settings()
    if not settings.embedded_qdrant:
        print("FAIL  QDRANT_PATH is not set in .env, so the app will look for a Qdrant server")
        return False
    if settings.allow_model_download:
        print("FAIL  ALLOW_MODEL_DOWNLOAD is true; an offline install must keep it false")
        return False
    print(f"OK    configured for an embedded store at {settings.qdrant_path}")
    return True


def main() -> int:
    print(f"      Python {sys.version.split()[0]} at {sys.executable}")
    checks = [check_imports, check_interface, check_embedded_store, check_configuration]
    if not all([check() for check in checks]):
        return 1

    # The slow one last: loads BGE-M3 with Hugging Face forced offline.
    print("      loading the embedding model, this takes a moment...")
    from verify_offline import main as verify_model

    return verify_model()


if __name__ == "__main__":
    raise SystemExit(main())
