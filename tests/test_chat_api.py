import hashlib
import json
from unittest.mock import patch

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from backend.agents.chat import ProposalProgress, ProposalReady, TextDelta, build_proposal
from backend.db_models import ChatMessage, UsageEvent
from backend.llm import Usage

BODY = "Elena stood at the gates."
DRAFT = {"kind": "write", "mode": "replace", "text": "Night fell.", "proposed_body": "Night fell."}

FIXES = [
    {"find": "stood", "replace": "waited", "explanation": "Static verb.", "severity": "style"},
    {"find": "gates", "replace": "gate", "explanation": "The bible gives the Citadel one gate.", "severity": "minor"},
]


def _suggestions():
    """Two localized fixes against BODY, as the agent would propose them."""
    return build_proposal(BODY, "suggest_fixes", {"fixes": FIXES})


def _parse_sse(text: str) -> list[dict]:
    return [json.loads(chunk.replace("data: ", "")) for chunk in text.split("\n\n") if chunk.strip()]


@pytest_asyncio.fixture
async def chapter(authed_client):
    client, project_id = authed_client
    doc_id = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Chapter 1"})
    ).json()["id"]
    await client.patch(
        f"/projects/{project_id}/documents/{doc_id}",
        json={"brief": "Elena reaches the gates.", "body": BODY},
    )
    return client, f"/projects/{project_id}/documents/{doc_id}"


def _agent(*events, seen: list | None = None, usage: Usage | None = None):
    async def fake(state, model_key, on_usage):
        if seen is not None:
            seen.append(state)
        for event in events:
            yield event
        on_usage(usage or Usage(input_tokens=100, output_tokens=50))

    return patch("backend.routes.chat.chat_event_stream", new=fake)


async def _send(client, base, content="Draft it.", *events, **kwargs):
    with _agent(*events, **kwargs):
        resp = await client.post(f"{base}/chat/stream", json={"content": content})
    return resp, _parse_sse(resp.text)


def _reviewer(*events, seen: list | None = None):
    def fake(reviewer, state, model_key, on_usage):
        async def gen():
            if seen is not None:
                seen.append((reviewer, state))
            for event in events:
                yield event
            on_usage(Usage(input_tokens=100, output_tokens=50))

        return gen()

    return patch("backend.routes.chat.reviewer_event_stream", new=fake)


async def _review(client, base, *events, agent="continuity", **kwargs):
    with _reviewer(*events, **kwargs):
        resp = await client.post(f"{base}/chat/stream", json={"agent": agent})
    return resp, _parse_sse(resp.text)


async def _pending_set(client, base):
    """A reviewed-pending suggestion set; returns its assistant message id."""
    _, frames = await _review(client, base, TextDelta("Two problems."), ProposalReady(_suggestions()))
    return frames[-1]["messages"][1]["id"]


@pytest.mark.asyncio
async def test_a_new_chapter_has_an_empty_chat(chapter):
    client, base = chapter
    resp = await client.get(f"{base}/chat")
    assert resp.status_code == 200
    assert resp.json() == {"messages": []}


@pytest.mark.asyncio
async def test_a_turn_streams_then_persists_both_messages(chapter):
    client, base = chapter
    resp, frames = await _send(
        client,
        base,
        "Draft it.",
        TextDelta("Here "),
        TextDelta("it is."),
        ProposalProgress("replace", "Night"),
        ProposalReady(DRAFT),
    )
    assert resp.status_code == 200
    assert [f["type"] for f in frames] == ["delta", "delta", "proposal_progress", "done"]
    assert frames[2] == {"type": "proposal_progress", "mode": "replace", "text": "Night"}

    user, assistant = frames[-1]["messages"]
    assert (user["role"], user["content"], user["proposal"]) == ("user", "Draft it.", None)
    assert assistant["role"] == "assistant"
    assert assistant["content"] == "Here it is."
    assert assistant["proposal"] == {
        **DRAFT,
        "base_hash": hashlib.sha256(BODY.encode()).hexdigest(),
        "outcome": None,
    }

    stored = (await client.get(f"{base}/chat")).json()["messages"]
    assert [m["id"] for m in stored] == [user["id"], assistant["id"]]

    # A proposal changes nothing until the writer accepts it in the editor.
    assert (await client.get(base)).json()["body"] == BODY


@pytest.mark.asyncio
async def test_the_agent_sees_the_chapter_the_history_and_the_message(chapter):
    client, base = chapter
    await _send(client, base, "First.", TextDelta("One."))
    seen = []
    await _send(client, base, "Second.", TextDelta("Two."), seen=seen)

    state = seen[0]
    assert state["draft"] == BODY
    assert state["brief"] == "Elena reaches the gates."
    assert state["message"] == "Second."
    assert [(m["role"], m["content"]) for m in state["history"]] == [("user", "First."), ("assistant", "One.")]


