import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
_logger = logging.getLogger(__name__)

from backend.auth import create_access_token, get_current_user, hash_password, verify_password
from backend.bible_markdown import BIBLE_TEMPLATE
from backend.db import get_db, init_db
from backend.db_models import Document, Project, User
from backend.routes import documents as documents_routes
from backend.routes import generate as generate_routes
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
