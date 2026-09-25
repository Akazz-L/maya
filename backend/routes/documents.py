import uuid

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db import get_db
from backend.db_models import Document, Project
from backend.context import WINDOW, digest_hash, prior_chapters, prose_mode
from backend.doc_storage import (
    create_document,
    delete_document,
    get_document,
    list_documents,
    digest_status,
    reorder_documents,
    summary_status,
    update_document,
)
from backend.routes.deps import require_project

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])


class DocumentCreateRequest(BaseModel):
    title: str | None = None
    kind: str = "chapter"


class DocumentUpdateRequest(BaseModel):
    title: str | None = None
    body: str | None = None
    brief: str | None = None
    plan: dict | None = None
    kind: str | None = None
    #: The writer's own summary. Blank reverts to the generated one.
    summary: str | None = None
    #: The writer's own "story so far". Blank reverts to the generated one.
    digest: str | None = None


class OrderRequest(BaseModel):
    document_ids: list[uuid.UUID]


def _summary(document: Document) -> dict:
    return {
        "id": str(document.id),
        "title": document.title,
        "kind": document.kind,
        "position": document.position,
        "updated_at": document.updated_at,
    }


def _detail(document: Document) -> dict:
    return {
        **_summary(document),
        "body": document.body,
        "brief": document.brief,
        "plan": document.plan,
        # What later chapters read of this one, and whether it still fits the body.
        "summary": document.summary,
        "summary_status": summary_status(document),
        # What this chapter reads of the ones before it.
        "digest": document.digest,
    }


@router.get("")
async def get_documents(
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    return [_summary(d) for d in await list_documents(db, project.id)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_document(
    body: DocumentCreateRequest,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await create_document(db, project.id, title=body.title, kind=body.kind)
    return _detail(document)


# Registered before /{document_id} so "order" is not parsed as a document id.
@router.put("/order", status_code=status.HTTP_204_NO_CONTENT)
async def put_order(
    body: OrderRequest,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    await reorder_documents(db, project.id, body.document_ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{document_id}")
async def get_one(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    return _detail(await get_document(db, project.id, document_id))


@router.get("/{document_id}/summary-context")
async def get_summary_context(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    """The preceding chapters this chapter's AI calls read, as summaries.

    Named in the Write view, so a writer can see that the AI works from these
    and not from the chapters themselves. Summarizes nothing: it costs nothing
    to look.
    """
    document = await get_document(db, project.id, document_id)
    prior = await prior_chapters(db, project.id, document.position)
    if prose_mode(prior):
        # Short project: nothing is summarized, so there is no window and no digest.
        return {
            "mode": "prose",
            "previous": [{"id": str(d.id), "title": d.title, "summary_status": "empty"} for d in prior],
            "digest": None,
        }

    window = prior[-WINDOW:]
    older = prior[: -len(window)] if window else prior
    return {
        "mode": "summaries",
        "previous": [
            {"id": str(d.id), "title": d.title, "summary_status": summary_status(d)}
            for d in window
        ],
        "digest": {
            "status": digest_status(document, digest_hash(older) if older else None),
            "covers": [d.title for d in older],
        }
        if older
        else None,
    }


@router.patch("/{document_id}")
async def patch_document(
    document_id: uuid.UUID,
    body: DocumentUpdateRequest,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await get_document(db, project.id, document_id)
    # exclude_unset so an omitted field is left alone while an explicit null
    # (dropping a plan) still clears it.
    fields = body.model_dump(exclude_unset=True)
    if fields.get("digest"):
        # Stamp it with the chapters it was written against, so a later edit to
        # one of them shows as "the story has moved on" rather than as stale
        # from the moment it was saved.
        prior = await prior_chapters(db, project.id, document.position)
        older = prior[:-WINDOW] if len(prior) > WINDOW else []
        fields["digest_hash"] = digest_hash(older) if older else None
    return _detail(await update_document(db, document, **fields))


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_document(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    await delete_document(db, project.id, document_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
