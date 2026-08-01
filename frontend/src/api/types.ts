// TypeScript mirror of the backend response shapes. The backend types
// plan / issues loosely as `dict` / `list`, but the UI works with these
// concrete shapes.

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

export type DocumentKind = 'bible' | 'chapter' | 'note';

/** A row in the sidebar, from GET /projects/{id}/documents. Bodies are omitted. */
export interface DocumentSummary {
  id: string;
  title: string;
  kind: DocumentKind;
  position: number;
  updated_at: string;
}

/** A single open document, from GET /projects/{id}/documents/{did}. */
export interface DocumentDetail extends DocumentSummary {
  body: string;
  /** Chapter only — the planner's outline beat. Empty on bible and note documents. */
  brief: string;
  plan: ScenePlan | null;
  issues: Issue[] | null;
}

/** A project in the list, from GET /projects. */
export interface ProjectSummary {
  project_id: string;
  name: string;
  created_at: string;
}

/** A single project, from GET /projects/{id}. */
export interface ProjectDetail {
  project_id: string;
  name: string;
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
