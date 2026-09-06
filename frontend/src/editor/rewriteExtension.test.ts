import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  acceptTx,
  rewriteExtension,
  rewriteOverlayField,
  setRewriteOverlay,
  type RewriteHost,
  type RewriteOverlay,
} from './rewriteExtension';

const TEXT = 'The hall was empty. She waited by the door. A clock ticked.';
const RANGE = { from: 20, to: 43 };

function makeView(host: Partial<RewriteHost> = {}) {
  const ref = {
    current: {
      onSelectionChange: vi.fn(),
      onDocChanged: vi.fn(),
      onRequestOpen: vi.fn(() => true),
      onEscape: vi.fn(() => true),
      ...host,
    },
  };
  const view = new EditorView({
    state: EditorState.create({ doc: TEXT, extensions: [rewriteExtension(ref)] }),
    parent: document.body,
  });
  return { view, ref };
}

function overlay(over: Partial<RewriteOverlay> = {}): RewriteOverlay {
  return {
    range: RANGE,
    phase: 'prompting',
    original: 'She waited by the door.',
    replacement: '',
    showDiff: true,
    error: false,
    ...over,
  };
}

describe('rewriteExtension', () => {
  it('reports selection changes to the host, with null for an empty selection', () => {
    const { view, ref } = makeView();
    view.dispatch({ selection: { anchor: 20, head: 43 } });
    expect(ref.current.onSelectionChange).toHaveBeenLastCalledWith(RANGE);
    view.dispatch({ selection: { anchor: 5 } });
    expect(ref.current.onSelectionChange).toHaveBeenLastCalledWith(null);
    view.destroy();
  });

  it('normalises a backwards selection', () => {
    const { view, ref } = makeView();
    view.dispatch({ selection: { anchor: 43, head: 20 } });
    expect(ref.current.onSelectionChange).toHaveBeenLastCalledWith(RANGE);
    view.destroy();
  });

  it('stores the overlay and clears it when the document changes', () => {
    const { view } = makeView();
    view.dispatch({ effects: setRewriteOverlay.of(overlay()) });
    expect(view.state.field(rewriteOverlayField)?.phase).toBe('prompting');
    view.dispatch({ changes: { from: 0, insert: 'X' } });
    expect(view.state.field(rewriteOverlayField)).toBeNull();
    view.destroy();
  });

  it('reports a document change to the host, except the accept transaction itself', () => {
    const { view, ref } = makeView();
    view.dispatch({ changes: { from: 0, insert: 'X' } });
    expect(ref.current.onDocChanged).toHaveBeenCalledTimes(1);

    // Accept edits the document on purpose; the layer must not treat its own
    // splice as the external change that invalidates the range.
    view.dispatch({ changes: { from: 0, insert: 'Y' }, annotations: acceptTx.of(true) });
    expect(ref.current.onDocChanged).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('tints the selection while prompting and leaves the text in the DOM', () => {
    const { view } = makeView();
    view.dispatch({ effects: setRewriteOverlay.of(overlay()) });
    const mark = view.contentDOM.querySelector('.cm-rewrite-selection');
    expect(mark?.textContent).toBe('She waited by the door.');
    view.destroy();
  });

  it('replaces the range with the streamed text while streaming', () => {
    const { view } = makeView();
    view.dispatch({
      effects: setRewriteOverlay.of(overlay({ phase: 'streaming', replacement: 'She fro' })),
    });
    const widget = view.contentDOM.querySelector('.cm-rewrite-stream');
    expect(widget?.textContent).toContain('She fro');
    expect(view.contentDOM.textContent).not.toContain('She waited by the door.');
    expect(view.state.doc.toString()).toBe(TEXT); // the document itself is untouched
    view.destroy();
  });

  it('renders a word diff while reviewing, or the clean result when the diff is off', () => {
    const { view } = makeView();
    const reviewing = overlay({ phase: 'reviewing', replacement: 'She froze by the door.' });
    view.dispatch({ effects: setRewriteOverlay.of(reviewing) });
    expect(view.contentDOM.querySelector('.cm-rewrite-del')?.textContent).toBe('waited');
    expect(view.contentDOM.querySelector('.cm-rewrite-ins')?.textContent).toBe('froze');

    view.dispatch({ effects: setRewriteOverlay.of({ ...reviewing, showDiff: false }) });
    expect(view.contentDOM.querySelector('.cm-rewrite-del')).toBeNull();
    expect(view.contentDOM.querySelector('.cm-rewrite-result')?.textContent).toBe('She froze by the door.');
    view.destroy();
  });

  it('shows the tinted original when reviewing ended in an error', () => {
    const { view } = makeView();
    view.dispatch({
      effects: setRewriteOverlay.of(overlay({ phase: 'reviewing', error: true })),
    });
    expect(view.contentDOM.querySelector('.cm-rewrite-selection')?.textContent).toBe(
      'She waited by the door.',
    );
    view.destroy();
  });

  it('routes Mod-k and Escape to the host', () => {
    const { view, ref } = makeView();
    // jsdom reports an empty navigator.platform, so CodeMirror maps Mod to Ctrl here.
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    );
    expect(ref.current.onRequestOpen).toHaveBeenCalled();
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ref.current.onEscape).toHaveBeenCalled();
    view.destroy();
  });
});
