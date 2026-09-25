"""Specialist review passes over a chapter.

A reviewer reads the chapter and proposes localized fixes through the same
`suggest_fixes` tool the chat uses, so its findings are reviewed exactly like
any other chat proposal: drawn in the prose, one explanation per fix, accepted
or discarded one at a time.

Adding one is a `Reviewer` instance and a prompt. Everything else — validating
the fixes against the chapter, the one correction attempt, streaming, metering,
storage — is already shared.
"""

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

from backend.agents.chat import ChatEvent, plan_text, stream_turn, suggest_tool
from backend.llm import Usage

_CACHED = {"type": "ephemeral"}

#: A review rates what it finds, so its copy of the tool makes severity required.
REVIEW_TOOL = suggest_tool(rate_severity=True)

# The reviewer is not forced to call the tool: a chapter with nothing wrong must
# be able to come back as a text reply rather than an invented fix.
_TOOL_CHOICE = {"type": "auto", "disable_parallel_tool_use": True}


@dataclass(frozen=True)
class Reviewer:
    #: Stable slug, stored on the chat message and sent by the picker.
    key: str
    #: What the picker shows.
    label: str
    hint: str
    #: The writer's turn recorded in the chat when this pass is run.
    message: str
    #: Rules. The story bible is appended, and the whole block is cached.
    system: str
    #: The chapter and its context, as this pass wants to read them.
    render: Callable[[dict], str]


_SUGGEST_RULES = (
    "Report what you find by calling suggest_fixes, with one fix per problem:\n"
    "- `find`: the exact passage from the chapter text that is wrong, copied character for "
    "character, long enough to occur exactly once. Never include text you are not changing "
    "beyond what uniqueness requires, and never let two fixes overlap.\n"
    "- `replace`: that passage, corrected, in the author's voice. Change as little as the problem "
    "requires; this replaces the passage verbatim.\n"
    "- `explanation`: one sentence naming the problem, written for the author — what contradicts "
    "what. Not an instruction, not a restatement of the fix.\n"
    "- `severity`: \"critical\" for a contradiction a reader would catch, \"minor\" for a small "
    "slip, \"style\" for a matter of taste.\n\n"
    "Order the fixes as they appear in the chapter. Add a one-line text reply saying what you "
    "found. If the chapter is clean, call no tool and say so in one line."
)


def _continuity_render(state: dict) -> str:
    summaries = state["previous_summaries"]
    previous = (
        "\n\n".join(f"{title} — summary:\n{summary}" for title, summary in summaries)
        if summaries
        else "No previous chapters."
    )
    return (
        f"SCENE PLAN (the POV, location and beats this chapter is meant to have):\n"
        f"{plan_text(state['scene_plan'])}\n\n"
        f"PREVIOUS CHAPTERS:\n{previous}\n\n"
        f"CHAPTER TEXT:\n{state['draft']}"
    )


CONTINUITY = Reviewer(
    key="continuity",
    label="Continuity check",
    hint="Contradictions against the bible, the timeline, and earlier chapters",
    message="Check this chapter for continuity problems.",
    system=(
        "You are a continuity editor reading one chapter of a work of literary fiction.\n"
        "Find every place where the chapter contradicts an established fact of the story: "
        "physical traits, timeline and elapsed time, what a character knows or could know at this "
        "point, locations and geography, names, and the world's own rules. The story bible below "
        "and the previous chapters' summaries are the established facts; the scene plan is what "
        "this chapter was meant to do.\n"
        "Report contradictions, not preferences. Do not rewrite prose you merely find weak, and "
        "do not flag something the chapter deliberately leaves ambiguous.\n\n" + _SUGGEST_RULES
    ),
    render=_continuity_render,
)

#: Every specialist the "+" picker offers, in the order it shows them.
REVIEWERS: dict[str, Reviewer] = {r.key: r for r in (CONTINUITY,)}


def reviewer_options() -> list[dict]:
    """The registry as the picker reads it. Labels live here only."""
    return [{"key": r.key, "label": r.label, "hint": r.hint} for r in REVIEWERS.values()]


def reviewer_event_stream(
    reviewer: Reviewer,
    state: dict,
    model_key: str,
    on_usage: Callable[[Usage], None],
) -> AsyncIterator[ChatEvent]:
    """Run one review pass. Yields the same events a chat turn does, so the
    endpoint, the store and the editor need no special case for a reviewer."""
    system = [
        {
            "type": "text",
            "text": f"{reviewer.system}\n\nSTORY BIBLE:\n{state['story_bible']}",
            "cache_control": _CACHED,
        }
    ]
    return stream_turn(
        system=system,
        messages=[{"role": "user", "content": reviewer.render(state)}],
        tools=[REVIEW_TOOL],
        tool_choice=_TOOL_CHOICE,
        body=state["draft"],
        model_key=model_key,
        on_usage=on_usage,
    )
