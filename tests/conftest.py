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
