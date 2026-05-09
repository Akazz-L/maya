from backend.pipeline import build_pipeline


def test_pipeline_runs_all_three_nodes_in_order(base_state):
    call_order = []

    def mock_planner(state):
        call_order.append("planner")
        return {"scene_plan": {"goal": "test goal"}}

    def mock_drafter(state):
        call_order.append("drafter")
        assert state["scene_plan"] == {"goal": "test goal"}
        return {"draft": "Once upon a time."}

    def mock_checker(state):
        call_order.append("checker")
        assert state["draft"] == "Once upon a time."
        return {"continuity_issues": []}

    pipeline = build_pipeline(
        planner=mock_planner, drafter=mock_drafter, checker=mock_checker
    )
    result = pipeline.invoke(base_state)

    assert call_order == ["planner", "drafter", "checker"]
    assert result["scene_plan"] == {"goal": "test goal"}
    assert result["draft"] == "Once upon a time."
    assert result["continuity_issues"] == []


def test_pipeline_passes_state_through_all_nodes(base_state):
    received_states = {}

    def mock_planner(state):
        received_states["planner"] = dict(state)
        return {"scene_plan": {"goal": "arrived"}}

    def mock_drafter(state):
        received_states["drafter"] = dict(state)
        return {"draft": "She arrived."}

    def mock_checker(state):
        received_states["checker"] = dict(state)
        return {"continuity_issues": []}

    pipeline = build_pipeline(
        planner=mock_planner, drafter=mock_drafter, checker=mock_checker
    )
    pipeline.invoke(base_state)

    assert received_states["drafter"]["scene_plan"] == {"goal": "arrived"}
    assert received_states["checker"]["draft"] == "She arrived."
    assert received_states["checker"]["scene_plan"] == {"goal": "arrived"}
