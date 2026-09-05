import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceScreen } from './WorkspaceScreen';
import { AuthProvider } from '../auth/AuthContext';
import { clearToken } from '../auth/token';
import { EMPTY_PLAN } from '../api/types';

const DOCS = [
  { id: 'b', title: 'Story Bible', kind: 'bible', position: 0, updated_at: '2026-01-01' },
  { id: 'c1', title: 'Chapter 1', kind: 'chapter', position: 1, updated_at: '2026-01-01' },
];

const CHAPTER = {
  id: 'c1',
  title: 'Chapter 1',
  kind: 'chapter',
  position: 1,
  updated_at: '2026-01-01',
  body: 'The rain.',
  brief: 'Mara waits.',
  plan: null,
  issues: null,
};

const BIBLE = {
  ...CHAPTER,
  id: 'b',
  kind: 'bible',
  title: 'Story Bible',
  body: '## Characters',
  brief: '',
};

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/documents')) return json(DOCS);
    if (url.includes('/documents/c1')) return json(CHAPTER);
    if (url.includes('/documents/b')) return json(BIBLE);
    return json({ project_id: 'p1', name: 'Novel' });
  });
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Routes>
            <Route path="/p/:projectId" element={<WorkspaceScreen />} />
            <Route path="/p/:projectId/d/:documentId" element={<WorkspaceScreen />} />
          </Routes>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearToken();
  vi.restoreAllMocks();
});

describe('WorkspaceScreen', () => {
  it('lists the documents in the sidebar', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    expect(await screen.findByText('Story Bible')).toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
  });

  it('opens the document named in the route', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    expect(await screen.findByDisplayValue('The rain.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mara waits.')).toBeInTheDocument();
  });

  it('shows the generate toolbar on a chapter', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    expect(await screen.findByRole('button', { name: /generate plan/i })).toBeInTheDocument();
  });

  it('hides the generate toolbar on the bible', async () => {
    mockApi();
    renderAt('/p/p1/d/b');
    expect(await screen.findByDisplayValue('## Characters')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate plan/i })).not.toBeInTheDocument();
  });

  it('keeps the plan panel closed until a plan exists', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    await screen.findByDisplayValue('The rain.');
    expect(screen.queryByRole('button', { name: /drop/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show plan/i })).toBeDisabled();
  });

  it('reopens a saved plan on load, so a reload does not strand it', async () => {
    // Regression: the panel used to be a plain boolean reset on mount, which
    // left a persisted plan unreachable without regenerating it.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/documents')) return json(DOCS);
      if (url.includes('/documents/c1'))
        return json({ ...CHAPTER, plan: { ...EMPTY_PLAN, goal: 'Reach the gate' } });
      return json({ project_id: 'p1', name: 'Novel' });
    });

    renderAt('/p/p1/d/c1');

    expect(await screen.findByDisplayValue('Reach the gate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide plan/i })).toBeEnabled();
  });
});
