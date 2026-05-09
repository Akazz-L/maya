import pytest
import yaml
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch, sample_bible, sample_scene_plan):
    import backend.storage as storage
    monkeypatch.setattr(storage, "BASE_DIR", tmp_path)
    (tmp_path / "chapters").mkdir()
    (tmp_path / "summaries").mkdir()
    (tmp_path / "bible.yaml").write_text(yaml.dump(sample_bible))
    (tmp_path / "outline.yaml").write_text(
        "chapters:\n  - Elena arrives at the gates\n  - Elena finds lodging\n"
    )
    from backend.main import app
    return TestClient(app)


@pytest.fixture
def pipeline_result(sample_scene_plan):
    return {
        "chapter_number": 1,
        "scene_plan": sample_scene_plan,
        "draft": "Elena stood at the gates.",
        "continuity_issues": [],
    }


def test_get_bible(client):
    response = client.get("/bible")
    assert response.status_code == 200
    data = response.json()
    assert "content" in data
    assert "Elena" in data["content"]


def test_put_bible(client):
    new_bible = {"characters": [], "world": {"locations": [], "rules": []}, "timeline": [], "style_guide": {"voice": "new", "avoid": []}}
    response = client.put("/bible", json={"content": yaml.dump(new_bible)})
    assert response.status_code == 200


def test_generate_chapter(client, pipeline_result):
    with patch("backend.main.pipeline") as mock_pipeline:
        mock_pipeline.invoke.return_value = pipeline_result
        response = client.post("/generate/1")
    assert response.status_code == 200
    data = response.json()
    assert data["draft"] == "Elena stood at the gates."
    assert data["chapter_number"] == 1
    assert data["scene_plan"]["goal"] == pipeline_result["scene_plan"]["goal"]


def test_generate_chapter_out_of_range(client):
    response = client.post("/generate/99")
    assert response.status_code == 400


def test_accept_chapter(client, pipeline_result):
    response = client.put("/chapter/1/accept", json=pipeline_result)
    assert response.status_code == 200
    assert response.json() == {"status": "saved"}


def test_get_chapter_not_found(client):
    response = client.get("/chapter/99")
    assert response.status_code == 404


def test_get_chapter_after_accept(client, pipeline_result):
    client.put("/chapter/1/accept", json=pipeline_result)
    response = client.get("/chapter/1")
    assert response.status_code == 200
    data = response.json()
    assert data["draft"] == "Elena stood at the gates."
