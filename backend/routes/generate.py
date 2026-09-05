import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.checker import checker_node
from backend.agents.drafter import drafter_token_stream
from backend.agents.planner import planner_node
from backend.context import build_previous_summaries
from backend.db import get_db
from backend.db_models import Document, Project
from backend.doc_storage import get_bible_body, get_document
from backend.routes.deps import require_project

router = APIRouter(prefix="/projects/{project_id}/documents/{document_id}", tags=["generate"])


class PlanBody(BaseModel):
    plan: dict


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


async def _base_state(db: AsyncSession, document: Document) -> dict:
    """Assemble agent state from documents. Replaces the old outline-index lookup:
    the beat comes from the document's own brief, so a chapter can sit anywhere."""
    return {
        "outline_beat": document.brief,
        "story_bible": await get_bible_body(db, document.project_id),
        "previous_summaries": await build_previous_summaries(
            db, document.project_id, document.position
        ),
        "scene_plan": document.plan or {},
        "draft": "",
        "continuity_issues": [],
    }


@router.post("/plan")
async def generate_plan(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    state = await _base_state(db, document)
    result = await planner_node(state)
    document.plan = result["scene_plan"]
    await db.commit()
    return {"plan": result["scene_plan"]}


@router.post("/check")
async def generate_check(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    state = await _base_state(db, document)
    state["draft"] = document.body
    result = await checker_node(state)
    document.issues = result["continuity_issues"]
    await db.commit()
    return {"issues": result["continuity_issues"]}


@router.post("/draft/stream")
async def generate_draft_stream(
    document_id: uuid.UUID,
    body: PlanBody,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    # Persist the plan first, so a panel edit survives a failed stream.
    document.plan = body.plan
    await db.commit()

    state = await _base_state(db, document)
    state["scene_plan"] = body.plan
    existing = document.body

    async def gen():
        buf = []
        try:
            async for text in drafter_token_stream(state):
                buf.append(text)
                yield _sse({"type": "delta", "text": text})
            draft = "".join(buf)
            document.body = f"{existing}\n\n{draft}" if existing else draft
            document.summary_hash = None  # body changed; the cached summary is stale
            await db.commit()
            yield _sse({"type": "done", "body": document.body})
        except Exception as e:
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/revise/stream")
async def revise_stream(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    state = await _base_state(db, document)
    # Both set => _build_messages takes its revision branch.
    state["draft"] = document.body
    state["continuity_issues"] = document.issues or []

    async def gen():
        buf = []
        try:
            async for text in drafter_token_stream(state):
                buf.append(text)
                yield _sse({"type": "delta", "text": text})
            # A revision replaces the text wholesale rather than appending.
            document.body = "".join(buf)
            document.summary_hash = None
            await db.commit()
            yield _sse({"type": "done", "body": document.body})
        except Exception as e:
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)
