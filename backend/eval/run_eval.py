# backend/eval/run_eval.py
"""Measure retrieval quality and compare chunking presets.

Each preset gets its own throwaway Qdrant collection and manifest, so a comparison
never disturbs the real index.

    uv run --directory backend python -m eval.run_eval --preset B
    uv run --directory backend python -m eval.run_eval --all-presets
    uv run --directory backend python -m eval.run_eval --preset B --documents ./documents
"""

from __future__ import annotations

import argparse
import json
import statistics
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from qdrant_client import QdrantClient

from app.config import get_settings
from app.deps import build_extractors
from app.models.request_models import SearchRequest
from app.services.chunk_service import ChunkConfig, Chunker
from app.services.embedding_service import BgeEmbeddingService
from app.services.indexing_service import IndexingService
from app.services.manifest_service import ManifestService
from app.services.qdrant_service import QdrantService
from app.services.search_service import SearchService
from app.services.tokenizer_service import BgeTokenizer

EVAL_DIR = Path(__file__).resolve().parent
RELEVANCE_SET = EVAL_DIR / "relevance_set.json"

# The three presets the specification names.
PRESETS: dict[str, ChunkConfig] = {
    "A": ChunkConfig(target_tokens=200, max_tokens=300, min_tokens=60, overlap_tokens=40),
    "B": ChunkConfig(target_tokens=300, max_tokens=450, min_tokens=80, overlap_tokens=50),
    "C": ChunkConfig(target_tokens=450, max_tokens=650, min_tokens=120, overlap_tokens=75),
}


@dataclass(frozen=True)
class Expectation:
    filename: str
    page: int


@dataclass(frozen=True)
class Case:
    id: str
    group: str
    query: str
    expect: list[Expectation]


@dataclass(frozen=True)
class CaseResult:
    case_id: str
    group: str
    hit_at_1: bool
    hit_at_k: bool
    reciprocal_rank: float
    rank: int | None
    took_ms: int


@dataclass(frozen=True)
class Summary:
    cases: int
    recall_at_1: float
    recall_at_k: float
    mrr: float
    median_ms: float


def load_cases(path: Path = RELEVANCE_SET) -> list[Case]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [
        Case(
            id=entry["id"],
            group=entry.get("group", "same_language"),
            query=entry["query"],
            expect=[Expectation(**expectation) for expectation in entry["expect"]],
        )
        for entry in raw["cases"]
    ]


def _matches(hit: dict[str, Any], expectation: Expectation) -> bool:
    if hit.get("filename") != expectation.filename:
        return False
    start = int(hit.get("page_start", 0))
    end = int(hit.get("page_end", start))
    return start <= expectation.page <= end


def evaluate_case(
    case: Case, hits: list[dict[str, Any]], top_k: int, took_ms: int = 0
) -> CaseResult:
    rank: int | None = None
    for position, hit in enumerate(hits[:top_k], start=1):
        if any(_matches(hit, expectation) for expectation in case.expect):
            rank = position
            break
    return CaseResult(
        case_id=case.id,
        group=case.group,
        hit_at_1=rank == 1,
        hit_at_k=rank is not None,
        reciprocal_rank=1.0 / rank if rank else 0.0,
        rank=rank,
        took_ms=took_ms,
    )


def summarise(results: list[CaseResult]) -> Summary:
    if not results:
        return Summary(cases=0, recall_at_1=0.0, recall_at_k=0.0, mrr=0.0, median_ms=0.0)
    count = len(results)
    return Summary(
        cases=count,
        recall_at_1=sum(result.hit_at_1 for result in results) / count,
        recall_at_k=sum(result.hit_at_k for result in results) / count,
        mrr=sum(result.reciprocal_rank for result in results) / count,
        median_ms=statistics.median(result.took_ms for result in results),
    )


