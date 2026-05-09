from unittest.mock import MagicMock, patch
from backend.agents.checker import checker_node


def _mock_tool_response(issues: list) -> MagicMock:
    tool_use = MagicMock()
    tool_use.type = "tool_use"
    tool_use.input = {"issues": issues}
    response = MagicMock()
    response.content = [tool_use]
    return response


def test_checker_returns_empty_list_when_no_issues(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    base_state["draft"] = "Elena stood at the gates, left hand at her side."
    mock_response = _mock_tool_response([])
    with patch("backend.agents.checker.client.messages.create", return_value=mock_response):
        result = checker_node(base_state)
    assert result == {"continuity_issues": []}


def test_checker_returns_structured_issues(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    base_state["draft"] = "Elena raised her right hand."
    issue = {
        "issue": "Elena described as right-handed but bible states she is left-handed",
        "severity": "critical",
        "location": "paragraph 1",
        "suggested_fix": "Change 'right hand' to 'left hand'",
    }
    mock_response = _mock_tool_response([issue])
    with patch("backend.agents.checker.client.messages.create", return_value=mock_response):
        result = checker_node(base_state)
    assert len(result["continuity_issues"]) == 1
    assert result["continuity_issues"][0]["severity"] == "critical"
    assert result["continuity_issues"][0]["suggested_fix"] == "Change 'right hand' to 'left hand'"


def test_checker_calls_claude_with_tool_choice(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    base_state["draft"] = "Some draft text."
    mock_response = _mock_tool_response([])
    with patch("backend.agents.checker.client.messages.create", return_value=mock_response) as mock_create:
        checker_node(base_state)
    assert mock_create.call_args.kwargs["tool_choice"] == {
        "type": "tool", "name": "report_continuity_issues"
    }


def test_checker_includes_draft_and_characters_in_prompt(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    base_state["draft"] = "She raised her hand."
    mock_response = _mock_tool_response([])
    with patch("backend.agents.checker.client.messages.create", return_value=mock_response) as mock_create:
        checker_node(base_state)
    prompt = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "She raised her hand." in prompt
    assert "Elena" in prompt
    assert "left-handed" in prompt
