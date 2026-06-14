# Story Bible Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-YAML BiblePanel sidebar with a structured, icon-driven story bible page containing five structured sections (Characters, World, Styles, Timeline, Outlines), while making chapter writing the default workspace view.

**Architecture:** A permanent `NavBar` (44px icon bar) drives a `view` state in `WorkspaceScreen`. `view === 'write'` renders the existing `ChapterPanel` unchanged; any other value renders the new `StoryBiblePage` — a single scrollable page with five section components that auto-save via debounced mutations. The backend bible/outline endpoints change from raw YAML strings to typed JSON objects; no DB schema changes are needed.

**Tech Stack:** React 19 + TypeScript, Tailwind CSS, TanStack Query v5, Vitest + Testing Library (frontend); FastAPI + SQLAlchemy async, Pydantic v2, aiosqlite/asyncpg, pytest-asyncio (backend). Run backend tests with `uv run pytest`; frontend tests with `cd frontend && npm test`; type-check with `cd frontend && npm run typecheck`.

---

## File Map

| Status | Path | Responsibility |
|--------|------|----------------|
| Modify | `backend/db_storage.py` | JSON load/save for bible + outline |
| Modify | `backend/models.py` | Structured Pydantic models for bible/outline |
| Modify | `backend/main.py` | Updated GET/PUT /bible and /outline endpoints |
| Modify | `tests/conftest.py` | Switch fixtures from YAML to JSON |
| Modify | `tests/test_storage.py` | Update + add storage tests |
| Create | `frontend/src/api/bible-types.ts` | TypeScript types + empty defaults |
| Modify | `frontend/src/api/endpoints.ts` | Typed getBible/saveBible/getOutline/saveOutline |
| Modify | `frontend/src/hooks/queries.ts` | Typed query hooks |
| Create | `frontend/src/components/NavBar.tsx` | Icon sidebar with view switching |
| Create | `frontend/src/components/bible/ListField.tsx` | Reusable list-of-text-inputs component |
| Create | `frontend/src/components/bible/CharactersSection.tsx` | Characters section |
| Create | `frontend/src/components/bible/WorldSection.tsx` | World section |
| Create | `frontend/src/components/bible/StylesSection.tsx` | Styles section |
| Create | `frontend/src/components/bible/TimelineSection.tsx` | Timeline section |
| Create | `frontend/src/components/bible/OutlinesSection.tsx` | Outlines section |
| Create | `frontend/src/screens/StoryBiblePage.tsx` | Scrollable bible page + auto-save |
| Modify | `frontend/src/screens/WorkspaceScreen.tsx` | Add NavBar + view state |
| Delete | `frontend/src/components/BiblePanel.tsx` | Replaced by StoryBiblePage |

---

## Task 1: Backend — storage layer (JSON)

**Files:**
- Modify: `backend/db_storage.py`
- Modify: `tests/test_storage.py`

- [ ] **Step 1: Write failing tests**

Replace the `project` fixture and update affected tests in `tests/test_storage.py`. The fixture now seeds JSON content; `save_bible` and `save_outline` now accept dicts.

```python
# tests/test_storage.py  — full replacement
import json
import uuid

import pytest
import pytest_asyncio

from backend import db_storage as storage
from backend.db_models import Project, User
from backend.auth import hash_password


@pytest_asyncio.fixture
async def project(db) -> tuple:
    """Create a test user and project seeded with JSON content."""
    user = User(email="writer@example.com", hashed_password=hash_password("pw"))
    db.add(user)
    await db.flush()

    bible_json = json.dumps({
        "characters": [{"name": "Elena", "traits": ["determined", "left-handed"], "dialogue_examples": ["I won't wait.", "The Citadel takes."]}],
        "world": {"locations": ["The Citadel", "The Wastes"], "rules": ["Magic requires physical cost"]},
        "timeline": [],
        "style_guide": {"voice": "sparse and precise", "avoid": ["adverbs ending in -ly"]},
    })
    outline_json = json.dumps({"chapters": ["Elena arrives at the gates", "Elena finds lodging"]})

    proj = Project(
        user_id=user.id,
        name="Test Novel",
        bible_content=bible_json,
        outline_content=outline_json,
    )
    db.add(proj)
    await db.commit()
    return db, proj.id


@pytest.mark.asyncio
async def test_load_bible(project):
    db, project_id = project
    result = await storage.load_bible(db, project_id)
    assert result["characters"][0]["name"] == "Elena"


@pytest.mark.asyncio
async def test_load_bible_returns_empty_on_non_json(db):
    """Old YAML content falls back to EMPTY_BIBLE rather than crashing."""
    user = User(email="x@x.com", hashed_password=hash_password("pw"))
    db.add(user)
    await db.flush()
    proj = Project(user_id=user.id, name="x", bible_content="characters:\n  - name: Elena\n", outline_content="{}")
    db.add(proj)
    await db.commit()
    result = await storage.load_bible(db, proj.id)
    assert result["characters"] == []
    assert result["world"] == {"locations": [], "rules": []}


@pytest.mark.asyncio
async def test_load_outline(project):
    db, project_id = project
    result = await storage.load_outline(db, project_id)
    assert len(result["chapters"]) == 2
    assert "Elena" in result["chapters"][0]


@pytest.mark.asyncio
async def test_save_bible_and_reload(project, sample_bible):
    db, project_id = project
    new_data = {**sample_bible, "world": {"locations": ["New Place"], "rules": []}}
    await storage.save_bible(db, project_id, new_data)
    result = await storage.load_bible(db, project_id)
    assert result["world"]["locations"] == ["New Place"]


@pytest.mark.asyncio
async def test_save_bible_rejects_non_dict(project):
    db, project_id = project
    with pytest.raises(ValueError):
        await storage.save_bible(db, project_id, ["list", "item"])


@pytest.mark.asyncio
async def test_save_outline_and_reload(project):
    db, project_id = project
    await storage.save_outline(db, project_id, {"chapters": ["Elena arrives", "Elena departs"]})
    result = await storage.load_outline(db, project_id)
    assert result["chapters"] == ["Elena arrives", "Elena departs"]


@pytest.mark.asyncio
async def test_save_outline_rejects_missing_chapters(project):
    db, project_id = project
    with pytest.raises(ValueError):
        await storage.save_outline(db, project_id, {"title": "My Book"})


# Keep the remaining tests from the original file unchanged:
# test_load_summaries_empty, test_load_summaries_reads_previous_chapters,
# test_load_summaries_stops_before_current_chapter, test_save_and_load_chapter,
# test_load_chapter_not_found, test_draft_state_roundtrip, test_delete_draft_state,
# test_save_and_load_summary, test_chapter_exists
# (copy them verbatim from the original test_storage.py)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
uv run pytest tests/test_storage.py -v
```

