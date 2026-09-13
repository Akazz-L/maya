import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceScreen } from './WorkspaceScreen';
import { AuthProvider } from '../auth/AuthContext';
import { clearToken } from '../auth/token';
import { EMPTY_PLAN, type ChatMessage, type ChatProposal } from '../api/types';
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

function mockApi({ me = ME, chapter = CHAPTER, chat = [], handle }: MockOptions = {}) {
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
    if (url.includes('/documents/c1'))
      return json(
        method === 'PATCH' ? { ...(chapter as object), ...JSON.parse(String(request?.body)) } : chapter,
      );
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

/** The editor hands its view up in an effect; its layers render after that. */
async function editorReady() {
  await screen.findByLabelText('Document body');
  await act(async () => {});
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

  it('shows the generate toolbar and the chat on a chapter', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    expect(await screen.findByRole('button', { name: /generate plan/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate draft/i })).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Message')).toBeEnabled();
  });

  it('hides the toolbar and the chat on the bible', async () => {
    const fetchMock = mockApi();
    renderAt('/p/p1/d/b');
    expect(await screen.findByLabelText('Document body')).toHaveTextContent('## Characters');
    expect(screen.queryByRole('button', { name: /generate plan/i })).not.toBeInTheDocument();
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
    await editorReady();

    selectRange('Document body', 0, 9);
    await userEvent.click(await screen.findByRole('button', { name: /rewrite/i }));
    await userEvent.type(screen.getByLabelText('Rewrite instruction'), 'wetter{Enter}');
    await screen.findByRole('toolbar', { name: /review rewrite/i });

    expect(screen.getByRole('button', { name: /generate plan/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();
    expect(screen.getByLabelText('Message')).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /discard/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generate plan/i })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: /^check$/i })).toBeEnabled();
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
    expect(screen.getByRole('button', { name: /generate plan/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByText(/budget used — chat is paused/i)).toBeInTheDocument();
  });

  it('still lets a writer drop a saved plan once the budget is spent', async () => {
    // Dropping a plan calls no model, so running out of budget must not lock it.
    mockApi({ me: BLOCKED, chapter: { ...CHAPTER, plan: { ...EMPTY_PLAN, goal: 'Reach the gate' } } });
    renderAt('/p/p1/d/c1');

    expect(await screen.findByDisplayValue('Reach the gate')).toBeInTheDocument();
    expect(await screen.findByText(/budget used — ai paused/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate draft/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /drop/i })).toBeEnabled();
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
    await userEvent.click(await screen.findByRole('button', { name: /generate plan/i }));

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
    await userEvent.click(await screen.findByRole('button', { name: /generate plan/i }));

    expect(await screen.findByText(/budget for this month is used up/i)).toBeInTheDocument();
    expect(await screen.findByText(/budget used — ai paused/i)).toBeInTheDocument();
  });

  it('reopens a saved plan on load, so a reload does not strand it', async () => {
    // Regression: the panel used to be a plain boolean reset on mount, which
    // left a persisted plan unreachable without regenerating it.
    mockApi({ chapter: { ...CHAPTER, plan: { ...EMPTY_PLAN, goal: 'Reach the gate' } } });
    renderAt('/p/p1/d/c1');

    expect(await screen.findByDisplayValue('Reach the gate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide plan/i })).toBeEnabled();
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
    expect(screen.getByRole('button', { name: /generate plan/i })).toBeDisabled();

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
          expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ body: 'Night fell.' }) }),
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

  it('drafts from the plan by asking the chat', async () => {
    const fetchMock = mockApi({
      chapter: { ...CHAPTER, plan: { ...EMPTY_PLAN, goal: 'Reach the gate' } },
      handle: (url) =>
        url.endsWith('/chat/stream') ? sse([{ type: 'done', messages: [], usage: ME.usage }]) : undefined,
    });
    renderAt('/p/p1/d/c1');
    await screen.findByDisplayValue('Reach the gate');

    await userEvent.click(screen.getByRole('button', { name: /generate draft/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/projects/p1/documents/c1/chat/stream',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Draft this chapter from the scene plan.' }),
        }),
      ),
    );
  });

  it('shows a refused chat message and gives the text back', async () => {
    mockApi({
      handle: (url) =>
        url.endsWith('/chat/stream') ? json({ detail: 'AI budget for this month is used up.' }, 402) : undefined,
    });
    renderAt('/p/p1/d/c1');

    await userEvent.type(await screen.findByLabelText('Message'), 'Draft it.{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(/used up/i);
    expect(screen.getByLabelText('Message')).toHaveValue('Draft it.');
  });
});
