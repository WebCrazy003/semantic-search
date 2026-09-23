# backend/app/api/admin.py
"""Read-only introspection for the admin page.

Three questions this answers, none of which the rest of the API can:

- what text did the extractor actually get out of this file?
- how is the index put together?
- how was this document split into passages, and where do they overlap?

Everything here is a GET and nothing here writes. The extraction endpoint re-runs the
extractor on demand, because the pipeline never persists page text: only chunk text
reaches Qdrant. That means it always shows what today's extractor produces, which is
what you want when you are chasing an extraction bug.
"""

from __future__ import annotations

import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import Container, get_container
from app.logging_config import get_logger
from app.models.response_models import (
    ChunkingSchema,
    ChunkListResponse,
    ChunkView,
    EmbeddingSchema,
    ExtractedBlock,
    ExtractedPageView,
    ExtractionResponse,
    IndexSchemaResponse,
    ManifestColumn,
    ManifestSchema,
    ManifestTable,
    PayloadField,
    QdrantSchema,
)
from app.services.extractors import (
    ExtractionError,
    ExtractionUnsupportedError,
    compute_file_hash,
    file_type_for,
)

logger = get_logger("api.admin")
router = APIRouter(tags=["admin"], prefix="/admin")

_MAX_PER_PAGE = 25
_MAX_CHUNK_LIMIT = 200

# Documented alongside QdrantService._payload. The test in tests/api/test_admin.py
# asserts these names match what the writer actually sets, so a new payload field
# cannot be added without describing it here.
_PAYLOAD_FIELDS: list[PayloadField] = [
    PayloadField(name="document_id", type="keyword", indexed=True,
                 description="Which document the passage came from"),
    PayloadField(name="filename", type="keyword", indexed=True,
                 description="The file's name, shown on a result"),
    PayloadField(name="filepath", type="keyword",
                 description="Where the file was when it was indexed"),
    PayloadField(name="page_start", type="integer",
                 description="First page the passage covers"),
    PayloadField(name="page_end", type="integer",
                 description="Last page it covers; the same as page_start unless it spans a break"),
    PayloadField(name="chunk_index", type="integer",
                 description="Position of the passage within its document, from 0"),
    PayloadField(name="text", type="text",
                 description="The passage itself; this is what a search result shows"),
    PayloadField(name="file_hash", type="keyword",
                 description="SHA-256 of the file, used to notice a changed document"),
    PayloadField(name="modified_at", type="keyword",
                 description="The file's modification time when it was indexed"),
    PayloadField(name="heading", type="text",
                 description="The section heading the passage sits under, when there is one"),
    PayloadField(name="token_count", type="integer",
                 description="Tokens in the passage, as the model's tokenizer counts them"),
    PayloadField(name="language", type="keyword", indexed=True,
                 description="Detected document language; a label only, search never depends on it"),
    PayloadField(name="title", type="text", description="The document's title, when it has one"),
    PayloadField(name="folder", type="keyword", description="The library folder the file was found in"),
    PayloadField(name="kind", type="keyword", description="text, table or heading"),
]


@router.get("/index/schema", response_model=IndexSchemaResponse)
def index_schema(container: Container = Depends(get_container)) -> IndexSchemaResponse:
    """How the index is built: the vector collection, the manifest, and the settings
    that decided how documents were cut up and embedded."""
    settings = container.settings

    try:
        info = container.qdrant.collection_info()
    except Exception as exc:  # a stopped or unreachable Qdrant is a normal state here
        logger.warning("could not read the collection: %s", exc)
        info = None

    qdrant = QdrantSchema(
        collection=settings.qdrant_collection,
        exists=info is not None,
        payload_fields=_PAYLOAD_FIELDS,
        **(info or {}),
    )

    describe = getattr(container.embedder, "device_info", None)
    device = describe() if callable(describe) else None

    return IndexSchemaResponse(
        qdrant=qdrant,
        manifest=ManifestSchema(
            path=str(settings.manifest_path),
            tables=[
                ManifestTable(
                    name=str(table["name"]),
                    rows=int(table["rows"]),
                    columns=[ManifestColumn(**column) for column in table["columns"]],  # type: ignore[arg-type]
                    indexes=list(table["indexes"]),  # type: ignore[arg-type]
                )
                for table in container.manifest.describe()
            ],
            status_breakdown=container.manifest.status_breakdown(),
        ),
        chunking=ChunkingSchema(
            target_tokens=settings.chunk_target_tokens,
            max_tokens=settings.chunk_max_tokens,
            min_tokens=settings.chunk_min_tokens,
            overlap_tokens=settings.chunk_overlap_tokens,
            preserve_headings=settings.chunk_preserve_headings,
            repeat_heading=settings.chunk_repeat_heading,
            allow_cross_page=settings.chunk_allow_cross_page,
            prefer_paragraph_boundaries=settings.chunk_prefer_paragraph_boundaries,
            prefer_sentence_boundaries=settings.chunk_prefer_sentence_boundaries,
        ),
        embedding=EmbeddingSchema(
            model=settings.bge_model_path.name,
            vector_size=settings.vector_size,
            device=device.device if device else None,
            device_name=device.name if device else None,
            precision=device.precision if device else None,
            max_seq_length=settings.embedding_max_seq_length,
        ),
    )


