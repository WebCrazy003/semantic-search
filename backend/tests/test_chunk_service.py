# backend/tests/test_chunk_service.py
from datetime import UTC, datetime

import pytest

from app.models.domain import DocumentMeta, ExtractedDocument, ExtractedPage, PageBlock
from app.services.chunk_service import ChunkConfig, Chunker
from tests.conftest import CharTokenCounter

DOC_ID = "d" * 64


def make_document(pages: list[list[PageBlock]]) -> ExtractedDocument:
    return ExtractedDocument(
        meta=DocumentMeta(
            document_id=DOC_ID,
            filename="t.pdf",
            filepath="/t.pdf",
            folder="/",
            file_hash=DOC_ID,
            modified_at=datetime(2026, 9, 20, tzinfo=UTC),
        ),
        pages=tuple(
            ExtractedPage(
                page_number=number,
                blocks=tuple(
                    PageBlock(kind=b.kind, text=b.text, order=i) for i, b in enumerate(blocks)
                ),
                text="\n\n".join(b.text for b in blocks),
            )
            for number, blocks in enumerate(pages, start=1)
        ),
    )


def para(text: str) -> PageBlock:
    return PageBlock(kind="paragraph", text=text)


def heading(text: str) -> PageBlock:
    return PageBlock(kind="heading", text=text)


def table(text: str) -> PageBlock:
    return PageBlock(kind="table", text=text)


@pytest.fixture
def config() -> ChunkConfig:
    return ChunkConfig(target_tokens=40, max_tokens=60, min_tokens=10, overlap_tokens=12)


@pytest.fixture
def chunker(token_counter: CharTokenCounter, config: ChunkConfig) -> Chunker:
    return Chunker(tokenizer=token_counter, config=config)


class TestConfigValidation:
    def test_max_below_target_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="max_tokens"):
            ChunkConfig(target_tokens=300, max_tokens=200)

    def test_overlap_at_or_above_target_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="overlap_tokens"):
            ChunkConfig(target_tokens=300, overlap_tokens=300)

    def test_min_above_target_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="min_tokens"):
            ChunkConfig(target_tokens=100, min_tokens=200, max_tokens=300)

    def test_the_specification_defaults_are_valid(self) -> None:
        config = ChunkConfig()
        assert (config.target_tokens, config.max_tokens) == (300, 450)
        assert (config.min_tokens, config.overlap_tokens) == (80, 50)


