import uuid

import yaml
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db_models import Chapter, DraftState, Project, Summary


async def _get_project(db: AsyncSession, project_id: uuid.UUID) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def _get_or_create_chapter(db: AsyncSession, project_id: uuid.UUID, chapter_number: int) -> Chapter:
    result = await db.execute(
        select(Chapter).where(Chapter.project_id == project_id, Chapter.number == chapter_number)
    )
    chapter = result.scalar_one_or_none()
    if chapter is None:
        chapter = Chapter(project_id=project_id, number=chapter_number)
        db.add(chapter)
        await db.flush()
    return chapter


async def load_bible(db: AsyncSession, project_id: uuid.UUID) -> dict:
    project = await _get_project(db, project_id)
    return yaml.safe_load(project.bible_content) or {}


async def load_bible_text(db: AsyncSession, project_id: uuid.UUID) -> str:
    project = await _get_project(db, project_id)
    return project.bible_content


async def save_bible(db: AsyncSession, project_id: uuid.UUID, content: str) -> None:
    parsed = yaml.safe_load(content)
    if not isinstance(parsed, dict):
        raise ValueError("Bible must be a YAML mapping")
    project = await _get_project(db, project_id)
    project.bible_content = content
    await db.commit()


async def load_outline(db: AsyncSession, project_id: uuid.UUID) -> dict:
    project = await _get_project(db, project_id)
    return yaml.safe_load(project.outline_content) or {}


async def load_summaries(db: AsyncSession, project_id: uuid.UUID, up_to_chapter: int) -> list[str]:
    result = await db.execute(
        select(Chapter.id, Chapter.number)
        .where(Chapter.project_id == project_id, Chapter.number < up_to_chapter)
        .order_by(Chapter.number)
    )
    rows = result.all()
    if not rows:
        return []
    chapter_ids = [r.id for r in rows]
    summary_result = await db.execute(
        select(Summary).where(Summary.chapter_id.in_(chapter_ids)).order_by(Summary.chapter_id)
    )
    summaries_by_chapter = {s.chapter_id: s.text for s in summary_result.scalars()}
    return [summaries_by_chapter[r.id] for r in rows if r.id in summaries_by_chapter]


async def save_summary(db: AsyncSession, project_id: uuid.UUID, chapter_number: int, text: str) -> None:
    chapter = await _get_or_create_chapter(db, project_id, chapter_number)
    result = await db.execute(select(Summary).where(Summary.chapter_id == chapter.id))
    summary = result.scalar_one_or_none()
    if summary:
        summary.text = text
    else:
        db.add(Summary(chapter_id=chapter.id, text=text))
    await db.commit()


async def save_chapter(
    db: AsyncSession,
    project_id: uuid.UUID,
    chapter_number: int,
    plan: dict,
    draft: str | None,
    issues: list[dict],
) -> None:
    chapter = await _get_or_create_chapter(db, project_id, chapter_number)
    chapter.plan = plan
    chapter.draft = draft
    chapter.issues = issues
    chapter.status = "accepted" if draft else "draft"
    await db.commit()


async def save_draft_state(
    db: AsyncSession,
    project_id: uuid.UUID,
    chapter_number: int,
    state: dict,
) -> None:
    chapter = await _get_or_create_chapter(db, project_id, chapter_number)
    result = await db.execute(select(DraftState).where(DraftState.chapter_id == chapter.id))
    draft_state = result.scalar_one_or_none()
    if draft_state is None:
        draft_state = DraftState(chapter_id=chapter.id)
        db.add(draft_state)
    draft_state.step = state.get("step", "plan")
    draft_state.scene_plan = state.get("scene_plan", {})
    draft_state.draft = state.get("draft", "")
    draft_state.issues = state.get("issues", [])
    await db.commit()


async def load_draft_state(
    db: AsyncSession, project_id: uuid.UUID, chapter_number: int
) -> dict | None:
    result = await db.execute(
        select(DraftState)
        .join(Chapter)
        .where(Chapter.project_id == project_id, Chapter.number == chapter_number)
    )
    ds = result.scalar_one_or_none()
    if ds is None:
        return None
    return {
        "step": ds.step,
        "scene_plan": ds.scene_plan or {},
        "draft": ds.draft or "",
        "issues": ds.issues or [],
    }


async def delete_draft_state(
    db: AsyncSession, project_id: uuid.UUID, chapter_number: int
) -> None:
    result = await db.execute(
        select(DraftState)
        .join(Chapter)
        .where(Chapter.project_id == project_id, Chapter.number == chapter_number)
    )
    ds = result.scalar_one_or_none()
    if ds:
        await db.delete(ds)
        await db.commit()


async def load_chapter(
    db: AsyncSession, project_id: uuid.UUID, chapter_number: int
) -> dict:
    result = await db.execute(
        select(Chapter).where(Chapter.project_id == project_id, Chapter.number == chapter_number)
    )
    chapter = result.scalar_one_or_none()
    if chapter is None or chapter.draft is None:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return {
        "plan": chapter.plan or {},
        "draft": chapter.draft,
        "issues": chapter.issues or [],
    }
