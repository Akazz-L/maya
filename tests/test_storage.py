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
    with pytest.raises(yaml.YAMLError):
        storage.save_bible("invalid: yaml: : :")


def test_save_bible_rejects_non_dict_yaml(tmp_path):
    (tmp_path / "bible.yaml").write_text("valid: yaml")
    with pytest.raises(ValueError):
        storage.save_bible("- list item\n")


def test_save_outline_and_reload(tmp_path):
    (tmp_path / "outline.yaml").write_text("chapters:\n  - Old beat\n")
    storage.save_outline("chapters:\n  - Elena arrives\n  - Elena departs\n")
    result = storage.load_outline()
    assert result["chapters"] == ["Elena arrives", "Elena departs"]


def test_save_outline_rejects_missing_chapters(tmp_path):
    (tmp_path / "outline.yaml").write_text("chapters:\n  - Old beat\n")
    with pytest.raises(ValueError):
        storage.save_outline("title: My Book\n")


def test_save_and_load_summary(tmp_path):
    storage.save_summary(1, "Elena reached the gates.")
    result = storage.load_summaries(2)
    assert len(result) == 1
    assert "Elena reached the gates." in result[0]
