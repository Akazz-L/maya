from unittest.mock import MagicMock, patch
from backend.agents.drafter import drafter_node


def _mock_text_response(text: str) -> MagicMock:
    content_block = MagicMock()
    content_block.text = text
    response = MagicMock()
    response.content = [content_block]
    return response


DRAFT_TEXT = "Elena stood at the gates as dusk swallowed the sky."


def test_drafter_returns_draft(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", return_value=mock_response):
        result = drafter_node(base_state)
    assert "draft" in result
    assert result["draft"] == DRAFT_TEXT


def test_drafter_uses_high_temperature(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", return_value=mock_response) as mock_create:
        drafter_node(base_state)
    assert mock_create.call_args.kwargs["temperature"] == 0.9


def test_drafter_injects_style_avoid_list(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", return_value=mock_response) as mock_create:
        drafter_node(base_state)
    system_prompt = mock_create.call_args.kwargs["system"]
    assert "adverbs ending in -ly" in system_prompt


def test_drafter_injects_dialogue_examples(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", return_value=mock_response) as mock_create:
        drafter_node(base_state)
    prompt = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "I won't wait." in prompt


def test_drafter_includes_previous_summary(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    base_state["previous_summaries"] = ["Elena crossed the Wastes alone."]
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", return_value=mock_response) as mock_create:
        drafter_node(base_state)
    prompt = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "Elena crossed the Wastes alone." in prompt
