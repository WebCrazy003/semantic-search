"""Report Qdrant reachability and the state of the passage collection.

Run this whenever search or indexing behaves oddly, before debugging anything else.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from qdrant_client import QdrantClient  # noqa: E402

from app.config import get_settings  # noqa: E402


def main() -> int:
    settings = get_settings()
    client = QdrantClient(url=settings.qdrant_url, timeout=settings.qdrant_timeout)
    try:
        collections = [c.name for c in client.get_collections().collections]
    except Exception as exc:
        print(f"FAIL  cannot reach Qdrant at {settings.qdrant_url}: {exc}")
        print("      start it with: docker compose up -d")
        return 1

    print(f"OK    connected to {settings.qdrant_url}")
    print(f"      collections: {collections or '(none)'}")

    name = settings.qdrant_collection
    if name not in collections:
        print(f"      '{name}' does not exist yet; the backend creates it at startup")
        return 0

    info = client.get_collection(name)
    print(f"      '{name}': points={info.points_count} status={info.status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
