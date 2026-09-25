import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  proposalExtension,
  proposalOverlayField,
  setProposalOverlay,
  type OverlayFix,
  type SuggestionsOverlay,
  type WriteOverlay,
} from './proposalExtension';
import type { SuggestionHost } from './suggestionWidget';

const TEXT = 'The rain fell.';

function makeView(host?: { current: SuggestionHost }) {
  const box = host ?? { current: { onAccept: () => {}, onDiscard: () => {} } };
  return new EditorView({
    state: EditorState.create({ doc: TEXT, extensions: [proposalExtension(box)] }),
    parent: document.body,
  });
}

function overlay(over: Partial<WriteOverlay> = {}): WriteOverlay {
  return {
    kind: 'write',
    from: 4,
    to: 8,
    original: 'rain',
    replacement: 'downpour',
    phase: 'reviewing',
    showDiff: true,
    ...over,
  };
}

function fixes(...list: Partial<OverlayFix>[]): SuggestionsOverlay {
  return {
    kind: 'suggestions',
    total: list.length,
    fixes: list.map((fix, index) => ({
      index,
      from: 4,
      to: 8,
      original: 'rain',
      replacement: 'downpour',
      explanation: 'The bible calls it a storm.',
      severity: null,
      ...fix,
    })),
  };
}

describe('proposalExtension', () => {
  it('hides the changed span behind the streamed text, leaving the document alone', () => {
    const view = makeView();
    view.dispatch({
      effects: setProposalOverlay.of(overlay({ phase: 'streaming', replacement: 'down' })),
    });
    expect(view.contentDOM.querySelector('.cm-rewrite-stream')?.textContent).toContain('down');
    expect(view.contentDOM.textContent).not.toContain('rain');
    expect(view.state.doc.toString()).toBe(TEXT);
    view.destroy();
  });

  it('renders a word diff while reviewing, or the clean result when the diff is off', () => {
    const view = makeView();
    view.dispatch({ effects: setProposalOverlay.of(overlay()) });
    expect(view.contentDOM.querySelector('.cm-rewrite-del')?.textContent).toBe('rain');
    expect(view.contentDOM.querySelector('.cm-rewrite-ins')?.textContent).toBe('downpour');

    view.dispatch({ effects: setProposalOverlay.of(overlay({ showDiff: false })) });
    expect(view.contentDOM.querySelector('.cm-rewrite-del')).toBeNull();
    expect(view.contentDOM.querySelector('.cm-rewrite-result')?.textContent).toBe('downpour');
    view.destroy();
  });

  it('shows an append as an insertion after the text', () => {
    const view = makeView();
    view.dispatch({
      effects: setProposalOverlay.of(
        overlay({ from: TEXT.length, to: TEXT.length, original: '', replacement: ' More.' }),
      ),
    });
    expect(view.contentDOM.textContent).toContain('The rain fell.');
    expect(view.contentDOM.querySelector('.cm-rewrite-ins')?.textContent).toBe(' More.');
    view.destroy();
  });

  it('draws a card under each fix, naming the problem and its severity', () => {
    const view = makeView();
    view.dispatch({
      effects: setProposalOverlay.of(
        fixes(
          { index: 0, from: 4, to: 8, severity: 'critical' },
          {
            index: 1,
            from: 9,
            to: 13,
            original: 'fell',
            replacement: 'poured',
            explanation: 'Weak verb.',
          },
        ),
      ),
    });

    const cards = view.contentDOM.querySelectorAll('.cm-suggestion-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('The bible calls it a storm.');
    expect(cards[0].textContent).toContain('Critical');
    expect(cards[0].textContent).toContain('1 of 2');
    expect(cards[1].textContent).toContain('Weak verb.');
    // Each fix is shown as a diff of its own span, and the document is untouched.
    expect(
      [...view.contentDOM.querySelectorAll('.cm-rewrite-ins')].map((e) => e.textContent),
    ).toEqual(['downpour', 'poured']);
    expect(view.state.doc.toString()).toBe(TEXT);
    view.destroy();
  });

  it('routes a card button to the host, by the fix it belongs to', () => {
    const accepted: number[] = [];
    const discarded: number[] = [];
    const host = {
      current: {
        onAccept: (i: number) => accepted.push(i),
        onDiscard: (i: number) => discarded.push(i),
      },
    };
    const view = makeView(host);
    view.dispatch({ effects: setProposalOverlay.of(fixes({ index: 3 })) });

    view.contentDOM.querySelector<HTMLButtonElement>('.cm-suggestion-accept')!.click();
    view.contentDOM.querySelector<HTMLButtonElement>('.cm-suggestion-discard')!.click();
    expect(accepted).toEqual([3]);
    expect(discarded).toEqual([3]);
    view.destroy();
  });

  it('drops the overlay when the document changes', () => {
    const view = makeView();
    view.dispatch({ effects: setProposalOverlay.of(overlay()) });
    view.dispatch({ changes: { from: 0, insert: 'X' } });
    expect(view.state.field(proposalOverlayField)).toBeNull();
    view.destroy();
  });
});
