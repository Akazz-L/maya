import json
import uuid

import pytest
import pytest_asyncio

from backend import db_storage as storage
from backend.db_models import Project, User
from backend.auth import hash_password


@pytest_asyncio.fixture
async def project(db) -> tuple:
    """Create a test user and project seeded with JSON content."""
    user = User(email="writer@example.com", hashed_password=hash_password("pw"))
    db.add(user)
    await db.flush()

    bible_json = json.dumps({
        "characters": [{"name": "Elena", "traits": ["determined", "left-handed"], "dialogue_examples": ["I won't wait.", "The Citadel takes."]}],
        "world": {"locations": ["The Citadel", "The Wastes"], "rules": ["Magic requires physical cost"]},
        "timeline": [],
        "style_guide": {"voice": "sparse and precise", "avoid": ["adverbs ending in -ly"]},
    })
    outline_json = json.dumps({"chapters": ["Elena arrives at the gates", "Elena finds lodging"]})

    proj = Project(
        user_id=user.id,
        name="Test Novel",
        bible_content=bible_json,
        outline_content=outline_json,
    )
    db.add(proj)
    await db.commit()
    return db, proj.id


@pytest.mark.asyncio
async def test_load_bible(project):
    db, project_id = project
    result = await storage.load_bible(db, project_id)
    assert result["characters"][0]["name"] == "Elena"


@pytest.mark.asyncio
async def test_load_bible_returns_empty_on_non_json(db):
    """Old YAML content falls back to EMPTY_BIBLE rather than crashing."""
    user = User(email="x@x.com", hashed_password=hash_password("pw"))
    db.add(user)
    await db.flush()
    proj = Project(user_id=user.id, name="x", bible_content="characters:\n  - name: Elena\n", outline_content="{}")
    db.add(proj)
    await db.commit()
    result = await storage.load_bible(db, proj.id)
    assert result["characters"] == []
    assert result["world"] == {"locations": [], "rules": []}


@pytest.mark.asyncio
async def test_load_outline(project):
    db, project_id = project
    result = await storage.load_outline(db, project_id)
    assert len(result["chapters"]) == 2
    assert "Elena" in result["chapters"][0]


@pytest.mark.asyncio
async def test_save_bible_and_reload(project, sample_bible):
    db, project_id = project
    new_data = {**sample_bible, "world": {"locations": ["New Place"], "rules": []}}
    await storage.save_bible(db, project_id, new_data)
    result = await storage.load_bible(db, project_id)
    assert result["world"]["locations"] == ["New Place"]


@pytest.mark.asyncio
async def test_save_bible_rejects_non_dict(project):
    db, project_id = project
    with pytest.raises(ValueError):
        await storage.save_bible(db, project_id, ["list", "item"])


@pytest.mark.asyncio
async def test_save_outline_and_reload(project):
    db, project_id = project
    await storage.save_outline(db, project_id, {"chapters": ["Elena arrives", "Elena departs"]})
    result = await storage.load_outline(db, project_id)
    assert result["chapters"] == ["Elena arrives", "Elena departs"]


@pytest.mark.asyncio
async def test_save_outline_rejects_missing_chapters(project):
    db, project_id = project
    with pytest.raises(ValueError):
        await storage.save_outline(db, project_id, {"title": "My Book"})


@pytest.mark.asyncio
async def test_load_summaries_empty(project):
    db, project_id = project
    result = await storage.load_summaries(db, project_id, 1)
    assert result == []


@pytest.mark.asyncio
async def test_load_summaries_reads_previous_chapters(project):
    db, project_id = project
    await storage.save_chapter(db, project_id, 1, {}, "Draft 1", [])
    await storage.save_chapter(db, project_id, 2, {}, "Draft 2", [])
    await storage.save_summary(db, project_id, 1, "Elena reached the gates.")
    await storage.save_summary(db, project_id, 2, "Elena found lodging.")
    result = await storage.load_summaries(db, project_id, 3)
    assert len(result) == 2
    assert "reached the gates" in result[0]
    assert "found lodging" in result[1]


@pytest.mark.asyncio
async def test_load_summaries_stops_before_current_chapter(project):
    db, project_id = project
    await storage.save_chapter(db, project_id, 1, {}, "Draft 1", [])
    await storage.save_summary(db, project_id, 1, "Chapter 1.")
    result = await storage.load_summaries(db, project_id, 1)
    assert result == []


@pytest.mark.asyncio
async def test_save_and_load_chapter(project, sample_scene_plan):
    db, project_id = project
    draft = "Elena stood at the gates."
    issues = [{"issue": "test", "severity": "minor", "location": "para 1", "suggested_fix": "fix"}]
    await storage.save_chapter(db, project_id, 1, sample_scene_plan, draft, issues)

    result = await storage.load_chapter(db, project_id, 1)
    assert result["plan"]["goal"] == sample_scene_plan["goal"]
    assert result["draft"] == draft
    assert result["issues"][0]["issue"] == "test"


@pytest.mark.asyncio
async def test_load_chapter_not_found(project):
    db, project_id = project
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await storage.load_chapter(db, project_id, 99)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_draft_state_roundtrip(project):
    db, project_id = project
    await storage.save_chapter(db, project_id, 1, {}, None, [])
    state = {"step": "draft", "scene_plan": {"goal": "test"}, "draft": "Some text", "issues": []}
    await storage.save_draft_state(db, project_id, 1, state)
    loaded = await storage.load_draft_state(db, project_id, 1)
    assert loaded["step"] == "draft"
    assert loaded["scene_plan"]["goal"] == "test"
    assert loaded["draft"] == "Some text"


@pytest.mark.asyncio
async def test_delete_draft_state(project):
    db, project_id = project
    await storage.save_chapter(db, project_id, 1, {}, None, [])
    await storage.save_draft_state(db, project_id, 1, {"step": "plan", "scene_plan": {}, "draft": "", "issues": []})
    await storage.delete_draft_state(db, project_id, 1)
    loaded = await storage.load_draft_state(db, project_id, 1)
    assert loaded is None


@pytest.mark.asyncio
async def test_save_and_load_summary(project):
    db, project_id = project
    await storage.save_chapter(db, project_id, 1, {}, "Draft 1", [])
    await storage.save_summary(db, project_id, 1, "Elena reached the gates.")
    result = await storage.load_summaries(db, project_id, 2)
    assert len(result) == 1
    assert "Elena reached the gates." in result[0]


@pytest.mark.asyncio
async def test_chapter_exists(project, sample_scene_plan):
    db, project_id = project
    assert await storage.chapter_exists(db, project_id, 1) is False
    await storage.save_chapter(db, project_id, 1, sample_scene_plan, "Elena stood at the gates.", [])
    assert await storage.chapter_exists(db, project_id, 1) is True
    assert await storage.chapter_exists(db, project_id, 2) is False
