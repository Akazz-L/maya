import json
import pytest
from unittest.mock import patch


@pytest.mark.asyncio
async def test_register_and_login(db):
    from httpx import ASGITransport, AsyncClient
    from backend.main import app
    from backend.db import get_db

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/auth/register", json={"email": "new@example.com", "password": "pass"})
            assert resp.status_code == 201

            resp = await client.post("/auth/token", json={"email": "new@example.com", "password": "pass"})
            assert resp.status_code == 200
            assert "access_token" in resp.json()
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_register_duplicate_email(db):
    from httpx import ASGITransport, AsyncClient
    from backend.main import app
    from backend.db import get_db

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post("/auth/register", json={"email": "dup@example.com", "password": "pass"})
            resp = await client.post("/auth/register", json={"email": "dup@example.com", "password": "pass"})
            assert resp.status_code == 409
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_bible(authed_client):
    client, project_id = authed_client
    resp = await client.get(f"/projects/{project_id}/bible")
    assert resp.status_code == 200
    data = resp.json()
    assert any(c["name"] == "Elena" for c in data["characters"])


@pytest.mark.asyncio
async def test_put_bible(authed_client):
    client, project_id = authed_client
    new_bible = {"characters": [], "world": {"locations": [], "rules": []}, "timeline": [], "style_guide": {"voice": "new", "avoid": []}}
    resp = await client.put(f"/projects/{project_id}/bible", json=new_bible)
    assert resp.status_code == 200
    assert resp.json() == {"status": "saved"}


@pytest.mark.asyncio
async def test_list_projects(authed_client):
    client, project_id = authed_client
    resp = await client.get("/projects")
    assert resp.status_code == 200
    projects = resp.json()
    assert len(projects) >= 1
    assert any(p["project_id"] == project_id for p in projects)


@pytest.mark.asyncio
async def test_get_project(authed_client):
    client, project_id = authed_client
    resp = await client.get(f"/projects/{project_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_id"] == project_id
    assert data["name"] == "Test Novel"


@pytest.mark.asyncio
async def test_accept_chapter(authed_client, sample_scene_plan):
    client, project_id = authed_client
    body = {"scene_plan": sample_scene_plan, "draft": "Elena stood at the gates.", "issues": []}
    resp = await client.put(f"/projects/{project_id}/chapters/1/accept", json=body)
    assert resp.status_code == 200
    assert resp.json() == {"status": "saved"}


@pytest.mark.asyncio
async def test_get_chapter_not_found(authed_client):
    client, project_id = authed_client
    resp = await client.get(f"/projects/{project_id}/chapters/99")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_chapter_after_accept(authed_client, sample_scene_plan):
    client, project_id = authed_client
    body = {"scene_plan": sample_scene_plan, "draft": "Elena stood at the gates.", "issues": []}
    await client.put(f"/projects/{project_id}/chapters/1/accept", json=body)
    resp = await client.get(f"/projects/{project_id}/chapters/1")
    assert resp.status_code == 200
    assert resp.json()["draft"] == "Elena stood at the gates."


@pytest.mark.asyncio
async def test_chapter_state_empty(authed_client):
    client, project_id = authed_client
    resp = await client.get(f"/projects/{project_id}/chapters/1/state")
    assert resp.status_code == 200
    assert resp.json() is None


@pytest.mark.asyncio
async def test_generate_plan_chapter_out_of_range(authed_client):
    client, project_id = authed_client
    resp = await client.post(f"/projects/{project_id}/chapters/99/plan")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_unauthorized_access(authed_client):
    client, project_id = authed_client
    from httpx import ASGITransport, AsyncClient
    from backend.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon_client:
        resp = await anon_client.get(f"/projects/{project_id}/bible")
        assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_project_not_accessible_by_other_user(db):
    from httpx import ASGITransport, AsyncClient
    from backend.main import app
    from backend.db import get_db

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # User A creates a project
            await client.post("/auth/register", json={"email": "a@example.com", "password": "pass"})
            resp = await client.post("/auth/token", json={"email": "a@example.com", "password": "pass"})
            token_a = resp.json()["access_token"]
            headers_a = {"Authorization": f"Bearer {token_a}"}

            resp = await client.post("/projects", json={"name": "A's Novel"}, headers=headers_a)
            project_id = resp.json()["project_id"]

            # User B tries to access it
            await client.post("/auth/register", json={"email": "b@example.com", "password": "pass"})
            resp = await client.post("/auth/token", json={"email": "b@example.com", "password": "pass"})
            token_b = resp.json()["access_token"]
            headers_b = {"Authorization": f"Bearer {token_b}"}

            resp = await client.get(f"/projects/{project_id}/bible", headers=headers_b)
            assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Streaming (SSE), accept guard, outline
