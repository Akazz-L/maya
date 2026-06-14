# Story Bible Refactor — Design Spec
**Date:** 2026-06-14

## Overview

Replace the current `BiblePanel` sidebar (two raw YAML textareas) with a structured, icon-driven story bible view. The chapter writing workspace becomes the primary project view; story bible sections are reached via a persistent vertical icon bar.

---

## 1. Navigation & Layout

`WorkspaceScreen` gains a permanent `NavBar` (44px wide, dark background) on the left edge. A single `view` state determines what renders to its right.

| `view` value | Renders |
|---|---|
| `'write'` | `ChapterPanel` (unchanged) |
| `'characters'` | `StoryBiblePage` scrolled to Characters |
| `'world'` | `StoryBiblePage` scrolled to World |
| `'styles'` | `StoryBiblePage` scrolled to Styles |
| `'timeline'` | `StoryBiblePage` scrolled to Timeline |
| `'outlines'` | `StoryBiblePage` scrolled to Outlines |

`view` defaults to `'write'` on mount.

### NavBar icons

| Icon | Tooltip label | `view` key |
|---|---|---|
| ✏️ | Write | `write` |
| 👤 | Characters | `characters` |
| 🌍 | World | `world` |
| 🎨 | Styles | `styles` |
| 📅 | Timeline | `timeline` |
| 📋 | Outlines | `outlines` |

Active icon: blue (`#4f8ef7`) background. Inactive: dark (`#2a2a4a`). Labels appear on hover via CSS tooltip (`title` attribute + CSS). `BiblePanel` is deleted.

---

## 2. StoryBiblePage

A single scrollable page (`overflow-y: auto`) with 5 stacked section components, each with a stable DOM `id` for anchor scrolling.

When `view` changes to a bible section, `StoryBiblePage` calls `document.getElementById(sectionId).scrollIntoView({ behavior: 'smooth' })` via a `useEffect`.

### Section components

**`CharactersSection`** (`id="characters"`)
- List of character cards. Each card:
  - `Name` — text input
  - `Traits` — list of text inputs + "Add trait" button; each item has a × delete
  - `Dialogue examples` — list of text inputs + "Add example" button; each item has a × delete
  - Card-level delete button
- "Add character" button below the list

**`WorldSection`** (`id="world"`)
- `Locations` — list of text inputs + "Add location"
- `Rules` — list of text inputs + "Add rule"

**`StylesSection`** (`id="styles"`)
- `Voice` — textarea (single field)
- `Avoid` — list of text inputs + "Add"

**`TimelineSection`** (`id="timeline"`)
- Flat list of event text inputs + "Add event"; each item has a × delete

**`OutlinesSection`** (`id="outlines"`)
- List of chapter beat text inputs, auto-labelled "Chapter 1", "Chapter 2", etc.
- "Add chapter" button; each item has a × delete

---

## 3. Data Model

### TypeScript types (new file `src/api/bible-types.ts`)

```ts
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

### DB storage

`bible_content` and `outline_content` columns on the `Project` table remain `Text`, but now store **JSON** instead of YAML. No schema migration required.

---

## 4. API Changes

### `GET /projects/{id}/bible`

**Before:** `{ content: "<yaml string>" }`
**After:** returns the full `BibleData` JSON object directly

```python
# backend: json.loads(project.bible_content) — with fallback to EMPTY_BIBLE on error
```

### `PUT /projects/{id}/bible`

**Before:** `{ content: "<yaml string>" }`
**After:** accepts a `BibleData` JSON body; stores `json.dumps(body)` in `bible_content`

### `GET /projects/{id}/outline`

**Before:** `{ content: "<yaml string>" }`
**After:** returns `OutlineData` JSON object directly (`{ chapters: [...] }`)

### `PUT /projects/{id}/outline`

**Before:** `{ content: "<yaml string>" }`
**After:** accepts `OutlineData` JSON body; stores `json.dumps(body)` in `outline_content`

### Backward compatibility

On `GET /bible`, if `json.loads()` fails (old YAML data in the column), return `EMPTY_BIBLE` rather than crashing. Existing YAML data is lost on first save — acceptable for a dev-stage project with example data only.

### Agent compatibility

`load_bible` in `db_storage.py` already returns a parsed dict (`yaml.safe_load → dict`). Changing it to `json.loads` keeps the same return type, so `_base_state` and all AI agents are unaffected.

`load_bible_text` and `load_outline_text` (raw string getters) are removed — the API endpoints now call `load_bible` / `load_outline` directly.

---

## 5. Frontend Data Flow

### Loading

`StoryBiblePage` calls `useBible(projectId)` and `useOutline(projectId)` (updated hooks that return typed objects). On success, initialise local `bibleData` and `outlineData` state.

### Auto-save

`StoryBiblePage` holds:
- `bibleData: BibleData` state
- `outlineData: OutlineData` state
- Two `useRef` debounce timers (one per resource)

On any change to `bibleData`: clear bible timer → set new 800ms timer → on fire, call `saveBible.mutate(bibleData)`.
On any change to `outlineData`: same pattern with `saveOutline.mutate(outlineData)`.

Each section header shows a `SaveState` indicator (existing component) driven by the respective mutation's `isPending` / `isSuccess` / `isError` state.

### Updated query hooks (`queries.ts`)

```ts
useBible(projectId)    // returns BibleData
useOutline(projectId)  // returns OutlineData
useSaveBible(projectId)   // mutationFn: (data: BibleData) => saveBible(projectId, data)
useSaveOutline(projectId) // mutationFn: (data: OutlineData) => saveOutline(projectId, data)
```

---

## 6. Files Changed

| File | Change |
|---|---|
| `src/screens/WorkspaceScreen.tsx` | Add `NavBar`, `view` state; remove `BiblePanel` |
| `src/components/BiblePanel.tsx` | **Deleted** |
| `src/components/NavBar.tsx` | **New** — icon bar |
| `src/screens/StoryBiblePage.tsx` | **New** — scrollable bible page |
| `src/components/bible/CharactersSection.tsx` | **New** |
| `src/components/bible/WorldSection.tsx` | **New** |
| `src/components/bible/StylesSection.tsx` | **New** |
| `src/components/bible/TimelineSection.tsx` | **New** |
| `src/components/bible/OutlinesSection.tsx` | **New** |
| `src/api/bible-types.ts` | **New** — TypeScript types + empty defaults |
| `src/api/endpoints.ts` | Update `getBible`, `saveBible`, `getOutline`, `saveOutline` signatures |
| `src/hooks/queries.ts` | Update hooks to use new typed API |
| `backend/main.py` | Update bible/outline GET+PUT endpoints |
| `backend/db_storage.py` | Update `load_bible`, `save_bible`, `load_outline`, `save_outline` to use JSON |
| `backend/models.py` | Add `BibleDataModel`, `OutlineDataModel` Pydantic request models |

---

## 7. Out of Scope

- No changes to `ChapterPanel`, agents, or auth
- No new DB tables or columns
- The `_base_state` function in `main.py` that feeds the bible into agents still works — it calls `load_bible()` which now returns a dict (JSON-parsed), which is what it already expected
