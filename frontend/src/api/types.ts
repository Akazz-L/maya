// TypeScript mirror of the backend response shapes. The backend types
// plan and proposals loosely as `dict` / `list`, but the UI works with these
// concrete shapes.

/** How serious a reviewer thinks a problem is. Null on an ordinary chat fix. */
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
  model_key: ModelKey;
  models: ModelOption[];
  usage: UsageSnapshot;
}

// ── chapter chat ─────────────────────────────────────────────────────────────

/** What the writer did with a proposal. `stale`: the chapter no longer matched it. */
export type ProposalOutcome = 'accepted' | 'discarded' | 'stale';

/**
 * One localized fix inside a suggestion set. `from`/`to` are offsets into the
 * body named by the proposal's `base_hash`; the editor re-measures them as the
 * writer accepts earlier fixes. Each fix carries its own outcome, so taking one
 * leaves the rest awaiting review.
 */
export interface Suggestion {
  find: string;
  replace: string;
  /** One line on what is wrong, shown on the card beside the fix. */
  explanation: string;
  severity: Severity | null;
  from: number;
  to: number;
  outcome: ProposalOutcome | null;
}

interface ProposalBase {
  /** sha256 of the chapter body the proposal was computed against. */
  base_hash: string;
}

export type ChatProposal =
  | (ProposalBase & {
      kind: 'write';
      mode: 'replace' | 'append';
      text: string;
      /** The whole body after applying it; null once resolved. */
      proposed_body: string | null;
      outcome: ProposalOutcome | null;
    })
  | (ProposalBase & { kind: 'suggestions'; suggestions: Suggestion[] });

/** One message in a chapter's chat, from GET …/chat. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** The specialist this turn was addressed to, or null for a typed message. */
  agent: string | null;
  /** Assistant only: a change to the chapter, reviewed in the editor. */
  proposal: ChatProposal | null;
  created_at: string | null;
}

/** One entry in the chat's "+" picker, from GET /agents. */
export interface AgentOption {
  key: string;
  label: string;
  hint: string;
}