class TestBasicPacking:
    def test_a_short_page_becomes_one_chunk(self, chunker: Chunker) -> None:
        document = make_document([[para("第一段落内容。")]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) == 1
        assert chunks[0].text == "第一段落内容。"
        assert chunks[0].chunk_index == 0
        assert chunks[0].page_start == chunks[0].page_end == 1
        assert chunks[0].document_id == DOC_ID

    def test_an_empty_page_produces_no_chunks(self, chunker: Chunker) -> None:
        chunks = chunker.chunk_document(make_document([[]]))
        assert chunks == []

    def test_short_neighbouring_paragraphs_merge_until_the_target_is_reached(
        self, chunker: Chunker
    ) -> None:
        # Six 12-character paragraphs, target 40: the first chunk takes four of them.
        document = make_document([[para("一二三四五六七八九十甲乙") for _ in range(6)]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) == 2
        assert chunks[0].token_count >= 40

    def test_chunk_indices_are_contiguous_across_pages(self, chunker: Chunker) -> None:
        page = [para("一二三四五六七八九十" * 5)]
        chunks = chunker.chunk_document(make_document([page, page, page]))
        assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))

    def test_no_chunk_exceeds_max_tokens(self, chunker: Chunker) -> None:
        document = make_document([[para("甲乙丙丁戊己庚辛壬癸。" * 12)]])
        chunks = chunker.chunk_document(document)
        assert chunks
        assert all(chunk.token_count <= 60 for chunk in chunks)

    def test_empty_blocks_are_skipped(self, chunker: Chunker) -> None:
        document = make_document([[para("   "), para("真实内容在这里。")]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) == 1
        assert chunks[0].text == "真实内容在这里。"


class TestPageBoundaries:
    def test_chunks_stay_within_one_page_by_default(self, chunker: Chunker) -> None:
        document = make_document([[para("第一页的内容。")], [para("第二页的内容。")]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) == 2
        assert chunks[0].page_start == chunks[0].page_end == 1
        assert chunks[1].page_start == chunks[1].page_end == 2
        assert "第二页" not in chunks[0].text

    def test_cross_page_chunks_span_pages_when_enabled(
        self, token_counter: CharTokenCounter
    ) -> None:
        config = ChunkConfig(
            target_tokens=40, max_tokens=60, min_tokens=10, overlap_tokens=12, allow_cross_page=True
        )
        chunker = Chunker(tokenizer=token_counter, config=config)
        document = make_document([[para("第一页的内容。")], [para("第二页的内容。")]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) == 1
        assert chunks[0].page_start == 1
        assert chunks[0].page_end == 2


class TestHeadings:
    def test_a_heading_is_recorded_on_the_chunks_of_its_section(self, chunker: Chunker) -> None:
        document = make_document([[heading("第一章 安全"), para("必须关闭电源。")]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) == 1
        assert chunks[0].heading == "第一章 安全"
        assert chunks[0].text.startswith("第一章 安全")

    def test_a_heading_starts_a_new_chunk(self, chunker: Chunker) -> None:
        document = make_document(
            [[para("第一节的内容。"), heading("第二章 维护"), para("第二节的内容。")]]
        )
        chunks = chunker.chunk_document(document)
        assert len(chunks) == 2
        assert chunks[0].heading is None
        assert chunks[1].heading == "第二章 维护"
        assert "第一节" not in chunks[1].text

    def test_the_heading_is_repeated_at_the_top_of_later_chunks_in_the_section(
        self, chunker: Chunker
    ) -> None:
        document = make_document([[heading("维护周期"), para("甲乙丙丁戊己庚辛壬癸。" * 10)]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) > 1
        assert all(chunk.heading == "维护周期" for chunk in chunks)
        assert all(chunk.text.startswith("维护周期") for chunk in chunks)

    def test_the_heading_is_not_repeated_when_the_option_is_off(
        self, token_counter: CharTokenCounter
    ) -> None:
        config = ChunkConfig(
            target_tokens=40, max_tokens=60, min_tokens=10, overlap_tokens=12, repeat_heading=False
        )
        chunker = Chunker(tokenizer=token_counter, config=config)
        document = make_document([[heading("维护周期"), para("甲乙丙丁戊己庚辛壬癸。" * 10)]])
        chunks = chunker.chunk_document(document)
        assert chunks[-1].heading == "维护周期"
        assert not chunks[-1].text.startswith("维护周期")

    def test_headings_are_ignored_entirely_when_preservation_is_off(
        self, token_counter: CharTokenCounter
    ) -> None:
        config = ChunkConfig(
            target_tokens=40,
            max_tokens=60,
            min_tokens=10,
            overlap_tokens=12,
            preserve_headings=False,
        )
        chunker = Chunker(tokenizer=token_counter, config=config)
        document = make_document([[heading("维护周期"), para("甲乙丙丁。")]])
        chunks = chunker.chunk_document(document)
        assert all(chunk.heading is None for chunk in chunks)

    def test_a_trailing_heading_with_no_body_still_becomes_a_chunk(
        self, chunker: Chunker
    ) -> None:
        # Short, but structurally important, so it is exempt from min_tokens.
        document = make_document([[para("甲乙丙丁戊己庚辛壬癸。" * 4), heading("附录")]])
        chunks = chunker.chunk_document(document)
        assert chunks[-1].text == "附录"
        assert chunks[-1].token_count < 10


class TestTables:
    def test_a_table_becomes_its_own_chunk(self, chunker: Chunker) -> None:
        markdown = "| 部件 | 周期 |\n| --- | --- |\n| 滤芯 | 每月 |"
        document = make_document([[para("下表列出周期。"), table(markdown), para("其他说明。")]])
        chunks = chunker.chunk_document(document)
        table_chunks = [chunk for chunk in chunks if chunk.kind == "table"]
        assert len(table_chunks) == 1
        assert table_chunks[0].text == markdown
        assert "下表列出周期" not in table_chunks[0].text

    def test_a_long_table_splits_by_rows_and_repeats_the_header(self, chunker: Chunker) -> None:
        header = "| 部件 | 周期 |\n| --- | --- |"
        rows = "\n".join(f"| 部件{index:02d} | 每月 |" for index in range(12))
        document = make_document([[table(f"{header}\n{rows}")]])
        chunks = chunker.chunk_document(document)
        table_chunks = [chunk for chunk in chunks if chunk.kind == "table"]
        assert len(table_chunks) > 1
        assert all(chunk.text.startswith("| 部件 | 周期 |") for chunk in table_chunks)
        assert all(chunk.token_count <= 60 for chunk in table_chunks)

    def test_a_table_is_never_merged_into_a_neighbour(self, chunker: Chunker) -> None:
        document = make_document([[table("| a | b |\n| --- | --- |\n| 1 | 2 |")]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) == 1
        assert chunks[0].kind == "table"
        assert chunks[0].token_count < 80  # below min_tokens, kept anyway


class TestSentenceAndTokenSplitting:
    def test_an_oversized_paragraph_splits_at_sentence_boundaries(
        self, chunker: Chunker
    ) -> None:
        paragraph = "".join(f"这是第{index}句话内容。" for index in range(12))
        document = make_document([[para(paragraph)]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) > 1
        # Every chunk ends on a sentence terminator, so no sentence was cut in half.
        assert all(chunk.text.rstrip().endswith("。") for chunk in chunks)

    def test_a_single_oversized_sentence_is_split_by_tokens(self, chunker: Chunker) -> None:
        document = make_document([[para("甲" * 200 + "。")]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) > 1
        assert all(chunk.token_count <= 60 for chunk in chunks)

    def test_sentence_splitting_can_be_switched_off(
        self, token_counter: CharTokenCounter
    ) -> None:
        config = ChunkConfig(
            target_tokens=40,
            max_tokens=60,
            min_tokens=10,
            overlap_tokens=12,
            prefer_sentence_boundaries=False,
        )
        chunker = Chunker(tokenizer=token_counter, config=config)
        document = make_document([[para("".join(f"第{i}句。" for i in range(20)))]])
        chunks = chunker.chunk_document(document)
        assert all(chunk.token_count <= 60 for chunk in chunks)


class TestOverlap:
    def test_consecutive_chunks_share_trailing_context(self, chunker: Chunker) -> None:
        paragraph = "".join(f"这是第{index}句话内容。" for index in range(12))
        document = make_document([[para(paragraph)]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) > 1
        tail = chunks[0].text[-8:]
        assert any(fragment in chunks[1].text for fragment in (tail[-4:], tail[-6:]))

    def test_overlap_does_not_cross_a_heading(self, chunker: Chunker) -> None:
        document = make_document(
            [[para("前一节的独特内容甲乙丙。"), heading("新的一章"), para("后一节内容。")]]
        )
        chunks = chunker.chunk_document(document)
        assert "独特" not in chunks[-1].text

    def test_no_chunk_is_made_only_of_repeated_overlap(self, chunker: Chunker) -> None:
        paragraph = "".join(f"这是第{index}句话内容。" for index in range(12))
        chunks = chunker.chunk_document(make_document([[para(paragraph)]]))
        texts = [chunk.text for chunk in chunks]
        assert len(texts) == len(set(texts))
        # The last chunk must carry content, not just the previous chunk's tail.
        assert chunks[-1].token_count > 8

    def test_overlap_of_zero_produces_disjoint_chunks(
        self, token_counter: CharTokenCounter
    ) -> None:
        config = ChunkConfig(target_tokens=40, max_tokens=60, min_tokens=10, overlap_tokens=0)
        chunker = Chunker(tokenizer=token_counter, config=config)
        paragraph = "".join(f"这是第{index}句话内容。" for index in range(12))
        chunks = chunker.chunk_document(make_document([[para(paragraph)]]))
        rebuilt = "".join(chunk.text for chunk in chunks)
        assert len(rebuilt) == len(paragraph)


class TestSmallChunkMerging:
    def test_an_undersized_trailing_chunk_merges_into_its_predecessor(
        self, chunker: Chunker
    ) -> None:
        document = make_document([[para("甲乙丙丁戊己庚辛壬癸。" * 4), para("很短。")]])
        chunks = chunker.chunk_document(document)
        assert all(chunk.token_count >= 10 for chunk in chunks)
        assert "很短。" in chunks[-1].text

    def test_a_lone_short_paragraph_is_kept_rather_than_dropped(self, chunker: Chunker) -> None:
        document = make_document([[para("很短。")]])
        chunks = chunker.chunk_document(document)
        assert len(chunks) == 1
        assert chunks[0].text == "很短。"

    def test_merging_never_pushes_a_chunk_past_max_tokens(self, chunker: Chunker) -> None:
        document = make_document([[para("甲" * 58), para("短句。")]])
        chunks = chunker.chunk_document(document)
        assert all(chunk.token_count <= 60 for chunk in chunks)

    def test_merging_does_not_join_chunks_from_different_pages(self, chunker: Chunker) -> None:
        document = make_document([[para("甲乙丙丁戊己庚辛壬癸。" * 4)], [para("很短。")]])
        chunks = chunker.chunk_document(document)
        assert chunks[-1].page_start == 2
        assert chunks[-1].text == "很短。"


class TestTokenCounts:
    def test_token_count_matches_the_final_text_including_a_repeated_heading(
        self, chunker: Chunker, token_counter: CharTokenCounter
    ) -> None:
        document = make_document([[heading("维护周期"), para("甲乙丙丁戊己庚辛壬癸。" * 10)]])
        for chunk in chunker.chunk_document(document):
            assert chunk.token_count == token_counter.count(chunk.text)
