from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.planner import planner_node
from backend.settings import get_model


def _mock_tool_response(input_data: dict) -> MagicMock:
    tool_use = MagicMock()
    tool_use.type = "tool_use"
    tool_use.input = input_data
    response = MagicMock()
    response.content = [tool_use]
    return response


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
        result = await planner_node(base_state)
    assert "scene_plan" in result
    assert result["scene_plan"]["goal"] == "Elena arrives and is blocked"
    assert result["scene_plan"]["pov_character"] == "Elena"
    assert isinstance(result["scene_plan"]["beats"], list)
    assert len(result["scene_plan"]["beats"]) > 0


@pytest.mark.asyncio
async def test_planner_calls_claude_with_tool_choice(base_state):
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", new_callable=AsyncMock, return_value=mock_response) as mock_create:
        await planner_node(base_state)
    call_kwargs = mock_create.call_args.kwargs
    assert call_kwargs["tool_choice"] == {"type": "tool", "name": "create_scene_plan"}
    # Assert against the configured model rather than a literal, so changing
    # settings.json doesn't break this test.
    assert call_kwargs["model"] == get_model()


@pytest.mark.asyncio
async def test_planner_includes_outline_beat_in_prompt(base_state):
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", new_callable=AsyncMock, return_value=mock_response) as mock_create:
        await planner_node(base_state)
    prompt_text = mock_create.call_args.kwargs["messages"][0]["content"]
    assert base_state["outline_beat"] in prompt_text


@pytest.mark.asyncio
async def test_planner_includes_previous_summaries(base_state):
    base_state["previous_summaries"] = ["Chapter 1: Elena left the Wastes."]
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", new_callable=AsyncMock, return_value=mock_response) as mock_create:
        await planner_node(base_state)
    prompt_text = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "Elena left the Wastes" in prompt_text
