import anthropic

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

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        temperature=0.9,
        system=(
            f"You are writing literary fiction.\n"
            f"Voice: {style.get('voice', 'precise and immersive')}\n\n"
            f"Prose patterns to avoid:\n{avoid_lines if avoid_lines else 'None specified.'}\n\n"
            "Write only the prose. No commentary, no meta-text, no titles."
        ),
        messages=[
            {
                "role": "user",
                "content": (
                    f"Write this scene as prose.\n\n"
                    f"SCENE PLAN:\n"
                    f"Goal: {plan.get('goal')}\n"
                    f"POV: {plan.get('pov_character')}\n"
                    f"Location: {plan.get('location')}\n"
                    f"Beats:\n{beats_text}\n"
                    f"Opening image: {plan.get('opening_image')}\n"
                    f"Closing image: {plan.get('closing_image')}\n"
                    f"Sensory anchor: {plan.get('sensory_anchor')}\n\n"
                    f"PREVIOUS CHAPTER:\n{last_summary}\n\n"
                    f"CHARACTER VOICES:\n"
                    + ("\n\n".join(dialogue_blocks) if dialogue_blocks else "No examples available.")
                ),
            }
        ],
    )

    return {"draft": response.content[0].text}
