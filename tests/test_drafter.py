from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.drafter import drafter_node
from tests.conftest import MODEL_KEY, stub_usage


def _mock_text_response(text: str) -> MagicMock:
    content_block = MagicMock()
    content_block.text = text
    response = MagicMock()
    response.content = [content_block]
    return stub_usage(response)


DRAFT_TEXT = "Elena stood at the gates as dusk swallowed the sky."


@pytest.mark.asyncio
async def test_drafter_returns_draft(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", new_callable=AsyncMock, return_value=mock_response):
        result = await drafter_node(base_state, MODEL_KEY)
    assert "draft" in result
    assert result["draft"] == DRAFT_TEXT


@pytest.mark.asyncio
async def test_drafter_system_prompt_carries_the_bible_style_rules(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", new_callable=AsyncMock, return_value=mock_response) as mock_create:
        await drafter_node(base_state, MODEL_KEY)
    system_prompt = mock_create.call_args.kwargs["system"]
    assert "adverbs ending in -ly" in system_prompt


@pytest.mark.asyncio
async def test_drafter_prompt_carries_the_bible_dialogue_examples(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", new_callable=AsyncMock, return_value=mock_response) as mock_create:
        await drafter_node(base_state, MODEL_KEY)
    prompt = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "I won't wait." in prompt


@pytest.mark.asyncio
async def test_drafter_includes_previous_summary(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    base_state["previous_summaries"] = ["Elena crossed the Wastes alone."]
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", new_callable=AsyncMock, return_value=mock_response) as mock_create:
        await drafter_node(base_state, MODEL_KEY)
    prompt = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "Elena crossed the Wastes alone." in prompt


@pytest.mark.asyncio
async def test_drafter_revision_branch_still_triggers(base_state, sample_scene_plan):
    """A draft plus issues routes _build_messages down its revision branch, which
    is what powers the revise/stream endpoint."""
    from backend.agents.drafter import _build_messages

    base_state["scene_plan"] = sample_scene_plan
    base_state["draft"] = "Existing prose."
    base_state["continuity_issues"] = [
        {"issue": "Wrong hand", "severity": "critical", "location": "p2", "suggested_fix": "left"}
    ]
    system_prompt, user_content = _build_messages(base_state)
    assert "Wrong hand" in user_content
    assert "Existing prose." in user_content
    assert "sparse and precise" in system_prompt
