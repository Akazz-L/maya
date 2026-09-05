import pytest


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
    # bible_content / outline_content are gone: the story bible is a document now.
    assert resp.json() == {"project_id": project_id, "name": "Test Novel"}


@pytest.mark.asyncio
async def test_unauthorized_access(authed_client):
    client, project_id = authed_client
    from httpx import ASGITransport, AsyncClient
    from backend.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon_client:
        resp = await anon_client.get(f"/projects/{project_id}/documents")
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
            # Owner creates a project.
            await client.post("/auth/register", json={"email": "owner@example.com", "password": "pw"})
            token = (
                await client.post("/auth/token", json={"email": "owner@example.com", "password": "pw"})
            ).json()["access_token"]
            client.headers["Authorization"] = f"Bearer {token}"
            project_id = (await client.post("/projects", json={"name": "Owned"})).json()["project_id"]

            # A second user must not see it.
            await client.post("/auth/register", json={"email": "other@example.com", "password": "pw"})
            other_token = (
                await client.post("/auth/token", json={"email": "other@example.com", "password": "pw"})
            ).json()["access_token"]
            client.headers["Authorization"] = f"Bearer {other_token}"

            assert (await client.get(f"/projects/{project_id}")).status_code == 404
            assert (await client.get(f"/projects/{project_id}/documents")).status_code == 404
    finally:
        app.dependency_overrides.clear()
