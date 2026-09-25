import pytest


@pytest.mark.asyncio
async def test_first_request_creates_the_user_once(api_client, db):
    from sqlalchemy import func, select
    from backend.db_models import User

    api_client.headers["Authorization"] = "Bearer user_new"
    assert (await api_client.get("/projects")).status_code == 200
    assert (await api_client.get("/projects")).status_code == 200

    count = await db.scalar(
        select(func.count()).select_from(User).where(User.clerk_user_id == "user_new")
    )
    assert count == 1


@pytest.mark.asyncio
async def test_request_without_a_session_is_refused(api_client):
    resp = await api_client.get("/projects")
    assert resp.status_code == 401


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
async def test_project_not_accessible_by_other_user(api_client):
    api_client.headers["Authorization"] = "Bearer user_owner"
    project_id = (await api_client.post("/projects", json={"name": "Owned"})).json()["project_id"]

    # A second user must not see it.
    api_client.headers["Authorization"] = "Bearer user_other"
    assert (await api_client.get(f"/projects/{project_id}")).status_code == 404
    assert (await api_client.get(f"/projects/{project_id}/documents")).status_code == 404
