"""One-time script to import existing file-based data into PostgreSQL.

Usage:
    python scripts/migrate_to_db.py --email you@example.com --password secret --project "My Novel"

The script will:
  1. Create a user with the given credentials
  2. Create a project with the given name
  3. Import bible.yaml and outline.yaml into the project
  4. Import all chapters/chNN/{plan.json, draft.md, issues.json} into chapters
  5. Import summaries/chNN_summary.txt into summaries
  6. Import chapters/chNN/draft_state.json into draft_states
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

import yaml
from dotenv import load_dotenv
from sqlalchemy import select

load_dotenv()

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from backend.auth import hash_password  # noqa: E402
from backend.db import AsyncSessionLocal  # noqa: E402
from backend.db_models import Chapter, DraftState, Project, Summary, User  # noqa: E402


async def run(email: str, password: str, project_name: str) -> None:
    async with AsyncSessionLocal() as db:
        # Create or find user
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is None:
            user = User(email=email, hashed_password=hash_password(password))
            db.add(user)
            await db.flush()
            print(f"Created user: {email}")
        else:
            print(f"Using existing user: {email}")

        # Create project
        bible_path = ROOT / "bible.yaml"
        outline_path = ROOT / "outline.yaml"
        bible_content = bible_path.read_text() if bible_path.exists() else ""
        outline_content = outline_path.read_text() if outline_path.exists() else ""

        project = Project(
            user_id=user.id,
            name=project_name,
            bible_content=bible_content,
            outline_content=outline_content,
        )
        db.add(project)
        await db.flush()
        print(f"Created project: {project_name} ({project.id})")

        # Import chapters
        chapters_dir = ROOT / "chapters"
        if chapters_dir.exists():
            for ch_dir in sorted(chapters_dir.iterdir()):
                if not ch_dir.is_dir() or not ch_dir.name.startswith("ch"):
                    continue
                try:
                    ch_num = int(ch_dir.name[2:])
                except ValueError:
                    continue

                plan = json.loads((ch_dir / "plan.json").read_text()) if (ch_dir / "plan.json").exists() else None
                draft = (ch_dir / "draft.md").read_text() if (ch_dir / "draft.md").exists() else None
                issues = json.loads((ch_dir / "issues.json").read_text()) if (ch_dir / "issues.json").exists() else None

                chapter = Chapter(
                    project_id=project.id,
                    number=ch_num,
                    plan=plan,
                    draft=draft,
                    issues=issues,
                    status="accepted" if draft else "draft",
                )
                db.add(chapter)
                await db.flush()
                print(f"  Imported chapter {ch_num}")

                # Draft state
                ds_path = ch_dir / "draft_state.json"
                if ds_path.exists():
                    ds_data = json.loads(ds_path.read_text())
                    ds = DraftState(
                        chapter_id=chapter.id,
                        step=ds_data.get("step", "plan"),
                        scene_plan=ds_data.get("scene_plan", {}),
                        draft=ds_data.get("draft", ""),
                        issues=ds_data.get("issues", []),
                    )
                    db.add(ds)
                    print(f"    Imported draft state for chapter {ch_num}")

                # Summary
                summary_path = ROOT / "summaries" / f"ch{ch_num:02d}_summary.txt"
                if summary_path.exists():
                    db.add(Summary(chapter_id=chapter.id, text=summary_path.read_text()))
                    print(f"    Imported summary for chapter {ch_num}")

        await db.commit()
        print("Migration complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate file-based Maya data to PostgreSQL")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--project", default="My Novel")
    args = parser.parse_args()
    asyncio.run(run(args.email, args.password, args.project))
