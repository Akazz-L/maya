// Typed fetch wrapper. Mirrors the semantics of the old index.html `post()`
// helper: JSON in/out, and throws Error(detail) on a non-OK response.
// Adds the session's Bearer token and signs out on a 401.

import { authHeaders, handleUnauthorized } from '../auth/session';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = opts;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await authHeaders()),
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail || res.statusText);
  }
  // 204 / empty bodies are rare here, but guard anyway.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
