// Thin, typed wrappers around the backend REST routes. Streaming routes
// (draft/revise) live in stream.ts and are driven by useDraftStream.

import { request } from './client';
import type { DraftState, Issue, SavedChapter, ScenePlan } from './types';

// ── bible / outline (raw YAML text) ─────────────────────────────────────────
export const getBible = () => request<{ content: string }>('/bible');
export const saveBible = (content: string) =>
  request<{ status: string }>('/bible', { method: 'PUT', body: { content } });

export const getOutline = () => request<{ content: string }>('/outline');
export const saveOutline = (content: string) =>
  request<{ status: string }>('/outline', { method: 'PUT', body: { content } });

// ── chapter / workflow ──────────────────────────────────────────────────────
export const getChapter = (n: number) => request<SavedChapter>(`/chapter/${n}`);

/** Returns null when there is no in-progress workflow for the chapter. */
export const getDraftState = (n: number) => request<DraftState | null>(`/chapter/${n}/state`);

export const generatePlan = (n: number) =>
  request<{ scene_plan: ScenePlan }>(`/chapter/${n}/plan`, { method: 'POST' });

export const checkDraft = (n: number, draft: string) =>
  request<{ issues: Issue[] }>(`/chapter/${n}/check`, { method: 'POST', body: { draft } });

export const acceptChapter = (
  n: number,
  payload: { scene_plan: ScenePlan; draft: string; issues: Issue[] },
  overwrite: boolean,
) =>
  request<{ status: string }>(`/chapter/${n}/accept?overwrite=${overwrite}`, {
    method: 'PUT',
    body: payload,
  });
