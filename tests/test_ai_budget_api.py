import json
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select

from backend.db_models import UsageEvent, User
from backend.llm import Usage


def _parse_sse(text: str) -> list[dict]:
    return [
        json.loads(chunk.replace("data: ", ""))
        for chunk in text.split("\n\n")
        if chunk.strip()
    ]


@pytest_asyncio.fixture
async def chapter(authed_client):
    client, project_id = authed_client
    doc_id = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Chapter 1"})
    ).json()["id"]
    return client, project_id, doc_id


@pytest_asyncio.fixture
async def user(db):
    return (await db.execute(select(User).where(User.email == "test@example.com"))).scalar_one()


async def _spend(db, user, dollars):
    db.add(
        UsageEvent(
            user_id=user.id,
            model_key="haiku",
            operation="draft",
            cost_micro_usd=int(dollars * 1_000_000),
        )
    )
    await db.commit()


@pytest.fixture(autouse=True)
def budget(monkeypatch):
    monkeypatch.setenv("MONTHLY_BUDGET_USD", "5.00")


# ---------------------------------------------------------------------------
# GET / PATCH /me
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_me_starts_on_haiku_with_an_untouched_budget(authed_client):
    client, _ = authed_client
    me = (await client.get("/me")).json()
    assert me["email"] == "test@example.com"
    assert me["model_key"] == "haiku"
    assert me["usage"] == {
        "spent_usd": 0.0,
        "budget_usd": 5.0,
        "percent": 0.0,
        "blocked": False,
        "period_end": me["usage"]["period_end"],
    }


@pytest.mark.asyncio
async def test_me_serves_the_model_catalogue_for_the_picker(authed_client):
    client, _ = authed_client
    models = (await client.get("/me")).json()["models"]
    assert [m["key"] for m in models] == ["haiku", "sonnet", "opus"]
    assert all(m["label"] and m["hint"] for m in models)


@pytest.mark.asyncio
async def test_choosing_a_model_persists(authed_client):
    client, _ = authed_client
    resp = await client.patch("/me", json={"model_key": "opus"})
    assert resp.status_code == 200
    assert resp.json()["model_key"] == "opus"
    assert (await client.get("/me")).json()["model_key"] == "opus"


@pytest.mark.asyncio
async def test_an_unknown_model_is_refused(authed_client):
    client, _ = authed_client
    resp = await client.patch("/me", json={"model_key": "gpt-5"})
    assert resp.status_code == 422
    assert (await client.get("/me")).json()["model_key"] == "haiku"


