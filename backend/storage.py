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
