import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceScreen } from './WorkspaceScreen';
import { AuthProvider } from '../auth/AuthContext';
import { clearToken } from '../auth/token';
import { EMPTY_PLAN } from '../api/types';
import { selectRange } from '../test/editor';

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

const ME = {
  email: 'w@test.com',
  model_key: 'haiku',
  models: [
    { key: 'haiku', label: 'Haiku 4.5', hint: 'fastest, cheapest' },
    { key: 'sonnet', label: 'Sonnet 5', hint: '2x the cost of Haiku' },
    { key: 'opus', label: 'Opus 5', hint: 'best prose, 5x the cost of Haiku' },
  ],
  usage: {
    spent_usd: 1.25,
    budget_usd: 5,
    percent: 25,
    blocked: false,
    period_end: '2026-10-01T00:00:00+00:00',
  },
};

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sse(frames: object[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(encoder.encode(`data: ${JSON.stringify(f)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

function mockApi(me: unknown = ME) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/me')) return json(me);
    if (url.endsWith('/documents')) return json(DOCS);
    if (url.endsWith('/rewrite/stream')) return sse([{ type: 'done', body: 'The downpour.' }]);
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
    expect(await screen.findByLabelText('Document body')).toHaveTextContent('The rain.');
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
    expect(await screen.findByLabelText('Document body')).toHaveTextContent('## Characters');
    expect(screen.queryByRole('button', { name: /generate plan/i })).not.toBeInTheDocument();
  });

  it('keeps the plan panel closed until a plan exists', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    expect(await screen.findByLabelText('Document body')).toHaveTextContent('The rain.');
    expect(screen.queryByRole('button', { name: /drop/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show plan/i })).toBeDisabled();
  });

  it('folds a rewrite under review into the toolbar busy state', async () => {
    // A generation started mid-review would overwrite the body the review bar
    // is still drawn against, so the toolbar has to wait for the writer.
    mockApi();
    renderAt('/p/p1/d/c1');
    await screen.findByLabelText('Document body');
    // The editor hands its view up in an effect; the rewrite layer only exists
    // — and only starts listening for selections — on the render after that.
    await act(async () => {});

    selectRange('Document body', 0, 9);
    await userEvent.click(await screen.findByRole('button', { name: /rewrite/i }));
    await userEvent.type(screen.getByLabelText('Rewrite instruction'), 'wetter{Enter}');
    await screen.findByRole('toolbar', { name: /review rewrite/i });

    expect(screen.getByRole('button', { name: /generate plan/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /generate draft/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /discard/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generate plan/i })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: /generate draft/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeEnabled();
  });

  it('shows the model picker and the meter on every document, not just chapters', async () => {
    mockApi();
    renderAt('/p/p1/d/b');
    expect(await screen.findByLabelText('Model')).toHaveValue('haiku');
    expect(screen.getByText('$1.25 / $5.00 · 25%')).toBeInTheDocument();
  });

  it('saves a new model choice', async () => {
    const fetchMock = mockApi();
    renderAt('/p/p1/d/c1');
    await userEvent.selectOptions(await screen.findByLabelText('Model'), 'opus');

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/me',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ model_key: 'opus' }),
        }),
      ),
    );
  });

  it('disables every AI action once the budget is spent', async () => {
    mockApi({
      ...ME,
      usage: { ...ME.usage, spent_usd: 5, percent: 100, blocked: true },
    });
    renderAt('/p/p1/d/c1');

    expect(await screen.findByText(/budget used — ai paused/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate plan/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /generate draft/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();
  });

  it('says why rewrite is unavailable rather than doing nothing on ⌘K', async () => {
    mockApi({
      ...ME,
      usage: { ...ME.usage, spent_usd: 5, percent: 100, blocked: true },
    });
    renderAt('/p/p1/d/c1');
    await screen.findByLabelText('Document body');
    await act(async () => {});

    selectRange('Document body', 0, 9);
    expect(await screen.findByText(/rewrite paused — ai budget used/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rewrite/i })).not.toBeInTheDocument();
  });

  it('moves the meter as soon as a generation reports what it cost', async () => {
    // No polling: the plan response carries the writer's spend including itself.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/me')) return json(ME);
      if (url.endsWith('/documents')) return json(DOCS);
      if (url.endsWith('/plan') && (init as RequestInit)?.method === 'POST')
        return json({
          plan: EMPTY_PLAN,
          usage: { ...ME.usage, spent_usd: 4.5, percent: 90, blocked: false },
        });
      if (url.includes('/documents/c1')) return json(CHAPTER);
      return json({ project_id: 'p1', name: 'Novel' });
    });

    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('button', { name: /generate plan/i }));

    expect(await screen.findByText('$4.50 / $5.00 · 90%')).toBeInTheDocument();
  });

  it('refetches the meter when the server refuses a generation', async () => {
    // A 402 means the cached meter was stale — the UI must not keep lying.
    let spent = 1.25;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/me'))
        return json({
          ...ME,
          usage: { ...ME.usage, spent_usd: spent, percent: spent * 20, blocked: spent >= 5 },
        });
      if (url.endsWith('/documents')) return json(DOCS);
      if (url.endsWith('/plan') && (init as RequestInit)?.method === 'POST') {
        spent = 5;
        return new Response(JSON.stringify({ detail: 'AI budget for this month is used up.' }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/documents/c1')) return json(CHAPTER);
      return json({ project_id: 'p1', name: 'Novel' });
    });

    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('button', { name: /generate plan/i }));

    expect(await screen.findByText(/budget for this month is used up/i)).toBeInTheDocument();
    expect(await screen.findByText(/budget used — ai paused/i)).toBeInTheDocument();
  });

  it('reopens a saved plan on load, so a reload does not strand it', async () => {
    // Regression: the panel used to be a plain boolean reset on mount, which
    // left a persisted plan unreachable without regenerating it.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/me')) return json(ME);
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
