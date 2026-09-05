import hashlib
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db_models import Document

VALID_KINDS = {"bible", "chapter", "note"}


def body_hash(body: str) -> str:
    """Cache key for a document's summary. Any edit to the body invalidates it."""
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


async def list_documents(db: AsyncSession, project_id: uuid.UUID) -> list[Document]:
    result = await db.execute(
        select(Document).where(Document.project_id == project_id).order_by(Document.position)
    )
    return list(result.scalars())


async def get_document(
    db: AsyncSession, project_id: uuid.UUID, document_id: uuid.UUID
) -> Document:
    result = await db.execute(
        select(Document).where(Document.id == document_id, Document.project_id == project_id)
    )
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


async def create_document(
    db: AsyncSession,
    project_id: uuid.UUID,
    title: str | None = None,
    kind: str = "chapter",
    body: str = "",
) -> Document:
    if kind not in VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid kind: {kind}")
    existing = await list_documents(db, project_id)
    document = Document(
        project_id=project_id,
        title=title or "Untitled",
        kind=kind,
        body=body,
        position=len(existing),
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)
    return document


async def update_document(db: AsyncSession, document: Document, **fields) -> Document:
    if fields.get("kind") is not None and fields["kind"] not in VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid kind: {fields['kind']}")
    # `plan: None` is meaningful — it is how the UI drops a plan — so only skip
    # keys the caller did not send at all.
    for key, value in fields.items():
        setattr(document, key, value)
    if "body" in fields:
        document.summary_hash = None  # body changed; the cached summary is stale
    await db.commit()
    await db.refresh(document)
    return document


async def delete_document(
    db: AsyncSession, project_id: uuid.UUID, document_id: uuid.UUID
) -> None:
    document = await get_document(db, project_id, document_id)
    if document.kind == "bible":
        raise HTTPException(status_code=409, detail="The story bible cannot be deleted")
    await db.delete(document)
    await db.flush()
    # Close the gap so positions stay contiguous.
    for index, remaining in enumerate(await list_documents(db, project_id)):
        remaining.position = index
    await db.commit()


async def reorder_documents(
    db: AsyncSession, project_id: uuid.UUID, document_ids: list[uuid.UUID]
) -> None:
    documents = await list_documents(db, project_id)
    if {d.id for d in documents} != set(document_ids) or len(documents) != len(document_ids):
        raise HTTPException(
            status_code=400, detail="Order must list exactly the project's documents"
        )
    by_id = {d.id: d for d in documents}
    for index, document_id in enumerate(document_ids):
        by_id[document_id].position = index
    await db.commit()


async def get_bible_body(db: AsyncSession, project_id: uuid.UUID) -> str:
    result = await db.execute(
        select(Document.body).where(
            Document.project_id == project_id, Document.kind == "bible"
        )
    )
    return result.scalar_one_or_none() or ""
