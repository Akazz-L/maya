// Thin, typed wrappers around the backend REST routes. Every data route is
// scoped to a project and requires auth; the streaming routes (rewrite, chat)
// are read by stream.ts.

import { request } from './client';
import type {
  AgentOption,
  ChatMessage,
  DocumentDetail,
  DocumentKind,
  DocumentSummary,
  Me,
  ModelKey,
  PlanOption,
  ProjectDetail,
  ProjectSummary,
  ProposalOutcome,
  ScenePlan,
  UsageSnapshot,
} from './types';

// ── account: model choice and AI budget ──────────────────────────────────────
export const getMe = () => request<Me>('/me');

// ── plans and billing ────────────────────────────────────────────────────────
export const listPlans = () => request<PlanOption[]>('/billing/plans');

/** A Stripe Checkout URL subscribing the writer to a paid plan. */
export const startCheckout = (plan: string) =>
  request<{ url: string }>('/billing/checkout', { method: 'POST', body: { plan } });

/** A Stripe billing portal URL: change plan, update the card, cancel. */
export const openBillingPortal = () =>
  request<{ url: string }>('/billing/portal', { method: 'POST' });

/** Refresh the writer's plan from Stripe, for the return from checkout. */
export const syncBilling = () => request<null>('/billing/sync', { method: 'POST' });

/** The specialist review passes the chat's "+" picker offers. */
export const listAgents = () => request<AgentOption[]>('/agents');

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

export const getProject = (projectId: string) => request<ProjectDetail>(`/projects/${projectId}`);

// ── documents ────────────────────────────────────────────────────────────────
export const listDocuments = (projectId: string) =>
  request<DocumentSummary[]>(`/projects/${projectId}/documents`);

export const getDocument = (projectId: string, documentId: string) =>
  request<DocumentDetail>(`/projects/${projectId}/documents/${documentId}`);

export const createDocument = (projectId: string, title?: string, kind: DocumentKind = 'chapter') =>
  request<DocumentDetail>(`/projects/${projectId}/documents`, {
    method: 'POST',
    body: { title, kind },
  });

export type DocumentPatch = Partial<
  Pick<DocumentDetail, 'title' | 'body' | 'brief' | 'plan' | 'kind'>
>;

export const updateDocument = (projectId: string, documentId: string, patch: DocumentPatch) =>
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

/** SSE stream URLs, read by stream.ts. */
export const rewriteStreamUrl = (projectId: string, documentId: string) =>
  `/projects/${projectId}/documents/${documentId}/rewrite/stream`;

// ── chapter chat ─────────────────────────────────────────────────────────────
export const getChat = (projectId: string, documentId: string) =>
  request<{ messages: ChatMessage[] }>(`/projects/${projectId}/documents/${documentId}/chat`);

export const clearChat = (projectId: string, documentId: string) =>
  request<null>(`/projects/${projectId}/documents/${documentId}/chat`, { method: 'DELETE' });

/**
 * Record what the writer did with a proposal; the next message tells the model.
 * `indexes` names the fixes in a suggestion set; omitting it resolves every fix
 * still unreviewed, which is what Accept all and Discard all send.
 */
export const resolveProposal = (
  projectId: string,
  documentId: string,
  messageId: string,
  outcome: ProposalOutcome,
  indexes?: number[],
) =>
  request<ChatMessage>(
    `/projects/${projectId}/documents/${documentId}/chat/messages/${messageId}/outcome`,
    { method: 'POST', body: indexes ? { outcome, indexes } : { outcome } },
  );

export const chatStreamUrl = (projectId: string, documentId: string) =>
  `/projects/${projectId}/documents/${documentId}/chat/stream`;
