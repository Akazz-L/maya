import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentDetail, ProposalOutcome, Suggestion } from '../api/types';
import { sha256Hex } from '../lib/chat';
import { viewFor } from '../test/editor';
import type { ProposalView } from '../lib/proposalView';
import { revealPos } from '../editor/proposalExtension';

const DOC: DocumentDetail = {
  id: 'c1',
  title: 'Chapter 1',
  kind: 'chapter',
  position: 1,
  updated_at: '2026-01-01',
  body: 'The rain fell. She ran.',
  brief: '',
  plan: null,
};

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

async function renderWith(proposal: ProposalView) {
  const onSave = vi.fn();
  const onResolve = vi.fn<(outcome: ProposalOutcome, indexes?: number[]) => void>();
  render(
    <DocumentEditor
      document={DOC}
      projectId="p1"
      onSave={onSave}
      saveState="idle"
      proposal={proposal}
      onProposalResolve={onResolve}
    />,
  );
  // The editor hands its view up in an effect; the layer renders after that.
  await act(async () => {});
  // A suggestion set then hashes the chapter before drawing anything, so wait
  // for that to land — either as fixes on screen, or as the set going stale.
  if (proposal.phase === 'reviewing' && proposal.kind === 'suggestions') {
    await waitFor(() =>
      expect(screen.queryAllByRole('toolbar').length + onResolve.mock.calls.length).toBeGreaterThan(
        0,
      ),
    );
  }
  return { onSave, onResolve };
}

async function reviewing(proposed: string, baseHash?: string): Promise<ProposalView> {
  return {
    phase: 'reviewing',
    kind: 'write',
    proposed,
    baseHash: baseHash ?? (await sha256Hex(DOC.body)),
    showDiff: true,
  };
}

/** Two non-overlapping fixes against DOC.body: "rain"→"downpour", "ran"→"fled". */
function fixes(...outcomes: (ProposalOutcome | null)[]): Suggestion[] {
  const all: Suggestion[] = [
    {
      find: 'rain',
      replace: 'downpour',
      explanation: 'The bible calls it a storm.',
      severity: 'critical',
      from: 4,
      to: 8,
      outcome: null,
    },
    {
      find: 'ran',
      replace: 'fled',
      explanation: 'Weak verb.',
      severity: 'style',
      from: 19,
      to: 22,
      outcome: null,
    },
  ];
  return all.map((fix, i) => ({ ...fix, outcome: outcomes[i] ?? null }));
}

async function reviewingSet(
  suggestions: Suggestion[] = fixes(),
  baseHash?: string,
): Promise<ProposalView> {
  return {
    phase: 'reviewing',
    kind: 'suggestions',
    suggestions,
    baseHash: baseHash ?? (await sha256Hex(DOC.body)),
    label: 'Continuity check',
  };
}

const body = () => viewFor('Document body').state.doc.toString();

describe('ProposalLayer, whole-chapter proposals', () => {
  it('streams the proposed prose into place and keeps the editor read-only', async () => {
    await renderWith({ phase: 'streaming', mode: 'append', text: 'More.' });
    expect(screen.getByLabelText('Document body')).toHaveAttribute('contenteditable', 'false');
    expect(
      screen.getByLabelText('Document body').querySelector('.cm-rewrite-stream')?.textContent,
    ).toContain('More.');
    expect(screen.getByText(/writing/i)).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: /review proposal/i })).not.toBeInTheDocument();
  });

  it('accepts through the editor, so the change autosaves', async () => {
    const { onSave, onResolve } = await renderWith(await reviewing('The downpour fell. She ran.'));
    expect(
      screen.getByLabelText('Document body').querySelector('.cm-rewrite-ins')?.textContent,
    ).toBe('downpour');

    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('accepted'));
    expect(body()).toBe('The downpour fell. She ran.');
    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).toHaveBeenCalledWith({ body: 'The downpour fell. She ran.' });
  });

  it('discards without touching the text', async () => {
    const { onSave, onResolve } = await renderWith(await reviewing('The downpour fell. She ran.'));
    await userEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onResolve).toHaveBeenCalledWith('discarded');
    expect(body()).toBe(DOC.body);
    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses a proposal computed against different text', async () => {
    const { onSave, onResolve } = await renderWith(
      await reviewing('The downpour fell. She ran.', 'not-this-text'),
    );
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('stale'));
    expect(body()).toBe(DOC.body);
    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('discards on Escape', async () => {
    const { onResolve } = await renderWith(await reviewing('The downpour fell. She ran.'));
    await userEvent.keyboard('{Escape}');
    expect(onResolve).toHaveBeenCalledWith('discarded');
  });
});

