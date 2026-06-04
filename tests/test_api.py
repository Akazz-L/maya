import pytest
import yaml
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
    assert "Elena" in resp.json()["content"]


@pytest.mark.asyncio
async def test_put_bible(authed_client):
    client, project_id = authed_client
    new_bible = {"characters": [], "world": {"locations": [], "rules": []}, "timeline": [], "style_guide": {"voice": "new", "avoid": []}}
    resp = await client.put(f"/projects/{project_id}/bible", json={"content": yaml.dump(new_bible)})
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
