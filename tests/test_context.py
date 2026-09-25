"""What each agent is given of the story so far.

The policy under test: everything before the window is folded into one digest,
the window itself is summaries, the drafter also gets the previous chapter's
closing prose verbatim, and a short project skips all of it and sends the
chapters themselves.
"""

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

from tests.conftest import MODEL_KEY, stub_usage


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


def _usage():
    from types import SimpleNamespace

    return stub_usage(SimpleNamespace()).usage


def _ignore(_usage) -> None:
    """Usage sink for the tests that are about context, not spend."""


def _summarizer(prefix="sum:"):
    return AsyncMock(side_effect=lambda text, model: (f"{prefix}{text}", _usage()))


async def _state(db, document, **kw):
    from backend.context import build_chapter_state

    return await build_chapter_state(db, document, MODEL_KEY, _ignore, **kw)


# ---------------------------------------------------------------------------
# The window
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_window_is_the_nearest_chapters_by_title(db, project, summaries_mode):
    from backend.context import WINDOW, build_previous_window

    for i in range(1, 4):
        await _chapter(db, project.id, i, f"Body {i}.")
    assert WINDOW >= 3

    with patch("backend.context.summarize_node", new=_summarizer()):
        window = await build_previous_window(db, project.id, 4, MODEL_KEY, _ignore)
    assert window == [("Ch 1", "sum:Body 1."), ("Ch 2", "sum:Body 2."), ("Ch 3", "sum:Body 3.")]


@pytest.mark.asyncio
async def test_chapters_past_the_window_are_digested_not_dropped(db, project, summaries_mode):
    """The ten-chapter cap forgot the opening of a long book outright. Nothing
    is forgotten now: it moves into the digest."""
    from backend.context import WINDOW

    for i in range(1, WINDOW + 4):
        await _chapter(db, project.id, i, f"Body {i}.")
    current = await _chapter(db, project.id, WINDOW + 4, "")

    with (
        patch("backend.context.summarize_node", new=_summarizer()),
        patch("backend.context.write_digest", new=AsyncMock(return_value=("DIGEST", _usage()))),
    ):
        # confirmed: eight chapters arriving at once is the imported-novel case,
        # which the writer starts deliberately. Writing forward, one is stale.
        state = await _state(db, current, confirmed=True)

    assert state["digest"] == "DIGEST"
    assert [title for title, _ in state["previous_summaries"]] == [
        f"Ch {i}" for i in range(4, WINDOW + 4)
    ]


@pytest.mark.asyncio
async def test_a_short_history_needs_no_digest(db, project, summaries_mode):
    from backend.context import WINDOW

    for i in range(1, WINDOW + 1):
        await _chapter(db, project.id, i, f"Body {i}.")
    current = await _chapter(db, project.id, WINDOW + 1, "")

    digest = AsyncMock()
    with (
        patch("backend.context.summarize_node", new=_summarizer()),
        patch("backend.context.write_digest", new=digest),
    ):
        state = await _state(db, current)
    assert state["digest"] is None
    digest.assert_not_awaited()


# ---------------------------------------------------------------------------
# The voice sample
# ---------------------------------------------------------------------------


def test_the_voice_sample_takes_whole_paragraphs_from_the_end():
    from backend.context import closing_prose

    body = "First para.\n\n" + "\n\n".join(f"Para {i} " + "word " * 150 for i in range(3))
    sample = closing_prose(body, max_words=200)

    assert sample.startswith("Para 2")  # only the last paragraph fits
    assert "First para." not in sample
    assert not sample.endswith("word")  or sample.count("Para") == 1


def test_the_voice_sample_keeps_the_last_paragraph_whole_even_when_long():
    """A sample cut mid-sentence teaches the model to write that way."""
    from backend.context import closing_prose

    body = "Short one.\n\n" + "word " * 900
    sample = closing_prose(body, max_words=400)
    assert sample.startswith("word")
    assert "Short one." not in sample


def test_an_empty_chapter_has_no_voice_sample():
    from backend.context import closing_prose

    assert closing_prose("") == ""


@pytest.mark.asyncio
async def test_only_the_drafter_is_given_the_voice_sample(db, project, summaries_mode):
    """It exists to set prose voice. The planner writes no prose, and the
    review passes read the chapter itself."""
    await _chapter(db, project.id, 1, "It ended in rain.")
    current = await _chapter(db, project.id, 2, "")

    with patch("backend.context.summarize_node", new=_summarizer()):
        chat = await _state(db, current, for_agent="chat")
        plan = await _state(db, current, for_agent="plan")
        review = await _state(db, current, for_agent="review")

    assert chat["voice_sample"] == ("Ch 1", "It ended in rain.")
    assert plan["voice_sample"] is None
    assert review["voice_sample"] is None


# ---------------------------------------------------------------------------
# Prose mode
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_short_project_sends_the_chapters_and_summarizes_nothing(db, project):
    """Under the budget, compressing buys nothing and costs a call per chapter."""
    await _chapter(db, project.id, 1, "The rain stopped.")
    await _chapter(db, project.id, 2, "She left at dawn.")
    current = await _chapter(db, project.id, 3, "")

    summarizer = _summarizer()
    with patch("backend.context.summarize_node", new=summarizer):
        state = await _state(db, current)

    assert state["previous_prose"] == [("Ch 1", "The rain stopped."), ("Ch 2", "She left at dawn.")]
    assert state["previous_summaries"] == []
    assert state["digest"] is None
    summarizer.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_long_project_leaves_prose_mode(db, project):
    from backend.context import PROSE_BUDGET_TOKENS, prose_mode

    await _chapter(db, project.id, 1, "word " * int(PROSE_BUDGET_TOKENS))
    prior = await _chapter(db, project.id, 2, "short")
    from backend.context import prior_chapters

    assert not prose_mode(await prior_chapters(db, project.id, 3))
    assert prior is not None


