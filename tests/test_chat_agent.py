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
    apply_fixes,
    build_proposal,
    build_turn,
    chat_event_stream,
    describe_proposal,
    is_pending,
    pending_indexes,
    render_history,
)
from tests.conftest import MODEL_KEY, stub_usage

# ---------------------------------------------------------------------------
# locating fixes
# ---------------------------------------------------------------------------


def _fix(find, replace, explanation="Because.", **extra):
    return {"find": find, "replace": replace, "explanation": explanation, **extra}


def test_fixes_apply_against_the_original_positions():
    body = "The hall was empty. She waited by the door. A clock ticked."
    out = apply_fixes(
        body,
        [
            _fix("A clock ticked.", "Somewhere, a clock."),
            _fix("She waited by the door.", "She froze."),
        ],
    )
    assert out == "The hall was empty. She froze. Somewhere, a clock."


def test_a_fix_whose_find_is_missing_names_the_fix():
    with pytest.raises(ProposalError, match="Fix 2: `find` does not appear"):
        apply_fixes("One. Two.", [_fix("One.", "1."), _fix("Three.", "3.")])


def test_an_ambiguous_find_is_refused():
    with pytest.raises(ProposalError, match="appears 2 times"):
        apply_fixes("She ran. She ran.", [_fix("She ran.", "She fled.")])


def test_overlapping_occurrences_count_as_ambiguous():
    with pytest.raises(ProposalError, match="appears 2 times"):
        apply_fixes("aaa", [_fix("aa", "b")])


def test_overlapping_fixes_are_refused():
    with pytest.raises(ProposalError, match="Fixes 1 and 2 overlap"):
        apply_fixes("The hall was empty.", [_fix("The hall was", "A"), _fix("was empty", "b")])


def test_an_empty_find_is_refused():
    with pytest.raises(ProposalError, match="Fix 1: `find` is empty"):
        apply_fixes("Text.", [_fix("", "x")])


def test_every_problem_in_a_set_is_reported_at_once():
    with pytest.raises(ProposalError) as raised:
        apply_fixes("One. Two.", [_fix("nowhere", "x"), _fix("", "y")])
    assert "Fix 1: `find` does not appear" in str(raised.value)
    assert "Fix 2: `find` is empty" in str(raised.value)


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


def test_a_suggestion_carries_its_offsets_its_reason_and_no_outcome():
    proposal = build_proposal(
        "The rain.",
        "suggest_fixes",
        {"fixes": [_fix("rain", "downpour", "Too mild.", severity="minor")]},
    )
    assert proposal == {
        "kind": "suggestions",
        "suggestions": [
            {
                "find": "rain",
                "replace": "downpour",
                "explanation": "Too mild.",
                "severity": "minor",
                "from": 4,
                "to": 8,
                "outcome": None,
            }
        ],
    }


def test_suggestions_come_back_in_document_order():
    proposal = build_proposal(
        "First. Second. Third.",
        "suggest_fixes",
        {"fixes": [_fix("Third.", "3."), _fix("First.", "1.")]},
    )
    assert [s["find"] for s in proposal["suggestions"]] == ["First.", "Third."]


def test_a_severity_outside_the_enum_is_dropped():
    proposal = build_proposal(
        "The rain.", "suggest_fixes", {"fixes": [_fix("rain", "x", severity="urgent")]}
    )
    assert proposal["suggestions"][0]["severity"] is None


def test_a_fix_without_an_explanation_is_refused():
    with pytest.raises(ProposalError, match="Fix 1: `explanation` is empty"):
        build_proposal("The rain.", "suggest_fixes", {"fixes": [_fix("rain", "x", "  ")]})


def test_a_fix_that_changes_nothing_is_refused():
    """It would draw an empty diff and ask the writer to accept a no-op; a
    remark about prose the model is not changing belongs in its text reply."""
    with pytest.raises(ProposalError, match="Fix 1: `replace` is identical to `find`"):
        build_proposal("The rain.", "suggest_fixes", {"fixes": [_fix("rain", "rain", "Hmm.")]})


def test_every_problem_with_a_set_is_reported_together():
    with pytest.raises(ProposalError) as raised:
        build_proposal(
            "The rain fell.",
            "suggest_fixes",
            {"fixes": [_fix("rain", "rain", "Hmm."), _fix("fell", "poured", "  ")]},
        )
    assert "Fix 1: `replace` is identical" in str(raised.value)
    assert "Fix 2: `explanation` is empty" in str(raised.value)


def test_a_suggestion_proposal_without_fixes_is_refused():
    with pytest.raises(ProposalError, match="`fixes` is empty"):
        build_proposal("The rain.", "suggest_fixes", {"fixes": []})


# ---------------------------------------------------------------------------
# what is still pending
# ---------------------------------------------------------------------------


def _set(*outcomes):
    return {
        "kind": "suggestions",
        "suggestions": [
            {
                "find": "a",
                "replace": "b",
                "explanation": "x",
                "severity": None,
                "from": 0,
                "to": 1,
                "outcome": outcome,
            }
            for outcome in outcomes
        ],
    }


def test_a_set_is_pending_while_any_fix_is_unreviewed():
    assert is_pending(_set("accepted", None)) is True
    assert pending_indexes(_set("accepted", None, None)) == [1, 2]


def test_a_fully_reviewed_set_is_not_pending():
    assert is_pending(_set("accepted", "discarded")) is False
    assert pending_indexes(_set("accepted")) == []


