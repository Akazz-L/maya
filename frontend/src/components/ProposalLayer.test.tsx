import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentDetail } from '../api/types';
import { sha256Hex } from '../lib/chat';
import { viewFor } from '../test/editor';
import type { ProposalView } from './ProposalLayer';

const DOC: DocumentDetail = {
  id: 'c1',
  title: 'Chapter 1',
  kind: 'chapter',
  position: 1,
  updated_at: '2026-01-01',
  body: 'The rain fell.',
  brief: '',
  plan: null,
  issues: null,
};

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

async function renderWith(proposal: ProposalView) {
  const onSave = vi.fn();
  const onResolve = vi.fn();
  render(
    <DocumentEditor
      document={DOC}
      projectId="p1"
      readOnly={false}
      onSave={onSave}
      saveState="idle"
      proposal={proposal}
      onProposalResolve={onResolve}
    />,
  );
  // The editor hands its view up in an effect; the layer renders after that.
  await act(async () => {});
  return { onSave, onResolve };
}

async function reviewing(proposed: string, baseHash?: string): Promise<ProposalView> {
  return {
    phase: 'reviewing',
    proposed,
    baseHash: baseHash ?? (await sha256Hex(DOC.body)),
    showDiff: true,
  };
}

describe('ProposalLayer', () => {
  it('streams the proposed prose into place and keeps the editor read-only', async () => {
    await renderWith({ phase: 'streaming', mode: 'append', text: 'More.' });
    expect(screen.getByLabelText('Document body')).toHaveAttribute('contenteditable', 'false');
    expect(screen.getByLabelText('Document body').querySelector('.cm-rewrite-stream')?.textContent).toContain(
      'More.',
    );
    expect(screen.getByText(/writing/i)).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: /review proposal/i })).not.toBeInTheDocument();
  });

  it('accepts through the editor, so the change autosaves', async () => {
    const { onSave, onResolve } = await renderWith(await reviewing('The downpour fell.'));
    expect(screen.getByLabelText('Document body').querySelector('.cm-rewrite-ins')?.textContent).toBe('downpour');

    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('accepted'));
    expect(viewFor('Document body').state.doc.toString()).toBe('The downpour fell.');
    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).toHaveBeenCalledWith({ body: 'The downpour fell.' });
  });

  it('discards without touching the text', async () => {
    const { onSave, onResolve } = await renderWith(await reviewing('The downpour fell.'));
    await userEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onResolve).toHaveBeenCalledWith('discarded');
    expect(viewFor('Document body').state.doc.toString()).toBe(DOC.body);
    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses a proposal computed against different text', async () => {
    const { onSave, onResolve } = await renderWith(await reviewing('The downpour fell.', 'not-this-text'));
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('stale'));
    expect(viewFor('Document body').state.doc.toString()).toBe(DOC.body);
    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('discards on Escape', async () => {
    const { onResolve } = await renderWith(await reviewing('The downpour fell.'));
    await userEvent.keyboard('{Escape}');
    expect(onResolve).toHaveBeenCalledWith('discarded');
  });
});