@pytest.mark.asyncio
async def test_me_requires_auth(authed_client):
    client, _ = authed_client
    resp = await client.get("/me", headers={"Authorization": "Bearer nonsense"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# The chosen model reaches the agents
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generation_runs_on_the_model_the_writer_picked(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter
    await client.patch("/me", json={"model_key": "opus"})

    mock = AsyncMock(return_value={"scene_plan": sample_scene_plan, "usage": Usage()})
    with patch("backend.routes.generate.planner_node", new=mock):
        await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")
    assert mock.call_args.args[1] == "opus"


# ---------------------------------------------------------------------------
# Metering
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_plan_records_what_it_cost(chapter, sample_scene_plan, db, user):
    client, project_id, doc_id = chapter
    await client.patch("/me", json={"model_key": "opus"})

    usage = Usage(input_tokens=1_000_000, output_tokens=1_000_000)
    with patch(
        "backend.routes.generate.planner_node",
        new=AsyncMock(return_value={"scene_plan": sample_scene_plan, "usage": usage}),
    ):
        resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")

    event = (await db.execute(select(UsageEvent))).scalars().one()
    assert event.operation == "plan"
    assert event.model_key == "opus"
    assert event.cost_micro_usd == 30_000_000  # $5/MTok in + $25/MTok out
    # The response carries the fresh meter, so the editor updates without polling.
    assert resp.json()["usage"]["spent_usd"] == 30.0
    assert resp.json()["usage"]["blocked"] is True


@pytest.mark.asyncio
async def test_a_completed_draft_stream_reports_usage_in_its_done_frame(
    chapter, sample_scene_plan
):
    client, project_id, doc_id = chapter

    async def fake_stream(state, model_key, on_usage):
        yield "Prose."
        on_usage(Usage(input_tokens=1_000_000))

    with patch("backend.routes.generate.drafter_token_stream", new=fake_stream):
        resp = await client.post(
            f"/projects/{project_id}/documents/{doc_id}/draft/stream",
            json={"plan": sample_scene_plan},
        )
    done = next(f for f in _parse_sse(resp.text) if f["type"] == "done")
    assert done["usage"]["spent_usd"] == 1.0
    assert done["usage"]["percent"] == 20.0


@pytest.mark.asyncio
async def test_summarizer_calls_are_metered_too(chapter, sample_scene_plan, db, user):
    """They fire implicitly before a generation; unmetered they would be spend
    the writer never sees."""
    client, project_id, doc_id = chapter
    earlier = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Chapter 0"})
    ).json()["id"]
    await client.patch(
        f"/projects/{project_id}/documents/{earlier}", json={"body": "Elena left home."}
    )
    bible = (await client.get(f"/projects/{project_id}/documents")).json()[0]["id"]
    await client.put(
        f"/projects/{project_id}/documents/order",
        json={"document_ids": [bible, earlier, doc_id]},
    )

    with (
        patch(
            "backend.context.summarize_node",
            new=AsyncMock(return_value=("Elena departed.", Usage(input_tokens=1_000_000))),
        ),
        patch(
            "backend.routes.generate.planner_node",
            new=AsyncMock(return_value={"scene_plan": sample_scene_plan, "usage": Usage()}),
        ),
    ):
        await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")

    operations = sorted(
        e.operation for e in (await db.execute(select(UsageEvent))).scalars().all()
    )
    assert operations == ["plan", "summarize"]


# ---------------------------------------------------------------------------
# The budget gate
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path,body",
    [
        ("plan", None),
        ("check", None),
        ("draft/stream", {"plan": {}}),
        ("revise/stream", None),
        ("rewrite/stream", {"instruction": "tighten", "selection": "Some prose."}),
    ],
)
async def test_every_generation_route_refuses_once_the_budget_is_spent(
    chapter, db, user, path, body
):
    client, project_id, doc_id = chapter
    await _spend(db, user, 5.00)

    resp = await client.post(
        f"/projects/{project_id}/documents/{doc_id}/{path}", json=body
    )
    assert resp.status_code == 402
    assert "used up" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_a_blocked_stream_fails_as_a_status_not_an_error_frame(chapter, db, user):
    """The gate runs before the StreamingResponse exists, so the client sees a
    plain 402 body rather than an error frame inside a 200."""
    client, project_id, doc_id = chapter
    await _spend(db, user, 5.00)

    resp = await client.post(
        f"/projects/{project_id}/documents/{doc_id}/draft/stream", json={"plan": {}}
    )
    assert resp.status_code == 402
    assert "text/event-stream" not in resp.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_generation_still_runs_just_under_the_budget(chapter, sample_scene_plan, db, user):
    client, project_id, doc_id = chapter
    await _spend(db, user, 4.99)

    with patch(
        "backend.routes.generate.planner_node",
        new=AsyncMock(return_value={"scene_plan": sample_scene_plan, "usage": Usage()}),
    ):
        resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_a_per_user_override_lifts_the_cap(chapter, sample_scene_plan, db, user):
    client, project_id, doc_id = chapter
    await _spend(db, user, 5.00)
    user.monthly_budget_micro_usd = 20_000_000
    await db.commit()

    with patch(
        "backend.routes.generate.planner_node",
        new=AsyncMock(return_value={"scene_plan": sample_scene_plan, "usage": Usage()}),
    ):
        resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")
    assert resp.status_code == 200
    assert (await client.get("/me")).json()["usage"]["budget_usd"] == 20.0
