from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio


@pytest_asyncio.fixture
async def project(db):
    from backend.db_models import Project, User

    user = User(email="ctx@test.com", hashed_password="x")
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


@pytest.mark.asyncio
async def test_summarizes_preceding_chapters_in_order(db, project):
    from backend.context import build_previous_summaries

    await _chapter(db, project.id, 1, "First.")
    await _chapter(db, project.id, 2, "Second.")

    with patch("backend.context.summarize_node", new=AsyncMock(side_effect=lambda t: f"sum:{t}")):
        result = await build_previous_summaries(db, project.id, position=3)
    assert result == ["sum:First.", "sum:Second."]


@pytest.mark.asyncio
async def test_reuses_a_cached_summary(db, project):
    from backend.context import build_previous_summaries
    from backend.doc_storage import body_hash

    await _chapter(db, project.id, 1, "First.", summary="cached", summary_hash=body_hash("First."))

    mock = AsyncMock(side_effect=lambda t: "fresh")
    with patch("backend.context.summarize_node", new=mock):
        result = await build_previous_summaries(db, project.id, position=2)
    assert result == ["cached"]
    mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_stale_hash_triggers_resummarize(db, project):
    from backend.context import build_previous_summaries

    await _chapter(db, project.id, 1, "Edited body.", summary="old", summary_hash="deadbeef")

    with patch("backend.context.summarize_node", new=AsyncMock(return_value="fresh")):
        assert await build_previous_summaries(db, project.id, position=2) == ["fresh"]


@pytest.mark.asyncio
async def test_skips_notes_empty_bodies_and_later_chapters(db, project):
    from backend.context import build_previous_summaries
    from backend.db_models import Document

    await _chapter(db, project.id, 1, "")  # empty body
    db.add(Document(project_id=project.id, title="N", kind="note", body="Research.", position=2))
    await db.commit()
    await _chapter(db, project.id, 4, "Later.")  # after the target

    with patch("backend.context.summarize_node", new=AsyncMock(return_value="s")):
        assert await build_previous_summaries(db, project.id, position=3) == []


@pytest.mark.asyncio
async def test_caps_at_the_ten_nearest(db, project):
    from backend.context import MAX_PRIOR_CHAPTERS, build_previous_summaries

    for i in range(1, 15):
        await _chapter(db, project.id, i, f"Body {i}.")

    with patch("backend.context.summarize_node", new=AsyncMock(side_effect=lambda t: t)):
        result = await build_previous_summaries(db, project.id, position=15)
    assert len(result) == MAX_PRIOR_CHAPTERS
    assert result[0] == "Body 5."
    assert result[-1] == "Body 14."