@router.get("/documents/{document_id}/extraction", response_model=ExtractionResponse)
def document_extraction(
    document_id: str,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=5, ge=1, le=_MAX_PER_PAGE),
    container: Container = Depends(get_container),
) -> ExtractionResponse:
    """Re-run the extractor and return what it produced, a few pages at a time."""
    record = container.manifest.get(document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="No such document")

    path = _resolve(record.known_paths, container)
    if path is None:
        raise HTTPException(
            status_code=410,
            detail=f"{record.filename} is no longer in any folder in the library",
        )

    extractor = container.extractors.for_path(path)
    if extractor is None:
        raise HTTPException(status_code=422, detail=f"No extractor handles {path.suffix} files")

    file_hash = compute_file_hash(path)
    started = time.perf_counter()
    try:
        document = extractor.extract(path, document_id=document_id, file_hash=file_hash)
    except ExtractionUnsupportedError as exc:
        raise HTTPException(status_code=422, detail=str(exc) or "The file cannot be read") from exc
    except ExtractionError as exc:
        raise HTTPException(status_code=500, detail=str(exc) or "Extraction failed") from exc
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    start = (page - 1) * per_page
    file_type = file_type_for(record.filename)
    return ExtractionResponse(
        document_id=document_id,
        filename=record.filename,
        file_type=file_type,
        filepath=str(path),
        pages=len(document.pages),
        pages_approximate=file_type == "docx",
        language=document.meta.language,
        title=document.meta.title,
        extracted_ms=elapsed_ms,
        page=page,
        per_page=per_page,
        file_hash_matches_manifest=file_hash == record.file_hash,
        page_views=[
            ExtractedPageView(
                page_number=extracted.page_number,
                text=extracted.text,
                char_count=extracted.char_count,
                blocks=[
                    ExtractedBlock(kind=block.kind, text=block.text) for block in extracted.blocks
                ],
            )
            for extracted in document.pages[start : start + per_page]
        ],
    )


@router.get("/documents/{document_id}/chunks", response_model=ChunkListResponse)
def document_chunks(
    document_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=_MAX_CHUNK_LIMIT),
    container: Container = Depends(get_container),
) -> ChunkListResponse:
    """Every passage of one document, in order, with the overlap between neighbours."""
    record = container.manifest.get(document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="No such document")

    try:
        payloads, total = container.qdrant.iter_chunks(document_id, offset=offset, limit=limit)
    except Exception as exc:
        logger.warning("could not read passages for %s: %s", document_id, exc)
        raise HTTPException(status_code=503, detail="Could not read the passage store") from exc

    # The previous passage is needed to measure the overlap of the first one shown, so
    # it is fetched when the window does not start at zero.
    previous_text = ""
    if offset > 0:
        earlier, _ = container.qdrant.iter_chunks(document_id, offset=offset - 1, limit=1)
        previous_text = str(earlier[0].get("text", "")) if earlier else ""

    chunks: list[ChunkView] = []
    pages: set[int] = set()
    tokens = 0
    for payload in payloads:
        text = str(payload.get("text", ""))
        page_start = int(payload.get("page_start", 0))
        page_end = int(payload.get("page_end", page_start))
        pages.update(range(page_start, page_end + 1))
        token_count = payload.get("token_count")
        tokens += int(token_count or 0)
        heading = payload.get("heading")
        overlap_start, overlap_length = _overlap(previous_text, text, heading)
        chunks.append(
            ChunkView(
                chunk_index=int(payload.get("chunk_index", 0)),
                point_id=str(payload.get("point_id", "")),
                page_start=page_start,
                page_end=page_end,
                heading=heading,
                kind=payload.get("kind"),
                token_count=int(token_count) if token_count is not None else None,
                char_count=len(text),
                text=text,
                overlap_start=overlap_start,
                overlap_with_previous=overlap_length,
            )
        )
        previous_text = text

    return ChunkListResponse(
        document_id=document_id,
        filename=record.filename,
        total_chunks=total,
        total_tokens=tokens,
        pages_covered=len(pages),
        offset=offset,
        limit=limit,
        chunks=chunks,
    )


def _resolve(known_paths: list[str], container: Container) -> Path | None:
    """The first known path that is inside the library and still on disk.

    The same allow-list as GET /documents/{id}/file: a manifest row alone is not
    permission to read a file, so nothing outside the registered folders is opened.
    """
    roots = [container.settings.pdf_directory.resolve()]
    roots.extend(Path(folder.path).resolve() for folder in container.manifest.folders())
    for candidate in known_paths:
        path = Path(candidate).resolve()
        if any(path.is_relative_to(root) for root in roots) and path.is_file():
            return path
    return None


def _overlap(previous: str, current: str, heading: str | None = None) -> tuple[int, int]:
    """Where this passage repeats the end of the previous one, and how much.

    The chunker seeds each passage with the tail of the one before, so the repeat is a
    prefix of `current` that ends `previous`. With CHUNK_REPEAT_HEADING on, though, the
    passage opens with its section heading and the repeated text starts *after* it, so
    a plain prefix match finds nothing. Skipping the heading first is what makes the
    overlap visible in the configuration the app actually ships with.

    Returns (start, length) so the caller can highlight the right span.
    """
    if not previous or not current:
        return 0, 0

    start = 0
    if heading and current.startswith(heading):
        start = len(current) - len(current[len(heading) :].lstrip())

    body = current[start:]
    limit = min(len(previous), len(body))
    for length in range(limit, 0, -1):
        if previous.endswith(body[:length]):
            return start, length
    return 0, 0