def _run_preset(
    preset: str,
    documents: Path,
    top_k: int,
    embedder: BgeEmbeddingService,
    tokenizer: BgeTokenizer,
    keep: bool,
) -> list[CaseResult]:
    settings = get_settings()
    collection = f"{settings.qdrant_collection}_eval_{preset.lower()}"
    client = QdrantClient(url=settings.qdrant_url, timeout=settings.qdrant_timeout)

    qdrant = QdrantService(
        client=client,
        collection=collection,
        vector_size=settings.vector_size,
        upsert_batch=settings.qdrant_upsert_batch,
    )
    if qdrant.collection_exists():
        client.delete_collection(collection)
    qdrant.ensure_collection()

    with tempfile.TemporaryDirectory() as scratch:
        manifest = ManifestService(Path(scratch) / "eval.db")
        manifest.initialise()
        indexer = IndexingService(
            extractors=build_extractors(settings),
            chunker=Chunker(tokenizer=tokenizer, config=PRESETS[preset]),
            embedder=embedder,
            qdrant=qdrant,
            manifest=manifest,
            default_directory=documents,
        )
        started = time.perf_counter()
        assert indexer.start(documents, force=True)
        indexer.run(documents, force=True)
        status = indexer.snapshot()
        index_seconds = time.perf_counter() - started

        searcher = SearchService(
            embedder=embedder, qdrant=qdrant, default_top_k=top_k, max_top_k=top_k
        )
        results: list[CaseResult] = []
        for case in load_cases():
            response = searcher.search(SearchRequest(query=case.query, top_k=top_k))
            hits = [hit.model_dump() for hit in response.results]
            results.append(evaluate_case(case, hits, top_k, response.took_ms))

        print(
            f"\nPreset {preset}: target={PRESETS[preset].target_tokens} "
            f"max={PRESETS[preset].max_tokens} overlap={PRESETS[preset].overlap_tokens}"
        )
        print(
            f"  indexed {status.indexed_documents} documents into {status.total_chunks} "
            f"passages in {index_seconds:.1f}s"
        )
        manifest.close()

    if not keep:
        client.delete_collection(collection)
    client.close()
    return results


def _print_table(preset: str, results: list[CaseResult], top_k: int) -> None:
    print(f"  {'case':<26} {'rank':>5}  {'ms':>5}")
    for result in results:
        rank = str(result.rank) if result.rank else "miss"
        print(f"  {result.case_id:<26} {rank:>5}  {result.took_ms:>5}")

    overall = summarise(results)
    same = summarise([r for r in results if r.group == "same_language"])
    cross = summarise([r for r in results if r.group == "cross_language"])
    print(
        f"  overall        recall@1={overall.recall_at_1:.2f} "
        f"recall@{top_k}={overall.recall_at_k:.2f} MRR={overall.mrr:.3f} "
        f"median={overall.median_ms:.0f}ms"
    )
    print(f"  same-language  recall@1={same.recall_at_1:.2f} MRR={same.mrr:.3f}")
    print(f"  cross-language recall@1={cross.recall_at_1:.2f} MRR={cross.mrr:.3f}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate retrieval quality per chunk preset")
    parser.add_argument("--preset", choices=sorted(PRESETS), default="B")
    parser.add_argument("--all-presets", action="store_true")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument(
        "--documents",
        type=Path,
        default=None,
        help="Corpus to evaluate. Defaults to generated fixtures in a temp directory.",
    )
    parser.add_argument("--keep", action="store_true", help="Keep the eval collections")
    args = parser.parse_args()

    settings = get_settings()
    tokenizer = BgeTokenizer(settings.bge_model_path)
    embedder = BgeEmbeddingService(
        model_path=settings.bge_model_path,
        device=settings.embedding_device,
        batch_size=settings.embedding_batch_size,
        max_seq_length=settings.embedding_max_seq_length,
        expected_dimension=settings.vector_size,
    )

    with tempfile.TemporaryDirectory() as scratch:
        if args.documents is None:
            from tests.fixtures.make_fixtures import build_all

            documents = Path(scratch) / "corpus"
            build_all(documents)
            print(f"using generated fixtures in {documents}")
        else:
            documents = args.documents
            print(f"using corpus {documents}")

        presets = sorted(PRESETS) if args.all_presets else [args.preset]
        summaries: dict[str, Summary] = {}
        for preset in presets:
            results = _run_preset(preset, documents, args.top_k, embedder, tokenizer, args.keep)
            _print_table(preset, results, args.top_k)
            summaries[preset] = summarise(results)

    if len(summaries) > 1:
        best = max(summaries.items(), key=lambda item: (item[1].mrr, item[1].recall_at_1))
        print("\nComparison:")
        for preset, summary in summaries.items():
            print(
                f"  preset {preset}: recall@1={summary.recall_at_1:.2f} "
                f"MRR={summary.mrr:.3f}"
            )
        print(f"  best by MRR: preset {best[0]}")
        print("  Set CHUNK_TARGET_TOKENS, CHUNK_MAX_TOKENS, and CHUNK_OVERLAP_TOKENS to match.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
