from unittest.mock import AsyncMock, patch

import pytest


class _Block:
    def __init__(self, text):
        self.text = text
        self.type = "text"


class _Response:
    def __init__(self, text):
        self.content = [_Block(text)]
        self.stop_reason = "end_turn"


@pytest.mark.asyncio
async def test_summarize_returns_text():
    from backend.agents import summarizer

    with patch.object(
        summarizer.client.messages,
        "create",
        new=AsyncMock(return_value=_Response("Elena arrives.")),
    ):
        assert await summarizer.summarize_node("Long chapter prose.") == "Elena arrives."


@pytest.mark.asyncio
async def test_summarize_sends_the_body():
    from backend.agents import summarizer

    mock = AsyncMock(return_value=_Response("s"))
    with patch.object(summarizer.client.messages, "create", new=mock):
        await summarizer.summarize_node("The gates stood open.")
    assert "The gates stood open." in mock.call_args.kwargs["messages"][0]["content"]


@pytest.mark.asyncio
async def test_summarize_raises_on_empty_content():
    from backend.agents import summarizer

    empty = _Response("x")
    empty.content = []
    with patch.object(summarizer.client.messages, "create", new=AsyncMock(return_value=empty)):
        with pytest.raises(ValueError):
            await summarizer.summarize_node("prose")
