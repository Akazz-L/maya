import uuid

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import get_current_user
from backend.db import get_db
from backend.db_models import Document, Project, User
from backend.doc_storage import get_document


async def require_chapter(
    db: AsyncSession, project_id: uuid.UUID, document_id: uuid.UUID
) -> Document:
    """Resolve a document in the project, or 404. Only chapters take AI
    generation, so any other kind is a 400."""
    document = await get_document(db, project_id, document_id)
    if document.kind != "chapter":
        raise HTTPException(
            status_code=400, detail=f"Cannot generate on a {document.kind} document"
        )
    return document


async def require_project(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Resolve a project the caller owns, or 404. A project id belonging to
    another user is indistinguishable from one that does not exist."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
