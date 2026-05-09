import yaml
import anthropic

client = anthropic.Anthropic()

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


def planner_node(state: dict) -> dict:
    bible = state["story_bible"]
    summaries = state["previous_summaries"]

    summaries_text = (
        "\n\n".join(f"Chapter {i + 1} summary:\n{s}" for i, s in enumerate(summaries))
        if summaries
        else "No previous chapters."
    )

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
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
                    f"Create a scene plan for this chapter beat:\n\n"
                    f"OUTLINE BEAT: {state['outline_beat']}\n\n"
                    f"CHARACTERS:\n{yaml.dump(bible.get('characters', []))}\n\n"
                    f"WORLD:\n{yaml.dump(bible.get('world', {}))}\n\n"
                    f"TIMELINE SO FAR:\n{yaml.dump(bible.get('timeline', []))}\n\n"
                    f"PREVIOUS CHAPTERS:\n{summaries_text}"
                ),
            }
        ],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        raise RuntimeError(f"Claude did not return a tool_use block; content={response.content!r}")
    return {"scene_plan": tool_use.input}
