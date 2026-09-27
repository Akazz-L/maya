import os
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("CLERK_SECRET_KEY", "sk_test_unit_tests_only")
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


#: The Clerk user id the default authed client signs in as.
TEST_CLERK_USER_ID = "user_test"


@pytest.fixture
def fake_clerk(monkeypatch):
    """Stand in for Clerk's token check: a bearer token is taken to be the
    Clerk user id it was issued to. Everything after that check, from creating
    the local user to project ownership, runs for real."""
    from backend import auth

    async def verify_session(request):
        header = request.headers.get("Authorization", "")
        return header.removeprefix("Bearer ") or None

    monkeypatch.setattr(auth, "verify_session", verify_session)


@pytest_asyncio.fixture
async def api_client(db, fake_clerk):
    """An unauthenticated client against the app, on the test database."""
    from backend.main import app
    from backend.db import get_db

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def authed_client(api_client):
    """Return (AsyncClient, project_id), signed in with one project."""
    api_client.headers["Authorization"] = f"Bearer {TEST_CLERK_USER_ID}"
    # Create project. The story bible document is seeded server-side.
    resp = await api_client.post("/projects", json={"name": "Test Novel"})
    project_id = resp.json()["project_id"]
    return api_client, project_id


@pytest.fixture
def billing(monkeypatch):
    """Stripe configured with the three paid plans at their default budgets:
    Starter $10, Pro $25, Studio $50."""
    monkeypatch.setenv("MONTHLY_BUDGET_USD", "5.00")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_unit_tests_only")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_unit_tests_only")
    for key in ("starter", "pro", "studio"):
        monkeypatch.setenv(f"STRIPE_PRICE_{key.upper()}", f"price_{key}")
        monkeypatch.delenv(f"PLAN_{key.upper()}_BUDGET_USD", raising=False)


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
        "brief": "Elena arrives at the Citadel gates and confronts the Gatekeeper",
        "story_bible": sample_bible,
        "previous_summaries": [],
        "scene_plan": {},
        "draft": "",
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


# ---------------------------------------------------------------------------
# Model / usage helpers
# ---------------------------------------------------------------------------

#: The model every agent test runs as. Tests that care about model-specific
#: request parameters name their own key instead.
MODEL_KEY = "haiku"


def stub_usage(response, input_tokens: int = 120, output_tokens: int = 340):
    """Give a mocked API response a usage block backend.llm can read.

    Without this a MagicMock hands back MagicMock token counts, which are
    truthy and silently poison any cost arithmetic downstream.
    """
    response.usage = SimpleNamespace(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_input_tokens=0,
        cache_creation_input_tokens=0,
    )
    return response
