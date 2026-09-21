"""Report Qdrant reachability and the state of the passage collection.

Run this whenever search or indexing behaves oddly, before debugging anything else.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import get_settings  # noqa: E402
from app.deps import build_qdrant_client  # noqa: E402


def main() -> int:
    settings = get_settings()
    where = settings.qdrant_path if settings.embedded_qdrant else settings.qdrant_url
    try:
        client = build_qdrant_client(settings)
        collections = [c.name for c in client.get_collections().collections]
    except Exception as exc:
        print(f"FAIL  cannot open Qdrant at {where}: {exc}")
        if settings.embedded_qdrant:
            # The embedded store is single-writer, so this is nearly always the cause.
            print("      stop the application first; only one process may hold that folder")
        else:
            print("      start it with: docker compose up -d")
        return 1

    print(f"OK    connected to {where}")
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
