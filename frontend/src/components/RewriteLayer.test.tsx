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
  render(<DocumentEditor {...props} />);
  return props;
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

    expect(fetchSpy).toHaveBeenCalledWith(
      '/projects/p1/documents/c1/rewrite/stream',
      expect.objectContaining({
        body: JSON.stringify({
          instruction: 'more tense',
          selection: 'She waited by the door.',
          before: 'The hall was empty. ',
          after: ' A clock ticked.',
        }),
      }),
    );
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

  it('Escape in the prompt closes it', async () => {
    renderChapter();
    await openPrompt();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('Rewrite instruction')).toBeNull();
  });

  it('does not offer the pill while the editor is read-only', () => {
    renderChapter({ readOnly: true });
    selectRange('Document body', 20, 43);
    expect(screen.queryByRole('button', { name: /rewrite/i })).toBeNull();
  });
});
