"""Seed a ready-to-use demo account so the app can be exercised without setup.

Usage:
    make seed
    uv run python scripts/seed_demo.py --email you@example.com --password hunter2

Creates one user and one project whose documents cover every state the
workspace can be in, so each toolbar action has something to act on:

  Story Bible   a filled bible, not the empty heading template
  Chapter 1     brief + prose + a cached summary, so it is ready to be
                context for later chapters without spending a summarizer call
  Chapter 2     brief + saved scene plan, empty body -> Generate Draft
  Chapter 3     brief only -> Generate Plan, or the plan-then-draft path
  Research note a note document, which every agent deliberately ignores

Re-running replaces the demo project so the demo always starts pristine. Any
other project on the account is left alone.
"""

import argparse
import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import select

load_dotenv()

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from backend.auth import hash_password  # noqa: E402
from backend.db import get_session_factory, init_db  # noqa: E402
from backend.db_models import Document, Project, User  # noqa: E402
from backend.doc_storage import body_hash  # noqa: E402

DEFAULT_EMAIL = "demo@maya.local"
DEFAULT_PASSWORD = "demo1234"
DEFAULT_PROJECT = "Demo — The Salt Road"

BIBLE = """## Characters

### Ines Balard
Traits:
- Salt assessor for the Weighing House, twelve years in the post
- Reads people the way she reads a ledger: by what does not balance
- Keeps her father's brass weight in her coat pocket and touches it when lying

Dialogue examples:
- "The pan doesn't argue. It just sits there being right."
- "I am not accusing you. I am reading you the number."

### Teodor Wray
Traits:
- Caravan master on the inland route, loud in company and quiet alone
- Owes the Weighing House more than he has told anyone
- Laughs first when he is frightened

Dialogue examples:
- "Salt's honest. It's the men around it that curdle."
- "Ask me tomorrow. Tomorrow I'll have a better answer for you."

## World

- The city of Ferrun taxes salt by weight at a single chokepoint, the Weighing
  House, whose brass scales are considered legally infallible.
- Caravans cross the flats in six-week cycles; a delayed caravan is assumed lost
  and its bond is forfeit to the House.
- Assessors may not own salt, hold caravan shares, or marry into a trading
  family. The prohibition is old and unevenly enforced.
- Nothing supernatural occurs. The pressure in this story is entirely economic.

## Style

- Close third person, past tense, one POV per chapter.
- Concrete and restrained. Prefer the physical detail to the emotional summary.
- Dialogue carries the conflict; characters rarely name what they want.
- No prologue-style narration and no foreshadowing addressed to the reader.

## Timeline

- Day 1: Teodor's caravan arrives eleven days late and one barrel short.
- Day 2: Ines re-weighs the shipment and finds the discrepancy is not an error.
- Day 4: The bond hearing. Both of them will have to choose what to say.
"""

CHAPTER_ONE_BRIEF = (
    "Ines re-weighs Teodor's late caravan and finds a shortfall that cannot be "
    "an accident; she says nothing yet."
)

CHAPTER_ONE_BODY = """The caravan came in eleven days late, and Ines heard it before she saw it — \
the flat complaint of cart axles that had been dry since the second week out.

She was already at the pans when Teodor Wray came through the doors of the \
Weighing House with the road still on him. He had the particular cheerfulness \
of a man who had rehearsed being cheerful.

"Assessor," he said. "You look well. You look like someone who slept."

"I slept fine." She did not look up. "Twenty-two barrels?"

"Twenty-two." He set the manifest on the counter and did not let go of it \
immediately. "One took water on the flats. It's lighter. I've marked it."

She weighed all twenty-two anyway, because the House weighed all of them, and \
because she had learned in twelve years that the barrel a man explains first is \
rarely the barrel that matters. The brass pans took each one and settled, and \
she wrote the numbers down in the long column, and the column came out wrong.

Not wrong the way water made things wrong. Water was a slow, stupid thief and \
it took from everywhere at once. This was clean. This was one figure that had \
been chosen.

Ines put her hand in her coat pocket and touched her father's weight, and heard \
herself say, "The flats were hard this cycle."

"The flats are always hard." Teodor laughed, first and too quickly. "Ask me \
tomorrow. Tomorrow I'll have a better answer for you."

She closed the ledger on the wrong number and told him the House would post its \
assessment in the morning. He thanked her twice, which was once more than he \
had ever thanked her before, and went out into the street where his people were \
waiting to hear that it had gone fine.

Ines stood a while in the cold of the weighing floor. The pans did not argue. \
They sat there, being right, the way they always were, and she was going to \
have to decide what to do about it before the bond hearing on the fourth day.
"""

CHAPTER_ONE_SUMMARY = (
    "Teodor Wray's caravan reaches the Weighing House eleven days late with "
    "twenty-two barrels. Teodor pre-emptively explains that one barrel took "
    "water on the flats and is therefore light. Ines Balard, the assessor, "
    "weighs all twenty-two regardless and finds the shortfall is too clean to "
    "be water damage: a single figure has been deliberately altered. She does "
    "not confront him. She tells him the assessment will be posted in the "
    "morning, and he thanks her twice, which is unusual for him. Ines now "
    "knows the discrepancy is deliberate; Teodor does not know that she knows. "
    "The bond hearing is on day four. Established facts: Ines has served twelve "
    "years, carries her father's brass weight in her pocket, and touches it "
    "when she lies; Teodor laughs first when frightened."
)

