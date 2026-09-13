"""Persistence for the chapter chat."""

import uuid

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

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
        "proposal": message.proposal,
        "created_at": message.created_at.isoformat() if message.created_at else None,
    }


def history(messages: list[ChatMessage]) -> list[dict]:
    """The conversation in the plain shape the chat agent reads."""
    return [{"role": m.role, "content": m.content, "proposal": m.proposal} for m in messages]


def has_pending_proposal(messages: list[ChatMessage]) -> bool:
    """A reply proposal the writer has yet to accept or discard. It gates the next
    message: the model must know what became of it before being asked anything else."""
    if not messages:
        return False
    last = messages[-1]
    return bool(last.proposal) and last.proposal.get("outcome") is None


def add_turn(
    db: AsyncSession,
    document_id: uuid.UUID,
    position: int,
    user_content: str,
    reply: str,
    proposal: dict | None,
) -> tuple[ChatMessage, ChatMessage]:
    """Stage a writer message and its reply. The caller commits both together,
    so a failed turn never leaves a message without its reply."""
    user = ChatMessage(document_id=document_id, position=position, role="user", content=user_content)
    assistant = ChatMessage(
        document_id=document_id,
        position=position + 1,
        role="assistant",
        content=reply,
        proposal=proposal,
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


async def resolve_proposal(db: AsyncSession, message: ChatMessage, outcome: str) -> ChatMessage:
    if not message.proposal:
        raise HTTPException(status_code=409, detail="This message has no proposal")
    if message.proposal.get("outcome") is not None:
        raise HTTPException(status_code=409, detail="This proposal was already resolved")
    # A new dict, because the JSON column does not see in-place mutation. The
    # full proposed chapter was only needed for review.
    message.proposal = {**message.proposal, "outcome": outcome, "proposed_body": None}
    await db.commit()
    return message


async def clear_messages(db: AsyncSession, document_id: uuid.UUID) -> None:
    await db.execute(delete(ChatMessage).where(ChatMessage.document_id == document_id))
    await db.commit()
