# backend/tests/test_eval_harness.py
from eval.run_eval import Case, Expectation, evaluate_case, summarise


def case(query: str = "q") -> Case:
    return Case(
        id="c1",
        group="same_language",
        query=query,
        expect=[Expectation(filename="manual_zh.pdf", page=1)],
    )


def hit(filename: str, page: int) -> dict[str, object]:
    return {"filename": filename, "page_start": page, "page_end": page}


class TestEvaluateCase:
    def test_a_hit_at_rank_one_scores_perfectly(self) -> None:
        result = evaluate_case(case(), [hit("manual_zh.pdf", 1)], top_k=5)
        assert result.hit_at_1 is True
        assert result.hit_at_k is True
        assert result.reciprocal_rank == 1.0
        assert result.rank == 1

    def test_a_hit_at_rank_three_scores_one_third(self) -> None:
        hits = [hit("other.pdf", 1), hit("other.pdf", 2), hit("manual_zh.pdf", 1)]
        result = evaluate_case(case(), hits, top_k=5)
        assert result.hit_at_1 is False
        assert result.hit_at_k is True
        assert result.reciprocal_rank == 1 / 3
        assert result.rank == 3

    def test_a_miss_scores_zero(self) -> None:
        result = evaluate_case(case(), [hit("other.pdf", 9)], top_k=5)
        assert result.hit_at_k is False
        assert result.reciprocal_rank == 0.0
        assert result.rank is None

    def test_a_hit_beyond_top_k_does_not_count(self) -> None:
        hits = [hit("other.pdf", 1), hit("manual_zh.pdf", 1)]
        result = evaluate_case(case(), hits, top_k=1)
        assert result.hit_at_k is False

    def test_the_right_file_on_the_wrong_page_is_a_miss(self) -> None:
        result = evaluate_case(case(), [hit("manual_zh.pdf", 7)], top_k=5)
        assert result.hit_at_k is False

    def test_a_chunk_spanning_the_expected_page_counts(self) -> None:
        spanning = {"filename": "manual_zh.pdf", "page_start": 1, "page_end": 2}
        result = evaluate_case(case(), [spanning], top_k=5)
        assert result.hit_at_1 is True


class TestSummarise:
    def test_metrics_average_across_cases(self) -> None:
        results = [
            evaluate_case(case(), [hit("manual_zh.pdf", 1)], top_k=5),
            evaluate_case(case(), [hit("other.pdf", 1)], top_k=5),
        ]
        summary = summarise(results)
        assert summary.cases == 2
        assert summary.recall_at_1 == 0.5
        assert summary.recall_at_k == 0.5
        assert summary.mrr == 0.5

    def test_summarising_nothing_yields_zeros(self) -> None:
        summary = summarise([])
        assert summary.cases == 0
        assert summary.mrr == 0.0
