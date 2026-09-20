import uuid
from functools import partial

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.planner import planner_node
from backend.agents.rewriter import rewriter_token_stream
from backend.context import build_chapter_state
from backend.db import get_db
from backend.db_models import Project, User
from backend.doc_storage import get_bible_body
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
            db, document, user.model_key, partial(meter.add, "summarize")
        )
        result = await planner_node(state, user.model_key)
    meter.add("plan", result["usage"])
    document.plan = result["scene_plan"]
    await meter.flush()
    return {"plan": result["scene_plan"], "usage": (await meter.snapshot()).as_dict()}


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
