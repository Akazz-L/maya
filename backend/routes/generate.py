import uuid
from functools import partial

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.planner import planner_node
from backend.agents.rewriter import rewriter_token_stream
from backend.agents.summarizer import summarize_node
from backend.context import (
    WINDOW,
    build_chapter_state,
    ensure_digest,
    ensure_summaries,
    prior_chapters,
)
from backend.db import get_db
from backend.db_models import Project, User
from backend.doc_storage import get_bible_body, set_generated_summary, summary_status
from backend.routes.deps import require_chapter, require_project
from backend.routes.sse import SSE_HEADERS, sse
from backend.usage import Meter, require_ai_budget

router = APIRouter(prefix="/projects/{project_id}/documents/{document_id}", tags=["generate"])


class RewriteBody(BaseModel):
    instruction: str = Field(min_length=1, max_length=2000)
    selection: str = Field(min_length=1, max_length=20000)
    before: str = Field(default="", max_length=4000)
    after: str = Field(default="", max_length=4000)


@router.post("/plan")
async def generate_plan(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    user: User = Depends(require_ai_budget),
    db: AsyncSession = Depends(get_db),
):
    document = await require_chapter(db, project.id, document_id)
    meter = Meter(db, user, user.model_key)
    async with meter.flushed_on_error():
        state = await build_chapter_state(
            db,
            document,
            user.model_key,
            partial(meter.add, "summarize"),
            for_agent="plan",
        )
        result = await planner_node(state, user.model_key)
    meter.add("plan", result["usage"])
    document.plan = result["scene_plan"]
    await meter.flush()
    return {"plan": result["scene_plan"], "usage": (await meter.snapshot()).as_dict()}


@router.post("/summary")
async def generate_summary(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    user: User = Depends(require_ai_budget),
    db: AsyncSession = Depends(get_db),
):
    """Summarize this chapter now, replacing whatever summary it had.

    The implicit refresh in build_chapter_state covers the common case; this is
    the writer asking for one directly, from the Summary view — to fill one in
    before a generation pays for it, or to take back an edit of their own. It
    therefore overwrites an edited summary, which the UI confirms first.
    """
    document = await require_chapter(db, project.id, document_id)
    if not document.body:
        raise HTTPException(status_code=400, detail="An empty chapter has nothing to summarize")

    meter = Meter(db, user, user.model_key)
    async with meter.flushed_on_error():
        summary, usage = await summarize_node(document.body, user.model_key)
    meter.add("summarize", usage)
    set_generated_summary(document, summary)
    await meter.flush()
    return {
        "summary": document.summary,
        "summary_status": summary_status(document),
        "usage": (await meter.snapshot()).as_dict(),
    }


@router.post("/story-so-far")
async def rebuild_digest(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    user: User = Depends(require_ai_budget),
    db: AsyncSession = Depends(get_db),
):
    """Build this chapter's story-so-far now, summarizing whatever it needs.

    The one place a large backfill is allowed: every other route refuses one
    rather than spend a third of the month's budget inside a request the writer
    thought was about something else. Here they asked, having been told the
    number of chapters.
    """
    document = await require_chapter(db, project.id, document_id)
    prior = await prior_chapters(db, project.id, document.position)
    older = prior[:-WINDOW] if len(prior) > WINDOW else []
    if not older:
        raise HTTPException(
            status_code=400,
            detail="There are no chapters behind the recent ones to summarize yet.",
        )

    meter = Meter(db, user, user.model_key)
    async with meter.flushed_on_error():
        await ensure_summaries(
            db, prior, user.model_key, partial(meter.add, "summarize"), confirmed=True
        )
        # Force a rebuild: this route exists to be asked, including over an edit.
        document.digest_hash = None
        document.digest_edited = False
        text = await ensure_digest(
            db, document, older, user.model_key, partial(meter.add, "digest")
        )
    await meter.flush()
    return {
        "digest": text,
        "digest_status": "current",
        "usage": (await meter.snapshot()).as_dict(),
    }


@router.post("/rewrite/stream")
async def rewrite_stream(
    document_id: uuid.UUID,
    body: RewriteBody,
    project: Project = Depends(require_project),
    user: User = Depends(require_ai_budget),
    db: AsyncSession = Depends(get_db),
):
    """Stream a replacement for one selected span. Persists nothing but the
    usage: the client splices the replacement in only when the writer accepts
    it, and the normal autosave carries it to the server."""
    document = await require_chapter(db, project.id, document_id)
    meter = Meter(db, user, user.model_key)
    # The chapter and its plan, rather than only the few thousand characters
    # around the selection: a rewrite that cannot see the scene it sits in can
    # only manage tonal changes. It reads no earlier chapters — a rewrite is a
    # local operation, and long-range memory would be paid for on every one.
    state = {
        "story_bible": await get_bible_body(db, document.project_id),
        "chapter": document.body,
        "scene_plan": document.plan or {},
        "instruction": body.instruction,
        "selection": body.selection,
        "before": body.before,
        "after": body.after,
    }

    async def gen():
        buf = []
        try:
            async for text in rewriter_token_stream(
                state, user.model_key, partial(meter.add, "rewrite")
            ):
                buf.append(text)
                yield sse({"type": "delta", "text": text})
            await meter.flush()
            yield sse(
                {
                    "type": "done",
                    "body": "".join(buf),
                    "usage": (await meter.snapshot()).as_dict(),
                }
            )
        except Exception as e:
            # A truncated rewrite is still a billed call, so the usage the
            # stream reported before raising is written before the error goes out.
            await meter.flush()
            yield sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=SSE_HEADERS)