@pytest.mark.asyncio
async def test_a_new_message_waits_for_the_pending_proposal(chapter):
    client, base = chapter
    await _send(client, base, "Draft it.", ProposalReady(DRAFT))
    resp, _ = await _send(client, base, "And another?", TextDelta("No."))
    assert resp.status_code == 409
    assert "pending suggestions" in resp.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["accepted", "discarded", "stale"])
async def test_recording_an_outcome_resolves_the_proposal(chapter, outcome):
    client, base = chapter
    _, frames = await _send(client, base, "Draft it.", ProposalReady(DRAFT))
    message_id = frames[-1]["messages"][1]["id"]

    resp = await client.post(f"{base}/chat/messages/{message_id}/outcome", json={"outcome": outcome})
    assert resp.status_code == 200
    proposal = resp.json()["proposal"]
    assert proposal["outcome"] == outcome
    # The full proposed chapter is only needed while it is under review.
    assert proposal["proposed_body"] is None
    assert proposal["text"] == "Night fell."

    resp, _ = await _send(client, base, "Now shorter.", TextDelta("Sure."))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_an_outcome_is_recorded_once(chapter):
    client, base = chapter
    _, frames = await _send(client, base, "Draft it.", ProposalReady(DRAFT))
    url = f"{base}/chat/messages/{frames[-1]['messages'][1]['id']}/outcome"
    await client.post(url, json={"outcome": "accepted"})
    resp = await client.post(url, json={"outcome": "discarded"})
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_an_outcome_needs_a_proposal(chapter):
    client, base = chapter
    _, frames = await _send(client, base, "Is the pacing slow?", TextDelta("A little."))
    resp = await client.post(
        f"{base}/chat/messages/{frames[-1]['messages'][1]['id']}/outcome", json={"outcome": "accepted"}
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_an_unknown_message_or_outcome_is_refused(chapter):
    client, base = chapter
    _, frames = await _send(client, base, "Draft it.", ProposalReady(DRAFT))
    message_id = frames[-1]["messages"][1]["id"]
    missing = "00000000-0000-0000-0000-000000000000"
    assert (
        await client.post(f"{base}/chat/messages/{missing}/outcome", json={"outcome": "accepted"})
    ).status_code == 404
    assert (
        await client.post(f"{base}/chat/messages/{message_id}/outcome", json={"outcome": "maybe"})
    ).status_code == 422


@pytest.mark.asyncio
async def test_a_failed_turn_keeps_no_messages_but_keeps_its_usage(chapter, db):
    client, base = chapter

    async def boom(state, model_key, on_usage):
        yield TextDelta("Half a")
        on_usage(Usage(input_tokens=1000))
        raise RuntimeError("model exploded")

    with patch("backend.routes.chat.chat_event_stream", new=boom):
        resp = await client.post(f"{base}/chat/stream", json={"content": "Draft it."})

    frames = _parse_sse(resp.text)
    assert "model exploded" in frames[-1]["detail"]
    assert (await client.get(f"{base}/chat")).json()["messages"] == []
    operations = [e.operation for e in (await db.execute(select(UsageEvent))).scalars()]
    assert operations == ["chat"]


@pytest.mark.asyncio
async def test_a_turn_is_metered_as_chat_and_reports_the_meter(chapter, db):
    client, base = chapter
    _, frames = await _send(client, base, "Hi.", TextDelta("Hello."), usage=Usage(input_tokens=1_000_000))
    assert frames[-1]["usage"]["spent_usd"] == 1.0
    assert [e.operation for e in (await db.execute(select(UsageEvent))).scalars()] == ["chat"]


@pytest.mark.asyncio
async def test_clearing_the_chat_removes_every_message(chapter):
    client, base = chapter
    await _send(client, base, "Hi.", TextDelta("Hello."))
    assert (await client.delete(f"{base}/chat")).status_code == 204
    assert (await client.get(f"{base}/chat")).json()["messages"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("content", ["", "   ", "x" * 8001])
async def test_a_blank_or_oversized_message_is_refused(chapter, content):
    client, base = chapter
    resp = await client.post(f"{base}/chat/stream", json={"content": content})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_chat_is_for_chapters_only(authed_client):
    client, project_id = authed_client
    note = (await client.post(f"/projects/{project_id}/documents", json={"kind": "note"})).json()["id"]
    base = f"/projects/{project_id}/documents/{note}"
    assert (await client.get(f"{base}/chat")).status_code == 400
    assert (await client.post(f"{base}/chat/stream", json={"content": "Hi."})).status_code == 400


@pytest.mark.asyncio
async def test_deleting_a_chapter_deletes_its_chat(chapter, db):
    client, base = chapter
    await _send(client, base, "Hi.", TextDelta("Hello."))
    assert (await client.delete(base)).status_code == 204
    remaining = (await db.execute(select(func.count()).select_from(ChatMessage))).scalar_one()
    assert remaining == 0


# ---------------------------------------------------------------------------
# Specialist review passes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_agent_catalogue_is_served_to_the_picker(authed_client):
    client, _ = authed_client
    resp = await client.get("/agents")
    assert resp.status_code == 200
    assert {"key": "continuity", "label": "Continuity check"}.items() <= resp.json()[0].items()
    assert resp.json()[0]["hint"]


@pytest.mark.asyncio
async def test_a_review_pass_is_a_turn_labelled_with_its_agent(chapter):
    client, base = chapter
    seen = []
    resp, frames = await _review(
        client, base, TextDelta("Two problems."), ProposalReady(_suggestions()), seen=seen
    )
    assert resp.status_code == 200

    reviewer, state = seen[0]
    assert reviewer.key == "continuity"
    assert state["draft"] == BODY

    user, assistant = frames[-1]["messages"]
    # The writer's turn reads as the pass they ran, not as an empty message.
    assert user["content"] == "Check this chapter for continuity problems."
    assert user["agent"] == "continuity" and assistant["agent"] == "continuity"
    assert assistant["content"] == "Two problems."
    assert [s["find"] for s in assistant["proposal"]["suggestions"]] == ["stood", "gates"]
    assert assistant["proposal"]["base_hash"] == hashlib.sha256(BODY.encode()).hexdigest()
    # An unreviewed set has no proposal-level outcome; each fix carries its own.
    assert "outcome" not in assistant["proposal"]
    assert all(s["outcome"] is None for s in assistant["proposal"]["suggestions"])

    # Nothing is applied until the writer accepts a fix in the editor.
    assert (await client.get(base)).json()["body"] == BODY


@pytest.mark.asyncio
async def test_a_typed_message_carries_no_agent(chapter):
    client, base = chapter
    _, frames = await _send(client, base, "Draft it.", TextDelta("Here."))
    assert all(m["agent"] is None for m in frames[-1]["messages"])


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{"agent": "vibes"}, {}, {"content": None}])
async def test_an_unknown_agent_or_an_empty_turn_is_refused(chapter, body):
    client, base = chapter
    assert (await client.post(f"{base}/chat/stream", json=body)).status_code == 422


