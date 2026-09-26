"""The story so far: the running record of the chapters before the window.

Held per chapter because it is a prefix. The digest read while revising chapter
6 must not contain chapter 30, which is the whole reason it is not one row per
project.
"""

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

from tests.conftest import MODEL_KEY, stub_usage


@pytest_asyncio.fixture
async def project(db):
    from backend.db_models import Project, User

    user = User(email="digest@test.com", hashed_password="x")
    db.add(user)
    await db.flush()
    project = Project(user_id=user.id, name="P")
    db.add(project)
    await db.commit()
    return project


def _usage():
    from types import SimpleNamespace

    return stub_usage(SimpleNamespace()).usage


def _ignore(_usage) -> None:
    """Usage sink for the tests that are about the digest, not spend."""


async def _chapter(db, project_id, position, body, **kw):
    from backend.db_models import Document
    from backend.doc_storage import body_hash

    doc = Document(
        project_id=project_id,
        title=f"Ch {position}",
        kind="chapter",
        body=body,
        position=position,
        summary=kw.pop("summary", f"summary of {position}"),
        summary_hash=kw.pop("summary_hash", body_hash(body)),
        **kw,
    )
    db.add(doc)
    await db.commit()
    return doc


@pytest_asyncio.fixture
async def folded(db, project):
    """Chapters 1–3 behind a chapter that reads them, all summarized."""
    older = [await _chapter(db, project.id, i, f"Body {i}.") for i in (1, 2, 3)]
    current = await _chapter(db, project.id, 9, "", summary=None, summary_hash=None)
    return older, current


# ---------------------------------------------------------------------------
# Folding
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_first_digest_is_written_from_every_summary_at_once(db, folded):
    from backend.context import ensure_digest

    older, current = folded
    write = AsyncMock(return_value=("RECORD", _usage()))
    with patch("backend.context.write_digest", new=write):
        assert await ensure_digest(db, current, older, MODEL_KEY, _ignore) == "RECORD"

    assert write.await_count == 1
    assert [title for title, _ in write.await_args.args[0]] == ["Ch 1", "Ch 2", "Ch 3"]


@pytest.mark.asyncio
async def test_a_current_digest_costs_nothing(db, folded):
    from backend.context import ensure_digest

    older, current = folded
    with patch("backend.context.write_digest", new=AsyncMock(return_value=("RECORD", _usage()))):
        await ensure_digest(db, current, older, MODEL_KEY, _ignore)

    write = AsyncMock()
    fold = AsyncMock()
    with (
        patch("backend.context.write_digest", new=write),
        patch("backend.context.fold_digest", new=fold),
    ):
        assert await ensure_digest(db, current, older, MODEL_KEY, _ignore) == "RECORD"
    write.assert_not_awaited()
    fold.assert_not_awaited()


@pytest.mark.asyncio
async def test_one_more_chapter_is_folded_in_rather_than_rebuilt(db, project, folded):
    """Writing forward is the common path, and it is one call per chapter in
    that chapter's life."""
    from backend.context import ensure_digest

    older, current = folded
    with patch("backend.context.write_digest", new=AsyncMock(return_value=("RECORD", _usage()))):
        await ensure_digest(db, current, older, MODEL_KEY, _ignore)

    older.append(await _chapter(db, project.id, 4, "Body 4."))
    fold = AsyncMock(return_value=("RECORD+4", _usage()))
    write = AsyncMock()
    with (
        patch("backend.context.fold_digest", new=fold),
        patch("backend.context.write_digest", new=write),
    ):
        assert await ensure_digest(db, current, older, MODEL_KEY, _ignore) == "RECORD+4"

    assert fold.await_count == 1
    assert fold.await_args.args[:3] == ("RECORD", "Ch 4", "summary of 4")
    write.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_edited_earlier_chapter_rebuilds_in_a_single_call(db, folded):
    """A changed chapter cannot be folded onto, but rebuilding is one call over
    the stored summaries — not one per chapter."""
    from backend.context import ensure_digest

    older, current = folded
    with patch("backend.context.write_digest", new=AsyncMock(return_value=("RECORD", _usage()))):
        await ensure_digest(db, current, older, MODEL_KEY, _ignore)

    older[0].summary = "rewritten"
    older[0].summary_hash = "different"
    await db.commit()

    write = AsyncMock(return_value=("REBUILT", _usage()))
    fold = AsyncMock()
    with (
        patch("backend.context.write_digest", new=write),
        patch("backend.context.fold_digest", new=fold),
    ):
        assert await ensure_digest(db, current, older, MODEL_KEY, _ignore) == "REBUILT"
    assert write.await_count == 1
    fold.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_digest_the_writer_wrote_is_never_regenerated(db, project, folded):
    from backend.context import ensure_digest
    from backend.doc_storage import set_digest

    older, current = folded
    set_digest(current, "Mine: Elena is left-handed.")
    await db.commit()

    older.append(await _chapter(db, project.id, 4, "Body 4."))
    write, fold = AsyncMock(), AsyncMock()
    with (
        patch("backend.context.write_digest", new=write),
        patch("backend.context.fold_digest", new=fold),
    ):
        assert await ensure_digest(db, current, older, MODEL_KEY, _ignore) == (
            "Mine: Elena is left-handed."
        )
    write.assert_not_awaited()
    fold.assert_not_awaited()


