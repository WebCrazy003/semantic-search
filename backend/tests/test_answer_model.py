import asyncio
import json

import httpx
import pytest

from app.services.answer_model import AnswerModelUnavailable, OpenAICompatibleModel


def sse(*pieces: str, reasoning: str | None = None) -> bytes:
    lines = []
    if reasoning:
        lines.append({"choices": [{"delta": {"reasoning_content": reasoning}}]})
    lines.extend({"choices": [{"delta": {"content": piece}}]} for piece in pieces)
    body = "".join(f"data: {json.dumps(line)}\n\n" for line in lines)
    return (body + "data: [DONE]\n\n").encode()


def model_answering(body: bytes, status: int = 200, seen: list | None = None) -> OpenAICompatibleModel:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(json.loads(request.content))
        return httpx.Response(status, content=body)

    return OpenAICompatibleModel(
        "http://127.0.0.1:8081/v1/", transport=httpx.MockTransport(handler)
    )


def read(model: OpenAICompatibleModel) -> list[str]:
    async def run() -> list[str]:
        return [
            piece
            async for piece in model.stream(
                [{"role": "user", "content": "hi"}], max_tokens=50, temperature=0.2
            )
        ]

    return asyncio.run(run())


def test_streams_the_content_pieces() -> None:
    assert read(model_answering(sse("Hel", "lo [1]."))) == ["Hel", "lo [1]."]


def test_reasoning_is_not_part_of_the_answer() -> None:
    assert read(model_answering(sse("Answer.", reasoning="let me think"))) == ["Answer."]


def test_an_inline_think_block_is_dropped() -> None:
    pieces = read(model_answering(sse("<thi", "nk>hmm</th", "ink>\n\nAnswer", " [1].")))
    assert "".join(pieces) == "Answer [1]."


def test_asks_the_server_to_skip_thinking_and_to_stream() -> None:
    seen: list = []
    read(model_answering(sse("x"), seen=seen))
    assert seen[0]["stream"] is True
    assert seen[0]["chat_template_kwargs"] == {"enable_thinking": False}
    assert seen[0]["max_tokens"] == 50
    # Stops a model that starts copying a source out after its answer.
    assert "<source" in seen[0]["stop"]


def test_an_error_status_is_unavailable() -> None:
    with pytest.raises(AnswerModelUnavailable):
        read(model_answering(b"", status=503))


def test_an_unreachable_server_is_unavailable() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    model = OpenAICompatibleModel("http://127.0.0.1:1/v1", transport=httpx.MockTransport(refuse))
    with pytest.raises(AnswerModelUnavailable):
        read(model)
