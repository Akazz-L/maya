import uuid

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db import get_db
from backend.db_models import Document, Project
from backend.doc_storage import (
    create_document,
    delete_document,
    get_document,
    list_documents,
    reorder_documents,
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
    issues: list | None = None
    kind: str | None = None


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
        "issues": document.issues,
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
    return _detail(await update_document(db, document, **fields))


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_document(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    await delete_document(db, project.id, document_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
