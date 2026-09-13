import hashlib
import json
from unittest.mock import patch

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from backend.agents.chat import ProposalProgress, ProposalReady, TextDelta
from backend.db_models import ChatMessage, UsageEvent
from backend.llm import Usage

BODY = "Elena stood at the gates."
DRAFT = {"kind": "write", "mode": "replace", "text": "Night fell.", "proposed_body": "Night fell."}


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
    assert "pending proposal" in resp.json()["detail"]


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
