from unittest.mock import AsyncMock, patch

import pytest

from tests.conftest import MODEL_KEY, stub_usage


class _Block:
    def __init__(self, text):
        self.text = text
        self.type = "text"


class _Response:
    def __init__(self, text):
        self.content = [_Block(text)]
        self.stop_reason = "end_turn"
        stub_usage(self)


@pytest.mark.asyncio
async def test_summarize_returns_text():
    from backend.agents import summarizer

    with patch.object(
        summarizer.client.messages,
        "create",
        new=AsyncMock(return_value=_Response("Elena arrives.")),
    ):
        summary, usage = await summarizer.summarize_node("Long chapter prose.", MODEL_KEY)
    assert summary == "Elena arrives."
    assert usage.output_tokens == 340


class _ThinkingBlock:
    type = "thinking"
    thinking = ""


@pytest.mark.asyncio
async def test_summarize_reads_past_a_leading_thinking_block():
    """Sonnet 5 and Opus 5 think adaptively, so the first block is not always text."""
    from backend.agents import summarizer

    response = _Response("Elena arrives.")
    response.content.insert(0, _ThinkingBlock())
    with patch.object(summarizer.client.messages, "create", new=AsyncMock(return_value=response)):
        summary, _ = await summarizer.summarize_node("Long chapter prose.", MODEL_KEY)
    assert summary == "Elena arrives."


@pytest.mark.asyncio
async def test_summarize_sends_the_body():
    from backend.agents import summarizer

    mock = AsyncMock(return_value=_Response("s"))
    with patch.object(summarizer.client.messages, "create", new=mock):
        await summarizer.summarize_node("The gates stood open.", MODEL_KEY)
    assert "The gates stood open." in mock.call_args.kwargs["messages"][0]["content"]


@pytest.mark.asyncio
async def test_summarize_raises_on_empty_content():
    from backend.agents import summarizer

    empty = _Response("x")
    empty.content = []
    with patch.object(summarizer.client.messages, "create", new=AsyncMock(return_value=empty)):
        with pytest.raises(ValueError):
            await summarizer.summarize_node("prose", MODEL_KEY)
