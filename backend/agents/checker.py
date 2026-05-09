import yaml
import anthropic

client = anthropic.Anthropic()

_CHECK_TOOL = {
    "name": "report_continuity_issues",
    "description": "Report all continuity issues found in the draft",
    "input_schema": {
        "type": "object",
        "properties": {
            "issues": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "issue": {"type": "string"},
                        "severity": {
                            "type": "string",
                            "enum": ["critical", "minor", "style"],
                        },
                        "location": {"type": "string"},
                        "suggested_fix": {"type": "string"},
                    },
                    "required": ["issue", "severity", "location", "suggested_fix"],
                },
            }
        },
        "required": ["issues"],
    },
}


def checker_node(state: dict) -> dict:
    bible = state["story_bible"]
    summaries = state["previous_summaries"]

    summaries_text = (
        "\n\n".join(f"Chapter {i + 1}:\n{s}" for i, s in enumerate(summaries))
        if summaries
        else "No previous chapters."
    )

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=(
            "You are a continuity editor. Check for contradictions between the draft "
            "and all established story facts. Be thorough and precise. "
            "If the draft is consistent, return an empty issues list."
        ),
        tools=[_CHECK_TOOL],
        tool_choice={"type": "tool", "name": "report_continuity_issues"},
        messages=[
            {
                "role": "user",
                "content": (
                    f"Check this draft for continuity issues.\n\n"
                    f"DRAFT:\n{state['draft']}\n\n"
                    f"CHARACTER FACTS:\n{yaml.dump(bible.get('characters', []))}\n\n"
                    f"WORLD RULES:\n{yaml.dump(bible.get('world', {}))}\n\n"
                    f"TIMELINE:\n{yaml.dump(bible.get('timeline', []))}\n\n"
                    f"PREVIOUS CHAPTERS:\n{summaries_text}\n\n"
                    "Check for: physical trait contradictions, timeline inconsistencies, "
                    "character knowledge errors (knowing something they shouldn't), "
                    "location consistency errors."
                ),
            }
        ],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        raise RuntimeError(f"Claude did not return a tool_use block; content={response.content!r}")
    return {"continuity_issues": tool_use.input["issues"]}
