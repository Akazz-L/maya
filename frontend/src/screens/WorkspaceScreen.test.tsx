import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceScreen } from './WorkspaceScreen';
import { AuthProvider } from '../auth/AuthContext';
import { clearToken } from '../auth/token';
import { EMPTY_PLAN, type ScenePlan } from '../api/types';
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
  plan: null as ScenePlan | null,
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

const SAVED_PLAN: ScenePlan = { ...EMPTY_PLAN, goal: 'Reach the gate' };
const NEW_PLAN: ScenePlan = { ...EMPTY_PLAN, goal: 'Burn the map' };

const ISSUES = [
  { issue: 'Wrong hand', severity: 'critical', location: 'p1', suggested_fix: 'left' },
];

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

const BLOCKED_ME = { ...ME, usage: { ...ME.usage, spent_usd: 5, percent: 100, blocked: true } };

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

/** A fake backend for chapter c1 that remembers plan, issues, and patches like the real one. */
function mockApi({ me = ME as unknown, chapter = CHAPTER } = {}) {
  let current = { ...chapter };
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/me')) return json(me);
    if (url.endsWith('/documents')) return json(DOCS);
    if (url.endsWith('/rewrite/stream')) return sse([{ type: 'done', body: 'The downpour.' }]);
    if (url.endsWith('/draft/stream')) return sse([{ type: 'done', body: 'The rain fell.' }]);
    if (url.endsWith('/plan') && method === 'POST') {
      current = { ...current, plan: NEW_PLAN };
      return json({ plan: NEW_PLAN, usage: ME.usage });
    }
    if (url.endsWith('/check') && method === 'POST') {
      current = { ...current, issues: ISSUES as never };
      return json({ issues: ISSUES, usage: ME.usage });
    }
    if (url.includes('/documents/c1')) {
      if (method === 'PATCH') current = { ...current, ...JSON.parse(String(init?.body)) };
      return json(current);
    }
    if (url.includes('/documents/b')) return json(BIBLE);
    return json({ project_id: 'p1', name: 'Novel' });
  });
}

