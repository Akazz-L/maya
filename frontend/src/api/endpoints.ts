// Thin, typed wrappers around the backend REST routes. Every data route is
// scoped to a project and requires auth; the streaming routes (draft/revise)
// live in stream.ts and are driven by useDraftStream.

import { request } from './client';
import type { BibleData, OutlineData } from './bible-types';
import type {
  DraftState,
  Issue,
  ProjectDetail,
  ProjectSummary,
  SavedChapter,
  ScenePlan,
} from './types';

// ── auth (unauthenticated) ───────────────────────────────────────────────────
export const login = (email: string, password: string) =>
  request<{ access_token: string; token_type: string }>('/auth/token', {
    method: 'POST',
    body: { email, password },
    authed: false,
  });

export const register = (email: string, password: string) =>
  request<{ user_id: string }>('/auth/register', {
    method: 'POST',
    body: { email, password },
    authed: false,
  });

// ── projects ─────────────────────────────────────────────────────────────────
export const listProjects = () => request<ProjectSummary[]>('/projects');

export const createProject = (name: string, bible_content = '', outline_content = '') =>
  request<{ project_id: string; name: string }>('/projects', {
    method: 'POST',
    body: { name, bible_content, outline_content },
  });

export const getProject = (projectId: string) =>
  request<ProjectDetail>(`/projects/${projectId}`);

// ── bible / outline (typed JSON, per project) ────────────────────────────────
export const getBible = (projectId: string) =>
  request<BibleData>(`/projects/${projectId}/bible`);

export const saveBible = (projectId: string, data: BibleData) =>
  request<{ status: string }>(`/projects/${projectId}/bible`, { method: 'PUT', body: data });

export const getOutline = (projectId: string) =>
  request<OutlineData>(`/projects/${projectId}/outline`);

export const saveOutline = (projectId: string, data: OutlineData) =>
  request<{ status: string }>(`/projects/${projectId}/outline`, { method: 'PUT', body: data });

// ── chapter / workflow (per project) ─────────────────────────────────────────
export const getChapter = (projectId: string, n: number) =>
  request<SavedChapter>(`/projects/${projectId}/chapters/${n}`);

/** Returns null when there is no in-progress workflow for the chapter. */
export const getDraftState = (projectId: string, n: number) =>
  request<DraftState | null>(`/projects/${projectId}/chapters/${n}/state`);

export const generatePlan = (projectId: string, n: number) =>
  request<{ scene_plan: ScenePlan }>(`/projects/${projectId}/chapters/${n}/plan`, {
    method: 'POST',
  });

export const checkDraft = (projectId: string, n: number, draft: string) =>
  request<{ issues: Issue[] }>(`/projects/${projectId}/chapters/${n}/check`, {
    method: 'POST',
    body: { draft },
  });

export const acceptChapter = (
  projectId: string,
  n: number,
  payload: { scene_plan: ScenePlan; draft: string; issues: Issue[] },
  overwrite: boolean,
) =>
  request<{ status: string }>(
    `/projects/${projectId}/chapters/${n}/accept?overwrite=${overwrite}`,
    { method: 'PUT', body: payload },
  );

/** SSE stream URLs (driven by useDraftStream / stream.ts). */
export const draftStreamUrl = (projectId: string, n: number) =>
  `/projects/${projectId}/chapters/${n}/draft/stream`;
export const reviseStreamUrl = (projectId: string, n: number) =>
  `/projects/${projectId}/chapters/${n}/revise/stream`;
