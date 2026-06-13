// Pure state machine for the Plan -> Draft -> Check workflow. Kept free of
// React / network so it can be unit-tested in isolation. The orchestration
// (queries, mutations, streaming) lives in ChapterPanel.

import type { DraftState, Issue, SavedChapter, ScenePlan } from '../api/types';
import { EMPTY_PLAN } from '../api/types';

/** 'saved' is the locked read-only view; 'empty' is the initial blank state. */
export type ViewStep = 'empty' | 'plan' | 'draft' | 'check' | 'saved';

export interface WorkflowState {
  step: ViewStep;
  plan: ScenePlan;
  draft: string;
  issues: Issue[];
  /** True when accepting will replace an already-saved chapter on disk. */
  overwrite: boolean;
}

export const initialState: WorkflowState = {
  step: 'empty',
  plan: EMPTY_PLAN,
  draft: '',
  issues: [],
  overwrite: false,
};

export type WorkflowAction =
  | { type: 'reset' }
  // An in-progress draft_state resumes the workflow at its saved step.
  | { type: 'resume'; draftState: DraftState; overwrite: boolean }
  // A saved chapter exists and there is no in-progress workflow: show it locked.
  | { type: 'showSaved'; chapter: SavedChapter }
  // Planner returned a fresh scene plan.
  | { type: 'planGenerated'; plan: ScenePlan }
  // Live edits from the controlled form components.
  | { type: 'setPlan'; plan: ScenePlan }
  | { type: 'setDraft'; draft: string }
  | { type: 'setIssues'; issues: Issue[] }
  // Transitions.
  | { type: 'toPlan' }
  | { type: 'draftStarted' } // entering the draft step, clear text for streaming
  | { type: 'appendDraft'; text: string }
  | { type: 'issuesChecked'; issues: Issue[] }
  | { type: 'redo' };

export function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case 'reset':
      return initialState;

    case 'resume':
      return {
        step: action.draftState.step,
        plan: action.draftState.scene_plan ?? EMPTY_PLAN,
        draft: action.draftState.draft ?? '',
        issues: action.draftState.issues ?? [],
        overwrite: action.overwrite,
      };

    case 'showSaved':
      return {
        step: 'saved',
        plan: action.chapter.plan ?? EMPTY_PLAN,
        draft: action.chapter.draft ?? '',
        issues: action.chapter.issues ?? [],
        overwrite: true, // a saved chapter exists on disk
      };

    case 'planGenerated':
      return { ...state, step: 'plan', plan: action.plan };

    case 'setPlan':
      return { ...state, plan: action.plan };

    case 'setDraft':
      return { ...state, draft: action.draft };

    case 'setIssues':
      return { ...state, issues: action.issues };

    case 'toPlan':
      return { ...state, step: 'plan' };

    case 'draftStarted':
      return { ...state, step: 'draft', draft: '' };

    case 'appendDraft':
      return { ...state, draft: state.draft + action.text };

    case 'issuesChecked':
      return { ...state, step: 'check', issues: action.issues };

    case 'redo':
      // Editing a saved chapter; re-accepting will replace it.
      return { ...state, step: 'plan', overwrite: true };

    default:
      return state;
  }
}

/** Whether the plan has any content worth drafting from. */
export function planHasContent(plan: ScenePlan): boolean {
  return Boolean(
    plan.goal ||
      plan.pov_character ||
      plan.location ||
      plan.sensory_anchor ||
      plan.opening_image ||
      plan.closing_image ||
      plan.beats.length,
  );
}
