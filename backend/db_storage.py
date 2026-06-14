import json
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db_models import Chapter, DraftState, Project, Summary


EMPTY_BIBLE: dict = {
    "characters": [],
    "world": {"locations": [], "rules": []},
    "style_guide": {"voice": "", "avoid": []},
    "timeline": [],
}


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
    try:
        return json.loads(project.bible_content) or EMPTY_BIBLE
    except (json.JSONDecodeError, ValueError):
        return dict(EMPTY_BIBLE)


async def save_bible(db: AsyncSession, project_id: uuid.UUID, data: dict) -> None:
    if not isinstance(data, dict):
        raise ValueError("Bible must be a dict")
    project = await _get_project(db, project_id)
    project.bible_content = json.dumps(data)
    await db.commit()


async def load_outline(db: AsyncSession, project_id: uuid.UUID) -> dict:
    project = await _get_project(db, project_id)
    try:
        return json.loads(project.outline_content) or {"chapters": []}
    except (json.JSONDecodeError, ValueError):
        return {"chapters": []}


async def save_outline(db: AsyncSession, project_id: uuid.UUID, data: dict) -> None:
    if not isinstance(data, dict) or "chapters" not in data:
        raise ValueError("Outline must be a dict with a 'chapters' key")
    project = await _get_project(db, project_id)
    project.outline_content = json.dumps(data)
    await db.commit()


async def chapter_exists(db: AsyncSession, project_id: uuid.UUID, chapter_number: int) -> bool:
    result = await db.execute(
        select(Chapter.draft).where(
            Chapter.project_id == project_id, Chapter.number == chapter_number
        )
    )
    draft = result.scalar_one_or_none()
    return draft is not None


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
