"""Persistence for the chapter chat."""

import uuid

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.chat import is_pending, pending_indexes
from backend.db_models import ChatMessage


async def list_messages(db: AsyncSession, document_id: uuid.UUID) -> list[ChatMessage]:
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.document_id == document_id)
        .order_by(ChatMessage.position)
    )
    return list(result.scalars())


def message_out(message: ChatMessage) -> dict:
    return {
        "id": str(message.id),
        "role": message.role,
        "content": message.content,
        "agent": message.agent,
        "proposal": message.proposal,
        "created_at": message.created_at.isoformat() if message.created_at else None,
    }


def history(messages: list[ChatMessage]) -> list[dict]:
    """The conversation in the plain shape the chat agent reads."""
    return [{"role": m.role, "content": m.content, "proposal": m.proposal} for m in messages]


def has_pending_proposal(messages: list[ChatMessage]) -> bool:
    """A reply proposal the writer has yet to resolve — for a suggestion set, any
    fix still unreviewed. It gates the next message: the model must know what
    became of it before being asked anything else."""
    return bool(messages) and is_pending(messages[-1].proposal)


def add_turn(
    db: AsyncSession,
    document_id: uuid.UUID,
    position: int,
    user_content: str,
    reply: str,
    proposal: dict | None,
    agent: str | None = None,
) -> tuple[ChatMessage, ChatMessage]:
    """Stage a writer message and its reply. The caller commits both together,
    so a failed turn never leaves a message without its reply.

    `agent` names the specialist the writer ran, and is recorded on both messages
    so the pane can label the turn without looking at its neighbour."""
    user = ChatMessage(
        document_id=document_id,
        position=position,
        role="user",
        content=user_content,
        agent=agent,
    )
    assistant = ChatMessage(
        document_id=document_id,
        position=position + 1,
        role="assistant",
        content=reply,
        proposal=proposal,
        agent=agent,
    )
    db.add_all([user, assistant])
    return user, assistant


async def get_message(
    db: AsyncSession, document_id: uuid.UUID, message_id: uuid.UUID
) -> ChatMessage:
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id, ChatMessage.document_id == document_id
        )
    )
    message = result.scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


async def resolve_proposal(
    db: AsyncSession,
    message: ChatMessage,
    outcome: str,
    indexes: list[int] | None = None,
) -> ChatMessage:
    """Record what the writer did.

    For a `write` proposal that is the whole thing. For a suggestion set it is
    the fixes named by `indexes`, or every fix still unreviewed when they are
    omitted — which is what Accept all and Discard all send.
    """
    proposal = message.proposal
    if not proposal:
        raise HTTPException(status_code=409, detail="This message has no proposal")
    if not is_pending(proposal):
        raise HTTPException(status_code=409, detail="This proposal was already resolved")

    if proposal.get("kind") != "suggestions":
        # A new dict, because the JSON column does not see in-place mutation. The
        # full proposed chapter was only needed for review.
        message.proposal = {**proposal, "outcome": outcome, "proposed_body": None}
        await db.commit()
        return message

    suggestions = proposal["suggestions"]
    targets = pending_indexes(proposal) if indexes is None else indexes
    for index in targets:
        if not 0 <= index < len(suggestions):
            raise HTTPException(status_code=422, detail=f"No fix at index {index}")
        if suggestions[index].get("outcome") is not None:
            raise HTTPException(status_code=409, detail=f"Fix {index + 1} was already resolved")

    message.proposal = {
        **proposal,
        "suggestions": [
            {**s, "outcome": outcome} if i in set(targets) else s
            for i, s in enumerate(suggestions)
        ],
    }
    await db.commit()
    return message


async def clear_messages(db: AsyncSession, document_id: uuid.UUID) -> None:
    await db.execute(delete(ChatMessage).where(ChatMessage.document_id == document_id))
    await db.commit()