CHAPTER_TWO_BRIEF = (
    "Teodor tries to settle the shortfall privately before the hearing; Ines "
    "refuses to name a price and he realises she already knows."
)

CHAPTER_TWO_PLAN = {
    "goal": (
        "Move the shortfall from something Ines privately knows to something "
        "both characters know, without either of them saying it outright."
    ),
    "pov_character": "Teodor Wray",
    "location": "The back room of the Anchor and Sheaf, an hour before curfew",
    "beats": [
        "Teodor arrives early and picks the seat facing the door, which he tells himself is habit.",
        "He offers Ines a share in the next cycle, framed as gratitude for years of fair assessment.",
        "Ines does not refuse the offer; she asks him what the barrel weighed when it left the flats.",
        "Teodor laughs, and hears himself do it, and knows she has heard it too.",
        "He tries a second, smaller lie and abandons it halfway through.",
        "Ines leaves money on the table for her own drink, which she has never done before.",
    ],
    "sensory_anchor": "Wet wool drying too near the fire, and under it the flat mineral smell of salt on a man's coat",
    "opening_image": "A chair turned to face the door before anyone else is in the room.",
    "closing_image": "Two coins standing on edge in a ring of spilled beer, still upright as the door closes.",
}

CHAPTER_THREE_BRIEF = (
    "The bond hearing. Ines must read her assessment aloud with Teodor in the "
    "room, and decide in the moment how much of the truth the number will carry."
)

RESEARCH_NOTE = """Not story text — scratch notes. Note documents are never sent to the
planner, drafter, or checker, so this is a safe place to think.

Open questions
- Does Ines have a personal stake in the shortfall, or is her hesitation purely
  professional? Cleaner if it stays professional until chapter 3.
- How much does the reader learn about Teodor's debt before the hearing? Current
  plan: only what he lets slip in chapter 2.

Period detail to check
- Salt taxed by weight rather than by volume — check whether a chokepoint city
  would realistically do both.
- What a forfeited bond would actually do to a caravan master's crew.

Rules I keep breaking
- Stop explaining Ines's feelings after her dialogue. The line should carry it.
"""


def _documents(project_id) -> list[Document]:
    """The demo project's documents, in sidebar order.

    Position, not title, is what decides which chapters count as "previous" for
    a generation, so these are built in the order they should appear.
    """
    return [
        Document(
            project_id=project_id,
            title="Story Bible",
            kind="bible",
            body=BIBLE,
            position=0,
        ),
        Document(
            project_id=project_id,
            # Short enough not to truncate in the sidebar at its default width.
            title="1. The Weighing House",
            kind="chapter",
            brief=CHAPTER_ONE_BRIEF,
            body=CHAPTER_ONE_BODY,
            # Pre-cached so the first generation on a later chapter does not
            # spend a summarizer call. Editing the body invalidates it normally.
            summary=CHAPTER_ONE_SUMMARY,
            summary_hash=body_hash(CHAPTER_ONE_BODY),
            position=1,
        ),
        Document(
            project_id=project_id,
            title="2. Salt and Silver",
            kind="chapter",
            brief=CHAPTER_TWO_BRIEF,
            body="",
            plan=CHAPTER_TWO_PLAN,
            position=2,
        ),
        Document(
            project_id=project_id,
            title="3. The Bond Hearing",
            kind="chapter",
            brief=CHAPTER_THREE_BRIEF,
            body="",
            position=3,
        ),
        Document(
            project_id=project_id,
            title="Research — salt trade",
            kind="note",
            body=RESEARCH_NOTE,
            position=4,
        ),
    ]


async def seed(email: str, password: str, project_name: str) -> None:
    # Surfaces "run make migrate" rather than "no such table: users".
    await init_db()

    async with get_session_factory()() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is None:
            user = User(email=email, hashed_password=hash_password(password))
            db.add(user)
            await db.flush()
            print(f"Created user {email}")
        else:
            # Reset the password so a forgotten demo password is never a dead end.
            user.hashed_password = hash_password(password)
            print(f"Reusing user {email} (password reset)")

        result = await db.execute(
            select(Project).where(Project.user_id == user.id, Project.name == project_name)
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            await db.delete(existing)  # cascades to its documents
            await db.flush()
            print(f"Replaced the existing '{project_name}' project")

        project = Project(user_id=user.id, name=project_name)
        db.add(project)
        await db.flush()

        documents = _documents(project.id)
        db.add_all(documents)
        await db.commit()

    print(f"\nSeeded '{project_name}' with {len(documents)} documents:")
    for document in documents:
        state = {
            "bible": "filled",
            "note": "scratch notes",
        }.get(document.kind)
        if state is None:
            if document.body:
                state = "has prose + cached summary"
            elif document.plan:
                state = "plan saved, no prose yet"
            else:
                state = "brief only"
        print(f"  [{document.position}] {document.title} ({document.kind}, {state})")

    print(f"\nLog in at http://localhost:5173 with {email} / {password}")
    print("Then: Chapter 3 tests Generate Plan, Chapter 2 tests Generate Draft,")
    print("and Chapter 1 tests Check. Generation needs ANTHROPIC_API_KEY in .env.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed a demo account for local testing")
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    parser.add_argument("--project", default=DEFAULT_PROJECT)
    args = parser.parse_args()
    asyncio.run(seed(args.email, args.password, args.project))
