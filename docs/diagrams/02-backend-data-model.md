# Backend data model

Defined in `backend/db_models.py`; the schema itself is owned by Alembic (`alembic/versions/`), which is the only thing that writes DDL.

## The live tables

```mermaid
erDiagram
    USERS ||--o{ PROJECTS : owns
    PROJECTS ||--o{ DOCUMENTS : contains

    USERS {
        uuid id PK
        string email UK "indexed, unique"
        text hashed_password "bcrypt"
        datetime created_at
    }

    PROJECTS {
        uuid id PK
        uuid user_id FK "→ users.id, ON DELETE CASCADE"
        string name
        text bible_content "legacy, unused"
        text outline_content "legacy, unused"
        datetime created_at
        datetime updated_at
    }

    DOCUMENTS {
        uuid id PK
        uuid project_id FK "→ projects.id, ON DELETE CASCADE"
        string title
        string kind "bible | chapter | note"
        text body "the prose"
        text brief "chapter only — the outline beat"
        json plan "ScenePlan or null"
        json issues "Issue[] or null"
        text summary "cached continuity summary"
        string summary_hash "sha256(body) when summary was made"
        int position "0-based, contiguous"
        datetime created_at
        datetime updated_at
    }
```

Three rules live in this table rather than in application code, and they are the ones worth knowing:

**One bible per project.**
`uq_documents_project_bible` is a *partial* unique index on `project_id` where `kind = 'bible'`.
Partial indexes work on both SQLite and PostgreSQL, so the same declaration covers local dev and the Railway deployment.
Creating a project seeds that bible document immediately (`main.py`), and `delete_document` refuses to remove it with a 409.

**`position` is contiguous.**
It is the sidebar order and the chapter order at once — `build_previous_summaries` uses "documents with a lower `position`" to mean "earlier chapters".
`delete_document` renumbers the survivors to close the gap, and `reorder_documents` rejects any list that is not exactly the project's document set.

**`summary_hash` is a cache key, not a checksum.**
It records the `sha256` of the body *at the time the summary was written*.
Any write to `body` sets it to `NULL`, invalidating the cached summary.
See [03](03-backend-workflows.md#summary-caching).

## The legacy tables

`db_models.py` also defines `Chapter`, `DraftState`, and `Summary`.
**Nothing in the running application reads or writes them.**
They predate the document-based workspace and survive only for `scripts/migrate_to_db.py`, a one-off importer from the old file-based layout.
`Project.chapters`, `Project.bible_content`, and `Project.outline_content` are dead for the same reason.

```mermaid
erDiagram
    PROJECTS ||--o{ CHAPTERS : "legacy"
    CHAPTERS ||--o| DRAFT_STATES : "legacy"
    CHAPTERS ||--o| SUMMARIES : "legacy"

    CHAPTERS {
        uuid id PK
        uuid project_id FK
        int number "unique per project"
        json plan
        text draft
        json issues
        string status
    }
    DRAFT_STATES {
        uuid id PK
        uuid chapter_id FK "unique"
        string step
        json scene_plan
        text draft
        json issues
    }
    SUMMARIES {
        uuid id PK
        uuid chapter_id FK "unique"
        text text
    }
```

Everything a chapter used to hold now lives on a single `documents` row: `draft` became `body`, `scene_plan` became `plan`, and the separate `summaries` table became the `summary` / `summary_hash` columns.

## The agent state contract

The four agent functions in `backend/agents/` share one plain-dict shape, assembled by `_base_state` in `routes/generate.py`.
It is not a class — this diagram describes the keys, not a type that exists in the code.

| Key | Where it comes from |
|---|---|
| `outline_beat` | `document.brief` — what happens in this chapter |
| `story_bible` | the body of the project's one `bible` document |
| `previous_summaries` | earlier chapters, oldest first (see [03](03-backend-workflows.md#summary-caching)) |
| `scene_plan` | `document.plan`, or `{}` when there is none |
| `draft` | the prose being checked or revised; empty when drafting from scratch |
| `continuity_issues` | `document.issues`; `severity` is one of `critical`, `minor`, `style` |

```mermaid
classDiagram
    class AgentState {
        <<dict>>
        str outline_beat
        str story_bible
        list~str~ previous_summaries
        dict scene_plan
        str draft
        list~Issue~ continuity_issues
    }

    class ScenePlan {
        <<tool schema - planner.py>>
        str goal
        str pov_character
        str location
        list~str~ beats
        str sensory_anchor
        str opening_image
        str closing_image
    }

    class Issue {
        <<tool schema - checker.py>>
        str issue
        str severity
        str location
        str suggested_fix
    }

    class planner_node {
        <<async>>
        +planner_node(state) dict
        reads outline_beat, story_bible, previous_summaries
        returns scene_plan
    }
    class drafter_token_stream {
        <<async generator>>
        +drafter_token_stream(state) AsyncIterator~str~
        reads story_bible, scene_plan, previous_summaries
        also reads draft and continuity_issues when revising
        yields prose deltas
    }
    class checker_node {
        <<async>>
        +checker_node(state) dict
        reads draft, scene_plan, story_bible, previous_summaries
        returns continuity_issues
    }
    class summarize_node {
        <<async>>
        +summarize_node(text) str
        takes a chapter body, not the state dict
    }

    AgentState ..> ScenePlan : scene_plan holds
    AgentState ..> Issue : continuity_issues holds
    planner_node ..> AgentState
    drafter_token_stream ..> AgentState
    checker_node ..> AgentState
```

`ScenePlan` and `Issue` are not Python classes either — they are JSON Schemas passed to the Anthropic API as forced tools (`tool_choice` pins the tool), so the model returns structured data rather than prose to parse.
Both raise `RuntimeError` if the response carries no `tool_use` block.
The frontend mirrors both shapes as TypeScript interfaces in `frontend/src/api/types.ts`; those two files must be changed together.

`drafter_token_stream` is the only agent with two behaviors: `_build_messages` takes its revision branch when `draft` **and** `continuity_issues` are both non-empty, and its from-scratch branch otherwise.
