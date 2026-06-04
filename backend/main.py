import logging
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
_logger = logging.getLogger(__name__)

from backend.agents.checker import checker_node
from backend.agents.drafter import drafter_node
from backend.agents.planner import planner_node
from backend.auth import create_access_token, get_current_user, hash_password, verify_password
from backend.db import get_db
from backend.db_models import Project, User
from backend.db_storage import (
    delete_draft_state,
    load_bible,
    load_bible_text,
    load_chapter,
    load_draft_state,
    load_outline,
    load_summaries,
    save_bible,
    save_chapter,
    save_draft_state,
)
from backend.models import (
    AcceptRequest,
    BibleUpdateRequest,
    CheckRequest,
    DraftRequest,
    DraftStateResponse,
    ReviseRequest,
)

_FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

app = FastAPI(title="Maya")
app.mount("/static", StaticFiles(directory=str(_FRONTEND_DIR), check_dir=False), name="static")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=body.email, hashed_password=hash_password(body.password))
    db.add(user)
    await db.commit()
    return {"user_id": str(user.id)}


@app.post("/auth/token", response_model=TokenResponse)
async def login(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return TokenResponse(access_token=create_access_token(user.id))


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectCreateRequest(BaseModel):
    name: str
    bible_content: str = ""
    outline_content: str = ""


@app.post("/projects", status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = Project(
        user_id=current_user.id,
        name=body.name,
        bible_content=body.bible_content,
        outline_content=body.outline_content,
    )
    db.add(project)
    await db.commit()
    return {"project_id": str(project.id), "name": project.name}


@app.get("/projects")
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.user_id == current_user.id))
    projects = result.scalars().all()
    return [{"project_id": str(p.id), "name": p.name, "created_at": p.created_at} for p in projects]


@app.get("/projects/{project_id}")
async def get_project(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "project_id": str(project.id),
        "name": project.name,
        "bible_content": project.bible_content,
        "outline_content": project.outline_content,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _require_project(project_id: uuid.UUID, current_user: User, db: AsyncSession) -> None:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")


async def _base_state(project_id: uuid.UUID, chapter_number: int, db: AsyncSession) -> dict:
    bible = await load_bible(db, project_id)
    outline = await load_outline(db, project_id)
    beats = outline.get("chapters", [])
    if chapter_number < 1 or chapter_number > len(beats):
        raise HTTPException(status_code=400, detail=f"Chapter {chapter_number} not in outline")
    return {
        "chapter_number": chapter_number,
        "outline_beat": beats[chapter_number - 1],
        "story_bible": bible,
        "previous_summaries": await load_summaries(db, project_id, chapter_number),
        "scene_plan": {},
        "draft": "",
        "continuity_issues": [],
    }


# ---------------------------------------------------------------------------
# Bible
# ---------------------------------------------------------------------------

@app.get("/projects/{project_id}/bible")
async def get_bible(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    return {"content": await load_bible_text(db, project_id)}


@app.put("/projects/{project_id}/bible")
async def update_bible(
    project_id: uuid.UUID,
    request: BibleUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    await save_bible(db, project_id, request.content)
    return {"status": "saved"}


# ---------------------------------------------------------------------------
# Chapter workflow
# ---------------------------------------------------------------------------

@app.post("/projects/{project_id}/chapters/{chapter_number}/plan")
async def generate_plan(
    project_id: uuid.UUID,
    chapter_number: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    state = await _base_state(project_id, chapter_number, db)
    result = planner_node(state)
    state.update(result)
    await save_draft_state(db, project_id, chapter_number, {"step": "plan", "scene_plan": state["scene_plan"], "draft": "", "issues": []})
    return {"scene_plan": state["scene_plan"]}


@app.post("/projects/{project_id}/chapters/{chapter_number}/draft")
async def generate_draft(
    project_id: uuid.UUID,
    chapter_number: int,
    body: DraftRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    state = await _base_state(project_id, chapter_number, db)
    state["scene_plan"] = body.scene_plan
    result = drafter_node(state)
    state.update(result)
    await save_draft_state(db, project_id, chapter_number, {"step": "draft", "scene_plan": body.scene_plan, "draft": state["draft"], "issues": []})
    return {"draft": state["draft"]}


@app.post("/projects/{project_id}/chapters/{chapter_number}/check")
async def generate_check(
    project_id: uuid.UUID,
    chapter_number: int,
    body: CheckRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    state = await _base_state(project_id, chapter_number, db)
    saved = await load_draft_state(db, project_id, chapter_number)
    state["scene_plan"] = saved["scene_plan"] if saved else {}
    state["draft"] = body.draft
    result = checker_node(state)
    state.update(result)
    await save_draft_state(db, project_id, chapter_number, {
        "step": "check",
        "scene_plan": state["scene_plan"],
        "draft": body.draft,
        "issues": state["continuity_issues"],
    })
    return {"issues": state["continuity_issues"]}


@app.post("/projects/{project_id}/chapters/{chapter_number}/revise")
async def revise_draft(
    project_id: uuid.UUID,
    chapter_number: int,
    body: ReviseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    state = await _base_state(project_id, chapter_number, db)
    saved = await load_draft_state(db, project_id, chapter_number)
    state["scene_plan"] = saved["scene_plan"] if saved else {}
    state["draft"] = body.draft
    state["continuity_issues"] = body.issues
    result = drafter_node(state)
    state.update(result)
    await save_draft_state(db, project_id, chapter_number, {
        "step": "draft",
        "scene_plan": state["scene_plan"],
        "draft": state["draft"],
        "issues": [],
    })
    return {"draft": state["draft"]}


@app.get("/projects/{project_id}/chapters/{chapter_number}/state")
async def get_draft_state(
    project_id: uuid.UUID,
    chapter_number: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    saved = await load_draft_state(db, project_id, chapter_number)
    if not saved:
        return None
    return DraftStateResponse(
        step=saved.get("step", "plan"),
        scene_plan=saved.get("scene_plan", {}),
        draft=saved.get("draft", ""),
        issues=saved.get("issues", []),
    )


@app.put("/projects/{project_id}/chapters/{chapter_number}/accept")
async def accept_chapter(
    project_id: uuid.UUID,
    chapter_number: int,
    body: AcceptRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    await save_chapter(db, project_id, chapter_number, body.scene_plan, body.draft, body.issues)
    await delete_draft_state(db, project_id, chapter_number)
    return {"status": "saved"}


@app.get("/projects/{project_id}/chapters/{chapter_number}")
async def get_chapter(
    project_id: uuid.UUID,
    chapter_number: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    return await load_chapter(db, project_id, chapter_number)


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return FileResponse(_FRONTEND_DIR / "index.html")
