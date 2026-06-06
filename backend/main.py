import json
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
_logger = logging.getLogger(__name__)
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.agents.checker import checker_node
from backend.agents.drafter import drafter_node, drafter_token_stream
from backend.agents.planner import planner_node
from backend.models import (
    AcceptRequest,
    BibleUpdateRequest,
    CheckRequest,
    DraftRequest,
    DraftStateResponse,
    OutlineUpdateRequest,
    ReviseRequest,
)
from backend.storage import (
    delete_draft_state,
    load_bible,
    load_bible_text,
    load_chapter,
    load_draft_state,
    load_outline,
    load_outline_text,
    load_summaries,
    save_bible,
    save_chapter,
    save_draft_state,
    save_outline,
)

_FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

app = FastAPI(title="Maya")
app.mount("/static", StaticFiles(directory=str(_FRONTEND_DIR), check_dir=False), name="static")


@app.get("/")
def root():
    return FileResponse(_FRONTEND_DIR / "index.html")


def _base_state(chapter_number: int) -> dict:
    bible = load_bible()
    outline = load_outline()
    beats = outline.get("chapters", [])
    if chapter_number < 1 or chapter_number > len(beats):
        raise HTTPException(status_code=400, detail=f"Chapter {chapter_number} not in outline")
    return {
        "chapter_number": chapter_number,
        "outline_beat": beats[chapter_number - 1],
        "story_bible": bible,
        "previous_summaries": load_summaries(chapter_number),
        "scene_plan": {},
        "draft": "",
        "continuity_issues": [],
    }


@app.post("/chapter/{chapter_number}/plan")
def generate_plan(chapter_number: int):
    state = _base_state(chapter_number)
    result = planner_node(state)
    state.update(result)
    save_draft_state(chapter_number, {"step": "plan", "scene_plan": state["scene_plan"], "draft": "", "issues": []})
    return {"scene_plan": state["scene_plan"]}


@app.post("/chapter/{chapter_number}/draft")
def generate_draft(chapter_number: int, body: DraftRequest):
    state = _base_state(chapter_number)
    state["scene_plan"] = body.scene_plan
    result = drafter_node(state)
    state.update(result)
    save_draft_state(chapter_number, {"step": "draft", "scene_plan": body.scene_plan, "draft": state["draft"], "issues": []})
    return {"draft": state["draft"]}


@app.post("/chapter/{chapter_number}/check")
def generate_check(chapter_number: int, body: CheckRequest):
    state = _base_state(chapter_number)
    saved = load_draft_state(chapter_number)
    state["scene_plan"] = saved["scene_plan"] if saved else {}
    state["draft"] = body.draft
    result = checker_node(state)
    state.update(result)
    save_draft_state(chapter_number, {
        "step": "check",
        "scene_plan": state["scene_plan"],
        "draft": body.draft,
        "issues": state["continuity_issues"],
    })
    return {"issues": state["continuity_issues"]}


@app.post("/chapter/{chapter_number}/revise")
def revise_draft(chapter_number: int, body: ReviseRequest):
    state = _base_state(chapter_number)
    saved = load_draft_state(chapter_number)
    state["scene_plan"] = saved["scene_plan"] if saved else {}
    state["draft"] = body.draft
    state["continuity_issues"] = body.issues
    result = drafter_node(state)
    state.update(result)
    save_draft_state(chapter_number, {
        "step": "draft",
        "scene_plan": state["scene_plan"],
        "draft": state["draft"],
        "issues": [],
    })
    return {"draft": state["draft"]}


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@app.post("/chapter/{chapter_number}/draft/stream")
def generate_draft_stream(chapter_number: int, body: DraftRequest):
    state = _base_state(chapter_number)
    state["scene_plan"] = body.scene_plan

    def gen():
        buf = []
        try:
            for text in drafter_token_stream(state):
                buf.append(text)
                yield _sse({"type": "delta", "text": text})
            draft = "".join(buf)
            save_draft_state(chapter_number, {"step": "draft", "scene_plan": body.scene_plan, "draft": draft, "issues": []})
            yield _sse({"type": "done", "draft": draft})
        except Exception as e:
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@app.post("/chapter/{chapter_number}/revise/stream")
def revise_draft_stream(chapter_number: int, body: ReviseRequest):
    state = _base_state(chapter_number)
    saved = load_draft_state(chapter_number)
    state["scene_plan"] = saved["scene_plan"] if saved else {}
    state["draft"] = body.draft
    state["continuity_issues"] = body.issues

    def gen():
        buf = []
        try:
            for text in drafter_token_stream(state):
                buf.append(text)
                yield _sse({"type": "delta", "text": text})
            draft = "".join(buf)
            save_draft_state(chapter_number, {"step": "draft", "scene_plan": state["scene_plan"], "draft": draft, "issues": []})
            yield _sse({"type": "done", "draft": draft})
        except Exception as e:
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@app.get("/chapter/{chapter_number}/state")
def get_draft_state(chapter_number: int):
    saved = load_draft_state(chapter_number)
    if not saved:
        return None
    return DraftStateResponse(
        step=saved.get("step", "plan"),
        scene_plan=saved.get("scene_plan", {}),
        draft=saved.get("draft", ""),
        issues=saved.get("issues", []),
    )


@app.put("/chapter/{chapter_number}/accept")
def accept_chapter(chapter_number: int, body: AcceptRequest):
    save_chapter(chapter_number, body.scene_plan, body.draft, body.issues)
    delete_draft_state(chapter_number)
    return {"status": "saved"}


@app.get("/chapter/{chapter_number}")
def get_chapter(chapter_number: int):
    try:
        return load_chapter(chapter_number)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Chapter not found")


@app.get("/bible")
def get_bible():
    return {"content": load_bible_text()}


@app.put("/bible")
def update_bible(request: BibleUpdateRequest):
    save_bible(request.content)
    return {"status": "saved"}


@app.get("/outline")
def get_outline():
    return {"content": load_outline_text()}


@app.put("/outline")
def update_outline(request: OutlineUpdateRequest):
    save_outline(request.content)
    return {"status": "saved"}