# ---------------------------------------------------------------------------

def _parse_sse(text: str) -> list[dict]:
    """Parse an SSE response body into a list of decoded data payloads."""
    frames = []
    for chunk in text.split("\n\n"):
        chunk = chunk.strip()
        if chunk.startswith("data: "):
            frames.append(json.loads(chunk[len("data: "):]))
    return frames


def _fake_stream(texts):
    async def _gen(state):
        for t in texts:
            yield t
    return _gen


@pytest.mark.asyncio
async def test_draft_stream_emits_deltas_done_and_persists(authed_client, sample_scene_plan):
    client, project_id = authed_client
    with patch("backend.main.drafter_token_stream", _fake_stream(["Hello ", "world."])):
        resp = await client.post(
            f"/projects/{project_id}/chapters/1/draft/stream",
            json={"scene_plan": sample_scene_plan},
        )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    frames = _parse_sse(resp.text)
    assert frames[:2] == [
        {"type": "delta", "text": "Hello "},
        {"type": "delta", "text": "world."},
    ]
    assert frames[-1] == {"type": "done", "draft": "Hello world."}
    # Stream end persisted the full draft to draft_state.
    state_resp = await client.get(f"/projects/{project_id}/chapters/1/state")
    assert state_resp.json()["draft"] == "Hello world."


@pytest.mark.asyncio
async def test_revise_stream_emits_done(authed_client, sample_scene_plan):
    client, project_id = authed_client
    body = {"draft": "Old draft.", "issues": [
        {"issue": "x", "severity": "minor", "location": "p1", "suggested_fix": "y"}]}
    with patch("backend.main.drafter_token_stream", _fake_stream(["Revised ", "prose."])):
        resp = await client.post(f"/projects/{project_id}/chapters/1/revise/stream", json=body)
    assert resp.status_code == 200
    frames = _parse_sse(resp.text)
    assert {"type": "delta", "text": "Revised "} in frames
    assert frames[-1] == {"type": "done", "draft": "Revised prose."}


@pytest.mark.asyncio
async def test_draft_stream_error_frame(authed_client, sample_scene_plan):
    client, project_id = authed_client

    async def boom(state):
        raise RuntimeError("api exploded")
        yield  # pragma: no cover  (make it an async generator)

    with patch("backend.main.drafter_token_stream", boom):
        resp = await client.post(
            f"/projects/{project_id}/chapters/1/draft/stream",
            json={"scene_plan": sample_scene_plan},
        )
    frames = _parse_sse(resp.text)
    assert frames[-1] == {"type": "error", "detail": "api exploded"}


@pytest.mark.asyncio
async def test_accept_guard_blocks_then_overwrite(authed_client, sample_scene_plan):
    client, project_id = authed_client
    body = {"scene_plan": sample_scene_plan, "draft": "First.", "issues": []}
    # First accept succeeds.
    resp = await client.put(f"/projects/{project_id}/chapters/1/accept", json=body)
    assert resp.status_code == 200
    # Second accept without overwrite is blocked.
    resp = await client.put(f"/projects/{project_id}/chapters/1/accept", json=body)
    assert resp.status_code == 409
    # With overwrite it succeeds.
    resp = await client.put(f"/projects/{project_id}/chapters/1/accept?overwrite=true", json=body)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_outline_get_and_put(authed_client):
    client, project_id = authed_client
    resp = await client.get(f"/projects/{project_id}/outline")
    assert resp.status_code == 200
    chapters = resp.json()["chapters"]
    assert any("Elena" in ch for ch in chapters)

    new_outline = {"chapters": ["Elena arrives", "Elena departs"]}
    resp = await client.put(f"/projects/{project_id}/outline", json=new_outline)
    assert resp.status_code == 200
    resp = await client.get(f"/projects/{project_id}/outline")
    assert "Elena departs" in resp.json()["chapters"]
