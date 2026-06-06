import json
import yaml
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent


def load_bible() -> dict:
    return yaml.safe_load((BASE_DIR / "bible.yaml").read_text())


def load_bible_text() -> str:
    return (BASE_DIR / "bible.yaml").read_text()


def save_bible(content: str) -> None:
    parsed = yaml.safe_load(content)
    if not isinstance(parsed, dict):
        raise ValueError("Bible must be a YAML mapping")
    (BASE_DIR / "bible.yaml").write_text(content)


def load_outline() -> dict:
    return yaml.safe_load((BASE_DIR / "outline.yaml").read_text())


def load_outline_text() -> str:
    return (BASE_DIR / "outline.yaml").read_text()


def save_outline(content: str) -> None:
    parsed = yaml.safe_load(content)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("chapters"), list):
        raise ValueError("Outline must be a YAML mapping with a 'chapters' list")
    (BASE_DIR / "outline.yaml").write_text(content)


def load_summaries(up_to_chapter: int) -> list[str]:
    summaries = []
    for i in range(1, up_to_chapter):
        path = BASE_DIR / "summaries" / f"ch{i:02d}_summary.txt"
        if path.exists():
            summaries.append(path.read_text())
    return summaries


def save_summary(chapter_number: int, text: str) -> None:
    path = BASE_DIR / "summaries" / f"ch{chapter_number:02d}_summary.txt"
    path.write_text(text)


def save_chapter(chapter_number: int, plan: dict, draft: str, issues: list[dict]) -> None:
    ch_dir = BASE_DIR / "chapters" / f"ch{chapter_number:02d}"
    ch_dir.mkdir(parents=True, exist_ok=True)
    (ch_dir / "plan.json").write_text(json.dumps(plan, indent=2))
    (ch_dir / "draft.md").write_text(draft)
    (ch_dir / "issues.json").write_text(json.dumps(issues, indent=2))


def save_draft_state(chapter_number: int, state: dict) -> None:
    ch_dir = BASE_DIR / "chapters" / f"ch{chapter_number:02d}"
    ch_dir.mkdir(parents=True, exist_ok=True)
    (ch_dir / "draft_state.json").write_text(json.dumps(state, indent=2))


def load_draft_state(chapter_number: int) -> dict | None:
    path = BASE_DIR / "chapters" / f"ch{chapter_number:02d}" / "draft_state.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def delete_draft_state(chapter_number: int) -> None:
    path = BASE_DIR / "chapters" / f"ch{chapter_number:02d}" / "draft_state.json"
    path.unlink(missing_ok=True)


def load_chapter(chapter_number: int) -> dict:
    ch_dir = BASE_DIR / "chapters" / f"ch{chapter_number:02d}"
    if not ch_dir.exists():
        raise FileNotFoundError(f"Chapter {chapter_number} not found")
    return {
        "plan": json.loads((ch_dir / "plan.json").read_text()),
        "draft": (ch_dir / "draft.md").read_text(),
        "issues": json.loads((ch_dir / "issues.json").read_text()),
    }