const planRequests = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith('/plan') && init?.method === 'POST',
  ).length;

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

  it('opens a chapter on the Write view', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    expect(await screen.findByRole('tab', { name: 'Write' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Document body')).toBeVisible();
  });

  it('hides the chapter toolbar on the bible', async () => {
    mockApi();
    renderAt('/p/p1/d/b');
    expect(await screen.findByLabelText('Document body')).toHaveTextContent('## Characters');
    expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument();
  });

  it('generates a plan the first time the Plan view opens on a chapter without one', async () => {
    const fetchMock = mockApi();
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));

    expect(await screen.findByDisplayValue('Burn the map')).toBeInTheDocument();
    expect(screen.getByLabelText('Document body')).not.toBeVisible();
    expect(planRequests(fetchMock)).toBe(1);
  });

  it('shows a saved plan without calling the model', async () => {
    const fetchMock = mockApi({ chapter: { ...CHAPTER, plan: SAVED_PLAN } });
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));

    expect(await screen.findByDisplayValue('Reach the gate')).toBeInTheDocument();
    expect(planRequests(fetchMock)).toBe(0);
  });

  it('regenerates a plan, and undo restores and saves the one it replaced', async () => {
    const fetchMock = mockApi({ chapter: { ...CHAPTER, plan: SAVED_PLAN } });
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));
    await userEvent.click(await screen.findByRole('button', { name: /regenerate/i }));
    expect(await screen.findByDisplayValue('Burn the map')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /undo/i }));

    expect(await screen.findByDisplayValue('Reach the gate')).toBeInTheDocument();
    expect(screen.queryByText(/plan regenerated/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/projects/p1/documents/c1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ plan: SAVED_PLAN }) }),
      ),
    );
  });

  it('forgets the undo once the regenerated plan is edited by hand', async () => {
    mockApi({ chapter: { ...CHAPTER, plan: SAVED_PLAN } });
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));
    await userEvent.click(await screen.findByRole('button', { name: /regenerate/i }));
    await screen.findByRole('button', { name: /undo/i });

    await userEvent.type(screen.getByDisplayValue('Burn the map'), '!');

    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
  });

  it('drafts from the plan back in the Write view', async () => {
    mockApi({ chapter: { ...CHAPTER, plan: SAVED_PLAN } });
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));
    await userEvent.click(await screen.findByRole('button', { name: /draft from plan/i }));

    await waitFor(() =>
      expect(screen.getByLabelText('Document body')).toHaveTextContent('The rain fell.'),
    );
    expect(screen.getByLabelText('Document body')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Write' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the Issues view when a check comes back', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('button', { name: /^check$/i }));

    expect(await screen.findByDisplayValue('Wrong hand')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Issues (1)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('keeps the same editor across view switches rather than remounting it', async () => {
    // A remount would throw away the editor's undo history and selection.
    mockApi({ chapter: { ...CHAPTER, plan: SAVED_PLAN } });
    renderAt('/p/p1/d/c1');
    const body = await screen.findByLabelText('Document body');

    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    await screen.findByDisplayValue('Reach the gate');
    await userEvent.click(screen.getByRole('tab', { name: 'Write' }));

    expect(screen.getByLabelText('Document body')).toBe(body);
    expect(body).toBeVisible();
  });

  it('falls back to the Write view when switching documents', async () => {
    mockApi({ chapter: { ...CHAPTER, plan: SAVED_PLAN } });
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));
    await screen.findByDisplayValue('Reach the gate');

    await userEvent.click(screen.getByText('Story Bible'));
    await waitFor(() =>
      expect(screen.getByLabelText('Document body')).toHaveTextContent('## Characters'),
    );
    await userEvent.click(screen.getByText('Chapter 1'));

    expect(await screen.findByRole('tab', { name: 'Write' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('keeps a plan that lands after a document switch on the chapter it was made for', async () => {
    let resolvePlan: (res: Response) => void = () => {};
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/me')) return json(ME);
      if (url.endsWith('/documents')) return json(DOCS);
      if (url.endsWith('/plan') && init?.method === 'POST')
        return new Promise<Response>((resolve) => {
          resolvePlan = resolve;
        });
      // The chapter the server holds is deliberately left without a plan, so the
      // only way the plan can show up is through the cache write under test.
      if (url.includes('/documents/c1')) return json(CHAPTER);
      if (url.includes('/documents/b')) return json(BIBLE);
      return json({ project_id: 'p1', name: 'Novel' });
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    render(
      <MemoryRouter initialEntries={['/p/p1/d/c1']}>
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <Routes>
              <Route path="/p/:projectId/d/:documentId" element={<WorkspaceScreen />} />
            </Routes>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));
    await screen.findByText(/planning from your brief/i);
    await userEvent.click(screen.getByText('Story Bible'));
    await waitFor(() =>
      expect(screen.getByLabelText('Document body')).toHaveTextContent('## Characters'),
    );

    await act(async () => resolvePlan(json({ plan: NEW_PLAN, usage: ME.usage })));
    // Written to the chapter that asked for it, not the bible now on screen.
    expect(
      (qc.getQueryData(['document', 'p1', 'b']) as { plan: ScenePlan | null } | undefined)?.plan,
    ).toBeFalsy();

    await userEvent.click(screen.getByText('Chapter 1'));
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));
    expect(await screen.findByDisplayValue('Burn the map')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith('/plan') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
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

    expect(screen.getByRole('button', { name: /generate draft/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /discard/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generate draft/i })).toBeEnabled(),
    );
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
    mockApi({ me: BLOCKED_ME });
    renderAt('/p/p1/d/c1');

    expect(await screen.findByText(/budget used — ai paused/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate draft/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();
  });

  it('offers a blank plan instead of generating once the budget is spent', async () => {
    // Writing a plan by hand calls no model, so running out of budget must not lock it.
    const fetchMock = mockApi({ me: BLOCKED_ME });
    renderAt('/p/p1/d/c1');
    await screen.findByText(/budget used — ai paused/i);

    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    await userEvent.click(screen.getByRole('button', { name: /start a blank plan/i }));

    expect(await screen.findByRole('button', { name: /regenerate/i })).toBeDisabled();
    expect(screen.getByText('Goal')).toBeInTheDocument();
    expect(planRequests(fetchMock)).toBe(0);
  });

  it('says why rewrite is unavailable rather than doing nothing on ⌘K', async () => {
    mockApi({ me: BLOCKED_ME });
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
    await screen.findByText('$1.25 / $5.00 · 25%');
    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));

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
    await screen.findByText('$1.25 / $5.00 · 25%');
    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));

    expect(await screen.findByText(/budget for this month is used up/i)).toBeInTheDocument();
    expect(await screen.findByText(/budget used — ai paused/i)).toBeInTheDocument();
    // The Plan view follows the refetched meter: no retry, only writing by hand.
    expect(await screen.findByRole('button', { name: /start a blank plan/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});
