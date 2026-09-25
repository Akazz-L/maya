import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
_logger = logging.getLogger(__name__)

from backend.agents.reviewers import reviewer_options
from backend.auth import get_current_user
from backend.billing import BillingDisabled
from backend.bible_markdown import BIBLE_TEMPLATE
from backend.db import get_db, init_db
from backend.db_models import Document, Project, User
from backend.routes import billing as billing_routes
from backend.routes import chat as chat_routes
from backend.routes import documents as documents_routes
from backend.llm import MODELS
from backend.routes import generate as generate_routes
from backend.settings import get_clerk_secret_key
from backend.usage import entitlement
from backend.usage import snapshot as usage_snapshot

_FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
_DIST_DIR = _FRONTEND_DIR / "dist"
_INDEX_HTML = _DIST_DIR / "index.html"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail the deploy here rather than at the first request: a missing
    # CLERK_SECRET_KEY otherwise looks like a healthy service until a signed-in
    # writer calls the API and gets a 500.
    get_clerk_secret_key()
    await init_db()
    yield


app = FastAPI(title="Maya", lifespan=lifespan)
# Hashed JS/CSS emitted by `vite build`. check_dir=False so the backend still
# boots before the first `npm run build` has produced frontend/dist.
app.mount("/assets", StaticFiles(directory=str(_DIST_DIR / "assets"), check_dir=False), name="assets")
# Backwards-compatible mount for any /static/* assets referenced directly.
app.mount("/static", StaticFiles(directory=str(_FRONTEND_DIR), check_dir=False), name="static")


@app.exception_handler(BillingDisabled)
async def billing_disabled(request: Request, exc: BillingDisabled):
    return JSONResponse(status_code=503, content={"detail": "Billing is not enabled."})


# ---------------------------------------------------------------------------
# Account: model choice, plan and AI budget
# ---------------------------------------------------------------------------

class ModelOption(BaseModel):
    key: str
    label: str
    hint: str


class CurrentPlan(BaseModel):
    key: str
    label: str
    #: When a paid plan stops renewing, if it has been cancelled.
    ends_at: datetime | None


class MeResponse(BaseModel):
    # `model_key` collides with Pydantic's protected `model_` namespace, which
    # would otherwise warn on every import.
    model_config = ConfigDict(protected_namespaces=())

    model_key: str
    #: The catalogue the picker renders. Served from the backend so labels and
    #: relative cost live only in backend/llm.py.
    models: list[ModelOption]
    plan: CurrentPlan
    usage: dict


class ModelUpdate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    model_key: str


def _model_options() -> list[ModelOption]:
    return [ModelOption(key=k, label=s.label, hint=s.hint) for k, s in MODELS.items()]


async def _me(db: AsyncSession, user: User) -> MeResponse:
    current = await entitlement(db, user)
    return MeResponse(
        model_key=user.model_key,
        models=_model_options(),
        plan=CurrentPlan(key=current.plan.key, label=current.plan.label, ends_at=current.ends_at),
        usage=(await usage_snapshot(db, user, current=current)).as_dict(),
    )


@app.get("/me", response_model=MeResponse)
async def read_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _me(db, current_user)


@app.patch("/me", response_model=MeResponse)
async def update_me(
    body: ModelUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change which model this writer generates with.

    Takes effect on the next call; a generation already streaming keeps the
    model it started on.
    """
    if body.model_key not in MODELS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown model {body.model_key!r}. Choose one of: {', '.join(MODELS)}.",
        )
    current_user.model_key = body.model_key
    await db.commit()
    return await _me(db, current_user)


# ---------------------------------------------------------------------------
# Specialist agents
# ---------------------------------------------------------------------------

class AgentOption(BaseModel):
    key: str
    label: str
    hint: str


@app.get("/agents", response_model=list[AgentOption])
def list_agents(current_user: User = Depends(get_current_user)):
    """The specialist passes the chat's "+" picker offers. Served from the
    backend so a new reviewer reaches the UI by being registered, and its label
    lives only in backend/agents/reviewers.py."""
    return reviewer_options()


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectCreateRequest(BaseModel):
    name: str


@app.post("/projects", status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = Project(user_id=current_user.id, name=body.name)
    db.add(project)
    await db.flush()
    # Every project opens on a story bible; seed it with the conventional headings.
    db.add(Document(
        project_id=project.id,
        title="Story Bible",
        kind="bible",
        body=BIBLE_TEMPLATE,
        position=0,
    ))
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
    return {"project_id": str(project.id), "name": project.name}


# ---------------------------------------------------------------------------
# Documents & generation
# ---------------------------------------------------------------------------

app.include_router(documents_routes.router)
app.include_router(generate_routes.router)
app.include_router(chat_routes.router)
app.include_router(billing_routes.router)


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


# Client-side routes (e.g. /p/{id}/d/{id}) must resolve to the SPA on a hard
# reload. This catch-all is registered last, so it only handles GET paths that
# no API route or static mount matched; unknown API paths still 404 normally.
@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    return _serve_spa()
