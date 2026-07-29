import pytest

from backend.bible_markdown import BIBLE_TEMPLATE, render_bible_markdown


@pytest.fixture
def structured_bible():
    """The pre-migration bible shape. Deliberately local rather than the shared
    `sample_bible` fixture, which is markdown now that the agents consume text."""
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
        "timeline": ["Elena leaves home"],
        "style_guide": {
            "voice": "sparse and precise",
            "avoid": ["adverbs ending in -ly", "passive voice"],
        },
    }


def test_empty_dict_returns_template():
    assert render_bible_markdown({}) == BIBLE_TEMPLATE


def test_template_has_the_four_headings():
    for heading in ("## Characters", "## World", "## Style", "## Timeline"):
        assert heading in BIBLE_TEMPLATE


def test_renders_characters_with_traits_and_dialogue(structured_bible):
    md = render_bible_markdown(structured_bible)
    assert "### Elena" in md
    assert "- determined" in md
    assert '- "I won\'t wait."' in md


def test_renders_world_style_and_timeline(structured_bible):
    md = render_bible_markdown(structured_bible)
    assert "- The Citadel" in md
    assert "- Magic requires physical cost" in md
    assert "sparse and precise" in md
    assert "- adverbs ending in -ly" in md
    assert "- Elena leaves home" in md


def test_headings_present_even_when_sections_empty():
    md = render_bible_markdown({"characters": [], "world": {}, "timeline": []})
    for heading in ("## Characters", "## World", "## Style", "## Timeline"):
        assert heading in md


def test_tolerates_none_valued_keys():
    md = render_bible_markdown(
        {"characters": None, "world": None, "style_guide": None, "timeline": None}
    )
    assert "## Characters" in md


def test_character_without_name_is_labelled_unnamed():
    md = render_bible_markdown({"characters": [{"traits": ["quiet"]}]})
    assert "### Unnamed" in md
