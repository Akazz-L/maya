# Maya: Multi-Agent Creative Writing Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a LangGraph pipeline of three sequential agents (Planner → Drafter → Checker) with a FastAPI backend and vanilla JS frontend for iterative chapter-by-chapter novel writing.

**Architecture:** LangGraph `StateGraph` with three nodes sharing a `ChapterState` TypedDict. Planner and Checker call Claude with structured tool-use output; Drafter calls Claude at temperature 0.9 with few-shot style injection. FastAPI exposes the pipeline as REST and serves a single-file vanilla JS SPA. Outputs are written to disk only after explicit human approval.

**Tech Stack:** Python 3.11+, `anthropic`, `langgraph`, `fastapi`, `uvicorn`, `pyyaml`, `pydantic`, `pytest`, `httpx`

---

## File Map

```
maya/
├── requirements.txt
├── .gitignore
├── bible.yaml                    # sample story bible
├── outline.yaml                  # sample chapter beats
├── chapters/                     # generated outputs (gitignored)
├── summaries/                    # chapter summaries (gitignored)
├── backend/
│   ├── __init__.py
│   ├── models.py                 # ChapterState TypedDict + Pydantic response models
│   ├── storage.py                # read/write bible, chapters, summaries
│   ├── pipeline.py               # LangGraph StateGraph
│   ├── main.py                   # FastAPI app and routes
│   └── agents/
│       ├── __init__.py
│       ├── planner.py            # planner_node: outline_beat → scene_plan
│       ├── drafter.py            # drafter_node: scene_plan → draft prose
│       └── checker.py            # checker_node: draft → continuity_issues
├── frontend/
│   └── index.html                # vanilla JS SPA
└── tests/
    ├── __init__.py
    ├── conftest.py               # shared fixtures
    ├── test_storage.py
    ├── test_planner.py
    ├── test_drafter.py
    ├── test_checker.py
    ├── test_pipeline.py
    └── test_api.py
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `requirements.txt`
- Create: `.gitignore`
- Create: `bible.yaml`
- Create: `outline.yaml`
- Create: `backend/__init__.py`, `backend/agents/__init__.py`, `tests/__init__.py`

- [ ] **Step 1: Create requirements.txt**

```
anthropic>=0.40.0
langgraph>=0.2.0
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
pyyaml>=6.0.0
pydantic>=2.0.0
python-dotenv>=1.0.0
pytest>=8.0.0
httpx>=0.27.0
```

- [ ] **Step 2: Create .gitignore**

```
__pycache__/
*.pyc
.env
chapters/
summaries/
.pytest_cache/
```

- [ ] **Step 3: Create bible.yaml**

```yaml
characters:
  - name: Elena
    traits:
      - determined
      - left-handed
      - distrustful of authority
    dialogue_examples:
      - "I won't wait for permission."
      - "The Citadel takes. It never gives back."
      - "You think walls keep things out. They keep things in."

world:
  locations:
    - The Citadel
    - The Wastes
    - The Lower Gates
  rules:
    - Magic requires physical cost proportional to effect
    - The Citadel is ruled by the Council of Architects

timeline: []

style_guide:
  voice: sparse and precise, with occasional lyrical moments; never ornate
  avoid:
    - adverbs ending in -ly
    - passive voice constructions
    - was/were + gerund (e.g. "was walking")
    - throat-clearing opening sentences
```

- [ ] **Step 4: Create outline.yaml**

```yaml
chapters:
  - Elena arrives at the Citadel gates at dusk and confronts the Gatekeeper who denies her entry
  - Elena finds lodging in the Lower Gates district and learns the Council has banned left-handed mages
```

- [ ] **Step 5: Create empty __init__.py files**

```bash
touch backend/__init__.py backend/agents/__init__.py tests/__init__.py
mkdir -p chapters summaries
```

- [ ] **Step 6: Install dependencies**

```bash
pip install -r requirements.txt
```

Expected: no errors, packages installed.

- [ ] **Step 7: Commit**

```bash
git add requirements.txt .gitignore bible.yaml outline.yaml backend/__init__.py backend/agents/__init__.py tests/__init__.py
git commit -m "chore: project scaffolding, sample bible and outline"
```

---

## Task 2: Models

**Files:**
- Create: `backend/models.py`
- Create: `tests/conftest.py`

- [ ] **Step 1: Write tests/conftest.py**

```python
import pytest


@pytest.fixture
def sample_bible():
    return {
        "characters": [
            {
                "name": "Elena",
                "traits": ["determined", "left-handed"],
                "dialogue_examples": ["I won't wait.", "The Citadel takes."],
            }
        ],
        "world": {
            "locations": ["The Citadel", "The Wastes"],
            "rules": ["Magic requires physical cost"],
        },
        "timeline": [
            {
                "event": "Elena leaves home",
                "chapter": 0,
                "location": "The Wastes",
                "characters": ["Elena"],
            }
        ],
        "style_guide": {
            "voice": "sparse and precise",
            "avoid": ["adverbs ending in -ly", "passive voice"],
        },
    }


