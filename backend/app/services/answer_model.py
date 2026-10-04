"""The local language model that writes answers, reached over HTTP.

`llama-server` (llama.cpp), Ollama and LM Studio all speak the OpenAI chat-completions
protocol, so one client covers each of them, always on this machine. The model runs in
its own process: a crash or a slow answer there never takes search down with it.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import AsyncIterator
from typing import Protocol

import httpx

from app.logging_config import get_logger

logger = get_logger("answer_model")


class AnswerModelUnavailable(RuntimeError):
    """The model server is not running, or not answering."""


class AnswerModel(Protocol):
    name: str

    def stream(
        self, messages: list[dict[str, str]], max_tokens: int, temperature: float
    ) -> AsyncIterator[str]: ...

    def available(self) -> bool: ...

    async def aclose(self) -> None: ...


class OpenAICompatibleModel:
    def __init__(
        self,
        base_url: str,
        model: str = "local",
        timeout_seconds: float = 120,
        disable_thinking: bool = True,
        availability_ttl_seconds: float = 10,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self.name = model
        self._timeout = httpx.Timeout(timeout_seconds, connect=5)
        self._disable_thinking = disable_thinking
        self._ttl = availability_ttl_seconds
        self._checked_at = 0.0
        self._available = False
        self._transport = transport  # tests stand a fake server in here
        # One connection pool each, kept for the life of the process: building a client
        # costs an SSL context even for plain http to localhost.
        self._client: httpx.AsyncClient | None = None
        self._probe = httpx.Client(timeout=1.5)
        self._probe_lock = threading.Lock()

    async def stream(
        self, messages: list[dict[str, str]], max_tokens: int, temperature: float
    ) -> AsyncIterator[str]:
        """The answer, piece by piece. Closing the iterator closes the connection,
        which is what makes the server stop generating for a closed browser tab."""
        body: dict[str, object] = {
            "model": self.name,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
            # A small model sometimes starts copying a source out after its answer.
            "stop": ["<source", "</source", "<sources"],
        }
        if self._disable_thinking:
            # Hybrid models (Qwen3 and later) otherwise think aloud for hundreds of
            # tokens first. Servers that do not know the field ignore it.
            body["chat_template_kwargs"] = {"enable_thinking": False}

        think = _ThinkFilter()
        try:
            if self._client is None:
                self._client = httpx.AsyncClient(timeout=self._timeout, transport=self._transport)
            url = f"{self._base_url}/chat/completions"
            async with self._client.stream("POST", url, json=body) as response:
                if response.status_code != 200:
                    await response.aread()
                    raise AnswerModelUnavailable(
                        f"the answer model returned status {response.status_code}"
                    )
                async for line in response.aiter_lines():
                    text = _delta_text(line)
                    if text is None:
                        continue
                    if text == _DONE:
                        break
                    visible = think.feed(text)
                    if visible:
                        yield visible
            self._available = True
        except httpx.TransportError as exc:
            self._available = False
            raise AnswerModelUnavailable(f"the answer model is not reachable: {exc}") from exc

    def available(self) -> bool:
        """Whether the server answers, checked at most every few seconds.

        Called from the readiness route's worker threads, so one probe at a time.
        """
        with self._probe_lock:
            now = time.monotonic()
            if now - self._checked_at < self._ttl:
                return self._available
            try:
                self._available = self._probe.get(f"{self._base_url}/models").status_code == 200
            except httpx.HTTPError:
                self._available = False
            self._checked_at = now
            return self._available

    async def aclose(self) -> None:
        self._probe.close()
        if self._client is not None:
            await self._client.aclose()


_DONE = "\x00done"


def _delta_text(line: str) -> str | None:
    """The text in one server-sent-events line, _DONE at the end, else None."""
    if not line.startswith("data:"):
        return None
    data = line[5:].strip()
    if data == "[DONE]":
        return _DONE
    try:
        chunk = json.loads(data)
        choice = chunk["choices"][0]
    except (ValueError, KeyError, IndexError, TypeError):
        return None
    # Thinking arrives as reasoning_content on servers that separate it; only the
    # answer itself is content.
    content = (choice.get("delta") or {}).get("content")
    return content if isinstance(content, str) and content else None


class _ThinkFilter:
    """Drops a leading <think>…</think> block from servers that leave it in the text."""

    def __init__(self) -> None:
        self._buffer = ""
        self._state = "start"  # start → thinking → answer

    def feed(self, text: str) -> str:
        if self._state == "answer":
            return text
        self._buffer += text
        if self._state == "start":
            stripped = self._buffer.lstrip()
            if not stripped:
                return ""
            if "<think>".startswith(stripped[:7]) and len(stripped) < 7:
                return ""  # could still be the start of the tag
            if not stripped.startswith("<think>"):
                self._state = "answer"
                out, self._buffer = self._buffer, ""
                return out
            self._state = "thinking"
        end = self._buffer.find("</think>")
        if end == -1:
            return ""
        out = self._buffer[end + len("</think>") :].lstrip()
        self._buffer = ""
        self._state = "answer"
        return out
