import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceScreen } from './WorkspaceScreen';
import { AuthProvider } from '../auth/AuthContext';
import { clearToken } from '../auth/token';
import { EMPTY_PLAN, type ChatMessage, type ChatProposal, type ScenePlan } from '../api/types';
import { sha256Hex } from '../lib/chat';
import { selectRange, typeAtEnd, viewFor } from '../test/editor';

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

const BLOCKED = { ...ME, usage: { ...ME.usage, spent_usd: 5, percent: 100, blocked: true } };

const USER_MESSAGE: ChatMessage = {
  id: 'u1',
  role: 'user',
  content: 'Draft it.',
  proposal: null,
  created_at: null,
};

function assistant(proposal: ChatProposal): ChatMessage {
  return { id: 'a1', role: 'assistant', content: 'Here is a draft.', proposal, created_at: null };
}

function draftProposal(baseHash: string): ChatProposal {
  return {
    kind: 'write',
    mode: 'replace',
    text: 'Night fell.',
    base_hash: baseHash,
    proposed_body: 'Night fell.',
    outcome: null,
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
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

interface MockOptions {
  me?: unknown;
  chapter?: unknown;
  chat?: ChatMessage[];
  /** Answers a request before the defaults do; return undefined to fall through. */
  handle?: (url: string, init: RequestInit | undefined) => Response | undefined;
}

/** A fake backend whose chapter c1 remembers patches, plans, and checks like the real one. */
function mockApi({ me = ME, chapter = CHAPTER, chat = [], handle }: MockOptions = {}) {
  let current = { ...(chapter as object) };
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const request = init as RequestInit | undefined;
    const method = request?.method ?? 'GET';
    const custom = handle?.(url, request);
    if (custom) return custom;
    if (url.endsWith('/me')) return json(me);
    if (url.endsWith('/documents')) return json(DOCS);
    if (url.endsWith('/chat') && method === 'GET') return json({ messages: chat });
    if (url.endsWith('/rewrite/stream')) return sse([{ type: 'done', body: 'The downpour.' }]);
    if (url.endsWith('/plan') && method === 'POST') {
      current = { ...current, plan: NEW_PLAN };
      return json({ plan: NEW_PLAN, usage: ME.usage });
    }
    if (url.endsWith('/check') && method === 'POST') {
      current = { ...current, issues: ISSUES };
      return json({ issues: ISSUES, usage: ME.usage });
    }
    if (url.includes('/documents/c1')) {
      if (method === 'PATCH') current = { ...current, ...JSON.parse(String(request?.body)) };
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

function renderAt(
  path: string,
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
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

/** The editor hands its view up in an effect; its layers render after that. */
async function editorReady() {
  await screen.findByLabelText('Document body');
  await act(async () => {});
}

afterEach(() => {
  clearToken();
  // The chat and chapter notes remember whether they are open; no test inherits that.
  localStorage.clear();
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
    expect(screen.getByRole('button', { name: /chapter notes/i })).toHaveTextContent('Mara waits.');
  });

  it('opens a chapter on the Write view, with the chat beside it', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    expect(await screen.findByRole('tab', { name: 'Write' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Document body')).toBeVisible();
    expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Message')).toBeEnabled();
  });

  it('hides the toolbar and the chat on the bible', async () => {
    const fetchMock = mockApi();
    renderAt('/p/p1/d/b');
    expect(await screen.findByLabelText('Document body')).toHaveTextContent('## Characters');
    expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/chat'))).toBe(false);
  });

  it('hides the chat on request and remembers it', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    await screen.findByLabelText('Message');
    await userEvent.click(screen.getByRole('button', { name: /^chat$/i }));
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(localStorage.getItem('maya.chat.open')).toBe('0');
    localStorage.removeItem('maya.chat.open');
  });

  it('generates a plan the first time the Plan view opens on a chapter without one', async () => {
    const fetchMock = mockApi();
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));

    expect(await screen.findByDisplayValue('Burn the map')).toBeInTheDocument();
    expect(screen.getByLabelText('Document body')).not.toBeVisible();
    expect(planRequests(fetchMock)).toBe(1);
  });

  it('saves notes typed moments ago before planning from them, and shows them', async () => {
    const calls: string[] = [];
    mockApi({
      handle: (url, init) => {
        if (init?.method === 'PATCH') calls.push(`PATCH ${String(init.body)}`);
        if (url.endsWith('/plan') && init?.method === 'POST') calls.push('plan');
        return undefined;
      },
    });
    renderAt('/p/p1/d/c1');
    await editorReady();

    await userEvent.click(screen.getByRole('button', { name: /chapter notes/i }));
    await userEvent.type(screen.getByLabelText('Chapter notes'), ' The bell rings.');
    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));

    await waitFor(() => expect(calls).toContain('plan'));
    expect(calls[0]).toBe('PATCH {"brief":"Mara waits. The bell rings."}');
    expect(
      await screen.findByRole('region', { name: /what the plan is built from/i }),
    ).toHaveTextContent('Mara waits. The bell rings.');
  });

  it('plans a chapter without notes, saying the AI proposes what comes next', async () => {
    const fetchMock = mockApi({ chapter: { ...CHAPTER, brief: '' } });
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));

    expect(await screen.findByDisplayValue('Burn the map')).toBeInTheDocument();
    expect(screen.getByText(/no chapter notes yet/i)).toBeInTheDocument();
    expect(planRequests(fetchMock)).toBe(1);
  });

  it('jumps from the Plan view to the chapter notes, focused and ready to edit', async () => {
    // Open notes are already mounted, hidden with the editor: the focus must
    // wait for the Write view to be committed, or it silently goes nowhere.
    localStorage.setItem('maya.notes.open', '1');
    mockApi({ chapter: { ...CHAPTER, plan: SAVED_PLAN } });
    renderAt('/p/p1/d/c1');
    await editorReady();
    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    await screen.findByDisplayValue('Reach the gate');

    // jsdom focuses an element inside [hidden] anyway; a browser ignores the call.
    // Record where each focus lands so the test fails the way a browser would.
    const focusedInsideHidden: boolean[] = [];
    const realFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      focusedInsideHidden.push(this.closest('[hidden]') !== null);
      realFocus.call(this, options);
    });

    await userEvent.click(screen.getByRole('button', { name: /edit notes/i }));

    expect(screen.getByRole('tab', { name: 'Write' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Chapter notes')).toHaveFocus();
    expect(focusedInsideHidden).not.toContain(true);
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

  it('removes a plan without generating another, and undo brings it back', async () => {
    // Planning is optional: every chat draft and check is sent the saved plan,
    // so a writer must be able to go back to having none.
    const fetchMock = mockApi({ chapter: { ...CHAPTER, plan: SAVED_PLAN } });
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));
    await userEvent.click(await screen.findByRole('button', { name: /remove plan/i }));

    expect(await screen.findByText(/no plan yet/i)).toBeInTheDocument();
    expect(screen.getByText(/plan removed/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/projects/p1/documents/c1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ plan: null }) }),
      ),
    );
    expect(planRequests(fetchMock)).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: /undo/i }));

    expect(await screen.findByDisplayValue('Reach the gate')).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
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

  it('drafts from the plan by asking the chat, back in the Write view', async () => {
    const fetchMock = mockApi({
      chapter: { ...CHAPTER, plan: SAVED_PLAN },
      handle: (url) =>
        url.endsWith('/chat/stream')
          ? sse([{ type: 'done', messages: [], usage: ME.usage }])
          : undefined,
    });
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));
    await userEvent.click(await screen.findByRole('button', { name: /draft from plan/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/projects/p1/documents/c1/chat/stream',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Draft this chapter from the scene plan.' }),
        }),
      ),
    );
    expect(screen.getByRole('tab', { name: 'Write' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Document body')).toBeVisible();
  });

  it('brings the editor forward when a chat proposal arrives while the plan is open', async () => {
    // The proposal is reviewed in the editor; hidden behind the plan, it could not be.
    const proposal = draftProposal(await sha256Hex('The rain.'));
    mockApi({
      chapter: { ...CHAPTER, plan: SAVED_PLAN },
      handle: (url) =>
        url.endsWith('/chat/stream')
          ? sse([{ type: 'done', messages: [USER_MESSAGE, assistant(proposal)], usage: ME.usage }])
          : undefined,
    });
    renderAt('/p/p1/d/c1');
    await editorReady();
    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    await screen.findByDisplayValue('Reach the gate');

    await userEvent.type(screen.getByLabelText('Message'), 'Draft it.{Enter}');

    expect(await screen.findByRole('toolbar', { name: /review proposal/i })).toBeVisible();
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
    const fetchMock = mockApi({
      // The server's chapter deliberately keeps no plan, so the only way the plan
      // can show up is through the cache write under test.
      handle: (url, init) => {
        if (url.endsWith('/plan') && init?.method === 'POST')
          return new Promise<Response>((resolve) => {
            resolvePlan = resolve;
          }) as unknown as Response;
        if (url.includes('/documents/c1') && !url.endsWith('/chat')) return json(CHAPTER);
        return undefined;
      },
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    renderAt('/p/p1/d/c1', qc);

    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));
    await screen.findByText(/planning from your chapter notes/i);
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
    expect(planRequests(fetchMock)).toBe(1);
  });

  it('folds a rewrite under review into the toolbar busy state', async () => {
    // A generation started mid-review would overwrite the body the review bar
    // is still drawn against, so the toolbar has to wait for the writer.
    mockApi();
    renderAt('/p/p1/d/c1');
    await editorReady();

    selectRange('Document body', 0, 9);
    await userEvent.click(await screen.findByRole('button', { name: /rewrite/i }));
    await userEvent.type(screen.getByLabelText('Rewrite instruction'), 'wetter{Enter}');
    await screen.findByRole('toolbar', { name: /review rewrite/i });

    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    screen.getAllByRole('tab').forEach((t) => expect(t).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: /discard/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^check$/i })).toBeEnabled());
    expect(screen.getByLabelText('Message')).toBeEnabled();
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
    mockApi({ me: BLOCKED });
    renderAt('/p/p1/d/c1');

    expect(await screen.findByText(/budget used — ai paused/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByText(/budget used — chat is paused/i)).toBeInTheDocument();
  });

  it('offers a blank plan instead of generating once the budget is spent', async () => {
    // Writing a plan by hand calls no model, so running out of budget must not lock it.
    const fetchMock = mockApi({ me: BLOCKED });
    renderAt('/p/p1/d/c1');
    await screen.findByText(/budget used — ai paused/i);

    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    await userEvent.click(screen.getByRole('button', { name: /start a blank plan/i }));

    expect(await screen.findByRole('button', { name: /regenerate/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /draft from plan/i })).toBeDisabled();
    expect(screen.getByText('Goal')).toBeInTheDocument();
    expect(planRequests(fetchMock)).toBe(0);
  });

  it('says why rewrite is unavailable rather than doing nothing on ⌘K', async () => {
    mockApi({ me: BLOCKED });
    renderAt('/p/p1/d/c1');
    await editorReady();

    selectRange('Document body', 0, 9);
    expect(await screen.findByText(/rewrite paused — ai budget used/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rewrite/i })).not.toBeInTheDocument();
  });

  it('moves the meter as soon as a generation reports what it cost', async () => {
    // No polling: the plan response carries the writer's spend including itself.
    mockApi({
      handle: (url, init) =>
        url.endsWith('/plan') && init?.method === 'POST'
          ? json({ plan: EMPTY_PLAN, usage: { ...ME.usage, spent_usd: 4.5, percent: 90 } })
          : undefined,
    });

    renderAt('/p/p1/d/c1');
    await screen.findByText('$1.25 / $5.00 · 25%');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));

    expect(await screen.findByText('$4.50 / $5.00 · 90%')).toBeInTheDocument();
  });

  it('refetches the meter when the server refuses a generation', async () => {
    // A 402 means the cached meter was stale — the UI must not keep lying.
    let spent = 1.25;
    mockApi({
      handle: (url, init) => {
        if (url.endsWith('/me'))
          return json({
            ...ME,
            usage: { ...ME.usage, spent_usd: spent, percent: spent * 20, blocked: spent >= 5 },
          });
        if (url.endsWith('/plan') && init?.method === 'POST') {
          spent = 5;
          return json({ detail: 'AI budget for this month is used up.' }, 402);
        }
        return undefined;
      },
    });

    renderAt('/p/p1/d/c1');
    await screen.findByText('$1.25 / $5.00 · 25%');
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan' }));

    expect(await screen.findByText(/budget for this month is used up/i)).toBeInTheDocument();
    expect(await screen.findByText(/budget used — ai paused/i)).toBeInTheDocument();
    // The Plan view follows the refetched meter: no retry, only writing by hand.
    expect(await screen.findByRole('button', { name: /start a blank plan/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('saves an edit made inside the autosave window before Check reads the body', async () => {
    // Regression: only an in-flight save was awaited, so keystrokes still
    // waiting out the debounce were invisible to the server-side check.
    const calls: string[] = [];
    mockApi({
      handle: (url, init) => {
        if (init?.method === 'PATCH') calls.push(`PATCH ${String(init.body)}`);
        if (url.endsWith('/check')) {
          calls.push('check');
          return json({ issues: [], usage: ME.usage });
        }
        return undefined;
      },
    });
    renderAt('/p/p1/d/c1');
    await editorReady();

    typeAtEnd('Document body', '!');
    await userEvent.click(screen.getByRole('button', { name: /^check$/i }));

    await waitFor(() => expect(calls).toContain('check'));
    expect(calls[0]).toBe('PATCH {"body":"The rain.!"}');
  });

  it('drafts from a chat message: streams, reviews in the editor, accepts, autosaves', async () => {
    const proposal = draftProposal(await sha256Hex('The rain.'));
    const fetchMock = mockApi({
      handle: (url) => {
        if (url.endsWith('/chat/stream'))
          return sse([
            { type: 'delta', text: 'Here is a draft.' },
            { type: 'proposal_progress', mode: 'replace', text: 'Night' },
            {
              type: 'done',
              messages: [USER_MESSAGE, assistant(proposal)],
              usage: { ...ME.usage, spent_usd: 2, percent: 40 },
            },
          ]);
        if (url.endsWith('/chat/messages/a1/outcome'))
          return json(assistant({ ...proposal, outcome: 'accepted', proposed_body: null }));
        return undefined;
      },
    });
    renderAt('/p/p1/d/c1');
    await editorReady();

    await userEvent.type(await screen.findByLabelText('Message'), 'Draft it.{Enter}');

    await screen.findByRole('toolbar', { name: /review proposal/i });
    expect(screen.getByText('Here is a draft.')).toBeInTheDocument();
    expect(screen.getByText('$2.00 / $5.00 · 40%')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/projects/p1/documents/c1/chat/messages/a1/outcome',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ outcome: 'accepted' }) }),
      ),
    );
    expect(viewFor('Document body').state.doc.toString()).toBe('Night fell.');
    await waitFor(() => expect(screen.getByText('Accepted')).toBeInTheDocument());
    expect(screen.getByLabelText('Message')).toBeEnabled();
    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/projects/p1/documents/c1',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ body: 'Night fell.' }),
          }),
        ),
      { timeout: 2000 },
    );
  });

  it('keeps the chat locked while a saved proposal awaits review', async () => {
    mockApi({ chat: [USER_MESSAGE, assistant(draftProposal(await sha256Hex('The rain.')))] });
    renderAt('/p/p1/d/c1');

    expect(await screen.findByRole('toolbar', { name: /review proposal/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByText(/accept or discard the proposal/i)).toBeInTheDocument();
  });

  it('records a proposal as stale when the chapter no longer matches it', async () => {
    const proposal = draftProposal('computed-against-other-text');
    const fetchMock = mockApi({
      chat: [USER_MESSAGE, assistant(proposal)],
      handle: (url) =>
        url.endsWith('/outcome')
          ? json(assistant({ ...proposal, outcome: 'stale', proposed_body: null }))
          : undefined,
    });
    renderAt('/p/p1/d/c1');
    await userEvent.click(await screen.findByRole('button', { name: /accept/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/projects/p1/documents/c1/chat/messages/a1/outcome',
        expect.objectContaining({ body: JSON.stringify({ outcome: 'stale' }) }),
      ),
    );
    expect(viewFor('Document body').state.doc.toString()).toBe('The rain.');
    expect(await screen.findByText(/not applied — the chapter changed first/i)).toBeInTheDocument();
  });

  it('shows a refused chat message and gives the text back', async () => {
    mockApi({
      handle: (url) =>
        url.endsWith('/chat/stream')
          ? json({ detail: 'AI budget for this month is used up.' }, 402)
          : undefined,
    });
    renderAt('/p/p1/d/c1');

    await userEvent.type(await screen.findByLabelText('Message'), 'Draft it.{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(/used up/i);
    expect(screen.getByLabelText('Message')).toHaveValue('Draft it.');
  });
});
