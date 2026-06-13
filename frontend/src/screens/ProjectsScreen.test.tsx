import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ProjectsScreen } from './ProjectsScreen';
import { AuthProvider } from '../auth/AuthContext';
import { clearToken } from '../auth/token';

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <ProjectsScreen />
        </AuthProvider>
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

afterEach(() => {
  clearToken();
  vi.restoreAllMocks();
});

describe('ProjectsScreen', () => {
  it('lists the projects returned by the API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse([
        { project_id: 'p1', name: 'First Novel', created_at: '2026-01-01T00:00:00Z' },
        { project_id: 'p2', name: 'Second Novel', created_at: '2026-02-01T00:00:00Z' },
      ]),
    );

    renderScreen();

    expect(await screen.findByText('First Novel')).toBeInTheDocument();
    expect(screen.getByText('Second Novel')).toBeInTheDocument();
  });

  it('shows the empty state when there are no projects', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    renderScreen();
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });
});