@pytest.mark.asyncio
async def test_every_digest_call_is_reported_as_spend(db, folded):
    from backend.context import ensure_digest

    older, current = folded
    seen = []
    with patch("backend.context.write_digest", new=AsyncMock(return_value=("RECORD", _usage()))):
        await ensure_digest(db, current, older, MODEL_KEY, seen.append)
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_the_digest_belongs_to_the_chapter_that_reads_it(db, project, summaries_mode):
    """Revising chapter 6 of a long book must not hand the model chapter 30.
    A project-level digest could not tell the two requests apart."""
    from backend.context import build_chapter_state

    chapters = [await _chapter(db, project.id, i, f"Body {i}.") for i in range(1, 14)]
    early, late = chapters[7], chapters[-1]  # positions 8 and 13

    seen = []

    async def record(summaries, model_key):
        seen.append([title for title, _ in summaries])
        return "RECORD", _usage()

    with patch("backend.context.write_digest", new=record):
        await build_chapter_state(db, late, MODEL_KEY, _ignore, confirmed=True)
        await build_chapter_state(db, early, MODEL_KEY, _ignore, confirmed=True)

    # Chapter 13 folds everything up to its own window; chapter 8 folds only
    # what precedes it, and never a chapter that comes after.
    assert seen[0] == [f"Ch {i}" for i in range(1, 8)]
    assert seen[1] == ["Ch 1", "Ch 2"]


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def long_project(authed_client):
    """Eight written chapters and a ninth being written, so three sit behind
    the window and belong in the digest."""
    client, project_id = authed_client
    ids = []
    for i in range(1, 10):
        doc_id = (
            await client.post(f"/projects/{project_id}/documents", json={"title": f"Ch {i}"})
        ).json()["id"]
        if i < 9:
            await client.patch(
                f"/projects/{project_id}/documents/{doc_id}", json={"body": f"Chapter {i} prose."}
            )
        ids.append(doc_id)
    return client, project_id, ids


@pytest.mark.asyncio
async def test_the_context_line_names_the_digest_and_what_it_covers(
    long_project, summaries_mode
):
    client, project_id, ids = long_project
    resp = await client.get(f"/projects/{project_id}/documents/{ids[-1]}/summary-context")

    body = resp.json()
    assert body["mode"] == "summaries"
    assert [p["title"] for p in body["previous"]] == ["Ch 4", "Ch 5", "Ch 6", "Ch 7", "Ch 8"]
    assert body["digest"]["covers"] == ["Ch 1", "Ch 2", "Ch 3"]
    assert body["digest"]["status"] == "missing"


@pytest.mark.asyncio
async def test_the_writer_can_correct_the_digest(long_project, summaries_mode):
    client, project_id, ids = long_project
    resp = await client.patch(
        f"/projects/{project_id}/documents/{ids[-1]}",
        json={"digest": "Elena is left-handed. Teodor owes the House."},
    )
    assert resp.status_code == 200
    assert resp.json()["digest"] == "Elena is left-handed. Teodor owes the House."

    context = (
        await client.get(f"/projects/{project_id}/documents/{ids[-1]}/summary-context")
    ).json()
    assert context["digest"]["status"] == "edited"


@pytest.mark.asyncio
async def test_building_the_digest_summarizes_what_it_needs_and_reports_the_cost(
    long_project, summaries_mode
):
    """The one route allowed to run a large backfill: the writer asked for it
    here, having been told how many chapters it covers."""
    client, project_id, ids = long_project

    with (
        patch(
            "backend.context.summarize_node",
            new=AsyncMock(return_value=("a summary", _usage())),
        ),
        patch("backend.context.write_digest", new=AsyncMock(return_value=("RECORD", _usage()))),
    ):
        resp = await client.post(f"/projects/{project_id}/documents/{ids[-1]}/story-so-far")

    assert resp.status_code == 200
    assert resp.json()["digest"] == "RECORD"
    assert resp.json()["digest_status"] == "current"
    assert resp.json()["usage"]["spent_usd"] > 0


@pytest.mark.asyncio
async def test_a_chapter_with_nothing_behind_the_window_has_no_digest_to_build(authed_client):
    client, project_id = authed_client
    doc_id = (await client.post(f"/projects/{project_id}/documents", json={})).json()["id"]
    resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/story-so-far")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_a_generation_refuses_a_large_backfill_instead_of_billing_it(
    long_project, summaries_mode, sample_scene_plan
):
    """Eight unsummarized chapters inside a first Generate plan is eight model
    calls the writer never asked for."""
    client, project_id, ids = long_project

    with patch(
        "backend.context.summarize_node", new=AsyncMock(return_value=("a summary", _usage()))
    ):
        resp = await client.post(f"/projects/{project_id}/documents/{ids[-1]}/plan")

    assert resp.status_code == 409
    assert "Story so far" in resp.json()["detail"]
