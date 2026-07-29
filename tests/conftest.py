import os
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET", "test-secret-key-for-unit-tests-only")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

from backend.db_models import Base


# ---------------------------------------------------------------------------
# Async SQLite DB fixture
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def authed_client(db):
    """Return (AsyncClient, project_id) with a registered user and project."""
    from backend.main import app
    from backend.db import get_db

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Register + login
        await client.post("/auth/register", json={"email": "test@example.com", "password": "secret"})
        resp = await client.post("/auth/token", json={"email": "test@example.com", "password": "secret"})
        token = resp.json()["access_token"]
        client.headers["Authorization"] = f"Bearer {token}"

        # Create project. The story bible document is seeded server-side.
        resp = await client.post("/projects", json={"name": "Test Novel"})
        project_id = resp.json()["project_id"]

        yield client, project_id

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Shared data fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_bible():
    """The story bible as a document body — markdown, not a structured dict."""
    return (
        "## Characters\n\n"
        "### Elena\n\n"
        "Traits:\n- determined\n- left-handed\n\n"
        'Dialogue examples:\n- "I won\'t wait."\n- "The Citadel takes."\n\n'
        "## World\n\n"
        "Locations:\n- The Citadel\n- The Wastes\n\n"
        "Rules:\n- Magic requires physical cost\n\n"
        "## Style\n\n"
        "Voice: sparse and precise\n\n"
        "Avoid:\n- adverbs ending in -ly\n- passive voice\n\n"
        "## Timeline\n\n- Elena leaves home\n"
    )


@pytest.fixture
def base_state(sample_bible):
    return {
        "outline_beat": "Elena arrives at the Citadel gates and confronts the Gatekeeper",
        "story_bible": sample_bible,
        "previous_summaries": [],
        "scene_plan": {},
        "draft": "",
        "continuity_issues": [],
    }


@pytest.fixture
def sample_scene_plan():
    return {
        "goal": "Establish Elena's arrival and the first obstacle",
        "pov_character": "Elena",
        "location": "Citadel Lower Gates",
        "beats": [
            "Elena approaches the gates at dusk",
            "Gatekeeper blocks her and demands credentials",
            "Elena reveals her left hand — Gatekeeper recoils",
        ],
        "sensory_anchor": "Cold iron smell, torch smoke, distant bell",
        "opening_image": "Elena silhouetted against a bruised sky, gates ahead",
        "closing_image": "Gate slamming shut, Elena alone outside",
    }
