from app.models.response_models import SearchHit, SearchResponse
from eval.run_answer_eval import Case, cited_numbers, load_cases, score_case


def hit(filename: str, page: int, chunk: int) -> SearchHit:
    return SearchHit(
        score=0.7,
        document_id=filename,
        filename=filename,
        filepath="",
        page_start=page,
        page_end=page,
        chunk_index=chunk,
        text="t",
    )


RESPONSE = SearchResponse(
    query="q",
    count=2,
    took_ms=1,
    results=[hit("pump_zh.pdf", 2, 1), hit("pump_zh.pdf", 3, 2)],
)
SOURCES = (
    "sources",
    {
        "language": "en",
        "unsupported": False,
        "top_relevance": 0.9,
        "passages": [
            {"n": 1, "document_id": "pump_zh.pdf", "chunk_index": 1},
            {"n": 2, "document_id": "pump_zh.pdf", "chunk_index": 2},
        ],
    },
)
ANSWERABLE = Case(
    id="c",
    query="q",
    language="en",
    expect={"filename": "pump_zh.pdf", "page": 2},
    facts=["25 N·m", "MS-200"],
)


def events(answer: str, status: str = "answered") -> list:
    return [("results", {}), SOURCES, ("delta", {"text": answer}), ("done", {"status": status})]


def test_cited_numbers_reads_every_form() -> None:
    assert cited_numbers("a [1]. b [2][3]. c [1, 4]. d [5、6].") == [1, 2, 3, 4, 5, 6]


def test_a_correct_cited_answer_passes() -> None:
    result = score_case(
        ANSWERABLE, RESPONSE, events("Replace seal MS-200, torque 25 N·m [1]."), 900, 4000
    )
    assert result.passed
    assert result.source_rank == 1
    assert result.top_relevance == 0.9


def test_facts_ignore_spacing() -> None:
    result = score_case(ANSWERABLE, RESPONSE, events("MS-200 at 25N·m [1]."), 900, 4000)
    assert result.facts_ok


def test_citing_the_wrong_source_fails() -> None:
    result = score_case(ANSWERABLE, RESPONSE, events("MS-200, 25 N·m [2]."), 900, 4000)
    assert not result.cites_expected
    assert not result.passed


def test_a_citation_with_no_source_is_invalid() -> None:
    result = score_case(ANSWERABLE, RESPONSE, events("MS-200, 25 N·m [1][7]."), 900, 4000)
    assert not result.citations_valid


def test_cited_numbers_allow_spaces_inside_the_brackets() -> None:
    assert cited_numbers("a [ 1 ] b [2 , 3]") == [1, 2, 3]


def test_a_failed_model_is_not_an_abstention() -> None:
    case = Case(id="u", query="q", language="en", unanswerable=True)
    failed = [("results", {}), SOURCES, ("error", {"code": "failed", "message": "x"})]
    assert not score_case(case, RESPONSE, failed, None, 1).passed


def test_an_unanswerable_case_passes_on_not_found_or_no_citation() -> None:
    case = Case(id="u", query="q", language="en", unanswerable=True, forbid=["Paris"])
    assert score_case(case, RESPONSE, events("Not in the documents.", "not_found"), 1, 1).passed
    assert score_case(case, RESPONSE, events("The documents do not say."), 1, 1).passed
    assert not score_case(case, RESPONSE, events("It is Paris."), 1, 1).passed
    assert not score_case(case, RESPONSE, events("Use part MS-200 [1]."), 1, 1).passed


def test_the_answer_set_loads_and_covers_every_language() -> None:
    cases = load_cases()
    assert {case.language for case in cases} == {"en", "zh-Hans", "zh-Hant", "ko"}
    assert any(case.unanswerable for case in cases)
    assert all(case.expect for case in cases if not case.unanswerable)
