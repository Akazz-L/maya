from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from backend.agents.chat import (
    MAX_HISTORY_MESSAGES,
    TOOLS,
    ChatTruncatedError,
    EmptyReplyError,
    ProposalError,
    ProposalProgress,
    ProposalReady,
    TextDelta,
    apply_edits,
    build_proposal,
    build_turn,
    chat_event_stream,
    render_history,
)
from tests.conftest import MODEL_KEY, stub_usage

# ---------------------------------------------------------------------------
# apply_edits
# ---------------------------------------------------------------------------


def test_edits_apply_against_the_original_positions():
    body = "The hall was empty. She waited by the door. A clock ticked."
    out = apply_edits(
        body,
        [
            {"find": "A clock ticked.", "replace": "Somewhere, a clock."},
            {"find": "She waited by the door.", "replace": "She froze."},
        ],
    )
    assert out == "The hall was empty. She froze. Somewhere, a clock."


def test_an_edit_whose_find_is_missing_names_the_edit():
    with pytest.raises(ProposalError, match="Edit 2: `find` does not appear"):
        apply_edits("One. Two.", [{"find": "One.", "replace": "1."}, {"find": "Three.", "replace": "3."}])


def test_an_ambiguous_find_is_refused():
    with pytest.raises(ProposalError, match="appears 2 times"):
        apply_edits("She ran. She ran.", [{"find": "She ran.", "replace": "She fled."}])


def test_overlapping_occurrences_count_as_ambiguous():
    with pytest.raises(ProposalError, match="appears 2 times"):
        apply_edits("aaa", [{"find": "aa", "replace": "b"}])


def test_overlapping_edits_are_refused():
    with pytest.raises(ProposalError, match="Edits 1 and 2 overlap"):
        apply_edits(
            "The hall was empty.",
            [{"find": "The hall was", "replace": "A"}, {"find": "was empty", "replace": "b"}],
        )


def test_an_empty_find_is_refused():
    with pytest.raises(ProposalError, match="Edit 1: `find` is empty"):
        apply_edits("Text.", [{"find": "", "replace": "x"}])


# ---------------------------------------------------------------------------
# build_proposal
# ---------------------------------------------------------------------------


def test_a_replace_proposal_is_the_new_text():
    proposal = build_proposal("Old.", "write_draft", {"mode": "replace", "text": "New prose."})
    assert proposal == {"kind": "write", "mode": "replace", "text": "New prose.", "proposed_body": "New prose."}


def test_an_append_proposal_joins_with_a_blank_line():
    proposal = build_proposal("Existing.\n", "write_draft", {"mode": "append", "text": "More."})
    assert proposal["proposed_body"] == "Existing.\n\nMore."


def test_an_append_to_an_empty_chapter_has_no_leading_blank_line():
    assert build_proposal("", "write_draft", {"mode": "append", "text": "First."})["proposed_body"] == "First."


@pytest.mark.parametrize(
    "tool_input,message",
    [({"mode": "rewrite", "text": "x"}, "`mode` must be"), ({"mode": "replace", "text": "  "}, "`text` is empty")],
)
def test_an_invalid_write_is_refused(tool_input, message):
    with pytest.raises(ProposalError, match=message):
        build_proposal("Body.", "write_draft", tool_input)


def test_an_edit_proposal_carries_the_edits_and_the_result():
    edits = [{"find": "rain", "replace": "downpour"}]
    proposal = build_proposal("The rain.", "edit_draft", {"edits": edits})
    assert proposal == {"kind": "edit", "edits": edits, "proposed_body": "The downpour."}


def test_an_edit_proposal_without_edits_is_refused():
    with pytest.raises(ProposalError, match="`edits` is empty"):
        build_proposal("The rain.", "edit_draft", {"edits": []})


# ---------------------------------------------------------------------------
# render_history
# ---------------------------------------------------------------------------


def _user(content):
    return {"role": "user", "content": content, "proposal": None}


def _assistant(content, proposal=None):
    return {"role": "assistant", "content": content, "proposal": proposal}


def test_a_proposal_is_described_rather_than_replayed():
    draft = {"kind": "write", "mode": "replace", "text": "one two three", "outcome": "accepted"}
    rendered = render_history([_user("Draft it."), _assistant("Here is a draft.", draft)])
    assert rendered[1]["role"] == "assistant"
    assert "Here is a draft." in rendered[1]["content"]
    assert "new draft of 3 words" in rendered[1]["content"]
    assert "one two three" not in rendered[1]["content"]


