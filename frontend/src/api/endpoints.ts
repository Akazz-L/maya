// Thin, typed wrappers around the backend REST routes. Every data route is
// scoped to a project and requires auth; the streaming routes (draft/revise/rewrite)
// live in stream.ts and are driven by useDraftStream.

import { request } from './client';
import type {
  DocumentDetail,
  DocumentKind,
  DocumentSummary,
  Issue,
  Me,
  ModelKey,
  ProjectDetail,
  ProjectSummary,
  ScenePlan,
  UsageSnapshot,
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

// ── account: model choice and AI budget ──────────────────────────────────────
export const getMe = () => request<Me>('/me');

/** Takes effect on the next generation; anything already streaming keeps the
 *  model it started on. */
export const setModel = (modelKey: ModelKey) =>
  request<Me>('/me', { method: 'PATCH', body: { model_key: modelKey } });

// ── projects ─────────────────────────────────────────────────────────────────
export const listProjects = () => request<ProjectSummary[]>('/projects');

/** Creating a project also seeds its Story Bible document, server-side. */
export const createProject = (name: string) =>
  request<{ project_id: string; name: string }>('/projects', {
    method: 'POST',
    body: { name },
  });

export const getProject = (projectId: string) =>
  request<ProjectDetail>(`/projects/${projectId}`);

// ── documents ────────────────────────────────────────────────────────────────
export const listDocuments = (projectId: string) =>
  request<DocumentSummary[]>(`/projects/${projectId}/documents`);

export const getDocument = (projectId: string, documentId: string) =>
  request<DocumentDetail>(`/projects/${projectId}/documents/${documentId}`);

export const createDocument = (
  projectId: string,
  title?: string,
  kind: DocumentKind = 'chapter',
) =>
  request<DocumentDetail>(`/projects/${projectId}/documents`, {
    method: 'POST',
    body: { title, kind },
  });

export type DocumentPatch = Partial<
  Pick<DocumentDetail, 'title' | 'body' | 'brief' | 'plan' | 'issues' | 'kind'>
>;

export const updateDocument = (
  projectId: string,
  documentId: string,
  patch: DocumentPatch,
) =>
  request<DocumentDetail>(`/projects/${projectId}/documents/${documentId}`, {
    method: 'PATCH',
    body: patch,
  });

export const deleteDocument = (projectId: string, documentId: string) =>
  request<null>(`/projects/${projectId}/documents/${documentId}`, { method: 'DELETE' });

export const reorderDocuments = (projectId: string, documentIds: string[]) =>
  request<null>(`/projects/${projectId}/documents/order`, {
    method: 'PUT',
    body: { document_ids: documentIds },
  });

// ── generation (per document) ────────────────────────────────────────────────
export const generatePlan = (projectId: string, documentId: string) =>
  request<{ plan: ScenePlan; usage: UsageSnapshot }>(
    `/projects/${projectId}/documents/${documentId}/plan`,
    {
      method: 'POST',
    },
  );

export const checkDocument = (projectId: string, documentId: string) =>
  request<{ issues: Issue[]; usage: UsageSnapshot }>(
    `/projects/${projectId}/documents/${documentId}/check`,
    { method: 'POST' },
  );

/** SSE stream URLs (driven by useDraftStream / stream.ts). */
export const draftStreamUrl = (projectId: string, documentId: string) =>
  `/projects/${projectId}/documents/${documentId}/draft/stream`;
export const reviseStreamUrl = (projectId: string, documentId: string) =>
  `/projects/${projectId}/documents/${documentId}/revise/stream`;
export const rewriteStreamUrl = (projectId: string, documentId: string) =>
  `/projects/${projectId}/documents/${documentId}/rewrite/stream`;
