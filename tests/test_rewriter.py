from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.rewriter import (
    RewriteTruncatedError,
    _build_rewrite_messages,
    rewriter_token_stream,
)


def _state(sample_bible, **over):
    state = {
        "story_bible": sample_bible,
        "instruction": "make this more tense",
        "selection": "She waited by the door.",
        "before": "The hall was empty. ",
        "after": " A clock ticked somewhere.",
    }
    state.update(over)
    return state


def test_system_prompt_carries_the_story_bible(sample_bible):
    system, _ = _build_rewrite_messages(_state(sample_bible))
    assert "STORY BIBLE:" in system
    assert "adverbs ending in -ly" in system


def test_system_prompt_restricts_output_to_the_replacement(sample_bible):
    system, _ = _build_rewrite_messages(_state(sample_bible))
    assert "ONLY" in system
    assert "No commentary" in system


def test_user_content_carries_instruction_selection_and_context(sample_bible):
    _, user = _build_rewrite_messages(_state(sample_bible))
    assert "INSTRUCTION:\nmake this more tense" in user
    assert "PASSAGE TO REWRITE:\nShe waited by the door." in user
    assert "CONTEXT BEFORE (do not rewrite):\nThe hall was empty. " in user
    assert "CONTEXT AFTER (do not rewrite):\n A clock ticked somewhere." in user


def test_prompt_pins_the_reply_to_the_passage_boundaries(sample_bible):
    system, user = _build_rewrite_messages(_state(sample_bible))
    assert "begin where the passage begins and end where the passage ends" in system
    assert "Do not repeat any of the context before or continue into the context after" in system


@pytest.mark.asyncio
async def test_token_stream_yields_text_deltas(sample_bible):
    async def fake_text_stream():
        for t in ["She ", "froze."]:
            yield t

    stream = MagicMock()
    stream.text_stream = fake_text_stream()
    stream.get_final_message = AsyncMock(return_value=MagicMock(stop_reason="end_turn"))

    @asynccontextmanager
    async def fake_stream(**kwargs):
        yield stream

    with patch("backend.agents.rewriter.client.messages.stream", new=fake_stream):
        out = [t async for t in rewriter_token_stream(_state(sample_bible))]
    assert out == ["She ", "froze."]


@pytest.mark.asyncio
async def test_token_stream_raises_when_the_reply_is_truncated(sample_bible):
    """A max_tokens stop leaves a half-finished passage; accepting it would
    silently truncate the writer's prose, so the stream fails loudly instead."""

    async def fake_text_stream():
        yield "She froze and then"

    stream = MagicMock()
    stream.text_stream = fake_text_stream()
    stream.get_final_message = AsyncMock(return_value=MagicMock(stop_reason="max_tokens"))

    @asynccontextmanager
    async def fake_stream(**kwargs):
        yield stream

    with patch("backend.agents.rewriter.client.messages.stream", new=fake_stream):
        with pytest.raises(RewriteTruncatedError, match="shorter passage"):
            [t async for t in rewriter_token_stream(_state(sample_bible))]
