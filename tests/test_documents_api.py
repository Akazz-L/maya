import pytest


@pytest.mark.asyncio
async def test_new_project_has_a_seeded_bible(authed_client):
    from backend.bible_markdown import BIBLE_TEMPLATE

    client, project_id = authed_client
    resp = await client.get(f"/projects/{project_id}/documents")
    assert resp.status_code == 200
    docs = resp.json()
    assert len(docs) == 1
    assert docs[0]["kind"] == "bible"
    assert docs[0]["title"] == "Story Bible"

    detail = await client.get(f"/projects/{project_id}/documents/{docs[0]['id']}")
    assert detail.json()["body"] == BIBLE_TEMPLATE


@pytest.mark.asyncio
async def test_list_omits_bodies(authed_client):
    client, project_id = authed_client
    docs = (await client.get(f"/projects/{project_id}/documents")).json()
    assert "body" not in docs[0]
    assert set(docs[0]) == {"id", "title", "kind", "position", "updated_at"}


@pytest.mark.asyncio
async def test_create_defaults_to_chapter(authed_client):
    client, project_id = authed_client
    resp = await client.post(f"/projects/{project_id}/documents", json={})
    assert resp.status_code == 201
    assert resp.json()["kind"] == "chapter"
    assert resp.json()["title"] == "Untitled"
    assert resp.json()["position"] == 1


@pytest.mark.asyncio
async def test_patch_updates_title_body_and_brief(authed_client):
    client, project_id = authed_client
    doc_id = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Ch 1"})
    ).json()["id"]

    resp = await client.patch(
        f"/projects/{project_id}/documents/{doc_id}",
        json={"body": "The rain had not stopped.", "brief": "Mara waits."},
    )
    assert resp.status_code == 200
    assert resp.json()["body"] == "The rain had not stopped."
    assert resp.json()["brief"] == "Mara waits."


@pytest.mark.asyncio
async def test_patch_leaves_omitted_fields_alone(authed_client):
    client, project_id = authed_client
    doc_id = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Ch 1"})
    ).json()["id"]
    await client.patch(f"/projects/{project_id}/documents/{doc_id}", json={"body": "Prose."})

    resp = await client.patch(
        f"/projects/{project_id}/documents/{doc_id}", json={"brief": "A beat."}
    )
    assert resp.json()["body"] == "Prose."


@pytest.mark.asyncio
async def test_patch_can_null_a_plan(authed_client):
    client, project_id = authed_client
    doc_id = (await client.post(f"/projects/{project_id}/documents", json={})).json()["id"]
    await client.patch(
        f"/projects/{project_id}/documents/{doc_id}", json={"plan": {"goal": "Escape"}}
    )

    resp = await client.patch(f"/projects/{project_id}/documents/{doc_id}", json={"plan": None})
    assert resp.json()["plan"] is None


@pytest.mark.asyncio
async def test_delete_bible_returns_409(authed_client):
    client, project_id = authed_client
    docs = (await client.get(f"/projects/{project_id}/documents")).json()
    resp = await client.delete(f"/projects/{project_id}/documents/{docs[0]['id']}")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_delete_chapter_succeeds(authed_client):
    client, project_id = authed_client
    doc_id = (await client.post(f"/projects/{project_id}/documents", json={})).json()["id"]
    assert (await client.delete(f"/projects/{project_id}/documents/{doc_id}")).status_code == 204
    assert len((await client.get(f"/projects/{project_id}/documents")).json()) == 1


@pytest.mark.asyncio
async def test_reorder(authed_client):
    client, project_id = authed_client
    a = (await client.post(f"/projects/{project_id}/documents", json={"title": "A"})).json()["id"]
    b = (await client.post(f"/projects/{project_id}/documents", json={"title": "B"})).json()["id"]
    bible = (await client.get(f"/projects/{project_id}/documents")).json()[0]["id"]

    resp = await client.put(
        f"/projects/{project_id}/documents/order", json={"document_ids": [bible, b, a]}
    )
    assert resp.status_code == 204
    titles = [d["title"] for d in (await client.get(f"/projects/{project_id}/documents")).json()]
    assert titles == ["Story Bible", "B", "A"]


@pytest.mark.asyncio
async def test_reorder_rejects_a_partial_list(authed_client):
    client, project_id = authed_client
    a = (await client.post(f"/projects/{project_id}/documents", json={"title": "A"})).json()["id"]
    resp = await client.put(
        f"/projects/{project_id}/documents/order", json={"document_ids": [a]}
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_invalid_kind_rejected(authed_client):
    client, project_id = authed_client
    resp = await client.post(f"/projects/{project_id}/documents", json={"kind": "poem"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_documents_not_visible_across_projects(authed_client):
    client, project_id = authed_client
    other = (await client.post("/projects", json={"name": "Other"})).json()["project_id"]
    doc_id = (await client.post(f"/projects/{project_id}/documents", json={})).json()["id"]

    assert (await client.get(f"/projects/{other}/documents/{doc_id}")).status_code == 404
