// TypeScript mirror of the backend Pydantic models (backend/models.py).
// The backend types scene_plan / issues loosely as `dict`, but the UI works
// with these concrete shapes.

export type Severity = 'critical' | 'minor' | 'style';

export const SEVERITIES: Severity[] = ['critical', 'minor', 'style'];

export interface ScenePlan {
  goal: string;
  pov_character: string;
  location: string;
  sensory_anchor: string;
  opening_image: string;
  closing_image: string;
  beats: string[];
}

export interface Issue {
  issue: string;
  severity: Severity;
  location: string;
  suggested_fix: string;
}

/** The three workflow steps the backend persists in draft_state.json. */
export type Step = 'plan' | 'draft' | 'check';

/** Resumable in-progress workflow, from GET /chapter/{n}/state. */
export interface DraftState {
  step: Step;
  scene_plan: ScenePlan;
  draft: string;
  issues: Issue[];
}

/** A saved chapter, from GET /projects/{id}/chapters/{n}. */
export interface SavedChapter {
  plan: ScenePlan;
  draft: string;
  issues: Issue[];
}

/** A project in the list, from GET /projects. */
export interface ProjectSummary {
  project_id: string;
  name: string;
  created_at: string;
}

/** A single project with its bible/outline, from GET /projects/{id}. */
export interface ProjectDetail {
  project_id: string;
  name: string;
  bible_content: string;
  outline_content: string;
}

export const EMPTY_PLAN: ScenePlan = {
  goal: '',
  pov_character: '',
  location: '',
  sensory_anchor: '',
  opening_image: '',
  closing_image: '',
  beats: [],
};
