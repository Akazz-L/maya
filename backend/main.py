import json
import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
_logger = logging.getLogger(__name__)

from backend.agents.checker import checker_node
from backend.agents.drafter import drafter_node, drafter_token_stream
from backend.agents.planner import planner_node
from backend.auth import create_access_token, get_current_user, hash_password, verify_password
from backend.db import get_db, init_db
from backend.db_models import Project, User
from backend.db_storage import (
    chapter_exists,
    delete_draft_state,
    load_bible,
    load_chapter,
    load_draft_state,
    load_outline,
    load_summaries,
    save_bible,
    save_chapter,
    save_draft_state,
    save_outline,
)
from backend.models import (
    AcceptRequest,
    BibleUpdateRequest,
    OutlineUpdateRequest,
    CheckRequest,
    DraftRequest,
    DraftStateResponse,
    ReviseRequest,
)
from backend.settings import get_jwt_secret

_FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
_DIST_DIR = _FRONTEND_DIR / "dist"
_INDEX_HTML = _DIST_DIR / "index.html"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail the deploy here rather than at the first login attempt: a missing
    # JWT_SECRET otherwise looks like a healthy service until a user tries to
    # sign in and gets a 500.
    get_jwt_secret()
    await init_db()
    yield


app = FastAPI(title="Maya", lifespan=lifespan)
# Hashed JS/CSS emitted by `vite build`. check_dir=False so the backend still
# boots before the first `npm run build` has produced frontend/dist.
app.mount("/assets", StaticFiles(directory=str(_DIST_DIR / "assets"), check_dir=False), name="assets")
# Backwards-compatible mount for any /static/* assets referenced directly.
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
    return await load_bible(db, project_id)


@app.put("/projects/{project_id}/bible")
async def update_bible(
    project_id: uuid.UUID,
    request: BibleUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    await save_bible(db, project_id, request.model_dump())
    return {"status": "saved"}


# ---------------------------------------------------------------------------
# Outline
# ---------------------------------------------------------------------------

@app.get("/projects/{project_id}/outline")
async def get_outline(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    return await load_outline(db, project_id)


@app.put("/projects/{project_id}/outline")
async def update_outline(
    project_id: uuid.UUID,
    request: OutlineUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    await save_outline(db, project_id, request.model_dump())
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
    result = await planner_node(state)
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
    result = await drafter_node(state)
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
    result = await checker_node(state)
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
    result = await drafter_node(state)
    state.update(result)
    await save_draft_state(db, project_id, chapter_number, {
        "step": "draft",
        "scene_plan": state["scene_plan"],
        "draft": state["draft"],
        "issues": [],
    })
    return {"draft": state["draft"]}


# ---------------------------------------------------------------------------
# Streaming (Draft / Revise) — SSE
# ---------------------------------------------------------------------------

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@app.post("/projects/{project_id}/chapters/{chapter_number}/draft/stream")
async def generate_draft_stream(
    project_id: uuid.UUID,
    chapter_number: int,
    body: DraftRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    state = await _base_state(project_id, chapter_number, db)
    state["scene_plan"] = body.scene_plan

    async def gen():
        buf = []
        try:
            async for text in drafter_token_stream(state):
                buf.append(text)
                yield _sse({"type": "delta", "text": text})
            draft = "".join(buf)
            await save_draft_state(db, project_id, chapter_number, {"step": "draft", "scene_plan": body.scene_plan, "draft": draft, "issues": []})
            yield _sse({"type": "done", "draft": draft})
        except Exception as e:
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@app.post("/projects/{project_id}/chapters/{chapter_number}/revise/stream")
async def revise_draft_stream(
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

    async def gen():
        buf = []
        try:
            async for text in drafter_token_stream(state):
                buf.append(text)
                yield _sse({"type": "delta", "text": text})
            draft = "".join(buf)
            await save_draft_state(db, project_id, chapter_number, {"step": "draft", "scene_plan": state["scene_plan"], "draft": draft, "issues": []})
            yield _sse({"type": "done", "draft": draft})
        except Exception as e:
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


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
    overwrite: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    if await chapter_exists(db, project_id, chapter_number) and not overwrite:
        raise HTTPException(status_code=409, detail=f"Chapter {chapter_number} already exists")
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

def _serve_spa() -> FileResponse:
    if not _INDEX_HTML.exists():
        raise HTTPException(
            status_code=503,
            detail="Frontend build not found. Run `npm run build` in frontend/ first.",
        )
    return FileResponse(_INDEX_HTML)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    return _serve_spa()


# Client-side routes (e.g. /projects/{id}) must resolve to the SPA on a hard
# reload. This catch-all is registered last, so it only handles GET paths that
# no API route or static mount matched; unknown API paths still 404 normally.
@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    return _serve_spa()