@pytest.fixture
def base_state(sample_bible):
    return {
        "chapter_number": 1,
        "outline_beat": "Elena arrives at the Citadel gates and confronts the Gatekeeper",
        "story_bible": sample_bible,
        "previous_summaries": [],
        "scene_plan": {},
        "draft": "",
        "continuity_issues": [],
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
```

- [ ] **Step 2: Write backend/models.py**

```python
from typing import TypedDict
from pydantic import BaseModel


class ChapterState(TypedDict):
    chapter_number: int
    outline_beat: str
    story_bible: dict
    previous_summaries: list[str]
    scene_plan: dict
    draft: str
    continuity_issues: list[dict]


class GenerateResponse(BaseModel):
    chapter_number: int
    scene_plan: dict
    draft: str
    continuity_issues: list[dict]


class BibleUpdateRequest(BaseModel):
    content: str
```

- [ ] **Step 3: Verify imports work**

```bash
python -c "from backend.models import ChapterState, GenerateResponse, BibleUpdateRequest; print('OK')"
```

Expected output: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/models.py tests/conftest.py
git commit -m "feat: ChapterState TypedDict and Pydantic response models"
```

---

## Task 3: Storage Layer (TDD)

**Files:**
- Create: `tests/test_storage.py`
- Create: `backend/storage.py`

- [ ] **Step 1: Write tests/test_storage.py**

```python
import json
import pytest
import yaml
import backend.storage as storage


@pytest.fixture(autouse=True)
def patch_base_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "BASE_DIR", tmp_path)
    (tmp_path / "chapters").mkdir()
    (tmp_path / "summaries").mkdir()


def test_load_bible(tmp_path, sample_bible):
    (tmp_path / "bible.yaml").write_text(yaml.dump(sample_bible))
    result = storage.load_bible()
    assert result["characters"][0]["name"] == "Elena"


def test_load_outline(tmp_path):
    (tmp_path / "outline.yaml").write_text(
        "chapters:\n  - Elena arrives at the gates\n  - Elena finds lodging\n"
    )
    result = storage.load_outline()
    assert len(result["chapters"]) == 2
    assert "Elena" in result["chapters"][0]


def test_load_summaries_empty(tmp_path):
    result = storage.load_summaries(1)
    assert result == []


def test_load_summaries_reads_previous_chapters(tmp_path):
    (tmp_path / "summaries" / "ch01_summary.txt").write_text("Elena reached the gates.")
    (tmp_path / "summaries" / "ch02_summary.txt").write_text("Elena found lodging.")
    result = storage.load_summaries(3)
    assert len(result) == 2
    assert "reached the gates" in result[0]
    assert "found lodging" in result[1]


def test_load_summaries_stops_before_current_chapter(tmp_path):
    (tmp_path / "summaries" / "ch01_summary.txt").write_text("Chapter 1.")
    result = storage.load_summaries(1)
    assert result == []


def test_save_and_load_chapter(tmp_path, sample_scene_plan):
    draft = "Elena stood at the gates."
    issues = [{"issue": "test", "severity": "minor", "location": "para 1", "suggested_fix": "fix"}]
    storage.save_chapter(1, sample_scene_plan, draft, issues)

    result = storage.load_chapter(1)
    assert result["plan"]["goal"] == sample_scene_plan["goal"]
    assert result["draft"] == draft
    assert result["issues"][0]["issue"] == "test"


def test_load_chapter_not_found():
    with pytest.raises(FileNotFoundError):
        storage.load_chapter(99)


def test_save_bible_and_reload(tmp_path, sample_bible):
    original = yaml.dump(sample_bible)
    (tmp_path / "bible.yaml").write_text(original)
    new_content = yaml.dump({**sample_bible, "world": {"locations": ["New Place"], "rules": []}})
    storage.save_bible(new_content)
    result = storage.load_bible()
    assert result["world"]["locations"] == ["New Place"]


def test_save_bible_rejects_invalid_yaml(tmp_path):
    (tmp_path / "bible.yaml").write_text("valid: yaml")
    with pytest.raises(Exception):
        storage.save_bible("invalid: yaml: : :")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_storage.py -v
```

Expected: all tests fail with `ModuleNotFoundError` or `AttributeError`.

- [ ] **Step 3: Write backend/storage.py**

```python
import json
import yaml
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent


def load_bible() -> dict:
    return yaml.safe_load((BASE_DIR / "bible.yaml").read_text())


def save_bible(content: str) -> None:
    parsed = yaml.safe_load(content)
    if parsed is None:
        raise ValueError("Empty or invalid YAML")
    (BASE_DIR / "bible.yaml").write_text(content)


def load_outline() -> dict:
    return yaml.safe_load((BASE_DIR / "outline.yaml").read_text())


def load_summaries(up_to_chapter: int) -> list[str]:
    summaries = []
    for i in range(1, up_to_chapter):
        path = BASE_DIR / "summaries" / f"ch{i:02d}_summary.txt"
        if path.exists():
            summaries.append(path.read_text())
    return summaries


def save_chapter(chapter_number: int, plan: dict, draft: str, issues: list[dict]) -> None:
    ch_dir = BASE_DIR / "chapters" / f"ch{chapter_number:02d}"
    ch_dir.mkdir(parents=True, exist_ok=True)
    (ch_dir / "plan.json").write_text(json.dumps(plan, indent=2))
    (ch_dir / "draft.md").write_text(draft)
    (ch_dir / "issues.json").write_text(json.dumps(issues, indent=2))


def load_chapter(chapter_number: int) -> dict:
    ch_dir = BASE_DIR / "chapters" / f"ch{chapter_number:02d}"
    if not ch_dir.exists():
        raise FileNotFoundError(f"Chapter {chapter_number} not found")
    return {
        "plan": json.loads((ch_dir / "plan.json").read_text()),
        "draft": (ch_dir / "draft.md").read_text(),
        "issues": json.loads((ch_dir / "issues.json").read_text()),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_storage.py -v
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/storage.py tests/test_storage.py
git commit -m "feat: storage layer for bible, chapters, and summaries"
```

---

## Task 4: Planner Agent (TDD)

**Files:**
- Create: `tests/test_planner.py`
- Create: `backend/agents/planner.py`

- [ ] **Step 1: Write tests/test_planner.py**

```python
from unittest.mock import MagicMock, patch
from backend.agents.planner import planner_node


def _mock_tool_response(input_data: dict) -> MagicMock:
    tool_use = MagicMock()
    tool_use.type = "tool_use"
    tool_use.input = input_data
    response = MagicMock()
    response.content = [tool_use]
    return response


VALID_PLAN = {
    "goal": "Elena arrives and is blocked",
    "pov_character": "Elena",
    "location": "Citadel Lower Gates",
    "beats": ["Elena approaches", "Gatekeeper stops her"],
    "sensory_anchor": "Cold iron smell",
    "opening_image": "Elena at dusk",
    "closing_image": "Gate slams shut",
}


def test_planner_returns_scene_plan(base_state):
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", return_value=mock_response):
        result = planner_node(base_state)
    assert "scene_plan" in result
    assert result["scene_plan"]["goal"] == "Elena arrives and is blocked"
    assert result["scene_plan"]["pov_character"] == "Elena"
    assert isinstance(result["scene_plan"]["beats"], list)
    assert len(result["scene_plan"]["beats"]) > 0


def test_planner_calls_claude_with_tool_choice(base_state):
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", return_value=mock_response) as mock_create:
        planner_node(base_state)
    call_kwargs = mock_create.call_args.kwargs
    assert call_kwargs["tool_choice"] == {"type": "tool", "name": "create_scene_plan"}
    assert call_kwargs["model"] == "claude-sonnet-4-6"


def test_planner_includes_outline_beat_in_prompt(base_state):
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", return_value=mock_response) as mock_create:
        planner_node(base_state)
    prompt_text = mock_create.call_args.kwargs["messages"][0]["content"]
    assert base_state["outline_beat"] in prompt_text


def test_planner_includes_previous_summaries(base_state):
    base_state["previous_summaries"] = ["Chapter 1: Elena left the Wastes."]
    mock_response = _mock_tool_response(VALID_PLAN)
    with patch("backend.agents.planner.client.messages.create", return_value=mock_response) as mock_create:
        planner_node(base_state)
    prompt_text = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "Elena left the Wastes" in prompt_text
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_planner.py -v
```

Expected: fail with `ModuleNotFoundError`.

- [ ] **Step 3: Write backend/agents/planner.py**

```python
import yaml
import anthropic

client = anthropic.Anthropic()

_PLAN_TOOL = {
    "name": "create_scene_plan",
    "description": "Create a structured scene plan for a chapter",
    "input_schema": {
        "type": "object",
        "properties": {
            "goal": {"type": "string", "description": "What this scene accomplishes narratively"},
            "pov_character": {"type": "string", "description": "Whose perspective drives the scene"},
            "location": {"type": "string"},
            "beats": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Ordered list of events in the scene",
            },
            "sensory_anchor": {"type": "string", "description": "Primary sense detail grounding the scene"},
            "opening_image": {"type": "string", "description": "First concrete image the reader sees"},
            "closing_image": {"type": "string", "description": "Last concrete image the reader sees"},
        },
        "required": [
            "goal", "pov_character", "location", "beats",
            "sensory_anchor", "opening_image", "closing_image",
        ],
    },
}


def planner_node(state: dict) -> dict:
    bible = state["story_bible"]
    summaries = state["previous_summaries"]

    summaries_text = (
        "\n\n".join(f"Chapter {i + 1} summary:\n{s}" for i, s in enumerate(summaries))
        if summaries
        else "No previous chapters."
    )

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=(
            "You are a narrative architect. Create precise, concrete scene plans "
            "that give a prose writer everything they need without constraining their language."
        ),
        tools=[_PLAN_TOOL],
        tool_choice={"type": "tool", "name": "create_scene_plan"},
        messages=[
            {
                "role": "user",
                "content": (
                    f"Create a scene plan for this chapter beat:\n\n"
                    f"OUTLINE BEAT: {state['outline_beat']}\n\n"
                    f"CHARACTERS:\n{yaml.dump(bible.get('characters', []))}\n\n"
                    f"WORLD:\n{yaml.dump(bible.get('world', {}))}\n\n"
                    f"TIMELINE SO FAR:\n{yaml.dump(bible.get('timeline', []))}\n\n"
                    f"PREVIOUS CHAPTERS:\n{summaries_text}"
                ),
            }
        ],
    )

    tool_use = next(b for b in response.content if b.type == "tool_use")
    return {"scene_plan": tool_use.input}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_planner.py -v
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/planner.py tests/test_planner.py
git commit -m "feat: planner agent — outline_beat to structured scene_plan"
```

---

## Task 5: Drafter Agent (TDD)

**Files:**
- Create: `tests/test_drafter.py`
- Create: `backend/agents/drafter.py`

- [ ] **Step 1: Write tests/test_drafter.py**

```python
from unittest.mock import MagicMock, patch
from backend.agents.drafter import drafter_node


def _mock_text_response(text: str) -> MagicMock:
    content_block = MagicMock()
    content_block.text = text
    response = MagicMock()
    response.content = [content_block]
    return response


DRAFT_TEXT = "Elena stood at the gates as dusk swallowed the sky."


def test_drafter_returns_draft(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", return_value=mock_response):
        result = drafter_node(base_state)
    assert "draft" in result
    assert result["draft"] == DRAFT_TEXT


def test_drafter_uses_high_temperature(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", return_value=mock_response) as mock_create:
        drafter_node(base_state)
    assert mock_create.call_args.kwargs["temperature"] == 0.9


def test_drafter_injects_style_avoid_list(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", return_value=mock_response) as mock_create:
        drafter_node(base_state)
    system_prompt = mock_create.call_args.kwargs["system"]
    assert "adverbs ending in -ly" in system_prompt


def test_drafter_injects_dialogue_examples(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", return_value=mock_response) as mock_create:
        drafter_node(base_state)
    prompt = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "I won't wait." in prompt


def test_drafter_includes_previous_summary(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    base_state["previous_summaries"] = ["Elena crossed the Wastes alone."]
    mock_response = _mock_text_response(DRAFT_TEXT)
    with patch("backend.agents.drafter.client.messages.create", return_value=mock_response) as mock_create:
        drafter_node(base_state)
    prompt = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "Elena crossed the Wastes alone." in prompt
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_drafter.py -v
```

Expected: fail with `ModuleNotFoundError`.

- [ ] **Step 3: Write backend/agents/drafter.py**

```python
import anthropic

client = anthropic.Anthropic()


def drafter_node(state: dict) -> dict:
    bible = state["story_bible"]
    plan = state["scene_plan"]
    style = bible.get("style_guide", {})
    summaries = state["previous_summaries"]

    avoid_lines = "\n".join(f"- {t}" for t in style.get("avoid", []))
    last_summary = summaries[-1] if summaries else "This is the first chapter."

    dialogue_blocks = []
    for char in bible.get("characters", []):
        examples = char.get("dialogue_examples", [])[:5]
        if examples:
            lines = "\n".join(f'  "{e}"' for e in examples)
            dialogue_blocks.append(f"{char['name']}:\n{lines}")

    beats_text = "\n".join(f"- {b}" for b in plan.get("beats", []))

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        temperature=0.9,
        system=(
            f"You are writing literary fiction.\n"
            f"Voice: {style.get('voice', 'precise and immersive')}\n\n"
            f"Prose patterns to avoid:\n{avoid_lines if avoid_lines else 'None specified.'}\n\n"
            "Write only the prose. No commentary, no meta-text, no titles."
        ),
        messages=[
            {
                "role": "user",
                "content": (
                    f"Write this scene as prose.\n\n"
                    f"SCENE PLAN:\n"
                    f"Goal: {plan.get('goal')}\n"
                    f"POV: {plan.get('pov_character')}\n"
                    f"Location: {plan.get('location')}\n"
                    f"Beats:\n{beats_text}\n"
                    f"Opening image: {plan.get('opening_image')}\n"
                    f"Closing image: {plan.get('closing_image')}\n"
                    f"Sensory anchor: {plan.get('sensory_anchor')}\n\n"
                    f"PREVIOUS CHAPTER:\n{last_summary}\n\n"
                    f"CHARACTER VOICES:\n"
                    + ("\n\n".join(dialogue_blocks) if dialogue_blocks else "No examples available.")
                ),
            }
        ],
    )

    return {"draft": response.content[0].text}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_drafter.py -v
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/drafter.py tests/test_drafter.py
git commit -m "feat: drafter agent — scene_plan to prose draft at temperature 0.9"
```

---

## Task 6: Checker Agent (TDD)

**Files:**
- Create: `tests/test_checker.py`
- Create: `backend/agents/checker.py`

- [ ] **Step 1: Write tests/test_checker.py**

```python
from unittest.mock import MagicMock, patch
from backend.agents.checker import checker_node


def _mock_tool_response(issues: list) -> MagicMock:
    tool_use = MagicMock()
    tool_use.type = "tool_use"
    tool_use.input = {"issues": issues}
    response = MagicMock()
    response.content = [tool_use]
    return response


def test_checker_returns_empty_list_when_no_issues(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    base_state["draft"] = "Elena stood at the gates, left hand at her side."
    mock_response = _mock_tool_response([])
    with patch("backend.agents.checker.client.messages.create", return_value=mock_response):
        result = checker_node(base_state)
    assert result == {"continuity_issues": []}


def test_checker_returns_structured_issues(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    base_state["draft"] = "Elena raised her right hand."
    issue = {
        "issue": "Elena described as right-handed but bible states she is left-handed",
        "severity": "critical",
        "location": "paragraph 1",
        "suggested_fix": "Change 'right hand' to 'left hand'",
    }
    mock_response = _mock_tool_response([issue])
    with patch("backend.agents.checker.client.messages.create", return_value=mock_response):
        result = checker_node(base_state)
    assert len(result["continuity_issues"]) == 1
    assert result["continuity_issues"][0]["severity"] == "critical"
    assert result["continuity_issues"][0]["suggested_fix"] == "Change 'right hand' to 'left hand'"


def test_checker_calls_claude_with_tool_choice(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    base_state["draft"] = "Some draft text."
    mock_response = _mock_tool_response([])
    with patch("backend.agents.checker.client.messages.create", return_value=mock_response) as mock_create:
        checker_node(base_state)
    assert mock_create.call_args.kwargs["tool_choice"] == {
        "type": "tool", "name": "report_continuity_issues"
    }


def test_checker_includes_draft_and_characters_in_prompt(base_state, sample_scene_plan):
    base_state["scene_plan"] = sample_scene_plan
    base_state["draft"] = "She raised her hand."
    mock_response = _mock_tool_response([])
    with patch("backend.agents.checker.client.messages.create", return_value=mock_response) as mock_create:
        checker_node(base_state)
    prompt = mock_create.call_args.kwargs["messages"][0]["content"]
    assert "She raised her hand." in prompt
    assert "Elena" in prompt
    assert "left-handed" in prompt
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_checker.py -v
```

Expected: fail with `ModuleNotFoundError`.

- [ ] **Step 3: Write backend/agents/checker.py**

```python
import yaml
import anthropic

client = anthropic.Anthropic()

_CHECK_TOOL = {
    "name": "report_continuity_issues",
    "description": "Report all continuity issues found in the draft",
    "input_schema": {
        "type": "object",
        "properties": {
            "issues": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "issue": {"type": "string"},
                        "severity": {
                            "type": "string",
                            "enum": ["critical", "minor", "style"],
                        },
                        "location": {"type": "string"},
                        "suggested_fix": {"type": "string"},
                    },
                    "required": ["issue", "severity", "location", "suggested_fix"],
                },
            }
        },
        "required": ["issues"],
    },
}


def checker_node(state: dict) -> dict:
    bible = state["story_bible"]
    summaries = state["previous_summaries"]

    summaries_text = (
        "\n\n".join(f"Chapter {i + 1}:\n{s}" for i, s in enumerate(summaries))
        if summaries
        else "No previous chapters."
    )

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=(
            "You are a continuity editor. Check for contradictions between the draft "
            "and all established story facts. Be thorough and precise. "
            "If the draft is consistent, return an empty issues list."
        ),
        tools=[_CHECK_TOOL],
        tool_choice={"type": "tool", "name": "report_continuity_issues"},
        messages=[
            {
                "role": "user",
                "content": (
                    f"Check this draft for continuity issues.\n\n"
                    f"DRAFT:\n{state['draft']}\n\n"
                    f"CHARACTER FACTS:\n{yaml.dump(bible.get('characters', []))}\n\n"
                    f"WORLD RULES:\n{yaml.dump(bible.get('world', {}))}\n\n"
                    f"TIMELINE:\n{yaml.dump(bible.get('timeline', []))}\n\n"
                    f"PREVIOUS CHAPTERS:\n{summaries_text}\n\n"
                    "Check for: physical trait contradictions, timeline inconsistencies, "
                    "character knowledge errors (knowing something they shouldn't), "
                    "location consistency errors."
                ),
            }
        ],
    )

    tool_use = next(b for b in response.content if b.type == "tool_use")
    return {"continuity_issues": tool_use.input["issues"]}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_checker.py -v
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/checker.py tests/test_checker.py
git commit -m "feat: checker agent — structured continuity issue detection"
```

---

## Task 7: LangGraph Pipeline (TDD)

**Files:**
- Create: `tests/test_pipeline.py`
- Create: `backend/pipeline.py`

- [ ] **Step 1: Write tests/test_pipeline.py**

```python
from backend.pipeline import build_pipeline


def test_pipeline_runs_all_three_nodes_in_order(base_state):
    call_order = []

    def mock_planner(state):
        call_order.append("planner")
        return {"scene_plan": {"goal": "test goal"}}

    def mock_drafter(state):
        call_order.append("drafter")
        assert state["scene_plan"] == {"goal": "test goal"}
        return {"draft": "Once upon a time."}

    def mock_checker(state):
        call_order.append("checker")
        assert state["draft"] == "Once upon a time."
        return {"continuity_issues": []}

    pipeline = build_pipeline(
        planner=mock_planner, drafter=mock_drafter, checker=mock_checker
    )
    result = pipeline.invoke(base_state)

    assert call_order == ["planner", "drafter", "checker"]
    assert result["scene_plan"] == {"goal": "test goal"}
    assert result["draft"] == "Once upon a time."
    assert result["continuity_issues"] == []


def test_pipeline_passes_state_through_all_nodes(base_state):
    received_states = {}

    def mock_planner(state):
        received_states["planner"] = dict(state)
        return {"scene_plan": {"goal": "arrived"}}

    def mock_drafter(state):
        received_states["drafter"] = dict(state)
        return {"draft": "She arrived."}

    def mock_checker(state):
        received_states["checker"] = dict(state)
        return {"continuity_issues": []}

    pipeline = build_pipeline(
        planner=mock_planner, drafter=mock_drafter, checker=mock_checker
    )
    pipeline.invoke(base_state)

    assert received_states["drafter"]["scene_plan"] == {"goal": "arrived"}
    assert received_states["checker"]["draft"] == "She arrived."
    assert received_states["checker"]["scene_plan"] == {"goal": "arrived"}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_pipeline.py -v
```

Expected: fail with `ModuleNotFoundError`.

- [ ] **Step 3: Write backend/pipeline.py**

```python
from langgraph.graph import StateGraph, START, END
from backend.models import ChapterState
from backend.agents.planner import planner_node
from backend.agents.drafter import drafter_node
from backend.agents.checker import checker_node


def build_pipeline(planner=planner_node, drafter=drafter_node, checker=checker_node):
    graph = StateGraph(ChapterState)
    graph.add_node("planner", planner)
    graph.add_node("drafter", drafter)
    graph.add_node("checker", checker)
    graph.add_edge(START, "planner")
    graph.add_edge("planner", "drafter")
    graph.add_edge("drafter", "checker")
    graph.add_edge("checker", END)
    return graph.compile()


pipeline = build_pipeline()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_pipeline.py -v
```

Expected: both tests pass.

- [ ] **Step 5: Run all tests to confirm nothing is broken**

```bash
pytest tests/ -v --ignore=tests/test_api.py
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/pipeline.py tests/test_pipeline.py
git commit -m "feat: LangGraph pipeline wiring planner → drafter → checker"
```

---

## Task 8: FastAPI Backend (TDD)

**Files:**
- Create: `tests/test_api.py`
- Create: `backend/main.py`

- [ ] **Step 1: Write tests/test_api.py**

```python
import json
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_api.py -v
```

Expected: fail with `ModuleNotFoundError`.

- [ ] **Step 3: Write backend/main.py**

```python
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.models import BibleUpdateRequest, GenerateResponse
from backend.pipeline import pipeline
from backend.storage import (
    load_bible,
    load_chapter,
    load_outline,
    load_summaries,
    save_bible,
    save_chapter,
)

_FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

app = FastAPI(title="Maya")
app.mount("/static", StaticFiles(directory=str(_FRONTEND_DIR)), name="static")


@app.get("/")
def root():
    return FileResponse(_FRONTEND_DIR / "index.html")


@app.post("/generate/{chapter_number}", response_model=GenerateResponse)
def generate_chapter(chapter_number: int):
    bible = load_bible()
    outline = load_outline()
    beats = outline.get("chapters", [])
    if chapter_number < 1 or chapter_number > len(beats):
        raise HTTPException(status_code=400, detail=f"Chapter {chapter_number} not in outline")

    state = pipeline.invoke(
        {
            "chapter_number": chapter_number,
            "outline_beat": beats[chapter_number - 1],
            "story_bible": bible,
            "previous_summaries": load_summaries(chapter_number),
            "scene_plan": {},
            "draft": "",
            "continuity_issues": [],
        }
    )

    return GenerateResponse(
        chapter_number=chapter_number,
        scene_plan=state["scene_plan"],
        draft=state["draft"],
        continuity_issues=state["continuity_issues"],
    )


@app.get("/chapter/{chapter_number}")
def get_chapter(chapter_number: int):
    try:
        return load_chapter(chapter_number)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Chapter not found")


@app.put("/chapter/{chapter_number}/accept")
def accept_chapter(chapter_number: int, data: GenerateResponse):
    save_chapter(chapter_number, data.scene_plan, data.draft, data.continuity_issues)
    return {"status": "saved"}


@app.get("/bible")
def get_bible():
    return {"content": yaml.dump(load_bible())}


@app.put("/bible")
def update_bible(request: BibleUpdateRequest):
    save_bible(request.content)
    return {"status": "saved"}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_api.py -v
```

Expected: all 7 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/main.py tests/test_api.py
git commit -m "feat: FastAPI backend with generate, accept, and bible endpoints"
```

---

## Task 9: Frontend

**Files:**
- Create: `frontend/index.html`

- [ ] **Step 1: Write frontend/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Maya</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; display: flex; height: 100vh; overflow: hidden; background: #f5f5f0; }

    #bible-panel {
      width: 320px; min-width: 220px; display: flex; flex-direction: column;
      border-right: 1px solid #ddd; background: #fff; padding: 16px; gap: 8px;
    }
    #bible-panel h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .08em; color: #888; }
    #bible-editor { flex: 1; resize: none; border: 1px solid #ddd; padding: 8px; font-family: monospace; font-size: 12px; border-radius: 4px; }
    #save-bible-btn { padding: 8px; background: #1a1a1a; color: #fff; border: none; border-radius: 4px; cursor: pointer; }

    #chapter-panel { flex: 1; display: flex; flex-direction: column; padding: 24px; gap: 16px; overflow: hidden; }

    #controls { display: flex; gap: 12px; align-items: center; }
    #controls label { font-size: 14px; color: #444; }
    #chapter-num { width: 64px; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    #generate-btn { padding: 8px 20px; background: #2563eb; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    #generate-btn:disabled { opacity: .5; cursor: default; }
    #spinner { font-size: 13px; color: #888; }

    #results { flex: 1; display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
    #tabs { display: flex; gap: 4px; }
    #tabs button {
      padding: 6px 14px; border: 1px solid #ddd; background: #f5f5f0;
      border-radius: 4px 4px 0 0; cursor: pointer; font-size: 13px;
    }
    #tabs button.active { background: #fff; border-bottom-color: #fff; }

    .tab-content { flex: 1; overflow-y: auto; background: #fff; border: 1px solid #ddd; border-radius: 0 4px 4px 4px; padding: 16px; }
    #plan-content { font-family: monospace; font-size: 12px; white-space: pre-wrap; }
    #draft-content p { line-height: 1.7; margin-bottom: 1em; font-size: 15px; }

    #issues-list { list-style: none; display: flex; flex-direction: column; gap: 12px; }
    #issues-list li { border: 1px solid #eee; border-radius: 6px; padding: 12px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-right: 8px; text-transform: uppercase; }
    .badge-critical { background: #fee2e2; color: #b91c1c; }
    .badge-minor { background: #fef9c3; color: #854d0e; }
    .badge-style { background: #f1f5f9; color: #475569; }
    .issue-fix { display: block; margin-top: 6px; font-size: 12px; color: #666; font-style: italic; }

    #accept-btn { align-self: flex-end; padding: 8px 20px; background: #16a34a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    #status-msg { font-size: 13px; color: #16a34a; }
  </style>
</head>
<body>

<aside id="bible-panel">
  <h2>Story Bible</h2>
  <textarea id="bible-editor" spellcheck="false"></textarea>
  <button id="save-bible-btn" onclick="saveBible()">Save Bible</button>
</aside>

<main id="chapter-panel">
  <div id="controls">
    <label>Chapter <input type="number" id="chapter-num" value="1" min="1"></label>
    <button id="generate-btn" onclick="generate()">Generate</button>
    <span id="spinner" hidden>Generating…</span>
    <span id="status-msg"></span>
  </div>

  <div id="results" hidden>
    <div id="tabs">
      <button id="tab-plan" onclick="showTab('plan')">Plan</button>
      <button id="tab-draft" onclick="showTab('draft')">Draft</button>
      <button id="tab-issues" onclick="showTab('issues')">Issues <span id="issues-count"></span></button>
    </div>
    <div id="plan-tab" class="tab-content"><pre id="plan-content"></pre></div>
    <div id="draft-tab" class="tab-content" hidden><div id="draft-content"></div></div>
    <div id="issues-tab" class="tab-content" hidden><ul id="issues-list"></ul></div>
    <button id="accept-btn" onclick="acceptChapter()">Accept &amp; Save</button>
  </div>
</main>

<script>
  let currentResult = null;

  async function loadBible() {
    const res = await fetch('/bible');
    const data = await res.json();
    document.getElementById('bible-editor').value = data.content;
  }

  async function saveBible() {
    const content = document.getElementById('bible-editor').value;
    const res = await fetch('/bible', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content}),
    });
    setStatus(res.ok ? 'Bible saved.' : 'Error saving bible.');
  }

  async function generate() {
    const n = document.getElementById('chapter-num').value;
    document.getElementById('spinner').hidden = false;
    document.getElementById('generate-btn').disabled = true;
    document.getElementById('results').hidden = true;
    setStatus('');
    try {
      const res = await fetch(`/generate/${n}`, {method: 'POST'});
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || res.statusText); }
      currentResult = await res.json();
      renderResults(currentResult);
      document.getElementById('results').hidden = false;
      showTab('plan');
    } catch (e) {
      setStatus('Error: ' + e.message);
    } finally {
      document.getElementById('spinner').hidden = true;
      document.getElementById('generate-btn').disabled = false;
    }
  }

  function renderResults(data) {
    document.getElementById('plan-content').textContent = JSON.stringify(data.scene_plan, null, 2);
    document.getElementById('draft-content').innerHTML =
      data.draft.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    const issues = data.continuity_issues;
    document.getElementById('issues-count').textContent = issues.length ? `(${issues.length})` : '';
    document.getElementById('issues-list').innerHTML = issues.length === 0
      ? '<li style="color:#888">No issues found.</li>'
      : issues.map(i => `
          <li>
            <span class="badge badge-${i.severity}">${i.severity}</span>
            <strong>${i.location}:</strong> ${i.issue}
            <span class="issue-fix">Fix: ${i.suggested_fix}</span>
          </li>`).join('');
  }

  function showTab(name) {
    ['plan', 'draft', 'issues'].forEach(t => {
      document.getElementById(`${t}-tab`).hidden = t !== name;
      document.getElementById(`tab-${t}`).classList.toggle('active', t === name);
    });
  }

  async function acceptChapter() {
    if (!currentResult) return;
    const n = document.getElementById('chapter-num').value;
    const res = await fetch(`/chapter/${n}/accept`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(currentResult),
    });
    setStatus(res.ok ? `Chapter ${n} saved to disk.` : 'Error saving.');
  }

  function setStatus(msg) {
    document.getElementById('status-msg').textContent = msg;
  }

  loadBible();
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/index.html
git commit -m "feat: vanilla JS frontend — bible editor, generate, tab view, accept"
```

---

## Task 10: End-to-End Smoke Test

- [ ] **Step 1: Verify all tests pass**

```bash
pytest tests/ -v
```

Expected: all tests pass, no failures.

- [ ] **Step 2: Start the dev server**

```bash
ANTHROPIC_API_KEY=<your-key> uvicorn backend.main:app --reload
```

Expected: server starts on `http://127.0.0.1:8000` with no import errors.

- [ ] **Step 3: Verify the UI loads**

Open `http://127.0.0.1:8000` in a browser. Expected: split layout renders — left panel shows the story bible YAML from `bible.yaml`, right panel shows chapter number input and Generate button.

- [ ] **Step 4: Generate chapter 1**

Click **Generate** with chapter number `1`. Expected: spinner appears, then results show Plan / Draft / Issues tabs. Plan tab shows a JSON scene plan with `goal`, `pov_character`, `beats`, etc.

- [ ] **Step 5: Check the Issues tab**

Click **Issues**. Expected: either "No issues found" or a list of structured issues with severity badges.

- [ ] **Step 6: Accept and save**

Click **Accept & Save**. Expected: status message "Chapter 1 saved to disk." Files `chapters/ch01/plan.json`, `chapters/ch01/draft.md`, `chapters/ch01/issues.json` exist on disk.

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "chore: complete maya v1 — planner/drafter/checker pipeline with web UI"
```