def test_a_write_is_pending_until_it_has_an_outcome():
    assert is_pending({"kind": "write", "outcome": None}) is True
    assert is_pending({"kind": "write", "outcome": "accepted"}) is False
    assert is_pending(None) is False


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


def test_fixes_are_listed_with_their_reasons_in_the_description():
    proposal = build_proposal(
        "The rain.", "suggest_fixes", {"fixes": [_fix("rain", "downpour", "Too mild.")]}
    )
    rendered = render_history([_user("Wetter."), _assistant("", proposal)])
    assert "«rain»" in rendered[1]["content"] and "«downpour»" in rendered[1]["content"]
    assert "Too mild." in rendered[1]["content"]


def test_a_description_does_not_change_when_the_writer_resolves_it():
    """The assistant turn is part of the cached prompt prefix; resolving a fix
    must not rewrite it, or every later turn pays for a cache miss."""
    proposal = build_proposal("The rain.", "suggest_fixes", {"fixes": [_fix("rain", "downpour")]})
    before = describe_proposal(proposal)
    proposal["suggestions"][0]["outcome"] = "accepted"
    assert describe_proposal(proposal) == before


def test_the_outcome_of_a_proposal_opens_the_next_user_message():
    write = {"kind": "write", "mode": "replace", "text": "a b", "outcome": "discarded"}
    rendered = render_history([_user("One."), _assistant("", write), _user("Two."), _assistant("Ok.")])
    assert rendered[2]["content"].startswith("(The writer discarded your last proposal")
    assert rendered[2]["content"].endswith("Two.")
    assert rendered[0]["content"] == "One."


def test_a_partly_accepted_set_names_which_fixes_the_writer_took():
    rendered = render_history(
        [_user("One."), _assistant("", _set("accepted", "discarded", "accepted")), _user("Two.")]
    )
    note = rendered[2]["content"]
    assert "accepted fixes 1 and 3" in note
    assert "discarded fix 2" in note
    assert "The accepted ones are now part of the chapter." in note


def test_a_set_the_writer_took_nothing_from_says_the_chapter_did_not_change():
    rendered = render_history([_user("One."), _assistant("", _set("discarded")), _user("Two.")])
    assert "discarded fix 1" in rendered[2]["content"]
    assert "The chapter did not change." in rendered[2]["content"]


def test_a_fix_that_could_not_be_applied_says_why():
    rendered = render_history([_user("One."), _assistant("", _set("stale")), _user("Two.")])
    assert "could not apply fix 1" in rendered[2]["content"]


def test_an_unreviewed_set_adds_no_note():
    rendered = render_history([_user("One."), _assistant("", _set(None, None)), _user("Two.")])
    assert rendered[2]["content"] == "Two."


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
    assert "write_draft" in system[0]["text"] and "suggest_fixes" in system[0]["text"]
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
    write = {"kind": "write", "mode": "replace", "text": "a b", "outcome": "accepted"}
    state["history"] = [_user("Fix it."), _assistant("Done.", write)]
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


def _input_chunks(*chunks):
    """The input_json events the SDK really emits while a tool call streams.

    Each carries the raw `partial_json` fragment and a snapshot parsed the way
    the SDK parses it: jiter with `partial_mode=True`, which drops a trailing
    incomplete string. The prose is therefore absent from every snapshot until
    the whole call has arrived, which is why the raw fragments are what count.
    """
    from jiter import from_json

    buf = b""
    for chunk in chunks:
        buf += chunk.encode()
        yield SimpleNamespace(
            type="input_json", partial_json=chunk, snapshot=from_json(buf, partial_mode=True)
        )


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
                *_input_chunks('{"mode": "rep', 'lace", "text": "Night ', 'fell on the gates."}'),
            ],
            _final("tool_use", _tool_use("write_draft", tool_input)),
        ),
    )
    assert events == [
        TextDelta("Darker:"),
        ProposalProgress("replace", "Night "),
        ProposalProgress("replace", "Night fell on the gates."),
        ProposalReady(
            {"kind": "write", "mode": "replace", "text": "Night fell on the gates.", "proposed_body": "Night fell on the gates."}
        ),
    ]


@pytest.mark.asyncio
async def test_a_failed_fix_gets_one_correction_in_the_same_turn(monkeypatch, state):
    bad = _tool_use("suggest_fixes", {"fixes": [_fix("Elena stood at the gate!", "x")]}, id="tu_bad")
    good = _tool_use("suggest_fixes", {"fixes": [_fix("stood", "waited", "Stronger.")]}, id="tu_good")
    events, calls, usage = await _run(
        monkeypatch,
        state,
        ([_tool_start("suggest_fixes")], _final("tool_use", bad)),
        ([_text("Fixed."), _tool_start("suggest_fixes")], _final("tool_use", good)),
    )
    assert events[-1] == ProposalReady(
        {
            "kind": "suggestions",
            "suggestions": [
                {
                    "find": "stood",
                    "replace": "waited",
                    "explanation": "Stronger.",
                    "severity": None,
                    "from": 6,
                    "to": 11,
                    "outcome": None,
                }
            ],
        }
    )
    assert len(usage) == 2
    retry = calls[1]["messages"]
    assert retry[-2] == {"role": "assistant", "content": [bad]}
    result = retry[-1]["content"][0]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "tu_bad" and result["is_error"] is True
    assert "does not appear" in result["content"]


@pytest.mark.asyncio
async def test_a_second_failed_fix_is_an_error(monkeypatch, state):
    bad = _tool_use("suggest_fixes", {"fixes": [_fix("nowhere", "x")]})
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
