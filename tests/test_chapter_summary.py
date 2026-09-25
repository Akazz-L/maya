"""The writer's view of what the AI remembers: a chapter's summary, its
freshness, and the writer's right to correct it.

A summary the writer has edited is theirs. Nothing regenerates it behind their
back, because a corrected continuity fact is the whole point of showing it.
"""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch

from tests.conftest import MODEL_KEY, stub_usage


@pytest_asyncio.fixture
async def project(db):
    from backend.db_models import Project, User

    user = User(email="sum@test.com", hashed_password="x")
    db.add(user)
    await db.flush()
    project = Project(user_id=user.id, name="P")
    db.add(project)
    await db.commit()
    return project


async def _chapter(db, project_id, position, body, **kw):
    from backend.db_models import Document

    doc = Document(
        project_id=project_id,
        title=f"Ch {position}",
        kind="chapter",
        body=body,
        position=position,
        **kw,
    )
    db.add(doc)
    await db.commit()
    return doc


def _usage():
    from types import SimpleNamespace

    return stub_usage(SimpleNamespace()).usage


def _ignore(_usage) -> None:
    """Usage sink for the tests that are about summaries, not spend."""


# ---------------------------------------------------------------------------
# Status derivation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_empty_chapter_has_no_summary_to_show(db, project):
    from backend.doc_storage import summary_status

    assert summary_status(await _chapter(db, project.id, 1, "")) == "empty"


@pytest.mark.asyncio
async def test_a_written_chapter_starts_unsummarized(db, project):
    from backend.doc_storage import summary_status

    assert summary_status(await _chapter(db, project.id, 1, "Prose.")) == "missing"


@pytest.mark.asyncio
async def test_a_summary_of_the_current_body_is_current(db, project):
    from backend.doc_storage import body_hash, summary_status

    doc = await _chapter(
        db, project.id, 1, "Prose.", summary="s", summary_hash=body_hash("Prose.")
    )
    assert summary_status(doc) == "current"


@pytest.mark.asyncio
async def test_a_summary_of_an_older_body_is_stale(db, project):
    from backend.doc_storage import summary_status

    doc = await _chapter(db, project.id, 1, "Prose.", summary="s", summary_hash="old")
    assert summary_status(doc) == "stale"


@pytest.mark.asyncio
async def test_an_edited_summary_is_marked_as_the_writers(db, project):
    from backend.doc_storage import body_hash, summary_status

    doc = await _chapter(
        db,
        project.id,
        1,
        "Prose.",
        summary="mine",
        summary_hash=body_hash("Prose."),
        summary_edited=True,
    )
    assert summary_status(doc) == "edited"


@pytest.mark.asyncio
async def test_an_edited_summary_whose_chapter_moved_on_says_so(db, project):
    from backend.doc_storage import summary_status

    doc = await _chapter(
        db, project.id, 1, "Prose.", summary="mine", summary_hash="old", summary_edited=True
    )
    assert summary_status(doc) == "edited_stale"


# ---------------------------------------------------------------------------
# Saving a summary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_saving_a_summary_marks_it_edited_against_the_current_body(db, project):
    from backend.doc_storage import body_hash, summary_status, update_document

    doc = await _chapter(db, project.id, 1, "Prose.")
    await update_document(db, doc, summary="Elena is left-handed.")
    assert (doc.summary, doc.summary_edited) == ("Elena is left-handed.", True)
    assert doc.summary_hash == body_hash("Prose.")
    assert summary_status(doc) == "edited"


@pytest.mark.asyncio
async def test_clearing_a_summary_hands_it_back_to_the_summarizer(db, project):
    from backend.doc_storage import summary_status, update_document

    doc = await _chapter(db, project.id, 1, "Prose.")
    await update_document(db, doc, summary="mine")
    await update_document(db, doc, summary="   ")
    assert (doc.summary, doc.summary_edited, doc.summary_hash) == (None, False, None)
    assert summary_status(doc) == "missing"


@pytest.mark.asyncio
async def test_editing_the_chapter_keeps_the_writers_summary(db, project):
    """The body changing makes an edited summary questionable, not wrong. It
    stays until the writer says otherwise."""
    from backend.doc_storage import summary_status, update_document

    doc = await _chapter(db, project.id, 1, "Prose.")
    await update_document(db, doc, summary="mine")
    await update_document(db, doc, body="Rewritten prose.")
    assert (doc.summary, doc.summary_edited) == ("mine", True)
    assert summary_status(doc) == "edited_stale"


