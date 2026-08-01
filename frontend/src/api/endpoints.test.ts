import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkDocument,
  createDocument,
  createProject,
  listProjects,
  login,
  reorderDocuments,
  updateDocument,
} from './endpoints';
import { clearToken, setToken } from '../auth/token';

function jsonResponse(data: unknown, status = 200): Response {
  // A 204 must have a null body — an empty string still counts as a body.
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  clearToken();
  vi.restoreAllMocks();
});

describe('endpoints', () => {
  it('attaches a Bearer header to authed requests and scopes URLs by project', async () => {
    setToken('jwt123');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ issues: [] }));

    await checkDocument('proj-1', 'doc-3');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/projects/proj-1/documents/doc-3/check');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt123');
  });

  it('does not attach a token to login (unauthenticated) requests', async () => {
    setToken('should-not-be-sent');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ access_token: 't', token_type: 'bearer' }));

    await login('a@b.com', 'pw');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/auth/token');
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('hits the project collection routes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    await listProjects();
    expect(fetchSpy.mock.calls[0][0]).toBe('/projects');

    fetchSpy.mockResolvedValue(jsonResponse({ project_id: 'x', name: 'Novel' }));
    await createProject('Novel');
    const [url, init] = fetchSpy.mock.calls[1];
    expect(url).toBe('/projects');
    expect(init?.method).toBe('POST');
  });
});

describe('document endpoints', () => {
  it('creates a document with the given title and kind', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ id: 'd1', title: 'Ch 1', kind: 'chapter' }, 201));

    const doc = await createDocument('p1', 'Ch 1', 'chapter');

    expect(doc.id).toBe('d1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/projects/p1/documents');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ title: 'Ch 1', kind: 'chapter' });
  });

  it('patches only the fields it is given', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ id: 'd1' }));

    await updateDocument('p1', 'd1', { body: 'text' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/projects/p1/documents/d1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ body: 'text' });
  });

  it('sends an explicit null when dropping a plan', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ id: 'd1' }));

    await updateDocument('p1', 'd1', { plan: null });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({ plan: null });
  });

  it('sends the id order when reordering', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(null, 204));

    await reorderDocuments('p1', ['b', 'a']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/projects/p1/documents/order');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ document_ids: ['b', 'a'] });
  });
});
