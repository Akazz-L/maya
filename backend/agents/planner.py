import anthropic

from backend.llm import request_params, usage_from

client = anthropic.AsyncAnthropic()

_PLAN_TOOL = {
    "name": "create_scene_plan",
    "description": "Create a structured scene plan for a chapter",
    "input_schema": {
        "type": "object",
        "properties": {
            "goal": {"type": "string", "description": "What this scene accomplishes narratively"},
            "pov_character": {"type": "string", "description": "Whose perspective drives the scene"},
            "location": {"type": "string", "description": "Specific physical location where the scene takes place"},
            "beats": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Ordered list of events in the scene",
            },
            "sensory_anchor": {"type": "string", "description": "Primary sense detail grounding the scene"},
            "opening_image": {"type": "string", "description": "First concrete image the reader sees"},
            "closing_image": {"type": "string", "description": "Last concrete image the reader sees"},
        },
        "required": [
            "goal", "pov_character", "location", "beats",
            "sensory_anchor", "opening_image", "closing_image",
        ],
    },
}


def _task_text(brief: str) -> str:
    """What to plan. The writer's notes are optional: without them the planner
    proposes the chapter that should come next rather than planning nothing."""
    if brief.strip():
        return (
            "Create a scene plan for this chapter from the author's notes. Keep everything "
            "the notes specify, and fill in only what they leave open.\n\n"
            f"CHAPTER NOTES:\n{brief.strip()}"
        )
    return (
        "The author has not written notes for this chapter. Propose the chapter that most "
        "naturally comes next: pick up where the previous chapters leave off and stay "
        "consistent with the story bible. If there are no previous chapters, plan an "
        "opening chapter."
    )


async def planner_node(state: dict, model_key: str) -> dict:
    summaries = state["previous_summaries"]

    summaries_text = (
        "\n\n".join(f"Chapter {i + 1} summary:\n{s}" for i, s in enumerate(summaries))
        if summaries
        else "No previous chapters."
    )

    response = await client.messages.create(
        **request_params(model_key, max_tokens=1024),
        system=(
            "You are a narrative architect. Create precise, concrete scene plans "
            "that give a prose writer everything they need without constraining their language."
        ),
        tools=[_PLAN_TOOL],
        tool_choice={"type": "tool", "name": "create_scene_plan"},
        messages=[
            {
                "role": "user",
                "content": (
                    f"{_task_text(state['brief'])}\n\n"
                    f"STORY BIBLE:\n{state['story_bible']}\n\n"
                    f"PREVIOUS CHAPTERS:\n{summaries_text}"
                ),
            }
        ],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        raise RuntimeError(f"Claude did not return a tool_use block; content={response.content!r}")
    return {"scene_plan": tool_use.input, "usage": usage_from(response)}
