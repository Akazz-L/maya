import anthropic
from backend.settings import get_model

client = anthropic.Anthropic()


def drafter_node(state: dict) -> dict:
    bible = state["story_bible"]
    plan = state["scene_plan"]
    style = bible.get("style_guide", {})
    summaries = state["previous_summaries"]

    avoid_lines = "\n".join(f"- {t}" for t in style.get("avoid", []))
    last_summary = summaries[-1] if summaries else "This is the first chapter."

    dialogue_blocks = []
    for char in bible.get("characters", []):
        examples = char.get("dialogue_examples", [])[:5]
        if examples:
            lines = "\n".join(f'  "{e}"' for e in examples)
            dialogue_blocks.append(f"{char['name']}:\n{lines}")

    beats_text = "\n".join(f"- {b}" for b in plan.get("beats", []))

    existing_draft = state.get("draft", "")
    issues = state.get("continuity_issues", [])
    is_revision = bool(existing_draft and issues)

    if is_revision:
        issues_text = "\n".join(
            f"- [{i['severity'].upper()}] {i['issue']} (at {i['location']}): {i['suggested_fix']}"
            for i in issues
        )
        system_prompt = (
            f"You are revising a chapter of literary fiction.\n"
            f"Voice: {style.get('voice', 'precise and immersive')}\n\n"
            f"Prose patterns to avoid:\n{avoid_lines if avoid_lines else 'None specified.'}\n\n"
            "Fix all continuity issues listed below while preserving the overall narrative, characters, and style.\n"
            "Write only the revised prose. No commentary, no meta-text, no titles."
        )
        user_content = (
            f"Revise this draft to fix the following continuity issues.\n\n"
            f"CONTINUITY ISSUES TO FIX:\n{issues_text}\n\n"
            f"SCENE PLAN (for reference):\n"
            f"Goal: {plan.get('goal', '')}\n"
            f"POV: {plan.get('pov_character', '')}\n"
            f"Location: {plan.get('location', '')}\n\n"
            f"CURRENT DRAFT:\n{existing_draft}"
        )
    else:
        system_prompt = (
            f"You are writing literary fiction.\n"
            f"Voice: {style.get('voice', 'precise and immersive')}\n\n"
            f"Prose patterns to avoid:\n{avoid_lines if avoid_lines else 'None specified.'}\n\n"
            "Write only the prose. No commentary, no meta-text, no titles."
        )
        user_content = (
            f"Write this scene as prose.\n\n"
            f"SCENE PLAN:\n"
            f"Goal: {plan.get('goal', '')}\n"
            f"POV: {plan.get('pov_character', '')}\n"
            f"Location: {plan.get('location', '')}\n"
            f"Beats:\n{beats_text}\n"
            f"Opening image: {plan.get('opening_image', '')}\n"
            f"Closing image: {plan.get('closing_image', '')}\n"
            f"Sensory anchor: {plan.get('sensory_anchor', '')}\n\n"
            f"PREVIOUS CHAPTER:\n{last_summary}\n\n"
            f"CHARACTER VOICES:\n"
            + ("\n\n".join(dialogue_blocks) if dialogue_blocks else "No examples available.")
        )

    response = client.messages.create(
        model=get_model(),
        max_tokens=4096,
        temperature=0.9,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )

    if not response.content:
        raise ValueError(f"Drafter received empty content from API (stop_reason={response.stop_reason!r})")
    return {"draft": response.content[0].text}
