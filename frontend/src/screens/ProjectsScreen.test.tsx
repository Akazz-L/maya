import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ProjectsScreen } from './ProjectsScreen';

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <QueryClientProvider client={qc}>
        <ProjectsScreen />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ME = { email: 'writer@example.com', model_key: 'sonnet', models: [], usage: {} };

/**
 * The screen asks for two things: the account behind the header's menu, and
 * the projects themselves. Each call needs its own Response — a body reads once.
 */
function mockApi(projects: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : String(input);
    return Promise.resolve(jsonResponse(url.includes('/me') ? ME : projects));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProjectsScreen', () => {
  it('lists the projects returned by the API', async () => {
    mockApi([
      { project_id: 'p1', name: 'First Novel', created_at: '2026-01-01T00:00:00Z' },
      { project_id: 'p2', name: 'Second Novel', created_at: '2026-02-01T00:00:00Z' },
    ]);

    renderScreen();

    expect(await screen.findByText('First Novel')).toBeInTheDocument();
    expect(screen.getByText('Second Novel')).toBeInTheDocument();
  });

  it('shows the empty state when there are no projects', async () => {
    mockApi([]);
    renderScreen();
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });
});
