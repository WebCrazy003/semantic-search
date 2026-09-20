import logging

from app.logging_config import configure_logging, redact


def test_configure_logging_sets_the_requested_level() -> None:
    configure_logging(level="WARNING", log_text=False)
    assert logging.getLogger("app").level == logging.WARNING


def test_redact_hides_text_when_debug_logging_is_off() -> None:
    configure_logging(level="INFO", log_text=False)
    assert redact("安全注意事项：关闭主电源开关。") == "<text redacted, 15 chars>"


def test_redact_returns_a_truncated_preview_when_debug_logging_is_on() -> None:
    configure_logging(level="DEBUG", log_text=True)
    assert redact("abc") == "abc"
    assert redact("x" * 300).endswith("...")
    assert len(redact("x" * 300)) == 203


def test_configure_logging_is_idempotent() -> None:
    configure_logging(level="INFO", log_text=False)
    handler_count = len(logging.getLogger("app").handlers)
    configure_logging(level="INFO", log_text=False)
    assert len(logging.getLogger("app").handlers) == handler_count
