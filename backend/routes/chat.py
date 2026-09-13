import uuid
from functools import partial
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from backend import chat_storage
from backend.agents.chat import ProposalProgress, ProposalReady, TextDelta, chat_event_stream
from backend.context import build_chapter_state
from backend.db import get_db
from backend.db_models import Project, User
from backend.doc_storage import body_hash
from backend.routes.deps import require_chapter, require_project
from backend.routes.sse import SSE_HEADERS, sse
from backend.usage import Meter, require_ai_budget

router = APIRouter(prefix="/projects/{project_id}/documents/{document_id}/chat", tags=["chat"])


class ChatBody(BaseModel):
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)]


class OutcomeBody(BaseModel):
    outcome: Literal["accepted", "discarded", "stale"]


@router.get("")
async def get_chat(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await require_chapter(db, project.id, document_id)
    messages = await chat_storage.list_messages(db, document.id)
    return {"messages": [chat_storage.message_out(m) for m in messages]}


@router.post("/stream")
async def chat_stream(
    document_id: uuid.UUID,
    body: ChatBody,
    project: Project = Depends(require_project),
    user: User = Depends(require_ai_budget),
    db: AsyncSession = Depends(get_db),
):
    """Answer one writer message. Both messages are written only once the reply
    is complete, so a failed turn leaves the conversation as it was; the usage
    it billed is written either way."""
    document = await require_chapter(db, project.id, document_id)
    messages = await chat_storage.list_messages(db, document.id)
    if chat_storage.has_pending_proposal(messages):
        raise HTTPException(
            status_code=409,
            detail="Accept or discard the pending proposal before sending another message.",
        )

    meter = Meter(db, user, user.model_key)
    async with meter.flushed_on_error():
        state = await build_chapter_state(
            db, document, user.model_key, partial(meter.add, "summarize")
        )
    state.update(
        draft=document.body,
        history=chat_storage.history(messages),
        message=body.content,
    )
    # What the proposal is computed against. The editor refuses to apply it
    # over any other text.
    base_hash = body_hash(document.body)

    async def gen():
        reply: list[str] = []
        proposal = None
        try:
            async for event in chat_event_stream(state, user.model_key, partial(meter.add, "chat")):
                if isinstance(event, TextDelta):
                    reply.append(event.text)
                    yield sse({"type": "delta", "text": event.text})
                elif isinstance(event, ProposalProgress):
                    yield sse({"type": "proposal_progress", "mode": event.mode, "text": event.text})
                elif isinstance(event, ProposalReady):
                    proposal = {**event.proposal, "base_hash": base_hash, "outcome": None}
            user_message, assistant_message = chat_storage.add_turn(
                db, document.id, len(messages), body.content, "".join(reply).strip(), proposal
            )
            await meter.flush()  # commits the two messages with the usage
            yield sse(
                {
                    "type": "done",
                    "messages": [
                        chat_storage.message_out(user_message),
                        chat_storage.message_out(assistant_message),
                    ],
                    "usage": (await meter.snapshot()).as_dict(),
                }
            )
        except Exception as e:
            # Whatever the calls billed before failing is written before the error goes out.
            await meter.flush()
            yield sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/messages/{message_id}/outcome")
async def record_outcome(
    document_id: uuid.UUID,
    message_id: uuid.UUID,
    body: OutcomeBody,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    """Record what the writer did with a proposal. The next turn tells the model."""
    document = await require_chapter(db, project.id, document_id)
    message = await chat_storage.get_message(db, document.id, message_id)
    message = await chat_storage.resolve_proposal(db, message, body.outcome)
    return chat_storage.message_out(message)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def clear_chat(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await require_chapter(db, project.id, document_id)
    await chat_storage.clear_messages(db, document.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
