import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException


@pytest_asyncio.fixture
async def project(db):
    from backend.db_models import Project, User

    user = User(email="doc@test.com", hashed_password="x")
    db.add(user)
    await db.flush()
    project = Project(user_id=user.id, name="P")
    db.add(project)
    await db.commit()
    return project


@pytest.mark.asyncio
async def test_create_appends_at_end(db, project):
    from backend.doc_storage import create_document, list_documents

    a = await create_document(db, project.id, title="A")
    b = await create_document(db, project.id, title="B")
    assert (a.position, b.position) == (0, 1)
    assert [d.title for d in await list_documents(db, project.id)] == ["A", "B"]


@pytest.mark.asyncio
async def test_create_rejects_unknown_kind(db, project):
    from backend.doc_storage import create_document

    with pytest.raises(HTTPException) as exc:
        await create_document(db, project.id, kind="poem")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_get_document_missing_raises_404(db, project):
    from backend.doc_storage import get_document

    with pytest.raises(HTTPException) as exc:
        await get_document(db, project.id, uuid.uuid4())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_bible_raises_409(db, project):
    from backend.doc_storage import create_document, delete_document

    bible = await create_document(db, project.id, title="Story Bible", kind="bible")
    with pytest.raises(HTTPException) as exc:
        await delete_document(db, project.id, bible.id)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_delete_closes_position_gap(db, project):
    from backend.doc_storage import create_document, delete_document, list_documents

    a = await create_document(db, project.id, title="A")
    b = await create_document(db, project.id, title="B")
    c = await create_document(db, project.id, title="C")
    await delete_document(db, project.id, b.id)
    remaining = await list_documents(db, project.id)
    assert [(d.title, d.position) for d in remaining] == [("A", 0), ("C", 1)]
    assert {d.id for d in remaining} == {a.id, c.id}


@pytest.mark.asyncio
async def test_reorder_renumbers(db, project):
    from backend.doc_storage import create_document, list_documents, reorder_documents

    a = await create_document(db, project.id, title="A")
    b = await create_document(db, project.id, title="B")
    c = await create_document(db, project.id, title="C")
    await reorder_documents(db, project.id, [c.id, a.id, b.id])
    assert [d.title for d in await list_documents(db, project.id)] == ["C", "A", "B"]


@pytest.mark.asyncio
async def test_reorder_rejects_incomplete_list(db, project):
    from backend.doc_storage import create_document, reorder_documents

    a = await create_document(db, project.id, title="A")
    await create_document(db, project.id, title="B")
    with pytest.raises(HTTPException) as exc:
        await reorder_documents(db, project.id, [a.id])
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_update_clears_the_summary_hash_when_the_body_changes(db, project):
    from backend.doc_storage import body_hash, create_document, update_document

    doc = await create_document(db, project.id, title="A", body="Old.")
    doc.summary, doc.summary_hash = "cached", body_hash("Old.")
    await db.commit()

    await update_document(db, doc, body="New.")
    assert doc.summary_hash is None


@pytest.mark.asyncio
async def test_update_can_null_a_plan(db, project):
    """Dropping a plan sends plan=None explicitly; it must not be skipped."""
    from backend.doc_storage import create_document, update_document

    doc = await create_document(db, project.id, title="A")
    await update_document(db, doc, plan={"goal": "Escape"})
    assert doc.plan == {"goal": "Escape"}

    await update_document(db, doc, plan=None)
    assert doc.plan is None


@pytest.mark.asyncio
async def test_body_hash_changes_with_body():
    from backend.doc_storage import body_hash

    assert body_hash("abc") == body_hash("abc")
    assert body_hash("abc") != body_hash("abd")
    assert len(body_hash("abc")) == 64


@pytest.mark.asyncio
async def test_get_bible_body_returns_empty_when_absent(db, project):
    from backend.doc_storage import get_bible_body

    assert await get_bible_body(db, project.id) == ""