# ---------------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reuses_a_cached_summary(db, project, summaries_mode):
    from backend.context import build_previous_window
    from backend.doc_storage import body_hash

    await _chapter(db, project.id, 1, "First.", summary="cached", summary_hash=body_hash("First."))

    summarizer = _summarizer()
    with patch("backend.context.summarize_node", new=summarizer):
        assert await build_previous_window(db, project.id, 2, MODEL_KEY, _ignore) == [
            ("Ch 1", "cached")
        ]
    summarizer.assert_not_awaited()


@pytest.mark.asyncio
async def test_stale_hash_triggers_resummarize(db, project, summaries_mode):
    from backend.context import build_previous_window

    await _chapter(db, project.id, 1, "Edited body.", summary="old", summary_hash="deadbeef")

    with patch("backend.context.summarize_node", new=AsyncMock(return_value=("fresh", _usage()))):
        assert await build_previous_window(db, project.id, 2, MODEL_KEY, _ignore) == [
            ("Ch 1", "fresh")
        ]


@pytest.mark.asyncio
async def test_skips_notes_empty_bodies_and_later_chapters(db, project, summaries_mode):
    from backend.context import build_previous_window
    from backend.db_models import Document

    await _chapter(db, project.id, 1, "")  # empty body
    db.add(Document(project_id=project.id, title="N", kind="note", body="Research.", position=2))
    await db.commit()
    await _chapter(db, project.id, 4, "Later.")  # after the target

    with patch("backend.context.summarize_node", new=AsyncMock(return_value=("s", _usage()))):
        assert await build_previous_window(db, project.id, 3, MODEL_KEY, _ignore) == []


@pytest.mark.asyncio
async def test_reports_usage_for_every_fresh_summary(db, project, summaries_mode):
    """Summarizer calls fire implicitly before a generation. Unmetered, they
    would be spend the writer never sees."""
    from backend.context import build_previous_window

    await _chapter(db, project.id, 1, "First.")
    await _chapter(db, project.id, 2, "Second.")

    seen = []
    with patch("backend.context.summarize_node", new=_summarizer()):
        await build_previous_window(db, project.id, 3, MODEL_KEY, seen.append)
    assert len(seen) == 2


@pytest.mark.asyncio
async def test_a_failed_summary_keeps_and_reports_the_ones_that_came_back(
    db, project, summaries_mode
):
    """Each summary that came back was a billed call. A sibling failing must
    not throw away its result or its cost."""
    from backend.context import build_previous_window

    first = await _chapter(db, project.id, 1, "First.")
    await _chapter(db, project.id, 2, "Second.")

    async def flaky(text, model_key):
        if text == "Second.":
            raise RuntimeError("overloaded")
        return f"sum:{text}", _usage()

    seen = []
    with patch("backend.context.summarize_node", new=flaky):
        with pytest.raises(RuntimeError, match="overloaded"):
            await build_previous_window(db, project.id, 3, MODEL_KEY, seen.append)
    assert len(seen) == 1

    # Discard anything uncommitted, so what is read back is what was stored.
    await db.rollback()
    await db.refresh(first)
    assert first.summary == "sum:First."


@pytest.mark.asyncio
async def test_a_large_backfill_is_refused_rather_than_billed(db, project, summaries_mode):
    """Importing a finished novel used to fire one call per chapter inside the
    writer's first request, before the budget check could see the bill."""
    from fastapi import HTTPException

    from backend.context import BACKFILL_CONFIRM_ABOVE, ensure_summaries, prior_chapters

    for i in range(1, BACKFILL_CONFIRM_ABOVE + 3):
        await _chapter(db, project.id, i, f"Body {i}.")
    prior = await prior_chapters(db, project.id, 99)

    summarizer = _summarizer()
    with patch("backend.context.summarize_node", new=summarizer):
        with pytest.raises(HTTPException) as exc:
            await ensure_summaries(db, prior, MODEL_KEY, _ignore)
    assert exc.value.status_code == 409
    assert str(len(prior)) in exc.value.detail
    summarizer.assert_not_awaited()

    # Asked for deliberately, it runs.
    with patch("backend.context.summarize_node", new=summarizer):
        await ensure_summaries(db, prior, MODEL_KEY, _ignore, confirmed=True)
    assert summarizer.await_count == len(prior)


@pytest.mark.asyncio
async def test_summarizing_runs_under_a_concurrency_limit(db, project, summaries_mode):
    """Unbounded, an import opened one connection per chapter at once."""
    import asyncio

    from backend.context import SUMMARIZE_CONCURRENCY, ensure_summaries, prior_chapters

    for i in range(1, 12):
        await _chapter(db, project.id, i, f"Body {i}.")
    prior = await prior_chapters(db, project.id, 99)

    peak = 0
    live = 0

    async def slow(text, model_key):
        nonlocal peak, live
        live += 1
        peak = max(peak, live)
        await asyncio.sleep(0)
        live -= 1
        return text, _usage()

    with patch("backend.context.summarize_node", new=slow):
        await ensure_summaries(db, prior, MODEL_KEY, _ignore, confirmed=True)
    assert peak <= SUMMARIZE_CONCURRENCY
