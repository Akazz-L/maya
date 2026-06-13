// Typed fetch wrapper. Mirrors the semantics of the old index.html `post()`
// helper: JSON in/out, and throws Error(detail) on a non-OK response.
// Adds a Bearer token to authed requests and forces a logout on 401.

import { authHeaders, handleUnauthorized } from '../auth/token';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  /**
   * Whether to attach the auth token and treat a 401 as session-expired
   * (logout + redirect). Defaults to true. The login/register calls pass
   * false so their 401 ("invalid credentials") surfaces on the form instead.
   */
  authed?: boolean;
}

export async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, authed = true } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authed) Object.assign(headers, authHeaders());
  const init: RequestInit = { method, headers };
  if (body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (authed && res.status === 401) {
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
