"""Logging setup and the one helper that decides whether passage text is loggable."""

from __future__ import annotations

import logging
import sys

_LOG_TEXT = False
_PREVIEW_CHARS = 200

_FORMAT = "%(asctime)s %(levelname)-8s %(name)s %(message)s"


def configure_logging(level: str = "INFO", log_text: bool = False) -> None:
    global _LOG_TEXT
    _LOG_TEXT = log_text

    root = logging.getLogger("app")
    root.setLevel(level.upper())
    root.propagate = False
    if not root.handlers:
        handler = logging.StreamHandler(stream=sys.stdout)
        handler.setFormatter(logging.Formatter(_FORMAT))
        root.addHandler(handler)

    # Third-party libraries are chatty at INFO.
    for noisy in ("httpx", "httpcore", "sentence_transformers", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def redact(text: str) -> str:
    """Return loggable form of document text.

    Off by default so indexing logs never contain the documents themselves.
    """
    if not _LOG_TEXT:
        return f"<text redacted, {len(text)} chars>"
    if len(text) <= _PREVIEW_CHARS:
        return text
    return text[:_PREVIEW_CHARS] + "..."


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"app.{name}")
