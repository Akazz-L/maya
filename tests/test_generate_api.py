import json
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

from backend.agents.rewriter import RewriteTruncatedError
from backend.llm import Usage


def _parse_sse(text: str) -> list[dict]:
    return [
        json.loads(chunk.replace("data: ", ""))
        for chunk in text.split("\n\n")
        if chunk.strip()
    ]


@pytest_asyncio.fixture
async def chapter(authed_client):
    """(client, project_id, document_id) for a chapter with a brief."""
    client, project_id = authed_client
    doc_id = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Chapter 1"})
    ).json()["id"]
    await client.patch(
        f"/projects/{project_id}/documents/{doc_id}",
        json={"brief": "Elena reaches the gates."},
    )
    return client, project_id, doc_id


@pytest.mark.asyncio
async def test_generate_plan_persists_to_the_document(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter
    with patch(
        "backend.routes.generate.planner_node",
        new=AsyncMock(return_value={"scene_plan": sample_scene_plan, "usage": Usage()}),
    ):
        resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")
    assert resp.status_code == 200
    assert resp.json()["plan"]["pov_character"] == "Elena"

    doc = (await client.get(f"/projects/{project_id}/documents/{doc_id}")).json()
    assert doc["plan"]["pov_character"] == "Elena"


@pytest.mark.asyncio
async def test_plan_uses_the_document_brief_not_an_outline(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter
    mock = AsyncMock(return_value={"scene_plan": sample_scene_plan, "usage": Usage()})
    with patch("backend.routes.generate.planner_node", new=mock):
        await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")
    assert mock.call_args.args[0]["brief"] == "Elena reaches the gates."


@pytest.mark.asyncio
async def test_plan_works_on_a_chapter_without_notes(authed_client, sample_scene_plan):
    client, project_id = authed_client
    doc_id = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Chapter 1"})
    ).json()["id"]
    mock = AsyncMock(return_value={"scene_plan": sample_scene_plan, "usage": Usage()})
    with patch("backend.routes.generate.planner_node", new=mock):
        resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")
    assert resp.status_code == 200
    assert mock.call_args.args[0]["brief"] == ""


@pytest.mark.asyncio
async def test_plan_passes_the_bible_document_body(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter
    bible_id = (await client.get(f"/projects/{project_id}/documents")).json()[0]["id"]
    await client.patch(
        f"/projects/{project_id}/documents/{bible_id}", json={"body": "## Characters\n\n### Elena"}
    )

    mock = AsyncMock(return_value={"scene_plan": sample_scene_plan, "usage": Usage()})
    with patch("backend.routes.generate.planner_node", new=mock):
        await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")
    assert "### Elena" in mock.call_args.args[0]["story_bible"]


@pytest.mark.asyncio
async def test_plan_on_a_note_returns_400(authed_client):
    client, project_id = authed_client
    note = (
        await client.post(f"/projects/{project_id}/documents", json={"kind": "note"})
    ).json()["id"]
    resp = await client.post(f"/projects/{project_id}/documents/{note}/plan")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_the_draft_route_is_gone(chapter, sample_scene_plan):
    """Drafting goes through the chapter chat now; nothing plans behind the writer's back."""
    client, project_id, doc_id = chapter
    resp = await client.post(
        f"/projects/{project_id}/documents/{doc_id}/draft/stream", json={"plan": sample_scene_plan}
    )
    assert resp.status_code in (404, 405)


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["check", "revise/stream"])
async def test_the_check_and_revise_routes_are_gone(chapter, path):
    """Continuity findings are chat proposals reviewed fix by fix in the prose;
    nothing rewrites a whole chapter from a list of issues any more."""
    client, project_id, doc_id = chapter
    resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/{path}")
    assert resp.status_code in (404, 405)


@pytest.mark.asyncio
async def test_generation_uses_preceding_chapter_summaries(chapter, sample_scene_plan, summaries_mode):
    client, project_id, doc_id = chapter
    # A chapter before this one, with prose to summarize.
    earlier = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Chapter 0"})
    ).json()["id"]
    await client.patch(
        f"/projects/{project_id}/documents/{earlier}", json={"body": "Elena left home."}
    )
    await client.put(
        f"/projects/{project_id}/documents/order",
        json={
            "document_ids": [
                (await client.get(f"/projects/{project_id}/documents")).json()[0]["id"],
                earlier,
                doc_id,
            ]
        },
    )

    planner = AsyncMock(return_value={"scene_plan": sample_scene_plan, "usage": Usage()})
    with (
        patch("backend.context.summarize_node", new=AsyncMock(return_value=("Elena departed.", Usage()))),
        patch("backend.routes.generate.planner_node", new=planner),
    ):
        await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")

    assert planner.call_args.args[0]["previous_summaries"] == [("Chapter 0", "Elena departed.")]


@pytest.mark.asyncio
async def test_a_short_project_is_planned_from_the_chapters_themselves(chapter, sample_scene_plan):
    """Under the prose budget nothing is summarized: compressing two short
    chapters costs a model call each and loses what they actually say."""
    client, project_id, doc_id = chapter
    earlier = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Chapter 0"})
    ).json()["id"]
    await client.patch(
        f"/projects/{project_id}/documents/{earlier}", json={"body": "Elena left home."}
    )
    await client.put(
        f"/projects/{project_id}/documents/order",
        json={
            "document_ids": [
                (await client.get(f"/projects/{project_id}/documents")).json()[0]["id"],
                earlier,
                doc_id,
            ]
        },
    )

    planner = AsyncMock(return_value={"scene_plan": sample_scene_plan, "usage": Usage()})
    summarizer = AsyncMock(return_value=("Elena departed.", Usage()))
    with (
        patch("backend.context.summarize_node", new=summarizer),
        patch("backend.routes.generate.planner_node", new=planner),
    ):
        await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")

    state = planner.call_args.args[0]
    assert state["previous_prose"] == [("Chapter 0", "Elena left home.")]
    assert state["previous_summaries"] == []
    summarizer.assert_not_awaited()


