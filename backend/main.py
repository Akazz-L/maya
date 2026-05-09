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