@pytest.mark.asyncio
async def test_a_summary_saved_with_a_body_describes_that_body(db, project):
    from backend.doc_storage import body_hash, summary_status, update_document

    doc = await _chapter(db, project.id, 1, "Prose.")
    await update_document(db, doc, body="New prose.", summary="mine")
    assert doc.summary_hash == body_hash("New prose.")
    assert summary_status(doc) == "edited"


# ---------------------------------------------------------------------------
# What the agents read
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_summaries_carry_their_chapter_title(db, project):
    """The prompts number chapters from the window's start, which is wrong once
    the window slides. Titles are what the writer sees in the sidebar."""
    from backend.context import build_previous_summaries
    from backend.doc_storage import body_hash

    await _chapter(db, project.id, 1, "A.", summary="sa", summary_hash=body_hash("A."))
    await _chapter(db, project.id, 2, "B.", summary="sb", summary_hash=body_hash("B."))

    assert await build_previous_summaries(db, project.id, 3, MODEL_KEY, _ignore) == [
        ("Ch 1", "sa"),
        ("Ch 2", "sb"),
    ]


@pytest.mark.asyncio
async def test_an_edited_summary_is_never_regenerated(db, project):
    from backend.context import build_previous_summaries

    await _chapter(
        db, project.id, 1, "Prose.", summary="mine", summary_hash="old", summary_edited=True
    )

    mock = AsyncMock(return_value=("fresh", _usage()))
    with patch("backend.context.summarize_node", new=mock):
        result = await build_previous_summaries(db, project.id, 2, MODEL_KEY, _ignore)
    assert result == [("Ch 1", "mine")]
    mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_prior_chapters_are_reported_without_summarizing(db, project):
    """The Write view names the chapters the AI will read. Merely looking at
    that list must not spend anything."""
    from backend.context import prior_chapter_documents

    await _chapter(db, project.id, 1, "A.")
    await _chapter(db, project.id, 2, "")  # never summarized
    await _chapter(db, project.id, 3, "C.")

    documents = await prior_chapter_documents(db, project.id, 4)
    assert [d.title for d in documents] == ["Ch 1", "Ch 3"]


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def chapter(authed_client):
    client, project_id = authed_client
    doc_id = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Ch 1"})
    ).json()["id"]
    await client.patch(
        f"/projects/{project_id}/documents/{doc_id}", json={"body": "Elena left home."}
    )
    return client, project_id, doc_id


@pytest.mark.asyncio
async def test_detail_carries_the_summary_and_its_status(chapter):
    client, project_id, doc_id = chapter
    detail = (await client.get(f"/projects/{project_id}/documents/{doc_id}")).json()
    assert detail["summary"] is None
    assert detail["summary_status"] == "missing"


@pytest.mark.asyncio
async def test_patching_a_summary_round_trips_as_edited(chapter):
    client, project_id, doc_id = chapter
    resp = await client.patch(
        f"/projects/{project_id}/documents/{doc_id}", json={"summary": "Elena left home."}
    )
    assert resp.status_code == 200
    assert resp.json()["summary"] == "Elena left home."
    assert resp.json()["summary_status"] == "edited"


@pytest.mark.asyncio
async def test_summarize_now_writes_a_summary_and_reports_its_cost(chapter):
    client, project_id, doc_id = chapter
    with patch(
        "backend.routes.generate.summarize_node",
        new=AsyncMock(return_value=("Elena departed.", _usage())),
    ):
        resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/summary")
    assert resp.status_code == 200
    assert resp.json()["summary"] == "Elena departed."
    assert resp.json()["summary_status"] == "current"
    assert resp.json()["usage"]["spent_usd"] > 0


@pytest.mark.asyncio
async def test_regenerating_replaces_the_writers_own_summary(chapter):
    client, project_id, doc_id = chapter
    await client.patch(f"/projects/{project_id}/documents/{doc_id}", json={"summary": "mine"})

    with patch(
        "backend.routes.generate.summarize_node",
        new=AsyncMock(return_value=("Elena departed.", _usage())),
    ):
        resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/summary")
    assert resp.json()["summary"] == "Elena departed."
    assert resp.json()["summary_status"] == "current"


@pytest.mark.asyncio
async def test_summarizing_an_empty_chapter_is_refused(authed_client):
    client, project_id = authed_client
    doc_id = (await client.post(f"/projects/{project_id}/documents", json={})).json()["id"]
    resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/summary")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_the_write_view_can_list_what_the_ai_reads(chapter):
    client, project_id, doc_id = chapter
    later = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Ch 2"})
    ).json()["id"]

    resp = await client.get(f"/projects/{project_id}/documents/{later}/summary-context")
    assert resp.status_code == 200
    assert resp.json()["previous"] == [
        {"id": doc_id, "title": "Ch 1", "summary_status": "missing"}
    ]