@pytest.mark.asyncio
async def test_one_fix_resolves_without_touching_the_others(chapter):
    client, base = chapter
    message_id = await _pending_set(client, base)

    resp = await client.post(
        f"{base}/chat/messages/{message_id}/outcome", json={"outcome": "accepted", "indexes": [0]}
    )
    assert resp.status_code == 200
    outcomes = [s["outcome"] for s in resp.json()["proposal"]["suggestions"]]
    assert outcomes == ["accepted", None]


@pytest.mark.asyncio
async def test_the_chat_waits_until_every_fix_is_reviewed(chapter):
    client, base = chapter
    message_id = await _pending_set(client, base)
    await client.post(
        f"{base}/chat/messages/{message_id}/outcome", json={"outcome": "accepted", "indexes": [0]}
    )

    blocked, _ = await _send(client, base, "Anything else?", TextDelta("No."))
    assert blocked.status_code == 409

    # Discard all: no indexes means every fix still unreviewed.
    await client.post(f"{base}/chat/messages/{message_id}/outcome", json={"outcome": "discarded"})
    allowed, _ = await _send(client, base, "Anything else?", TextDelta("No."))
    assert allowed.status_code == 200


@pytest.mark.asyncio
async def test_omitting_the_indexes_leaves_already_reviewed_fixes_alone(chapter):
    client, base = chapter
    message_id = await _pending_set(client, base)
    url = f"{base}/chat/messages/{message_id}/outcome"
    await client.post(url, json={"outcome": "accepted", "indexes": [1]})
    resp = await client.post(url, json={"outcome": "discarded"})
    assert [s["outcome"] for s in resp.json()["proposal"]["suggestions"]] == ["discarded", "accepted"]


@pytest.mark.asyncio
async def test_a_fix_is_resolved_once(chapter):
    client, base = chapter
    message_id = await _pending_set(client, base)
    url = f"{base}/chat/messages/{message_id}/outcome"
    await client.post(url, json={"outcome": "accepted", "indexes": [0]})
    resp = await client.post(url, json={"outcome": "discarded", "indexes": [0]})
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_an_index_outside_the_set_is_refused(chapter):
    client, base = chapter
    message_id = await _pending_set(client, base)
    resp = await client.post(
        f"{base}/chat/messages/{message_id}/outcome", json={"outcome": "accepted", "indexes": [7]}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_the_next_turn_tells_the_model_which_fixes_the_writer_took(chapter):
    client, base = chapter
    message_id = await _pending_set(client, base)
    url = f"{base}/chat/messages/{message_id}/outcome"
    await client.post(url, json={"outcome": "accepted", "indexes": [0]})
    await client.post(url, json={"outcome": "discarded", "indexes": [1]})

    seen = []
    await _send(client, base, "Anything else?", TextDelta("No."), seen=seen)
    history = seen[0]["history"]
    assert history[-1]["proposal"]["suggestions"][0]["outcome"] == "accepted"
    assert history[-1]["proposal"]["suggestions"][1]["outcome"] == "discarded"
