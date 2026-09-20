# backend/app/services/search_service.py
"""Query embedding plus one Qdrant similarity search."""

from __future__ import annotations

import time

from app.logging_config import get_logger
from app.models.request_models import SearchRequest
from app.models.response_models import SearchResponse
from app.services.embedding_service import EmbeddingService
from app.services.qdrant_service import QdrantService

logger = get_logger("search")


class SearchService:
    def __init__(
        self,
        embedder: EmbeddingService,
        qdrant: QdrantService,
        default_top_k: int = 10,
        max_top_k: int = 100,
    ) -> None:
        self._embedder = embedder
        self._qdrant = qdrant
        self._default_top_k = default_top_k
        self._max_top_k = max_top_k

    def search(self, request: SearchRequest) -> SearchResponse:
        query = request.query.strip()
        if not query:
            raise ValueError("cannot search for an empty query")

        top_k = min(request.top_k or self._default_top_k, self._max_top_k)
        started = time.perf_counter()
        vector = self._embedder.embed_query(query)
        hits = self._qdrant.search(vector=vector, top_k=top_k, filters=request.filters)
        took_ms = int((time.perf_counter() - started) * 1000)

        # The query text itself is not logged: search history stays local, as the
        # specification requires.
        logger.info(
            "search top_k=%d filters=%s results=%d in %dms",
            top_k,
            request.filters.model_dump(exclude_none=True) if request.filters else {},
            len(hits),
            took_ms,
        )
        return SearchResponse(query=query, count=len(hits), took_ms=took_ms, results=hits)