def test_edits_are_listed_in_the_description():
    edit = {"kind": "edit", "edits": [{"find": "rain", "replace": "downpour"}], "outcome": "discarded"}
    rendered = render_history([_user("Wetter."), _assistant("", edit)])
    assert "«rain»" in rendered[1]["content"] and "«downpour»" in rendered[1]["content"]


def test_the_outcome_of_a_proposal_opens_the_next_user_message():
    edit = {"kind": "edit", "edits": [{"find": "a", "replace": "b"}], "outcome": "discarded"}
    rendered = render_history([_user("One."), _assistant("", edit), _user("Two."), _assistant("Ok.")])
    assert rendered[2]["content"].startswith("(The writer discarded your last proposal")
    assert rendered[2]["content"].endswith("Two.")
    assert rendered[0]["content"] == "One."


def test_the_window_keeps_the_most_recent_messages_and_starts_on_a_user_message():
    messages = [_user("first")]
    for i in range(MAX_HISTORY_MESSAGES):
        messages.append(_assistant(f"reply {i}") if i % 2 == 0 else _user(f"ask {i}"))
    rendered = render_history(messages)
    assert len(rendered) <= MAX_HISTORY_MESSAGES
    assert rendered[0]["role"] == "user"
    assert rendered[-1]["content"] == messages[-1]["content"]


# ---------------------------------------------------------------------------
# build_turn
# ---------------------------------------------------------------------------


@pytest.fixture
def state(base_state, sample_scene_plan):
    return {
        **base_state,
        "scene_plan": sample_scene_plan,
        "previous_summaries": ["Elena crossed the Wastes alone."],
        "draft": "Elena stood at the gates.",
        "history": [],
        "message": "Make the ending darker.",
    }


def test_the_system_prompt_carries_the_bible_and_is_cached(state):
    system, _ = build_turn(state)
    assert "adverbs ending in -ly" in system[0]["text"]
    assert "write_draft" in system[0]["text"] and "edit_draft" in system[0]["text"]
    assert system[0]["cache_control"] == {"type": "ephemeral"}


def test_the_new_message_carries_the_chapter_as_it_stands(state):
    _, messages = build_turn(state)
    content = messages[-1]["content"]
    assert messages[-1]["role"] == "user"
    for expected in (
        "Elena arrives at the Citadel gates",
        "Establish Elena's arrival",
        "Gatekeeper blocks her",
        "Elena crossed the Wastes alone.",
        "Elena stood at the gates.",
        "Make the ending darker.",
    ):
        assert expected in content


def test_a_first_chapter_without_a_plan_says_so(state):
    state.update(previous_summaries=[], scene_plan={}, draft="")
    content = build_turn(state)[1][-1]["content"]
    assert "This is the first chapter." in content
    assert "No scene plan." in content
    assert "The chapter is empty." in content


def test_a_chapter_without_notes_says_so(state):
    state.update(brief="  ")
    content = build_turn(state)[1][-1]["content"]
    assert "CHAPTER NOTES:\n(The author has not written notes for this chapter.)" in content


def test_the_last_outcome_reaches_the_new_message_and_history_is_cached(state):
    edit = {"kind": "edit", "edits": [{"find": "a", "replace": "b"}], "outcome": "accepted"}
    state["history"] = [_user("Fix it."), _assistant("Done.", edit)]
    _, messages = build_turn(state)
    assert len(messages) == 3
    assert "The writer accepted your last proposal" in messages[-1]["content"]
    assert messages[1]["content"][-1]["cache_control"] == {"type": "ephemeral"}


# ---------------------------------------------------------------------------
# chat_event_stream
# ---------------------------------------------------------------------------


class _Stream:
    def __init__(self, events, final):
        self._events = events
        self._final = final

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for event in self._events:
            yield event

    async def get_final_message(self):
        return self._final


def _text(text):
    return SimpleNamespace(type="text", text=text)


def _tool_start(name):
    return SimpleNamespace(type="content_block_start", content_block=SimpleNamespace(type="tool_use", name=name))


def _input(snapshot):
    return SimpleNamespace(type="input_json", partial_json="", snapshot=snapshot)


def _final(stop_reason, *blocks):
    return stub_usage(SimpleNamespace(stop_reason=stop_reason, content=list(blocks)))


def _tool_use(name, tool_input, id="tu_1"):
    return SimpleNamespace(type="tool_use", id=id, name=name, input=tool_input)


