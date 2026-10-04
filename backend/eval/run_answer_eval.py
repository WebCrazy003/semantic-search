"""Measure written answers end to end: retrieval, citations, language, facts, abstention.

Needs the real models: BGE-M3, the reranker (unless --no-rerank), and an answer model
server. The corpus from eval/answer_corpus.py is indexed into an in-memory Qdrant, so
the real index is never touched.

    llama-server -m models/llm/<model>.gguf --port 8081 -c 8192 -ngl 99 -np 1 --no-webui
    uv run --directory backend python -m eval.run_answer_eval --label qwen3.5-4b
    uv run --directory backend python -m eval.run_answer_eval --no-rerank
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import statistics
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from qdrant_client import QdrantClient

from app.config import get_settings
from app.deps import build_answers, build_reranker, chunk_config_from
from app.models.request_models import SearchRequest
from app.models.response_models import SearchResponse
from app.services import answer_language
from app.services.answer_service import AnswerService
from app.services.qdrant_service import QdrantService
from app.services.search_service import SearchService
from eval.answer_corpus import build as build_corpus
from eval.run_eval import Expectation, _matches, build_models, index_corpus

ANSWER_SET = Path(__file__).resolve().parent / "answer_set.json"

# The same citation forms the answer panel turns into chips: [1], [1][2], [1, 2], [1、2].
_CITATION = re.compile(r"\[\s*(\d+(?:\s*[,，、]\s*\d+)*)\s*\]")


@dataclass(frozen=True)
class Case:
    id: str
    query: str
    language: str
    expect: dict[str, Any] | None = None
    facts: list[str] = field(default_factory=list)
    unanswerable: bool = False
    forbid: list[str] = field(default_factory=list)


@dataclass
class Result:
    id: str
    unanswerable: bool
    status: str
    answer: str
    top_relevance: float | None
    source_rank: int | None  # the expected page's place among the answer's sources
    cited: list[int]
    cites_expected: bool
    citations_valid: bool
    language_ok: bool
    facts_ok: bool
    abstained: bool
    first_text_ms: int | None
    total_ms: int

    @property
    def passed(self) -> bool:
        if self.unanswerable:
            return self.abstained and self.language_ok
        return (
            self.source_rank is not None
            and self.facts_ok
            and self.language_ok
            and self.cites_expected
            and self.citations_valid
        )


def load_cases(path: Path = ANSWER_SET) -> list[Case]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [Case(**entry) for entry in raw["cases"]]


def cited_numbers(answer: str) -> list[int]:
    numbers: list[int] = []
    for match in _CITATION.finditer(answer):
        numbers.extend(int(part) for part in re.split(r"[,，、]", match.group(1)))
    return sorted(set(numbers))


def score_case(
    case: Case,
    response: SearchResponse,
    events: list[tuple[str, dict[str, Any]]],
    first_text_ms: int | None,
    total_ms: int,
) -> Result:
    answer = "".join(data["text"] for name, data in events if name == "delta")
    finished = [data for name, data in events if name in ("done", "error")]
    status = finished[-1].get("status", "error") if finished else "error"
    sources_event = next((data for name, data in events if name == "sources"), {})
    by_key = {(hit.document_id, hit.chunk_index): hit for hit in response.results}
    sources = {
        p["n"]: by_key.get((p["document_id"], p["chunk_index"]))
        for p in sources_event.get("passages", [])
    }
    expectation = Expectation(**case.expect) if case.expect else None

    def is_expected(n: int) -> bool:
        hit = sources.get(n)
        return (
            hit is not None and expectation is not None and _matches(hit.model_dump(), expectation)
        )

    cited = cited_numbers(answer)
    flat = re.sub(r"\s+", "", answer)
    return Result(
        id=case.id,
        unanswerable=case.unanswerable,
        status=status,
        answer=answer.strip(),
        top_relevance=sources_event.get("top_relevance"),
        source_rank=next((n for n in sorted(sources) if is_expected(n)), None),
        cited=cited,
        cites_expected=any(is_expected(n) for n in cited),
        citations_valid=all(n in sources for n in cited),
        language_ok=answer_language.is_in(answer, case.language),  # type: ignore[arg-type]
        facts_ok=all(re.sub(r"\s+", "", fact) in flat for fact in case.facts),
        # A model that failed has not declined to answer.
        abstained=status != "error"
        and (status == "not_found" or not cited)
        and not any(word in answer for word in case.forbid),
        first_text_ms=first_text_ms,
        total_ms=total_ms,
    )


async def _ask(answers: AnswerService, response: SearchResponse) -> tuple[list, int | None]:
    started = time.perf_counter()
    first: int | None = None
    events = []
    async for event in answers.events(response):
        if event[0] == "delta" and first is None:
            first = int((time.perf_counter() - started) * 1000)
        events.append(event)
    return events, first


def run(args: argparse.Namespace) -> list[Result]:
    settings = get_settings().model_copy(
        update={
            "llm_url": args.llm_url,
            "rag_min_score": args.min_score,
            "llm_timeout_seconds": 300,
            "reranker_model_path": None if args.no_rerank else get_settings().reranker_model_path,
        }
    )
    tokenizer, embedder = build_models(settings)
    qdrant = QdrantService(
        client=QdrantClient(location=":memory:"),
        collection="answer_eval",
        vector_size=settings.vector_size,
    )
    qdrant.ensure_collection()
    with tempfile.TemporaryDirectory() as scratch:
        documents = Path(scratch) / "corpus"
        build_corpus(documents)
        index_corpus(documents, qdrant, chunk_config_from(settings), embedder, tokenizer)

    search = SearchService(embedder=embedder, qdrant=qdrant)
    answers = build_answers(settings, build_reranker(settings, embedder.device_info().device))
    return asyncio.run(_run_cases(search, answers, args.top_k))


async def _run_cases(search: SearchService, answers: AnswerService, top_k: int) -> list[Result]:
    """Every case in one event loop, so the model's connection pool is reused."""
    results = []
    try:
        for case in load_cases():
            response = search.search(SearchRequest(query=case.query, top_k=top_k))
            started = time.perf_counter()
            events, first = await _ask(answers, response)
            total = int((time.perf_counter() - started) * 1000)
            result = score_case(case, response, events, first, total)
            results.append(result)
            print(_row(result), flush=True)
    finally:
        await answers.aclose()
    return results


