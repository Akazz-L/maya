# Creative Writing Multi-Agent Tool — Design Spec

**Date:** 2026-05-08  
**Project:** Maya  
**Status:** Approved

---

## Problem

Single-prompt LLM usage for creative writing produces monotonic, inconsistent prose. The model has no persistent world model, so characters drift, timelines break, and the "AI voice" dominates. The solution is a multi-pass pipeline with explicit persistent state — separating planning, drafting, and verification into distinct agent passes.

---

## Goal

A local web tool that assists iterative novel writing, chapter by chapter. The user maintains a story bible; the tool generates a scene plan, drafts prose, and flags continuity issues. The human reviews and accepts outputs before they are persisted.

---

## Architecture

```
[START] → planner_node → drafter_node → checker_node → [END]
```

A LangGraph `StateGraph` with three sequential nodes sharing a typed state dict. Built with LangGraph from the start so the conditional re-draft edge (`checker_node → drafter_node` when issues exceed a severity threshold) is a one-line addition later.

All agents call **Anthropic Claude (claude-sonnet-4-6)**. Planner and Checker use structured output via tool use. Drafter uses temperature 0.9 with few-shot style injection.

---

## Shared State

```python
class ChapterState(TypedDict):
    chapter_number: int
    outline_beat: str            # what this chapter should accomplish
    story_bible: dict            # loaded from bible.yaml
    previous_summaries: list[str]  # loaded from summaries/ at invocation time

    scene_plan: dict             # planner output
    draft: str                   # drafter output
    continuity_issues: list[dict]  # checker output
```

---

## Agents

### Planner Node

Produces a structured scene plan before any prose is written.

- **Inputs from state:** `outline_beat`, characters + world from `story_bible`, `previous_summaries`
- **Output:** `scene_plan` — `{goal, pov_character, location, beats: [], sensory_anchor, opening_image, closing_image}`
- **Prompt strategy:** System prompt = narrative architect role. Structured output via tool use (always parseable, never free prose).

### Drafter Node

Writes the actual prose from the scene plan.

- **Inputs from state:** `scene_plan`, style guide from bible, 3–5 dialogue examples per character present, last chapter summary
- **Output:** `draft` — plain prose string
- **Prompt strategy:** Few-shot style examples injected directly into the prompt. Temperature 0.9. System prompt instructs avoidance of prose tics listed in `style_guide.avoid`.

### Checker Node

Finds contradictions between the draft and established facts.

- **Inputs from state:** `draft`, characters + timeline from `story_bible`, `previous_summaries`
- **Output:** `continuity_issues` — `[{issue: str, severity: "critical"|"minor"|"style", location: str, suggested_fix: str}]`
- **Prompt strategy:** Structured output via tool use. Prompt explicitly enumerates contradiction categories: physical traits, timeline, character knowledge state, location consistency.

---

## Storage Layout

```
maya/
├── bible.yaml           # source of truth
├── outline.yaml         # ordered chapter beats
├── chapters/
│   ├── ch01/
│   │   ├── plan.json    # planner output
│   │   ├── draft.md     # drafter output
│   │   └── issues.json  # checker output
│   └── ch02/ ...
└── summaries/
    ├── ch01_summary.txt
    └── ch02_summary.txt
```

### `bible.yaml` Schema

```yaml
characters:
  - name: str
    traits: [str]
    dialogue_examples: [str]   # 3-5 lines, injected by Drafter
world:
  locations: [str]
  rules: [str]
timeline:
  - event: str
    chapter: int
    location: str
    characters: [str]
style_guide:
  voice: str
  avoid: [str]
```

Outputs are only written to disk after explicit human approval via the `/accept` endpoint. The bible is the source of truth; chapters are derived.

---

## API

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/generate/{chapter_number}` | Run full pipeline (synchronous v1) |
| `GET` | `/chapter/{chapter_number}` | Return plan + draft + issues |
| `PUT` | `/chapter/{chapter_number}/accept` | Write outputs to disk (approval gate) |
| `GET` | `/bible` | Return bible content |
| `PUT` | `/bible` | Update bible content |

Generation is synchronous in v1. SSE streaming is a natural future addition.

---

## Frontend

Single HTML file (`frontend/index.html`) served as FastAPI static files. Vanilla JS, no framework.

- **Left panel:** YAML text area for the story bible with a Save button
- **Center panel:** tabbed view — Plan / Draft / Issues
- **Generate button:** `POST /generate/{n}`, shows spinner, renders results
- **Issues list:** severity badges — critical (red), minor (yellow), style (grey)
- **Accept & Save button:** `PUT /chapter/{n}/accept`, persists to disk

---

## Project Structure

```
maya/
├── backend/
│   ├── main.py           # FastAPI app and routes
│   ├── pipeline.py       # LangGraph StateGraph
│   ├── agents/
│   │   ├── planner.py    # planner_node
│   │   ├── drafter.py    # drafter_node
│   │   └── checker.py    # checker_node
│   ├── storage.py        # read/write bible, chapters, summaries
│   └── models.py         # ChapterState, Pydantic response models
├── frontend/
│   └── index.html
├── bible.yaml
├── outline.yaml
├── chapters/
├── summaries/
└── requirements.txt      # anthropic, langgraph, fastapi, uvicorn, pyyaml
```

---

## Verification

1. `uvicorn backend.main:app --reload` starts with no errors
2. `POST /generate/1` with minimal `bible.yaml` + `outline.yaml` returns all three outputs
3. Planner output is a valid parseable JSON scene plan
4. Drafter output is non-empty prose
5. Checker output is a valid JSON list (`[]` = no issues)
6. `PUT /chapter/1/accept` writes files to `chapters/ch01/`
7. Browser at `localhost:8000` renders the UI and Generate button works end-to-end

---

## Out of Scope (v1)

- Line Editor agent
- Bible Updater agent
- Auto-retry loop on critical checker issues
- Streaming generation
- Multi-project support
