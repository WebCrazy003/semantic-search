# backend/app/deps.py
"""One object holding every service, built once per process.

Constructor injection rather than module-level singletons, so tests build a container
of fakes and exercise the real wiring.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import Request
from qdrant_client import QdrantClient

from app.config import Settings
from app.logging_config import get_logger
from app.services.access_store import AccessStore
from app.services.answer_model import OpenAICompatibleModel
from app.services.answer_service import AnswerService
from app.services.chunk_service import ChunkConfig, Chunker
from app.services.device_usage import DeviceUsageMonitor
from app.services.docx_service import DocxService
from app.services.embedding_service import BgeEmbeddingService, EmbeddingService
from app.services.extractors import DocumentExtractor, ExtractorRegistry
from app.services.indexing_service import IndexingService
from app.services.manifest_service import ManifestService
from app.services.pdf_service import PdfService
from app.services.qdrant_service import QdrantService
from app.services.reranker_service import BgeReranker, Reranker
from app.services.search_service import SearchService
from app.services.throttle import Throttles
from app.services.tokenizer_service import BgeTokenizer, TokenCounter

logger = get_logger("deps")


@dataclass
class Container:
    settings: Settings
    tokenizer: TokenCounter
    embedder: EmbeddingService
    qdrant: QdrantService
    manifest: ManifestService
    chunker: Chunker
    extractors: ExtractorRegistry
    indexing: IndexingService
    search: SearchService
    access: AccessStore
    # Optional so a container of fakes needs no device; without it the status endpoint
    # simply reports no usage.
    device_monitor: DeviceUsageMonitor | None = None
    throttles: Throttles = field(default_factory=Throttles)
    # Without a model configured this still exists and answers "unavailable", so the
    # routes need no special case.
    answers: AnswerService = field(default_factory=lambda: AnswerService(model=None))

    def close(self) -> None:
        self.manifest.close()
        self.access.close()
        self.qdrant.close()


def chunk_config_from(settings: Settings) -> ChunkConfig:
    return ChunkConfig(
        target_tokens=settings.chunk_target_tokens,
        max_tokens=settings.chunk_max_tokens,
        min_tokens=settings.chunk_min_tokens,
        overlap_tokens=settings.chunk_overlap_tokens,
        preserve_headings=settings.chunk_preserve_headings,
        repeat_heading=settings.chunk_repeat_heading,
        allow_cross_page=settings.chunk_allow_cross_page,
        prefer_paragraph_boundaries=settings.chunk_prefer_paragraph_boundaries,
        prefer_sentence_boundaries=settings.chunk_prefer_sentence_boundaries,
    )


def build_qdrant_client(settings: Settings) -> QdrantClient:
    """A server client, or an embedded one when QDRANT_PATH is set.

    Embedded mode keeps the vectors in a plain directory, which is what the offline
    installs use: no container, no daemon, no port. Only one process may hold that
    directory at a time, so the backend must be stopped before scripts touch it.
    """
    if settings.qdrant_path is None:
        return QdrantClient(url=settings.qdrant_url, timeout=settings.qdrant_timeout)
    settings.qdrant_path.mkdir(parents=True, exist_ok=True)
    return QdrantClient(path=str(settings.qdrant_path))


def build_extractors(settings: Settings) -> ExtractorRegistry:
    """One extractor per supported format, configured from the settings."""
    extractors: list[DocumentExtractor] = [
        PdfService(
            min_document_chars=settings.pdf_min_document_chars,
            extract_tables=settings.pdf_extract_tables,
            korean_midword_join=settings.pdf_korean_midword_join,
        )
    ]
    if settings.docx_enabled:
        extractors.append(
            DocxService(
                min_document_chars=settings.pdf_min_document_chars,
                extract_tables=settings.pdf_extract_tables,
            )
        )
    return ExtractorRegistry(extractors)


def answers_enabled(settings: Settings, device: str) -> bool:
    """Whether answers are on: a model server is set, and the machine has a GPU unless
    LLM_REQUIRE_GPU says a CPU will do. `device` is where the embedder ended up."""
    if not settings.llm_url.strip():
        return False
    return device != "cpu" or not settings.llm_require_gpu


def build_reranker(settings: Settings, device: str) -> Reranker | None:
    """The reranker, when answers are on and it has been downloaded.

    Only answers use it, so without a model to write them the 1 GB or more it takes
    stays free. A missing folder is not fatal: answers then use the search order.
    `device` is where the embedder ended up, so a GPU it had to give up on is not
    tried a second time.
    """
    path = settings.reranker_model_path
    if not answers_enabled(settings, device) or path is None:
        return None
    if not path.exists():
        logger.warning(
            "no reranker at %s, so answers use the search order; "
            "run scripts/download_model.py reranker to add it",
            path,
        )
        return None
    reranker = BgeReranker(path, device=device, batch_size=settings.rag_rerank_candidates)
    reranker.warmup()
    return reranker


def build_answers(
    settings: Settings, device: str, reranker: Reranker | None = None
) -> AnswerService:
    """The answer service, with a model only when answers are on (answers_enabled)."""
    model = (
        OpenAICompatibleModel(
            base_url=settings.llm_url,
            model=settings.llm_model,
            timeout_seconds=settings.llm_timeout_seconds,
            disable_thinking=settings.llm_disable_thinking,
        )
        if answers_enabled(settings, device)
        else None
    )
    return AnswerService(
        model=model,
        reranker=reranker,
        rerank_candidates=settings.rag_rerank_candidates,
        context_passages=settings.rag_context_passages,
        context_tokens=settings.llm_context_tokens,
        max_answer_tokens=settings.llm_max_answer_tokens,
        temperature=settings.llm_temperature,
        min_score=settings.rag_min_score,
        max_concurrent=settings.llm_max_concurrent,
    )


def build_container(settings: Settings) -> Container:
    """Load the model and open the stores. Called once, from the lifespan handler."""
    tokenizer = BgeTokenizer(settings.bge_model_path)
    embedder = BgeEmbeddingService(
        model_path=settings.bge_model_path,
        device=settings.embedding_device,
        batch_size=settings.embedding_batch_size,
        max_seq_length=settings.embedding_max_seq_length,
        expected_dimension=settings.vector_size,
        batch_size_gpu=settings.embedding_batch_size_gpu,
        precision=settings.embedding_precision,
    )
    qdrant = QdrantService(
        client=build_qdrant_client(settings),
        collection=settings.qdrant_collection,
        vector_size=settings.vector_size,
        upsert_batch=settings.qdrant_upsert_batch,
    )
    device = embedder.device_info()
    where = device.device
    if settings.llm_url.strip() and not answers_enabled(settings, where):
        logger.warning(
            "answers are off: search runs on the CPU (%s), and on a CPU an answer's first "
            "word takes 30 to 60 s; set LLM_REQUIRE_GPU=false to turn them on anyway",
            device.fallback_reason or f"EMBEDDING_DEVICE={settings.embedding_device}",
        )
    reranker = build_reranker(settings, where)
    manifest = ManifestService(settings.manifest_path)
    access = AccessStore(settings.access_db_path)
    chunker = Chunker(tokenizer=tokenizer, config=chunk_config_from(settings))
    extractors = build_extractors(settings)
    return Container(
        settings=settings,
        tokenizer=tokenizer,
        embedder=embedder,
        qdrant=qdrant,
        manifest=manifest,
        chunker=chunker,
        extractors=extractors,
        indexing=IndexingService(
            extractors=extractors,
            chunker=chunker,
            embedder=embedder,
            qdrant=qdrant,
            manifest=manifest,
            default_directory=settings.pdf_directory,
            access=access,
        ),
        search=SearchService(
            embedder=embedder,
            qdrant=qdrant,
            default_top_k=settings.default_top_k,
            max_top_k=settings.max_top_k,
        ),
        access=access,
        answers=build_answers(settings, where, reranker),
        device_monitor=DeviceUsageMonitor(device=where, name=device.name),
    )


def get_container(request: Request) -> Container:
    return request.app.state.container
