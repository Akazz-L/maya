import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDraft, createProject, listProjects, login } from './endpoints';
import { clearToken, setToken } from '../auth/token';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  clearToken();
  vi.restoreAllMocks();
});

describe('endpoints', () => {
  it('attaches a Bearer header to authed requests and scopes chapter URLs by project', async () => {
    setToken('jwt123');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ issues: [] }));

    await checkDraft('proj-1', 3, 'the draft');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/projects/proj-1/chapters/3/check');
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
