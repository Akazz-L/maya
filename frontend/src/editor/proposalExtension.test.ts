import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  proposalExtension,
  proposalOverlayField,
  setProposalOverlay,
  type ProposalOverlay,
} from './proposalExtension';

const TEXT = 'The rain fell.';

function makeView() {
  return new EditorView({
    state: EditorState.create({ doc: TEXT, extensions: [proposalExtension()] }),
    parent: document.body,
  });
}

function overlay(over: Partial<ProposalOverlay> = {}): ProposalOverlay {
  return {
    from: 4,
    to: 8,
    original: 'rain',
    replacement: 'downpour',
    phase: 'reviewing',
    showDiff: true,
    ...over,
  };
}

describe('proposalExtension', () => {
  it('hides the changed span behind the streamed text, leaving the document alone', () => {
    const view = makeView();
    view.dispatch({ effects: setProposalOverlay.of(overlay({ phase: 'streaming', replacement: 'down' })) });
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

  it('drops the overlay when the document changes', () => {
    const view = makeView();
    view.dispatch({ effects: setProposalOverlay.of(overlay()) });
    view.dispatch({ changes: { from: 0, insert: 'X' } });
    expect(view.state.field(proposalOverlayField)).toBeNull();
    view.destroy();
  });
});