describe('ProposalLayer, suggestion sets', () => {
  it('draws every fix in the prose with its own reason and buttons', async () => {
    await renderWith(await reviewingSet());
    const cards = screen.getByLabelText('Document body').querySelectorAll('.cm-suggestion-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('The bible calls it a storm.');
    expect(cards[1].textContent).toContain('Weak verb.');
    expect(screen.getByRole('button', { name: 'Accept fix 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard fix 2' })).toBeInTheDocument();
    // Nothing is applied yet, and the prose cannot be typed over meanwhile.
    expect(body()).toBe(DOC.body);
    expect(screen.getByLabelText('Document body')).toHaveAttribute('contenteditable', 'false');
  });

  it('only draws the fixes still awaiting review', async () => {
    await renderWith(await reviewingSet(fixes('accepted', null)));
    expect(
      screen.getByLabelText('Document body').querySelectorAll('.cm-suggestion-card'),
    ).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Accept fix 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept fix 1' })).not.toBeInTheDocument();
  });

  it('accepts one fix and leaves the rest of the set live', async () => {
    const { onSave, onResolve } = await renderWith(await reviewingSet());

    await userEvent.click(screen.getByRole('button', { name: 'Accept fix 1' }));

    expect(onResolve).toHaveBeenCalledWith('accepted', [0]);
    expect(body()).toBe('The downpour fell. She ran.');
    // The second fix survives, and its Accept still works.
    expect(screen.getByRole('button', { name: 'Accept fix 2' })).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).toHaveBeenCalledWith({ body: 'The downpour fell. She ran.' });
  });

  it('accepts a later fix correctly after an earlier one moved the text', async () => {
    const { onResolve } = await renderWith(await reviewingSet());

    // "rain" → "downpour" pushes everything after it four characters right.
    await userEvent.click(screen.getByRole('button', { name: 'Accept fix 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Accept fix 2' }));

    expect(onResolve).toHaveBeenNthCalledWith(2, 'accepted', [1]);
    expect(body()).toBe('The downpour fell. She fled.');
  });

  it('accepts out of order just as well', async () => {
    await renderWith(await reviewingSet());
    await userEvent.click(screen.getByRole('button', { name: 'Accept fix 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Accept fix 1' }));
    expect(body()).toBe('The downpour fell. She fled.');
  });

  it('discards one fix without touching the prose', async () => {
    const { onResolve } = await renderWith(await reviewingSet());

    await userEvent.click(screen.getByRole('button', { name: 'Discard fix 1' }));

    expect(onResolve).toHaveBeenCalledWith('discarded', [0]);
    expect(body()).toBe(DOC.body);
    expect(
      screen.getByLabelText('Document body').querySelectorAll('.cm-suggestion-card'),
    ).toHaveLength(1);
  });

  it('counts down what is left, and goes away with the last fix', async () => {
    await renderWith(await reviewingSet());
    expect(screen.getByRole('toolbar')).toHaveTextContent('Continuity check · 2 of 2 left');

    await userEvent.click(screen.getByRole('button', { name: 'Discard fix 1' }));
    expect(screen.getByRole('toolbar')).toHaveTextContent('Continuity check · 1 of 2 left');

    await userEvent.click(screen.getByRole('button', { name: 'Discard fix 2' }));
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('accepts every fix at once', async () => {
    const { onResolve, onSave } = await renderWith(await reviewingSet());

    await userEvent.click(screen.getByRole('button', { name: /accept all/i }));

    expect(onResolve).toHaveBeenCalledWith('accepted', [0, 1]);
    expect(body()).toBe('The downpour fell. She fled.');
    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).toHaveBeenCalledWith({ body: 'The downpour fell. She fled.' });
  });

  it('discards every fix at once, leaving the chapter as it was', async () => {
    const { onResolve, onSave } = await renderWith(await reviewingSet());

    await userEvent.click(screen.getByRole('button', { name: /discard all/i }));

    expect(onResolve).toHaveBeenCalledWith('discarded', [0, 1]);
    expect(body()).toBe(DOC.body);
    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('accepts all on ⌘↵ and discards all on Escape', async () => {
    const accepted = await renderWith(await reviewingSet());
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(accepted.onResolve).toHaveBeenCalledWith('accepted', [0, 1]);

    const discarded = await renderWith(await reviewingSet());
    await userEvent.keyboard('{Escape}');
    expect(discarded.onResolve).toHaveBeenCalledWith('discarded', [0, 1]);
  });

  it('marks the whole set stale when the chapter is no longer the text it was measured on', async () => {
    const { onResolve } = await renderWith(await reviewingSet(fixes(), 'not-this-text'));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('stale', [0, 1]));
    expect(body()).toBe(DOC.body);
    expect(
      screen.getByLabelText('Document body').querySelectorAll('.cm-suggestion-card'),
    ).toHaveLength(0);
  });

  it('marks one fix stale rather than splicing over the wrong words', async () => {
    // Offsets that do not read as `find` any more: the passage moved or changed.
    const wrong = fixes().map((fix, i) => (i === 0 ? { ...fix, from: 0, to: 4 } : fix));
    const { onResolve } = await renderWith(await reviewingSet(wrong));

    await userEvent.click(screen.getByRole('button', { name: 'Accept fix 1' }));

    expect(onResolve).toHaveBeenCalledWith('stale', [0]);
    expect(body()).toBe(DOC.body);
    // The sound fix is still there to take.
    expect(screen.getByRole('button', { name: 'Accept fix 2' })).toBeInTheDocument();
  });
});

describe('revealPos', () => {
  const fix = (from: number) => ({
    index: 0,
    from,
    to: from + 4,
    original: 'rain',
    replacement: 'storm',
    explanation: '',
    severity: null,
  });

  it('points at the next fix to review, not at the top of the chapter', () => {
    // The bug this exists for: a pass finds a contradiction 3,000 characters
    // down, the review bar says so from the top of the editor, and the writer
    // sees no change anywhere.
    expect(revealPos({ kind: 'suggestions', total: 2, fixes: [fix(2769), fix(3100)] })).toBe(2769);
  });

  it('follows the set as fixes are resolved', () => {
    expect(revealPos({ kind: 'suggestions', total: 2, fixes: [fix(3100)] })).toBe(3100);
    expect(revealPos({ kind: 'suggestions', total: 2, fixes: [] })).toBeNull();
  });

  it('points at the changed span of a whole-chapter proposal', () => {
    expect(
      revealPos({
        kind: 'write',
        from: 1200,
        to: 1200,
        original: '',
        replacement: 'More prose.',
        phase: 'reviewing',
        showDiff: false,
      }),
    ).toBe(1200);
  });
});
