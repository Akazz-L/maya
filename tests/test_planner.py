from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.planner import planner_node
from backend.llm import spec_for
from tests.conftest import MODEL_KEY, stub_usage


def _mock_tool_response(input_data: dict) -> MagicMock:
    tool_use = MagicMock()
    tool_use.type = "tool_use"
    tool_use.input = input_data
    response = MagicMock()
    response.content = [tool_use]
    return stub_usage(response)


VALID_PLAN = {
    "goal": "Elena arrives and is blocked",
    "pov_character": "Elena",
    "location": "Citadel Lower Gates",
    "beats": ["Elena approaches", "Gatekeeper stops her"],
    "sensory_anchor": "Cold iron smell",
    "opening_image": "Elena at dusk",
    "closing_image": "Gate slams shut",
}


@pytest.mark.asyncio
async def test_planner_returns_scene_plan(base_state):
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", new_callable=AsyncMock, return_value=mock_response):
        result = await planner_node(base_state, MODEL_KEY)
    assert "scene_plan" in result
    assert result["scene_plan"]["goal"] == "Elena arrives and is blocked"
    assert result["scene_plan"]["pov_character"] == "Elena"
    assert isinstance(result["scene_plan"]["beats"], list)
    assert len(result["scene_plan"]["beats"]) > 0


@pytest.mark.asyncio
async def test_planner_calls_claude_with_tool_choice(base_state):
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", new_callable=AsyncMock, return_value=mock_response) as mock_create:
        await planner_node(base_state, MODEL_KEY)
    call_kwargs = mock_create.call_args.kwargs
    assert call_kwargs["tool_choice"] == {"type": "tool", "name": "create_scene_plan"}
    # Assert against the catalogue rather than a literal, so retargeting a key
    # at a newer model doesn't break this test.
    assert call_kwargs["model"] == spec_for(MODEL_KEY).id


@pytest.mark.asyncio
async def test_planner_plans_from_the_writers_notes(base_state):
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", new_callable=AsyncMock, return_value=mock_response) as mock_create:
        await planner_node(base_state, MODEL_KEY)
    prompt_text = mock_create.call_args.kwargs["messages"][0]["content"]
    assert f"CHAPTER NOTES:\n{base_state['brief']}" in prompt_text
    assert "has not written notes" not in prompt_text


@pytest.mark.parametrize("brief", ["", "  \n "])
@pytest.mark.asyncio
async def test_planner_proposes_the_next_chapter_without_notes(base_state, brief):
    base_state["brief"] = brief
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", new_callable=AsyncMock, return_value=mock_response) as mock_create:
        await planner_node(base_state, MODEL_KEY)
    prompt_text = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "CHAPTER NOTES:" not in prompt_text
    assert "has not written notes for this chapter" in prompt_text
    assert "comes next" in prompt_text


@pytest.mark.asyncio
async def test_planner_includes_previous_summaries(base_state):
    base_state["previous_summaries"] = ["Chapter 1: Elena left the Wastes."]
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", new_callable=AsyncMock, return_value=mock_response) as mock_create:
        await planner_node(base_state, MODEL_KEY)
    prompt_text = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "Elena left the Wastes" in prompt_text


@pytest.mark.asyncio
async def test_planner_sends_the_bible_markdown_and_brief(base_state):
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", new_callable=AsyncMock, return_value=mock_response) as mock_create:
        await planner_node(base_state, MODEL_KEY)
    content = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "### Elena" in content
    assert "Elena arrives at the Citadel gates" in content


@pytest.mark.asyncio
async def test_planner_reports_what_the_call_cost(base_state):
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", new_callable=AsyncMock, return_value=mock_response):
        result = await planner_node(base_state, MODEL_KEY)
    assert result["usage"].input_tokens == 120
    assert result["usage"].output_tokens == 340