Expected: failures on `test_save_bible_and_reload`, `test_save_bible_rejects_non_dict`, `test_save_outline_and_reload`, `test_save_outline_rejects_missing_chapters`, `test_load_bible_returns_empty_on_non_json` (functions not yet updated).

- [ ] **Step 3: Update `backend/db_storage.py`**

Replace the top of the file (add `import json`, remove the `yaml` import, add `EMPTY_BIBLE` constant, rewrite the four bible/outline functions, remove `load_bible_text` and `load_outline_text`):

```python
# backend/db_storage.py  — top section (keep everything from _get_or_create_chapter onward unchanged)
import json
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db_models import Chapter, DraftState, Project, Summary


EMPTY_BIBLE: dict = {
    "characters": [],
    "world": {"locations": [], "rules": []},
    "style_guide": {"voice": "", "avoid": []},
    "timeline": [],
}


async def _get_project(db: AsyncSession, project_id: uuid.UUID) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def load_bible(db: AsyncSession, project_id: uuid.UUID) -> dict:
    project = await _get_project(db, project_id)
    try:
        return json.loads(project.bible_content) or EMPTY_BIBLE
    except (json.JSONDecodeError, ValueError):
        return dict(EMPTY_BIBLE)


async def save_bible(db: AsyncSession, project_id: uuid.UUID, data: dict) -> None:
    if not isinstance(data, dict):
        raise ValueError("Bible must be a dict")
    project = await _get_project(db, project_id)
    project.bible_content = json.dumps(data)
    await db.commit()


async def load_outline(db: AsyncSession, project_id: uuid.UUID) -> dict:
    project = await _get_project(db, project_id)
    try:
        return json.loads(project.outline_content) or {"chapters": []}
    except (json.JSONDecodeError, ValueError):
        return {"chapters": []}


async def save_outline(db: AsyncSession, project_id: uuid.UUID, data: dict) -> None:
    if not isinstance(data, dict) or "chapters" not in data:
        raise ValueError("Outline must be a dict with a 'chapters' key")
    project = await _get_project(db, project_id)
    project.outline_content = json.dumps(data)
    await db.commit()
```

Keep `_get_or_create_chapter`, `chapter_exists`, `load_summaries`, `save_summary`, `save_chapter`, `save_draft_state`, `load_draft_state`, `delete_draft_state`, `load_chapter` unchanged.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
uv run pytest tests/test_storage.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/db_storage.py tests/test_storage.py
git commit -m "feat: switch bible/outline storage from YAML to JSON"
```

---

## Task 2: Backend — Pydantic models + API endpoints

**Files:**
- Modify: `backend/models.py`
- Modify: `backend/main.py`
- Modify: `tests/conftest.py`

- [ ] **Step 1: Update `backend/models.py`**

Replace `BibleUpdateRequest` and `OutlineUpdateRequest` with structured Pydantic models. Keep all other models unchanged.

```python
# backend/models.py — replace BibleUpdateRequest and OutlineUpdateRequest

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
```

- [ ] **Step 2: Update GET/PUT /bible and /outline in `backend/main.py`**

Replace the four bible/outline route handlers. Also remove the now-unused `load_bible_text` and `load_outline_text` imports from the `from backend.db_storage import (...)` block.

```python
# backend/main.py — updated imports block (remove load_bible_text, load_outline_text)
from backend.db_storage import (
    chapter_exists,
    delete_draft_state,
    load_bible,
    load_chapter,
    load_draft_state,
    load_outline,
    load_summaries,
    save_bible,
    save_chapter,
    save_draft_state,
    save_outline,
)
```

```python
# backend/main.py — replace the Bible section (lines ~187-206)