def _client(*turns):
    """Each call to client.messages.stream plays the next (events, final) pair."""
    calls = []
    remaining = list(turns)

    @asynccontextmanager
    async def fake(**kwargs):
        calls.append(kwargs)
        events, final = remaining.pop(0)
        yield _Stream(events, final)

    return fake, calls


async def _run(monkeypatch, state, *turns):
    fake, calls = _client(*turns)
    monkeypatch.setattr("backend.agents.chat.client.messages.stream", fake)
    usage = []
    events = [e async for e in chat_event_stream(state, MODEL_KEY, usage.append)]
    return events, calls, usage


@pytest.mark.asyncio
async def test_a_text_reply_streams_and_reports_usage(monkeypatch, state):
    events, calls, usage = await _run(
        monkeypatch,
        state,
        ([_text("The ending "), _text("works.")], _final("end_turn", SimpleNamespace(type="text", text="The ending works."))),
    )
    assert events == [TextDelta("The ending "), TextDelta("works.")]
    assert len(usage) == 1
    assert calls[0]["tools"] == TOOLS
    assert calls[0]["tool_choice"] == {"type": "auto", "disable_parallel_tool_use": True}


def test_prose_from_write_draft_streams_as_it_is_written():
    write = next(t for t in TOOLS if t["name"] == "write_draft")
    assert write["eager_input_streaming"] is True


@pytest.mark.asyncio
async def test_a_write_streams_progress_then_a_ready_proposal(monkeypatch, state):
    tool_input = {"mode": "replace", "text": "Night fell on the gates."}
    events, _, _ = await _run(
        monkeypatch,
        state,
        (
            [
                _text("Darker:"),
                _tool_start("write_draft"),
                _input({"mode": "replace"}),
                _input({"mode": "replace", "text": "Night fell"}),
                _input({"mode": "replace", "text": "Night fell"}),
                _input(tool_input),
            ],
            _final("tool_use", _tool_use("write_draft", tool_input)),
        ),
    )
    assert events == [
        TextDelta("Darker:"),
        ProposalProgress("replace", "Night fell"),
        ProposalProgress("replace", "Night fell on the gates."),
        ProposalReady(
            {"kind": "write", "mode": "replace", "text": "Night fell on the gates.", "proposed_body": "Night fell on the gates."}
        ),
    ]


@pytest.mark.asyncio
async def test_a_failed_edit_gets_one_correction_in_the_same_turn(monkeypatch, state):
    bad = _tool_use("edit_draft", {"edits": [{"find": "Elena stood at the gate!", "replace": "x"}]}, id="tu_bad")
    good = _tool_use("edit_draft", {"edits": [{"find": "stood", "replace": "waited"}]}, id="tu_good")
    events, calls, usage = await _run(
        monkeypatch,
        state,
        ([_tool_start("edit_draft")], _final("tool_use", bad)),
        ([_text("Fixed."), _tool_start("edit_draft")], _final("tool_use", good)),
    )
    assert events[-1] == ProposalReady(
        {"kind": "edit", "edits": [{"find": "stood", "replace": "waited"}], "proposed_body": "Elena waited at the gates."}
    )
    assert len(usage) == 2
    retry = calls[1]["messages"]
    assert retry[-2] == {"role": "assistant", "content": [bad]}
    result = retry[-1]["content"][0]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "tu_bad" and result["is_error"] is True
    assert "does not appear" in result["content"]


@pytest.mark.asyncio
async def test_a_second_failed_edit_is_an_error(monkeypatch, state):
    bad = _tool_use("edit_draft", {"edits": [{"find": "nowhere", "replace": "x"}]})
    with pytest.raises(ProposalError):
        await _run(
            monkeypatch,
            state,
            ([], _final("tool_use", bad)),
            ([], _final("tool_use", bad)),
        )


@pytest.mark.asyncio
async def test_a_truncated_reply_is_an_error_but_still_billed(monkeypatch, state):
    fake, _ = _client(([_text("Half")], _final("max_tokens", SimpleNamespace(type="text", text="Half"))))
    monkeypatch.setattr("backend.agents.chat.client.messages.stream", fake)
    usage = []
    with pytest.raises(ChatTruncatedError):
        async for _ in chat_event_stream(state, MODEL_KEY, usage.append):
            pass
    assert len(usage) == 1


@pytest.mark.asyncio
async def test_an_empty_reply_is_an_error(monkeypatch, state):
    with pytest.raises(EmptyReplyError):
        await _run(monkeypatch, state, ([], _final("end_turn")))
