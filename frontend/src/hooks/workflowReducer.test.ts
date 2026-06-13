import { describe, expect, it } from 'vitest';
import {
  initialState,
  planHasContent,
  workflowReducer,
  type WorkflowState,
} from './workflowReducer';
import type { DraftState, SavedChapter, ScenePlan } from '../api/types';
import { EMPTY_PLAN } from '../api/types';

const samplePlan: ScenePlan = {
  goal: 'Escape the tower',
  pov_character: 'Maya',
  location: 'Tower',
  sensory_anchor: 'cold stone',
  opening_image: 'a locked door',
  closing_image: 'open sky',
  beats: ['wake', 'plan', 'climb'],
};

describe('workflowReducer', () => {
  it('reset returns the initial empty state', () => {
    const dirty: WorkflowState = {
      step: 'check',
      plan: samplePlan,
      draft: 'x',
      issues: [],
      overwrite: true,
    };
    expect(workflowReducer(dirty, { type: 'reset' })).toEqual(initialState);
  });

  it('resume restores step, plan, draft and issues from draft_state', () => {
    const draftState: DraftState = {
      step: 'draft',
      scene_plan: samplePlan,
      draft: 'Once upon a time',
      issues: [{ issue: 'tense', severity: 'minor', location: 'p1', suggested_fix: 'fix' }],
    };
    const next = workflowReducer(initialState, { type: 'resume', draftState, overwrite: true });
    expect(next.step).toBe('draft');
    expect(next.plan).toEqual(samplePlan);
    expect(next.draft).toBe('Once upon a time');
    expect(next.issues).toHaveLength(1);
    expect(next.overwrite).toBe(true);
  });

  it('showSaved enters the locked saved view with overwrite set', () => {
    const chapter: SavedChapter = { plan: samplePlan, draft: 'final prose', issues: [] };
    const next = workflowReducer(initialState, { type: 'showSaved', chapter });
    expect(next.step).toBe('saved');
    expect(next.draft).toBe('final prose');
    expect(next.overwrite).toBe(true);
  });

  it('planGenerated moves to the plan step with the new plan', () => {
    const next = workflowReducer(initialState, { type: 'planGenerated', plan: samplePlan });
    expect(next.step).toBe('plan');
    expect(next.plan).toEqual(samplePlan);
  });

  it('draftStarted clears the draft and enters the draft step', () => {
    const start: WorkflowState = { ...initialState, step: 'plan', draft: 'stale' };
    const next = workflowReducer(start, { type: 'draftStarted' });
    expect(next.step).toBe('draft');
    expect(next.draft).toBe('');
  });

  it('appendDraft accumulates streamed text', () => {
    let s: WorkflowState = { ...initialState, step: 'draft', draft: '' };
    s = workflowReducer(s, { type: 'appendDraft', text: 'Hello ' });
    s = workflowReducer(s, { type: 'appendDraft', text: 'world' });
    expect(s.draft).toBe('Hello world');
  });

  it('issuesChecked moves to the check step and stores issues', () => {
    const issues = [{ issue: 'x', severity: 'critical' as const, location: 'l', suggested_fix: 'f' }];
    const next = workflowReducer(initialState, { type: 'issuesChecked', issues });
    expect(next.step).toBe('check');
    expect(next.issues).toEqual(issues);
  });

  it('redo returns to plan and forces overwrite', () => {
    const saved: WorkflowState = { ...initialState, step: 'saved', plan: samplePlan, overwrite: true };
    const next = workflowReducer(saved, { type: 'redo' });
    expect(next.step).toBe('plan');
    expect(next.overwrite).toBe(true);
    expect(next.plan).toEqual(samplePlan);
  });

  it('setPlan / setDraft / setIssues update content without changing step', () => {
    const base: WorkflowState = { ...initialState, step: 'plan' };
    expect(workflowReducer(base, { type: 'setPlan', plan: samplePlan }).plan).toEqual(samplePlan);
    expect(workflowReducer(base, { type: 'setDraft', draft: 'd' }).draft).toBe('d');
    expect(workflowReducer(base, { type: 'setPlan', plan: samplePlan }).step).toBe('plan');
  });
});

describe('planHasContent', () => {
  it('is false for an empty plan', () => {
    expect(planHasContent(EMPTY_PLAN)).toBe(false);
  });
  it('is true when any field or beat is set', () => {
    expect(planHasContent({ ...EMPTY_PLAN, goal: 'x' })).toBe(true);
    expect(planHasContent({ ...EMPTY_PLAN, beats: ['a'] })).toBe(true);
  });
});