@app.get("/projects/{project_id}/bible")
async def get_bible(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    return await load_bible(db, project_id)


@app.put("/projects/{project_id}/bible")
async def update_bible(
    project_id: uuid.UUID,
    request: BibleUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    await save_bible(db, project_id, request.model_dump())
    return {"status": "saved"}
```

```python
# backend/main.py — replace the Outline section (lines ~213-232)

@app.get("/projects/{project_id}/outline")
async def get_outline(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    return await load_outline(db, project_id)


@app.put("/projects/{project_id}/outline")
async def update_outline(
    project_id: uuid.UUID,
    request: OutlineUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user, db)
    await save_outline(db, project_id, request.model_dump())
    return {"status": "saved"}
```

- [ ] **Step 3: Update `tests/conftest.py`**

Switch YAML seeds to JSON in both `authed_client` and `sample_bible`. Add `import json` at the top; remove `import yaml`.

```python
# tests/conftest.py — updated authed_client fixture (replace the project creation block)
import json

# inside authed_client, replace the client.post("/projects", ...) call:
resp = await client.post("/projects", json={
    "name": "Test Novel",
    "bible_content": json.dumps({
        "characters": [{"name": "Elena", "traits": ["determined", "left-handed"], "dialogue_examples": ["I won't wait.", "The Citadel takes."]}],
        "world": {"locations": ["The Citadel", "The Wastes"], "rules": ["Magic requires physical cost"]},
        "timeline": [],
        "style_guide": {"voice": "sparse and precise", "avoid": ["adverbs ending in -ly", "passive voice"]},
    }),
    "outline_content": json.dumps({"chapters": ["Elena arrives at the gates", "Elena finds lodging"]}),
})
```

```python
# tests/conftest.py — updated sample_bible fixture (timeline is now list[str])
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
        "timeline": ["Elena leaves home"],
        "style_guide": {
            "voice": "sparse and precise",
            "avoid": ["adverbs ending in -ly", "passive voice"],
        },
    }
```

- [ ] **Step 4: Run all backend tests**

```bash
uv run pytest -v
```

Expected: all tests pass. If `test_api.py` tests for bible/outline content fail (e.g. checking the value returned by GET /bible after project creation), update those specific assertions to either: (a) call PUT /bible first to seed structured data, then GET /bible; or (b) assert the empty-bible shape instead of YAML-seeded content.

- [ ] **Step 5: Commit**

```bash
git add backend/models.py backend/main.py tests/conftest.py
git commit -m "feat: update bible/outline API endpoints to structured JSON"
```

---

## Task 3: Frontend — bible types

**Files:**
- Create: `frontend/src/api/bible-types.ts`
- Create: `frontend/src/api/bible-types.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/api/bible-types.test.ts
import { describe, expect, it } from 'vitest';
import { EMPTY_BIBLE, EMPTY_OUTLINE } from './bible-types';

describe('EMPTY_BIBLE', () => {
  it('has the expected shape', () => {
    expect(EMPTY_BIBLE.characters).toEqual([]);
    expect(EMPTY_BIBLE.world).toEqual({ locations: [], rules: [] });
    expect(EMPTY_BIBLE.style_guide).toEqual({ voice: '', avoid: [] });
    expect(EMPTY_BIBLE.timeline).toEqual([]);
  });
});

describe('EMPTY_OUTLINE', () => {
  it('has chapters array', () => {
    expect(EMPTY_OUTLINE.chapters).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd frontend && npm test -- bible-types
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/api/bible-types.ts`**

```typescript
// frontend/src/api/bible-types.ts
export interface Character {
  name: string;
  traits: string[];
  dialogue_examples: string[];
}

export interface BibleData {
  characters: Character[];
  world: {
    locations: string[];
    rules: string[];
  };
  style_guide: {
    voice: string;
    avoid: string[];
  };
  timeline: string[];
}

export interface OutlineData {
  chapters: string[];
}

export const EMPTY_BIBLE: BibleData = {
  characters: [],
  world: { locations: [], rules: [] },
  style_guide: { voice: '', avoid: [] },
  timeline: [],
};

export const EMPTY_OUTLINE: OutlineData = { chapters: [] };
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd frontend && npm test -- bible-types
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/bible-types.ts frontend/src/api/bible-types.test.ts
git commit -m "feat: add bible/outline TypeScript types"
```

---

## Task 4: Frontend — update API layer

**Files:**
- Modify: `frontend/src/api/endpoints.ts`
- Modify: `frontend/src/hooks/queries.ts`

- [ ] **Step 1: Update `frontend/src/api/endpoints.ts`**

Replace the four bible/outline functions. Add the `BibleData` / `OutlineData` import.

```typescript
// frontend/src/api/endpoints.ts — add this import at the top
import type { BibleData, OutlineData } from './bible-types';

// Replace the bible / outline section (lines ~42-54):
export const getBible = (projectId: string) =>
  request<BibleData>(`/projects/${projectId}/bible`);

export const saveBible = (projectId: string, data: BibleData) =>
  request<{ status: string }>(`/projects/${projectId}/bible`, { method: 'PUT', body: data });

export const getOutline = (projectId: string) =>
  request<OutlineData>(`/projects/${projectId}/outline`);

export const saveOutline = (projectId: string, data: OutlineData) =>
  request<{ status: string }>(`/projects/${projectId}/outline`, { method: 'PUT', body: data });
```

- [ ] **Step 2: Update `frontend/src/hooks/queries.ts`**

```typescript
// frontend/src/hooks/queries.ts — full replacement
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBible, getOutline, saveBible, saveOutline } from '../api/endpoints';
import type { BibleData, OutlineData } from '../api/bible-types';

export const bibleKey = (projectId: string) => ['bible', projectId] as const;
export const outlineKey = (projectId: string) => ['outline', projectId] as const;

export function useBible(projectId: string) {
  return useQuery({ queryKey: bibleKey(projectId), queryFn: () => getBible(projectId) });
}

export function useOutline(projectId: string) {
  return useQuery({ queryKey: outlineKey(projectId), queryFn: () => getOutline(projectId) });
}

export function useSaveBible(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: BibleData) => saveBible(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: bibleKey(projectId) }),
  });
}

export function useSaveOutline(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: OutlineData) => saveOutline(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: outlineKey(projectId) }),
  });
}
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/endpoints.ts frontend/src/hooks/queries.ts
git commit -m "feat: update bible/outline API layer to typed JSON"
```

---

## Task 5: Frontend — NavBar component

**Files:**
- Create: `frontend/src/components/NavBar.tsx`
- Create: `frontend/src/components/NavBar.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/components/NavBar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavBar } from './NavBar';

