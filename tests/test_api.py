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


def _parse_sse(text):
    """Parse SSE response body into a list of decoded data payloads."""
    import json
    frames = []
    for chunk in text.split("\n\n"):
        chunk = chunk.strip()
        if chunk.startswith("data: "):
            frames.append(json.loads(chunk[len("data: "):]))
    return frames


def test_generate_draft_stream(client, sample_scene_plan):
    with patch("backend.main.drafter_token_stream", return_value=iter(["Hello ", "world."])):
        response = client.post("/chapter/1/draft/stream", json={"scene_plan": sample_scene_plan})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    frames = _parse_sse(response.text)
    assert frames[:2] == [
        {"type": "delta", "text": "Hello "},
        {"type": "delta", "text": "world."},
    ]
    assert frames[-1] == {"type": "done", "draft": "Hello world."}
    # Stream end persisted the full draft to draft_state.
    import backend.storage as storage
    assert storage.load_draft_state(1)["draft"] == "Hello world."


def test_revise_draft_stream(client, sample_scene_plan):
    # Seed prior draft state so revise can resolve the scene plan.
    import backend.storage as storage
    storage.save_draft_state(1, {"step": "check", "scene_plan": sample_scene_plan,
                                  "draft": "Old draft.", "issues": []})
    body = {"draft": "Old draft.", "issues": [
        {"issue": "x", "severity": "minor", "location": "p1", "suggested_fix": "y"}]}
    with patch("backend.main.drafter_token_stream", return_value=iter(["Revised ", "prose."])):
        response = client.post("/chapter/1/revise/stream", json=body)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    frames = _parse_sse(response.text)
    assert {"type": "delta", "text": "Revised "} in frames
    assert frames[-1] == {"type": "done", "draft": "Revised prose."}
    assert storage.load_draft_state(1)["draft"] == "Revised prose."


def test_draft_stream_error_frame(client, sample_scene_plan):
    def boom(state):
        raise RuntimeError("api exploded")
        yield  # pragma: no cover  (make it a generator)

    with patch("backend.main.drafter_token_stream", boom):
        response = client.post("/chapter/1/draft/stream", json={"scene_plan": sample_scene_plan})
    assert response.status_code == 200
    frames = _parse_sse(response.text)
    assert frames[-1] == {"type": "error", "detail": "api exploded"}
