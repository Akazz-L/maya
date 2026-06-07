// Typed fetch wrapper. Mirrors the semantics of the old index.html `post()`
// helper: JSON in/out, and throws Error(detail) on a non-OK response.

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
}

export async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = opts;
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail || res.statusText);
  }
  // 204 / empty bodies are rare here, but guard anyway.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