describe('NavBar', () => {
  it('renders all 6 navigation buttons', () => {
    render(<NavBar view="write" onViewChange={() => {}} />);
    expect(screen.getByTitle('Write')).toBeInTheDocument();
    expect(screen.getByTitle('Characters')).toBeInTheDocument();
    expect(screen.getByTitle('World')).toBeInTheDocument();
    expect(screen.getByTitle('Styles')).toBeInTheDocument();
    expect(screen.getByTitle('Timeline')).toBeInTheDocument();
    expect(screen.getByTitle('Outlines')).toBeInTheDocument();
  });

  it('applies active style to the current view button', () => {
    render(<NavBar view="characters" onViewChange={() => {}} />);
    expect(screen.getByTitle('Characters')).toHaveClass('bg-blue-500');
    expect(screen.getByTitle('Write')).not.toHaveClass('bg-blue-500');
  });

  it('calls onViewChange with the clicked view key', async () => {
    const onViewChange = vi.fn();
    render(<NavBar view="write" onViewChange={onViewChange} />);
    await userEvent.click(screen.getByTitle('Characters'));
    expect(onViewChange).toHaveBeenCalledWith('characters');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npm test -- NavBar
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/components/NavBar.tsx`**

```tsx
// frontend/src/components/NavBar.tsx
import { cn } from '../lib/utils';

export type View = 'write' | 'characters' | 'world' | 'styles' | 'timeline' | 'outlines';

const NAV_ITEMS: { view: View; icon: string; label: string }[] = [
  { view: 'write',      icon: '✏️', label: 'Write'      },
  { view: 'characters', icon: '👤', label: 'Characters' },
  { view: 'world',      icon: '🌍', label: 'World'      },
  { view: 'styles',     icon: '🎨', label: 'Styles'     },
  { view: 'timeline',   icon: '📅', label: 'Timeline'   },
  { view: 'outlines',   icon: '📋', label: 'Outlines'   },
];

interface NavBarProps {
  view: View;
  onViewChange: (v: View) => void;
}

export function NavBar({ view, onViewChange }: NavBarProps) {
  return (
    <nav className="flex w-11 flex-shrink-0 flex-col items-center gap-3 bg-[#1a1a2e] py-3">
      {NAV_ITEMS.map(({ view: v, icon, label }) => (
        <button
          key={v}
          title={label}
          type="button"
          onClick={() => onViewChange(v)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors',
            view === v
              ? 'bg-blue-500'
              : 'bg-[#2a2a4a] text-gray-400 hover:bg-[#3a3a5a]',
          )}
        >
          {icon}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend && npm test -- NavBar
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/NavBar.tsx frontend/src/components/NavBar.test.tsx
git commit -m "feat: add NavBar icon sidebar"
```

---

## Task 6: Frontend — ListField shared component

**Files:**
- Create: `frontend/src/components/bible/ListField.tsx`
- Create: `frontend/src/components/bible/ListField.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/components/bible/ListField.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListField } from './ListField';

describe('ListField', () => {
  it('renders existing items', () => {
    render(<ListField label="Traits" items={['brave', 'clever']} addLabel="+ Add" onChange={() => {}} />);
    expect(screen.getByDisplayValue('brave')).toBeInTheDocument();
    expect(screen.getByDisplayValue('clever')).toBeInTheDocument();
  });

  it('calls onChange with new empty item when add button is clicked', async () => {
    const onChange = vi.fn();
    render(<ListField label="Traits" items={['a']} addLabel="+ Add trait" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Add trait' }));
    expect(onChange).toHaveBeenCalledWith(['a', '']);
  });

  it('calls onChange without the removed item when × is clicked', async () => {
    const onChange = vi.fn();
    render(<ListField label="Traits" items={['a', 'b']} addLabel="+ Add" onChange={onChange} />);
    const removeButtons = screen.getAllByRole('button', { name: '×' });
    await userEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('calls onChange with updated value when an item is edited', async () => {
    const onChange = vi.fn();
    render(<ListField label="Traits" items={['a']} addLabel="+ Add" onChange={onChange} />);
    await userEvent.type(screen.getByDisplayValue('a'), 'x');
    expect(onChange).toHaveBeenLastCalledWith(['ax']);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npm test -- ListField
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/components/bible/ListField.tsx`**

```tsx
// frontend/src/components/bible/ListField.tsx
import { FieldLabel } from '../ui/card';
import { Input } from '../ui/input';

interface ListFieldProps {
  label: string;
  items: string[];
  addLabel: string;
  onChange: (items: string[]) => void;
}

export function ListField({ label, items, addLabel, onChange }: ListFieldProps) {
  const update = (i: number, value: string) =>
    onChange(items.map((item, j) => (j === i ? value : item)));
  const remove = (i: number) =>
    onChange(items.filter((_, j) => j !== i));
  const add = () => onChange([...items, '']);

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input value={item} onChange={(e) => update(i, e.target.value)} className="flex-1" />
            <button
              type="button"
              onClick={() => remove(i)}
              className="flex-shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm leading-none text-gray-400 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-1.5 w-full rounded-md border border-dashed border-gray-300 bg-gray-50 py-1.5 text-[13px] text-gray-400 hover:bg-gray-100"
      >
        {addLabel}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend && npm test -- ListField
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/bible/ListField.tsx frontend/src/components/bible/ListField.test.tsx
git commit -m "feat: add ListField reusable component"
```

---

## Task 7: Frontend — CharactersSection

**Files:**
- Create: `frontend/src/components/bible/CharactersSection.tsx`
- Create: `frontend/src/components/bible/CharactersSection.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/components/bible/CharactersSection.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CharactersSection } from './CharactersSection';
import type { Character } from '../../api/bible-types';

describe('CharactersSection', () => {
  it('renders existing character name and traits', () => {
    const chars: Character[] = [{ name: 'Elena', traits: ['brave'], dialogue_examples: [] }];
    render(<CharactersSection characters={chars} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Elena')).toBeInTheDocument();
    expect(screen.getByDisplayValue('brave')).toBeInTheDocument();
  });

  it('calls onChange with an empty character when Add character is clicked', async () => {
    const onChange = vi.fn();
    render(<CharactersSection characters={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /add character/i }));
    expect(onChange).toHaveBeenCalledWith([{ name: '', traits: [], dialogue_examples: [] }]);
  });

  it('calls onChange without the character when Remove is clicked', async () => {
    const onChange = vi.fn();
    const chars: Character[] = [{ name: 'Elena', traits: [], dialogue_examples: [] }];
    render(<CharactersSection characters={chars} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npm test -- CharactersSection
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/components/bible/CharactersSection.tsx`**

```tsx
// frontend/src/components/bible/CharactersSection.tsx
import type { Character } from '../../api/bible-types';
import { FieldLabel } from '../ui/card';
import { Input } from '../ui/input';
import { ListField } from './ListField';

interface Props {
  characters: Character[];
  onChange: (characters: Character[]) => void;
}

export function CharactersSection({ characters, onChange }: Props) {
  const updateChar = (i: number, char: Character) =>
    onChange(characters.map((c, j) => (j === i ? char : c)));
  const removeChar = (i: number) =>
    onChange(characters.filter((_, j) => j !== i));
  const addChar = () =>
    onChange([...characters, { name: '', traits: [], dialogue_examples: [] }]);

  return (
    <section id="characters" className="mb-10">
      <h2 className="mb-4 border-b-2 border-blue-500 pb-2 text-lg font-bold text-gray-800">
        👤 Characters
      </h2>
      <div className="flex flex-col gap-4">
        {characters.map((char, i) => (
          <div key={i} className="rounded-md border border-gray-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <FieldLabel>Character {i + 1}</FieldLabel>
              <button
                type="button"
                onClick={() => removeChar(i)}
                className="text-xs text-gray-400 hover:text-red-600"
              >
                Remove
              </button>
            </div>
            <div className="mb-3 flex flex-col gap-1">
              <FieldLabel>Name</FieldLabel>
              <Input
                value={char.name}
                onChange={(e) => updateChar(i, { ...char, name: e.target.value })}
              />
            </div>
            <div className="mb-3">
              <ListField
                label="Traits"
                items={char.traits}
                addLabel="+ Add trait"
                onChange={(traits) => updateChar(i, { ...char, traits })}
              />
            </div>
            <ListField
              label="Dialogue examples"
              items={char.dialogue_examples}
              addLabel="+ Add example"
              onChange={(dialogue_examples) => updateChar(i, { ...char, dialogue_examples })}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addChar}
        className="mt-3 w-full rounded-md border border-dashed border-gray-300 bg-gray-50 py-2 text-sm text-gray-400 hover:bg-gray-100"
      >
        + Add character
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend && npm test -- CharactersSection
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/bible/CharactersSection.tsx frontend/src/components/bible/CharactersSection.test.tsx
git commit -m "feat: add CharactersSection component"
```

---

## Task 8: Frontend — WorldSection

**Files:**
- Create: `frontend/src/components/bible/WorldSection.tsx`
- Create: `frontend/src/components/bible/WorldSection.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/components/bible/WorldSection.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorldSection } from './WorldSection';

describe('WorldSection', () => {
  it('renders existing locations and rules', () => {
    render(<WorldSection world={{ locations: ['The Citadel'], rules: ['No magic'] }} onChange={() => {}} />);
    expect(screen.getByDisplayValue('The Citadel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('No magic')).toBeInTheDocument();
  });

  it('calls onChange when a location is added', async () => {
    const onChange = vi.fn();
    render(<WorldSection world={{ locations: [], rules: [] }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /add location/i }));
    expect(onChange).toHaveBeenCalledWith({ locations: [''], rules: [] });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd frontend && npm test -- WorldSection
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/components/bible/WorldSection.tsx`**

```tsx
// frontend/src/components/bible/WorldSection.tsx
import type { BibleData } from '../../api/bible-types';
import { ListField } from './ListField';

interface Props {
  world: BibleData['world'];
  onChange: (world: BibleData['world']) => void;
}

export function WorldSection({ world, onChange }: Props) {
  return (
    <section id="world" className="mb-10">
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-lg font-bold text-gray-800">
        🌍 World
      </h2>
      <div className="flex flex-col gap-5">
        <ListField
          label="Locations"
          items={world.locations}
          addLabel="+ Add location"
          onChange={(locations) => onChange({ ...world, locations })}
        />
        <ListField
          label="Rules"
          items={world.rules}
          addLabel="+ Add rule"
          onChange={(rules) => onChange({ ...world, rules })}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd frontend && npm test -- WorldSection
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/bible/WorldSection.tsx frontend/src/components/bible/WorldSection.test.tsx
git commit -m "feat: add WorldSection component"
```

---

## Task 9: Frontend — StylesSection

**Files:**
- Create: `frontend/src/components/bible/StylesSection.tsx`
- Create: `frontend/src/components/bible/StylesSection.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/components/bible/StylesSection.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StylesSection } from './StylesSection';

describe('StylesSection', () => {
  it('renders voice and avoid items', () => {
    render(
      <StylesSection
        style_guide={{ voice: 'sparse', avoid: ['adverbs'] }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue('sparse')).toBeInTheDocument();
    expect(screen.getByDisplayValue('adverbs')).toBeInTheDocument();
  });

  it('calls onChange when voice is edited', async () => {
    const onChange = vi.fn();
    render(<StylesSection style_guide={{ voice: '', avoid: [] }} onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'v');
    expect(onChange).toHaveBeenLastCalledWith({ voice: 'v', avoid: [] });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd frontend && npm test -- StylesSection
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/components/bible/StylesSection.tsx`**

```tsx
// frontend/src/components/bible/StylesSection.tsx
import type { BibleData } from '../../api/bible-types';
import { FieldLabel } from '../ui/card';
import { ListField } from './ListField';

interface Props {
  style_guide: BibleData['style_guide'];
  onChange: (style_guide: BibleData['style_guide']) => void;
}

export function StylesSection({ style_guide, onChange }: Props) {
  return (
    <section id="styles" className="mb-10">
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-lg font-bold text-gray-800">
        🎨 Styles
      </h2>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <FieldLabel>Voice</FieldLabel>
          <textarea
            value={style_guide.voice}
            onChange={(e) => onChange({ ...style_guide, voice: e.target.value })}
            rows={3}
            className="w-full resize-y rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1.5 text-sm focus:border-blue-300 focus:bg-white focus:outline-none"
          />
        </div>
        <ListField
          label="Avoid"
          items={style_guide.avoid}
          addLabel="+ Add"
          onChange={(avoid) => onChange({ ...style_guide, avoid })}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd frontend && npm test -- StylesSection
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/bible/StylesSection.tsx frontend/src/components/bible/StylesSection.test.tsx
git commit -m "feat: add StylesSection component"
```

---

## Task 10: Frontend — TimelineSection

**Files:**
- Create: `frontend/src/components/bible/TimelineSection.tsx`
- Create: `frontend/src/components/bible/TimelineSection.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/components/bible/TimelineSection.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimelineSection } from './TimelineSection';

describe('TimelineSection', () => {
  it('renders existing events', () => {
    render(<TimelineSection timeline={['Elena leaves home']} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Elena leaves home')).toBeInTheDocument();
  });

  it('calls onChange with new event when Add event is clicked', async () => {
    const onChange = vi.fn();
    render(<TimelineSection timeline={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /add event/i }));
    expect(onChange).toHaveBeenCalledWith(['']);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd frontend && npm test -- TimelineSection
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/components/bible/TimelineSection.tsx`**

```tsx
// frontend/src/components/bible/TimelineSection.tsx
import { ListField } from './ListField';

interface Props {
  timeline: string[];
  onChange: (timeline: string[]) => void;
}

export function TimelineSection({ timeline, onChange }: Props) {
  return (
    <section id="timeline" className="mb-10">
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-lg font-bold text-gray-800">
        📅 Timeline
      </h2>
      <ListField
        label="Events"
        items={timeline}
        addLabel="+ Add event"
        onChange={onChange}
      />
    </section>
  );
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd frontend && npm test -- TimelineSection
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/bible/TimelineSection.tsx frontend/src/components/bible/TimelineSection.test.tsx
git commit -m "feat: add TimelineSection component"
```

---

## Task 11: Frontend — OutlinesSection

**Files:**
- Create: `frontend/src/components/bible/OutlinesSection.tsx`
- Create: `frontend/src/components/bible/OutlinesSection.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/components/bible/OutlinesSection.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OutlinesSection } from './OutlinesSection';

describe('OutlinesSection', () => {
  it('renders chapter beats with labels', () => {
    render(<OutlinesSection chapters={['Elena arrives', 'Elena leaves']} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Elena arrives')).toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Chapter 2')).toBeInTheDocument();
  });

  it('calls onChange with new chapter when Add chapter is clicked', async () => {
    const onChange = vi.fn();
    render(<OutlinesSection chapters={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /add chapter/i }));
    expect(onChange).toHaveBeenCalledWith(['']);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd frontend && npm test -- OutlinesSection
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/components/bible/OutlinesSection.tsx`**

```tsx
// frontend/src/components/bible/OutlinesSection.tsx
import { Input } from '../ui/input';

interface Props {
  chapters: string[];
  onChange: (chapters: string[]) => void;
}

export function OutlinesSection({ chapters, onChange }: Props) {
  const update = (i: number, value: string) =>
    onChange(chapters.map((c, j) => (j === i ? value : c)));
  const remove = (i: number) =>
    onChange(chapters.filter((_, j) => j !== i));
  const add = () => onChange([...chapters, '']);

  return (
    <section id="outlines" className="mb-10">
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-lg font-bold text-gray-800">
        📋 Outlines
      </h2>
      <div className="flex flex-col gap-1.5">
        {chapters.map((chapter, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-20 flex-shrink-0 text-right text-xs text-gray-400">
              Chapter {i + 1}
            </span>
            <Input value={chapter} onChange={(e) => update(i, e.target.value)} className="flex-1" />
            <button
              type="button"
              onClick={() => remove(i)}
              className="flex-shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm leading-none text-gray-400 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-1.5 w-full rounded-md border border-dashed border-gray-300 bg-gray-50 py-1.5 text-[13px] text-gray-400 hover:bg-gray-100"
      >
        + Add chapter
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd frontend && npm test -- OutlinesSection
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/bible/OutlinesSection.tsx frontend/src/components/bible/OutlinesSection.test.tsx
git commit -m "feat: add OutlinesSection component"
```

---

## Task 12: Frontend — StoryBiblePage

**Files:**
- Create: `frontend/src/screens/StoryBiblePage.tsx`

This component holds the single scrollable bible page, auto-save logic, and the save indicator. No unit test is written for it (it depends on TanStack Query and fetch — test the sections and hooks independently). Verify manually after Task 13.

- [ ] **Step 1: Create `frontend/src/screens/StoryBiblePage.tsx`**

```tsx
// frontend/src/screens/StoryBiblePage.tsx
import { useEffect, useRef, useState } from 'react';
import { EMPTY_BIBLE, EMPTY_OUTLINE } from '../api/bible-types';
import type { BibleData, OutlineData } from '../api/bible-types';
import { CharactersSection } from '../components/bible/CharactersSection';
import { OutlinesSection } from '../components/bible/OutlinesSection';
import { StylesSection } from '../components/bible/StylesSection';
import { TimelineSection } from '../components/bible/TimelineSection';
import { WorldSection } from '../components/bible/WorldSection';
import { useBible, useOutline, useSaveBible, useSaveOutline } from '../hooks/queries';
import type { View } from '../components/NavBar';

type BibleView = Exclude<View, 'write'>;

function SaveIndicator({
  isPending,
  isError,
  isSuccess,
}: {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}) {
  if (isPending) return <span className="text-xs text-gray-400">Saving…</span>;
  if (isError) return <span className="text-xs text-red-600">Error saving.</span>;
  if (isSuccess) return <span className="text-xs text-green-600">Saved.</span>;
  return null;
}

export function StoryBiblePage({
  projectId,
  activeSection,
}: {
  projectId: string;
  activeSection: BibleView;
}) {
  const bibleQuery = useBible(projectId);
  const outlineQuery = useOutline(projectId);
  const saveBible = useSaveBible(projectId);
  const saveOutline = useSaveOutline(projectId);

  const [bibleData, setBibleData] = useState<BibleData>(EMPTY_BIBLE);
  const [outlineData, setOutlineData] = useState<OutlineData>(EMPTY_OUTLINE);
  const bibleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (bibleQuery.data) setBibleData(bibleQuery.data);
  }, [bibleQuery.data]);

  useEffect(() => {
    if (outlineQuery.data) setOutlineData(outlineQuery.data);
  }, [outlineQuery.data]);

  useEffect(() => {
    document.getElementById(activeSection)?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSection]);

  const updateBible = (data: BibleData) => {
    setBibleData(data);
    if (bibleTimerRef.current) clearTimeout(bibleTimerRef.current);
    bibleTimerRef.current = setTimeout(() => saveBible.mutate(data), 800);
  };

  const updateOutline = (data: OutlineData) => {
    setOutlineData(data);
    if (outlineTimerRef.current) clearTimeout(outlineTimerRef.current);
    outlineTimerRef.current = setTimeout(() => saveOutline.mutate(data), 800);
  };

  if (bibleQuery.isLoading || outlineQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-2">
        <h2 className="text-sm font-medium text-gray-600">Story Bible</h2>
        <div className="flex items-center gap-4">
          <SaveIndicator
            isPending={saveBible.isPending}
            isError={saveBible.isError}
            isSuccess={saveBible.isSuccess}
          />
          <SaveIndicator
            isPending={saveOutline.isPending}
            isError={saveOutline.isError}
            isSuccess={saveOutline.isSuccess}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <CharactersSection
          characters={bibleData.characters}
          onChange={(characters) => updateBible({ ...bibleData, characters })}
        />
        <WorldSection
          world={bibleData.world}
          onChange={(world) => updateBible({ ...bibleData, world })}
        />
        <StylesSection
          style_guide={bibleData.style_guide}
          onChange={(style_guide) => updateBible({ ...bibleData, style_guide })}
        />
        <TimelineSection
          timeline={bibleData.timeline}
          onChange={(timeline) => updateBible({ ...bibleData, timeline })}
        />
        <OutlinesSection
          chapters={outlineData.chapters}
          onChange={(chapters) => updateOutline({ chapters })}
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/StoryBiblePage.tsx
git commit -m "feat: add StoryBiblePage with auto-save"
```

---

## Task 13: Frontend — wire WorkspaceScreen, delete BiblePanel

**Files:**
- Modify: `frontend/src/screens/WorkspaceScreen.tsx`
- Delete: `frontend/src/components/BiblePanel.tsx`

- [ ] **Step 1: Update `frontend/src/screens/WorkspaceScreen.tsx`**

```tsx
// frontend/src/screens/WorkspaceScreen.tsx — full replacement
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { getProject } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { ChapterPanel } from '../components/ChapterPanel';
import { NavBar, type View } from '../components/NavBar';
import { Button } from '../components/ui/button';
import { StoryBiblePage } from './StoryBiblePage';

export function WorkspaceScreen() {
  const { projectId } = useParams<{ projectId: string }>();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('write');

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });

  if (!projectId) return <Navigate to="/" replace />;
  if (project.isError) return <Navigate to="/" replace />;

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f0]">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
            ← Projects
          </Button>
          <h1 className="text-base font-semibold text-gray-800">
            {project.data?.name ?? '…'}
          </h1>
        </div>
        <Button variant="secondary" size="sm" onClick={logout}>
          Log out
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <NavBar view={view} onViewChange={setView} />
        {view === 'write' ? (
          <ChapterPanel projectId={projectId} />
        ) : (
          <StoryBiblePage projectId={projectId} activeSection={view} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete BiblePanel**

```bash
rm frontend/src/components/BiblePanel.tsx
```

- [ ] **Step 3: Run all frontend tests**

```bash
cd frontend && npm test
```

Expected: all tests pass. Fix any import errors (there should be none — nothing else imports `BiblePanel`).

- [ ] **Step 4: Type-check**

```bash
cd frontend && npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Run all backend tests**

```bash
uv run pytest -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/WorkspaceScreen.tsx
git rm frontend/src/components/BiblePanel.tsx
git commit -m "feat: replace BiblePanel with NavBar + StoryBiblePage in WorkspaceScreen"
```

---

## Self-Review Checklist

- **Navigation:** NavBar exports `View` type ✓ — WorkspaceScreen imports it ✓ — StoryBiblePage receives `Exclude<View, 'write'>` ✓
- **Auto-save:** debounce timers in StoryBiblePage ✓ — separate for bible vs outline ✓ — `SaveIndicator` in header ✓
- **Section IDs:** `id="characters"`, `id="world"`, `id="styles"`, `id="timeline"`, `id="outlines"` match `View` values used in `scrollIntoView` ✓
- **Backend fallback:** `load_bible` falls back to `EMPTY_BIBLE` on JSON parse failure ✓
- **Agent compatibility:** `load_bible` still returns a dict — `_base_state` unchanged ✓
- **`load_bible_text` / `load_outline_text`:** removed from `db_storage.py` and from `main.py` imports ✓
- **`sample_bible` fixture:** timeline updated from `list[dict]` to `list[str]` ✓