def _row(result: Result) -> str:
    def flag(ok: bool) -> str:
        return "ok" if ok else "--"

    relevance = f"{result.top_relevance:.3f}" if result.top_relevance is not None else "-"
    if result.unanswerable:
        detail = f"abstain={flag(result.abstained)}"
    else:
        detail = (
            f"src={result.source_rank or 'miss'} facts={flag(result.facts_ok)} "
            f"cite={flag(result.cites_expected and result.citations_valid)}"
        )
    return (
        f"{'PASS' if result.passed else 'FAIL'} {result.id:<26} rel={relevance} "
        f"lang={flag(result.language_ok)} {detail} first={result.first_text_ms}ms "
        f"total={result.total_ms}ms"
    )


def summarise(results: list[Result], label: str) -> dict[str, Any]:
    answerable = [r for r in results if not r.unanswerable]
    unanswerable = [r for r in results if r.unanswerable]

    def share(items: list[Result], test: Any) -> float:
        return sum(1 for item in items if test(item)) / len(items) if items else 0.0

    summary = {
        "label": label,
        "passed": share(results, lambda r: r.passed),
        "retrieved": share(answerable, lambda r: r.source_rank is not None),
        "facts": share(answerable, lambda r: r.facts_ok),
        "cites_expected": share(answerable, lambda r: r.cites_expected and r.citations_valid),
        "language": share(results, lambda r: r.language_ok),
        "abstained_correctly": share(unanswerable, lambda r: r.abstained),
        "answered_when_it_should": share(answerable, lambda r: not r.abstained),
        "median_first_text_ms": statistics.median(
            [r.first_text_ms for r in results if r.first_text_ms is not None] or [0]
        ),
        "median_total_ms": statistics.median([r.total_ms for r in results]),
    }
    print(f"\n{label}")
    for key, value in summary.items():
        if key != "label":
            print(f"  {key:<24} {value:.2f}" if value <= 1 else f"  {key:<24} {value:.0f}")

    # Where to put the "not found" threshold: between the best unanswerable hit and the
    # worst answerable one, when they separate.
    # Reranker scores only: without the reranker there is no comparable score.
    found = sorted(r.top_relevance for r in answerable if r.top_relevance is not None)
    missing = sorted(r.top_relevance for r in unanswerable if r.top_relevance is not None)
    if found and missing:
        print(
            f"  top relevance, answerable:   min={found[0]:.3f} "
            f"median={statistics.median(found):.3f}"
        )
        print(
            f"  top relevance, unanswerable: max={missing[-1]:.3f} "
            f"median={statistics.median(missing):.3f}"
        )
        if missing[-1] < found[0]:
            print(f"  separable: a threshold in ({missing[-1]:.3f}, {found[0]:.3f}) splits them")
        else:
            print("  not separable by top relevance alone")
    return summary


def main() -> int:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Evaluate written answers end to end")
    parser.add_argument("--llm-url", default=settings.llm_url or "http://127.0.0.1:8081/v1")
    parser.add_argument("--label", default="answers", help="Name for this run in the report")
    parser.add_argument("--no-rerank", action="store_true")
    parser.add_argument("--min-score", type=float, default=settings.rag_min_score)
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--json", type=Path, help="Write every case's result here")
    args = parser.parse_args()

    results = run(args)
    summary = summarise(results, args.label)
    if args.json:
        args.json.write_text(
            json.dumps(
                {"summary": summary, "cases": [asdict(r) for r in results]},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"  wrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