@pytest.mark.asyncio
async def test_rewrite_stream_returns_the_replacement_without_persisting(chapter):
    client, project_id, doc_id = chapter
    await client.patch(
        f"/projects/{project_id}/documents/{doc_id}",
        json={"body": "The hall was empty. She waited by the door. A clock ticked."},
    )

    async def fake_stream(state, model_key, on_usage):
        for text in ["She ", "froze."]:
            yield text

    with patch("backend.routes.generate.rewriter_token_stream", new=fake_stream):
        resp = await client.post(
            f"/projects/{project_id}/documents/{doc_id}/rewrite/stream",
            json={
                "instruction": "more tense",
                "selection": "She waited by the door.",
                "before": "The hall was empty. ",
                "after": " A clock ticked.",
            },
        )
    frames = _parse_sse(resp.text)
    assert [f["text"] for f in frames if f["type"] == "delta"] == ["She ", "froze."]
    assert next(f for f in frames if f["type"] == "done")["body"] == "She froze."

    doc = (await client.get(f"/projects/{project_id}/documents/{doc_id}")).json()
    assert doc["body"] == "The hall was empty. She waited by the door. A clock ticked."


@pytest.mark.asyncio
async def test_rewrite_stream_passes_the_bible_and_the_request_fields(chapter):
    client, project_id, doc_id = chapter
    bible_id = (await client.get(f"/projects/{project_id}/documents")).json()[0]["id"]
    await client.patch(
        f"/projects/{project_id}/documents/{bible_id}", json={"body": "## Style\n\nVoice: terse"}
    )
    seen = {}

    async def fake_stream(state, model_key, on_usage):
        seen.update(state)
        yield "x"

    with patch("backend.routes.generate.rewriter_token_stream", new=fake_stream):
        await client.post(
            f"/projects/{project_id}/documents/{doc_id}/rewrite/stream",
            json={"instruction": "tighten", "selection": "Some prose."},
        )
    assert "Voice: terse" in seen["story_bible"]
    assert seen["instruction"] == "tighten"
    assert seen["selection"] == "Some prose."
    assert seen["before"] == ""
    assert seen["after"] == ""


@pytest.mark.asyncio
async def test_rewrite_stream_emits_an_error_frame(chapter):
    client, project_id, doc_id = chapter

    async def boom(state, model_key, on_usage):
        raise RuntimeError("model exploded")
        yield  # pragma: no cover — makes this an async generator

    with patch("backend.routes.generate.rewriter_token_stream", new=boom):
        resp = await client.post(
            f"/projects/{project_id}/documents/{doc_id}/rewrite/stream",
            json={"instruction": "tighten", "selection": "Some prose."},
        )
    error = next(f for f in _parse_sse(resp.text) if f["type"] == "error")
    assert "model exploded" in error["detail"]


@pytest.mark.asyncio
async def test_rewrite_stream_reports_a_truncated_reply_as_an_error(chapter):
    """A rewrite cut off at max_tokens must reach the client as an error, not as
    a half-finished replacement the writer could accept over their own prose."""
    client, project_id, doc_id = chapter
    body = "The hall was empty. She waited by the door. A clock ticked."
    await client.patch(f"/projects/{project_id}/documents/{doc_id}", json={"body": body})

    async def truncated(state, model_key, on_usage):
        yield "She froze and then"
        raise RewriteTruncatedError("cut off")

    with patch("backend.routes.generate.rewriter_token_stream", new=truncated):
        resp = await client.post(
            f"/projects/{project_id}/documents/{doc_id}/rewrite/stream",
            json={"instruction": "tighten", "selection": "She waited by the door."},
        )

    frames = _parse_sse(resp.text)
    assert [f["text"] for f in frames if f["type"] == "delta"] == ["She froze and then"]
    assert "cut off" in next(f for f in frames if f["type"] == "error")["detail"]
    assert not [f for f in frames if f["type"] == "done"]

    doc = (await client.get(f"/projects/{project_id}/documents/{doc_id}")).json()
    assert doc["body"] == body


@pytest.mark.asyncio
async def test_rewrite_stream_on_a_note_returns_400(authed_client):
    client, project_id = authed_client
    note = (
        await client.post(f"/projects/{project_id}/documents", json={"kind": "note"})
    ).json()["id"]
    resp = await client.post(
        f"/projects/{project_id}/documents/{note}/rewrite/stream",
        json={"instruction": "tighten", "selection": "Some prose."},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {"instruction": "", "selection": "Some prose."},
        {"instruction": "tighten", "selection": ""},
        {"instruction": "tighten"},
    ],
)
async def test_rewrite_stream_rejects_empty_input(chapter, body):
    client, project_id, doc_id = chapter
    resp = await client.post(
        f"/projects/{project_id}/documents/{doc_id}/rewrite/stream", json=body
    )
    assert resp.status_code == 422
