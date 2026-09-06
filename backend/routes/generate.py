import json
import uuid
from functools import partial

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.checker import checker_node
from backend.agents.drafter import drafter_token_stream
from backend.agents.planner import planner_node
from backend.agents.rewriter import rewriter_token_stream
from backend.context import build_previous_summaries
from backend.db import get_db
from backend.db_models import Document, Project, User
from backend.doc_storage import get_bible_body, get_document
from backend.routes.deps import require_project
from backend.usage import Meter, require_ai_budget

router = APIRouter(prefix="/projects/{project_id}/documents/{document_id}", tags=["generate"])


class PlanBody(BaseModel):
    plan: dict


class RewriteBody(BaseModel):
    instruction: str = Field(min_length=1, max_length=2000)
    selection: str = Field(min_length=1, max_length=20000)
    before: str = Field(default="", max_length=4000)
    after: str = Field(default="", max_length=4000)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


async def _require_chapter(
    db: AsyncSession, project_id: uuid.UUID, document_id: uuid.UUID
) -> Document:
    document = await get_document(db, project_id, document_id)
    if document.kind != "chapter":
        raise HTTPException(
            status_code=400, detail=f"Cannot generate on a {document.kind} document"
        )
    return document


async def _base_state(
    db: AsyncSession, document: Document, model_key: str, meter: Meter
) -> dict:
    """Assemble agent state from documents. Replaces the old outline-index lookup:
    the beat comes from the document's own brief, so a chapter can sit anywhere.

    Building this can itself call the model — any prior chapter whose summary
    has gone stale is re-summarized here — so it takes the meter that records it.
    """
    return {
        "outline_beat": document.brief,
        "story_bible": await get_bible_body(db, document.project_id),
        "previous_summaries": await build_previous_summaries(
            db,
            document.project_id,
            document.position,
            model_key,
            partial(meter.add, "summarize"),
        ),
        "scene_plan": document.plan or {},
        "draft": "",
        "continuity_issues": [],
    }


@router.post("/plan")
async def generate_plan(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    user: User = Depends(require_ai_budget),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    meter = Meter(db, user, user.model_key)
    state = await _base_state(db, document, user.model_key, meter)
    result = await planner_node(state, user.model_key)
    meter.add("plan", result["usage"])
    document.plan = result["scene_plan"]
    await meter.flush()
    return {"plan": result["scene_plan"], "usage": (await meter.snapshot()).as_dict()}


@router.post("/check")
async def generate_check(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    user: User = Depends(require_ai_budget),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    meter = Meter(db, user, user.model_key)
    state = await _base_state(db, document, user.model_key, meter)
    state["draft"] = document.body
    result = await checker_node(state, user.model_key)
    meter.add("check", result["usage"])
    document.issues = result["continuity_issues"]
    await meter.flush()
    return {"issues": result["continuity_issues"], "usage": (await meter.snapshot()).as_dict()}


@router.post("/draft/stream")
async def generate_draft_stream(
    document_id: uuid.UUID,
    body: PlanBody,
    project: Project = Depends(require_project),
    user: User = Depends(require_ai_budget),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    # Persist the plan first, so a panel edit survives a failed stream.
    document.plan = body.plan
    await db.commit()

    meter = Meter(db, user, user.model_key)
    state = await _base_state(db, document, user.model_key, meter)
    state["scene_plan"] = body.plan
    existing = document.body

    async def gen():
        buf = []
        try:
            async for text in drafter_token_stream(
                state, user.model_key, partial(meter.add, "draft")
            ):
                buf.append(text)
                yield _sse({"type": "delta", "text": text})
            draft = "".join(buf)
            document.body = f"{existing}\n\n{draft}" if existing else draft
            document.summary_hash = None  # body changed; the cached summary is stale
            await meter.flush()
            yield _sse(
                {
                    "type": "done",
                    "body": document.body,
                    "usage": (await meter.snapshot()).as_dict(),
                }
            )
        except Exception as e:
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/revise/stream")
async def revise_stream(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    user: User = Depends(require_ai_budget),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    meter = Meter(db, user, user.model_key)
    state = await _base_state(db, document, user.model_key, meter)
    # Both set => _build_messages takes its revision branch.
    state["draft"] = document.body
    state["continuity_issues"] = document.issues or []

    async def gen():
        buf = []
        try:
            async for text in drafter_token_stream(
                state, user.model_key, partial(meter.add, "revise")
            ):
                buf.append(text)
                yield _sse({"type": "delta", "text": text})
            # A revision replaces the text wholesale rather than appending.
            document.body = "".join(buf)
            document.summary_hash = None
            await meter.flush()
            yield _sse(
                {
                    "type": "done",
                    "body": document.body,
                    "usage": (await meter.snapshot()).as_dict(),
                }
            )
        except Exception as e:
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


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
    document = await _require_chapter(db, project.id, document_id)
    meter = Meter(db, user, user.model_key)
    state = {
        "story_bible": await get_bible_body(db, document.project_id),
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
                yield _sse({"type": "delta", "text": text})
            await meter.flush()
            yield _sse(
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
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)
