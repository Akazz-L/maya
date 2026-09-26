from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from backend.agents.chat import ProposalReady, TextDelta
from backend.agents.chat import SUGGEST_TOOL
from backend.agents.reviewers import (
    CONTINUITY,
    REVIEW_TOOL,
    REVIEWERS,
    reviewer_event_stream,
    reviewer_options,
)
from tests.conftest import MODEL_KEY, stub_usage

DRAFT = "Elena stood at the gates. She raised her right hand."


@pytest.fixture
def state(base_state, sample_scene_plan):
    return {
        **base_state,
        "scene_plan": sample_scene_plan,
        "previous_summaries": [("Chapter 1", "Elena crossed the Wastes alone.")],
        "draft": DRAFT,
    }


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------


def test_the_picker_is_served_from_the_registry():
    assert reviewer_options() == [
        {"key": r.key, "label": r.label, "hint": r.hint} for r in REVIEWERS.values()
    ]


def test_every_reviewer_is_registered_under_its_own_key():
    assert all(key == reviewer.key for key, reviewer in REVIEWERS.items())


def test_a_reviewer_has_a_message_the_chat_can_show_as_the_writers_turn():
    assert CONTINUITY.message.strip() and not CONTINUITY.message.startswith("/")


# ---------------------------------------------------------------------------
# The prompt
# ---------------------------------------------------------------------------


def test_the_continuity_pass_asks_for_contradictions_not_polish():
    assert "continuity editor" in CONTINUITY.system
    assert "Report contradictions, not preferences." in CONTINUITY.system


def test_the_continuity_pass_asks_for_a_reason_and_a_severity_per_fix():
    for expected in ("`explanation`", "`severity`", "critical", "exactly once"):
        assert expected in CONTINUITY.system


def _fix_schema(tool):
    return tool["input_schema"]["properties"]["fixes"]["items"]


def test_a_review_must_rate_what_it_finds():
    """Told only that severity is available, a model often leaves it out, and the
    card in the margin then has no dot and no colour. The chat's own copy of the
    tool does not ask: how serious a line edit is would be noise."""
    assert "severity" in _fix_schema(REVIEW_TOOL)["required"]
    assert "severity" not in _fix_schema(SUGGEST_TOOL)["required"]
    assert REVIEW_TOOL["name"] == SUGGEST_TOOL["name"]


def test_a_clean_chapter_can_come_back_without_a_tool_call():
    assert "If the chapter is clean, call no tool and say so" in CONTINUITY.system


def test_the_pass_reads_the_plan_the_earlier_chapters_and_the_chapter(state):
    rendered = CONTINUITY.render(state)
    for expected in (
        "Establish Elena's arrival and the first obstacle",  # the scene plan's goal
        "Elena crossed the Wastes alone.",  # the previous chapter
        DRAFT,
    ):
        assert expected in rendered


def test_a_first_chapter_says_it_has_no_predecessors(state):
    state["previous_summaries"] = []
    assert "No previous chapters." in CONTINUITY.render(state)


# ---------------------------------------------------------------------------
# Running a pass
# ---------------------------------------------------------------------------


class _Stream:
    def __init__(self, events, final):
        self._events, self._final = events, final

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for event in self._events:
            yield event

    async def get_final_message(self):
        return self._final


def _run(monkeypatch, state, events, final):
    calls = []

    @asynccontextmanager
    async def fake(**kwargs):
        calls.append(kwargs)
        yield _Stream(events, final)

    monkeypatch.setattr("backend.agents.chat.client.messages.stream", fake)
    usage = []
    return calls, usage


def _final(*blocks):
    return stub_usage(SimpleNamespace(stop_reason="tool_use", content=list(blocks)))


def _text(text):
    return SimpleNamespace(type="text", text=text)


def _tool_use(tool_input):
    return SimpleNamespace(type="tool_use", id="tu_1", name="suggest_fixes", input=tool_input)


@pytest.mark.asyncio
async def test_a_pass_offers_only_the_suggest_tool_and_carries_the_cached_bible(monkeypatch, state):
    fixes = [
        {
            "find": "her right hand",
            "replace": "her left hand",
            "explanation": "The bible makes Elena left-handed.",
            "severity": "critical",
        }
    ]
    calls, usage = _run(monkeypatch, state, [_text("One problem.")], _final(_tool_use({"fixes": fixes})))
    events = [
        e
        async for e in reviewer_event_stream(CONTINUITY, state, MODEL_KEY, usage.append)
    ]

    assert calls[0]["tools"] == [REVIEW_TOOL]
    assert calls[0]["tool_choice"] == {"type": "auto", "disable_parallel_tool_use": True}
    system = calls[0]["system"][0]
    assert "adverbs ending in -ly" in system["text"]  # the story bible
    assert system["cache_control"] == {"type": "ephemeral"}
    assert len(usage) == 1

    ready = events[-1]
    assert isinstance(ready, ProposalReady)
    suggestion = ready.proposal["suggestions"][0]
    assert suggestion["severity"] == "critical"
    assert suggestion["explanation"] == "The bible makes Elena left-handed."
    # Located in the chapter, so the editor can draw it without searching.
    assert DRAFT[suggestion["from"] : suggestion["to"]] == "her right hand"


@pytest.mark.asyncio
async def test_a_clean_chapter_yields_text_and_no_proposal(monkeypatch, state):
    reply = _text("No continuity problems.")
    _, usage = _run(
        monkeypatch,
        state,
        [reply],
        stub_usage(SimpleNamespace(stop_reason="end_turn", content=[reply])),
    )
    events = [e async for e in reviewer_event_stream(CONTINUITY, state, MODEL_KEY, usage.append)]
    assert events == [TextDelta("No continuity problems.")]
