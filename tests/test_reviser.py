from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.reviser import RevisionTruncatedError, _build_messages, reviser_token_stream
from tests.conftest import MODEL_KEY, stub_usage

ISSUES = [
    {"issue": "Wrong hand", "severity": "critical", "location": "p2", "suggested_fix": "left"}
]


@pytest.fixture
def state(base_state, sample_scene_plan):
    return {
        **base_state,
        "scene_plan": sample_scene_plan,
        "draft": "Elena raised her right hand.",
        "continuity_issues": ISSUES,
    }


def _fake_stream(chunks: list[str], stop_reason: str, captured: dict):
    async def text_stream():
        for chunk in chunks:
            yield chunk

    stream = MagicMock()
    stream.text_stream = text_stream()
    stream.get_final_message = AsyncMock(
        return_value=stub_usage(MagicMock(stop_reason=stop_reason))
    )

    @asynccontextmanager
    async def fake(**kwargs):
        captured.update(kwargs)
        yield stream

    return fake


def test_prompt_carries_the_issues_the_draft_and_the_bible(state):
    system_prompt, user_content = _build_messages(state)
    assert "Wrong hand" in user_content
    assert "Elena raised her right hand." in user_content
    assert "sparse and precise" in system_prompt


@pytest.mark.asyncio
async def test_token_stream_yields_deltas_and_reports_usage(state):
    captured, seen = {}, []
    fake = _fake_stream(["Elena raised ", "her left hand."], "end_turn", captured)
    with patch("backend.agents.reviser.client.messages.stream", new=fake):
        out = [t async for t in reviser_token_stream(state, MODEL_KEY, seen.append)]
    assert out == ["Elena raised ", "her left hand."]
    assert [u.output_tokens for u in seen] == [340]


@pytest.mark.asyncio
async def test_a_truncated_revision_raises_and_still_reports_usage(state):
    """A revision replaces the whole body, so a reply cut off at max_tokens would
    silently delete the end of the writer's chapter."""
    captured, seen = {}, []
    fake = _fake_stream(["Elena raised her left hand, and the gate"], "max_tokens", captured)
    with patch("backend.agents.reviser.client.messages.stream", new=fake):
        with pytest.raises(RevisionTruncatedError, match="left unchanged"):
            async for _ in reviser_token_stream(state, MODEL_KEY, seen.append):
                pass
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_the_output_ceiling_fits_a_long_chapter(state):
    # 4,096 tokens is about 3,000 words; a revision returns the whole chapter.
    captured = {}
    fake = _fake_stream(["x"], "end_turn", captured)
    with patch("backend.agents.reviser.client.messages.stream", new=fake):
        async for _ in reviser_token_stream(state, MODEL_KEY, lambda u: None):
            pass
    assert captured["max_tokens"] >= 16000
