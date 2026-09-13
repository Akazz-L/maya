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
  /** Chapter only — the writer's optional chapter notes, read by the planner and the chat. Empty on bible and note documents. */
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

// ── model choice and AI budget ───────────────────────────────────────────────

export type ModelKey = 'haiku' | 'sonnet' | 'opus';

/** One entry in the picker. Served by the backend so labels and relative cost
 *  are defined in exactly one place. */
export interface ModelOption {
  key: ModelKey;
  label: string;
  hint: string;
}

/** Spend against this month's AI budget, from GET /me and every AI response. */
export interface UsageSnapshot {
  spent_usd: number;
  budget_usd: number;
  percent: number;
  /** True once the budget is reached: the server refuses further generation. */
  blocked: boolean;
  /** ISO timestamp of the reset — the first instant of next month, UTC. */
  period_end: string;
}

/** The signed-in writer, from GET /me. */
export interface Me {
  email: string;
  model_key: ModelKey;
  models: ModelOption[];
  usage: UsageSnapshot;
}

// ── chapter chat ─────────────────────────────────────────────────────────────

/** What the writer did with a proposal. `stale`: the chapter no longer matched it. */
export type ProposalOutcome = 'accepted' | 'discarded' | 'stale';

export interface ChatEdit {
  find: string;
  replace: string;
}

interface ProposalBase {
  /** sha256 of the chapter body the proposal was computed against. */
  base_hash: string;
  /** The whole body after applying it; null once resolved. */
  proposed_body: string | null;
  outcome: ProposalOutcome | null;
}

export type ChatProposal =
  | (ProposalBase & { kind: 'write'; mode: 'replace' | 'append'; text: string })
  | (ProposalBase & { kind: 'edit'; edits: ChatEdit[] });

/** One message in a chapter's chat, from GET …/chat. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Assistant only: a change to the chapter, reviewed in the editor. */
  proposal: ChatProposal | null;
  created_at: string | null;
}
