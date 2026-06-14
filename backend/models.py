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


class CharacterData(BaseModel):
    name: str = ""
    traits: list[str] = []
    dialogue_examples: list[str] = []


class WorldData(BaseModel):
    locations: list[str] = []
    rules: list[str] = []


class StyleGuideData(BaseModel):
    voice: str = ""
    avoid: list[str] = []


class BibleUpdateRequest(BaseModel):
    characters: list[CharacterData] = []
    world: WorldData = WorldData()
    style_guide: StyleGuideData = StyleGuideData()
    timeline: list[str] = []


class OutlineUpdateRequest(BaseModel):
    chapters: list[str] = []


class DraftRequest(BaseModel):
    scene_plan: dict


class CheckRequest(BaseModel):
    draft: str


class ReviseRequest(BaseModel):
    draft: str
    issues: list[dict]


class AcceptRequest(BaseModel):
    scene_plan: dict
    draft: str
    issues: list[dict]


class DraftStateResponse(BaseModel):
    step: str
    scene_plan: dict
    draft: str
    issues: list[dict]
