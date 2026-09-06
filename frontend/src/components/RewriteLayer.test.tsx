import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentDetail } from '../api/types';
import { selectRange, viewFor } from '../test/editor';

const BODY = 'The hall was empty. She waited by the door. A clock ticked.';
const DOC: DocumentDetail = {
  id: 'c1',
  title: 'Chapter 1',
  kind: 'chapter',
  position: 1,
  updated_at: '2026-01-01',
  body: BODY,
  brief: '',
  plan: null,
  issues: null,
};

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

function renderChapter(over: Partial<Parameters<typeof DocumentEditor>[0]> = {}) {
  const props = {
    document: DOC,
    projectId: 'p1',
    readOnly: false,
    onSave: vi.fn(),
    saveState: 'idle' as const,
    onBusyChange: vi.fn(),
    ...over,
  };
  const { unmount } = render(<DocumentEditor {...props} />);
  return { ...props, unmount };
}

async function openPrompt() {
  selectRange('Document body', 20, 43);
  await userEvent.click(await screen.findByRole('button', { name: /rewrite/i }));
  return screen.getByLabelText('Rewrite instruction');
}

afterEach(() => vi.restoreAllMocks());

describe('selection rewrite flow', () => {
  it('shows the pill only for a non-empty selection on a chapter', async () => {
    renderChapter();
    expect(screen.queryByRole('button', { name: /rewrite/i })).toBeNull();
    selectRange('Document body', 20, 43);
    expect(await screen.findByRole('button', { name: /rewrite/i })).toBeInTheDocument();
    selectRange('Document body', 5, 5);
    await waitFor(() => expect(screen.queryByRole('button', { name: /rewrite/i })).toBeNull());
  });

  it('never shows the pill on a note', () => {
    renderChapter({ document: { ...DOC, kind: 'note' } });
    selectRange('Document body', 20, 43);
    expect(screen.queryByRole('button', { name: /rewrite/i })).toBeNull();
  });

  it('streams a suggestion, then accepts it through the editor', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        sse([
          { type: 'delta', text: 'She ' },
          { type: 'delta', text: 'froze.' },
          { type: 'done', body: 'She froze.' },
        ]),
      );
    const props = renderChapter();

    const input = await openPrompt();
    await userEvent.type(input, 'more tense{Enter}');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/projects/p1/documents/c1/rewrite/stream');
    expect(JSON.parse(init!.body as string)).toEqual({
      instruction: 'more tense',
      selection: 'She waited by the door.',
      before: 'The hall was empty. ',
      after: ' A clock ticked.',
    });
    expect(props.onBusyChange).toHaveBeenLastCalledWith(true);

    const accept = await screen.findByRole('button', { name: /accept/i });
    expect(screen.getByLabelText('Document body')).toHaveAttribute('contenteditable', 'false');
    expect(viewFor('Document body').state.doc.toString()).toBe(BODY); // untouched until accepted

    await userEvent.click(accept);

    expect(viewFor('Document body').state.doc.toString()).toBe(
      'The hall was empty. She froze. A clock ticked.',
    );
    expect(screen.getByLabelText('Document body')).toHaveAttribute('contenteditable', 'true');
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('toolbar', { name: /review rewrite/i })).toBeNull();
  });

  it('autosaves the accepted text', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([{ type: 'done', body: 'She froze.' }]));
    const props = renderChapter();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    selectRange('Document body', 20, 43);
    await user.click(await screen.findByRole('button', { name: /rewrite/i }));
    await user.type(screen.getByLabelText('Rewrite instruction'), 'tighten{Enter}');
    await user.click(await screen.findByRole('button', { name: /accept/i }));

    act(() => void vi.advanceTimersByTime(800));
    expect(props.onSave).toHaveBeenCalledWith({
      body: 'The hall was empty. She froze. A clock ticked.',
    });
    vi.useRealTimers();
  });

  it('discard leaves the document untouched', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([{ type: 'done', body: 'She froze.' }]));
    renderChapter();

    const input = await openPrompt();
    await userEvent.type(input, 'tighten{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /discard/i }));

    expect(viewFor('Document body').state.doc.toString()).toBe(BODY);
    expect(screen.queryByRole('toolbar', { name: /review rewrite/i })).toBeNull();
  });

  it('abandons a review when the document changes underneath it', async () => {
    // The overlay field drops itself on any document change; if the React state
    // machine outlived it, Accept would splice over whatever now sits at those
    // offsets.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([{ type: 'done', body: 'She froze.' }]));
    renderChapter();

    const input = await openPrompt();
    await userEvent.type(input, 'tighten{Enter}');
    await screen.findByRole('toolbar', { name: /review rewrite/i });

    act(() => viewFor('Document body').dispatch({ changes: { from: 0, insert: 'X' } }));

    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: /review rewrite/i })).toBeNull(),
    );
    expect(viewFor('Document body').state.doc.toString()).toBe(`X${BODY}`);
  });

  it('shows an error with Retry, and Retry reopens the prompt with the instruction', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sse([{ type: 'error', detail: 'model exploded' }]),
    );
    renderChapter();

    const input = await openPrompt();
    await userEvent.type(input, 'tighten{Enter}');

    expect(await screen.findByText('model exploded')).toBeInTheDocument();
    expect(viewFor('Document body').state.doc.toString()).toBe(BODY);

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(screen.getByLabelText('Rewrite instruction')).toHaveValue('tighten');
  });

  it('accepts a review with Mod-Enter, wherever focus landed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([{ type: 'done', body: 'She froze.' }]));
    renderChapter();

    const input = await openPrompt();
    await userEvent.type(input, 'tighten{Enter}');
    await screen.findByRole('toolbar', { name: /review rewrite/i });

    // Focus off the autofocused Accept button, so only the window-wide
    // shortcut can do this — a plain Enter on the button would too.
    act(() => (globalThis.document.activeElement as HTMLElement).blur());
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');

    expect(viewFor('Document body').state.doc.toString()).toBe(
      'The hall was empty. She froze. A clock ticked.',
    );
    expect(screen.queryByRole('toolbar', { name: /review rewrite/i })).toBeNull();
  });

  it('discards a review with Escape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([{ type: 'done', body: 'She froze.' }]));
    renderChapter();

    const input = await openPrompt();
    await userEvent.type(input, 'tighten{Enter}');
    await screen.findByRole('toolbar', { name: /review rewrite/i });

    await userEvent.keyboard('{Escape}');

    expect(viewFor('Document body').state.doc.toString()).toBe(BODY);
    expect(screen.queryByRole('toolbar', { name: /review rewrite/i })).toBeNull();
  });

  it('Escape in the prompt closes it', async () => {
    renderChapter();
    await openPrompt();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('Rewrite instruction')).toBeNull();
  });

  it('reports not-busy when the editor unmounts mid-rewrite', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([{ type: 'done', body: 'She froze.' }]));
    const props = renderChapter();

    const input = await openPrompt();
    await userEvent.type(input, 'tighten{Enter}');
    await screen.findByRole('button', { name: /accept/i });
    expect(props.onBusyChange).toHaveBeenLastCalledWith(true);

    // Switching documents unmounts the editor; the workspace must not stay busy.
    act(() => props.unmount());
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('anchors the review bar below the last line of a span that wraps', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse([{ type: 'done', body: 'She froze.' }]));
    renderChapter();

    const input = await openPrompt();
    await userEvent.type(input, 'tighten{Enter}');
    const bar = await screen.findByRole('toolbar', { name: /review rewrite/i });

    const view = viewFor('Document body');
    const widget = view.contentDOM.querySelector('.cm-rewrite-widget')!;
    // Two rects: the reviewed span wraps onto a second line.
    const rects = [
      { top: 100, bottom: 120, left: 40 },
      { top: 130, bottom: 150, left: 24 },
    ];

    act(() => {
      widget.getClientRects = () => rects as unknown as DOMRectList;
      view.dom.getBoundingClientRect = () => ({ top: 0, left: 0, width: 1000 }) as DOMRect;
      view.scrollDOM.dispatchEvent(new Event('scroll'));
    });

    // Below the LAST rect, not the first, so the bar never covers the diff.
    expect(bar.parentElement).toHaveStyle({ top: '156px', left: '40px' });
  });

  it('does not offer the pill while the editor is read-only', () => {
    renderChapter({ readOnly: true });
    selectRange('Document body', 20, 43);
    expect(screen.queryByRole('button', { name: /rewrite/i })).toBeNull();
  });
});
