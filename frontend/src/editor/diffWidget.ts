// The inline widget that shows proposed prose over the document without
// changing it: the streamed text while it arrives, then a word diff (or the
// clean result) for review. Shared by selection rewrite and chat proposals.
import { EditorView, WidgetType } from '@codemirror/view';
import { wordDiff } from '../lib/rewrite';

export interface DiffContent {
  phase: 'streaming' | 'reviewing';
  original: string;
  replacement: string;
  showDiff: boolean;
}

export class DiffWidget extends WidgetType {
  constructor(readonly content: DiffContent) {
    super();
  }

  eq(other: DiffWidget) {
    const a = this.content;
    const b = other.content;
    return (
      a.phase === b.phase &&
      a.replacement === b.replacement &&
      a.original === b.original &&
      a.showDiff === b.showDiff
    );
  }

  toDOM() {
    const { phase, original, replacement, showDiff } = this.content;
    const root = document.createElement('span');
    root.className = 'cm-rewrite-widget';

    if (phase === 'streaming') {
      root.classList.add('cm-rewrite-stream');
      root.appendChild(document.createTextNode(replacement));
      const caret = document.createElement('span');
      caret.className = 'cm-rewrite-caret';
      root.appendChild(caret);
      return root;
    }

    if (!showDiff) {
      root.classList.add('cm-rewrite-result');
      root.textContent = replacement;
      return root;
    }

    root.classList.add('cm-rewrite-diff');
    for (const part of wordDiff(original, replacement)) {
      const span = document.createElement('span');
      if (part.removed) span.className = 'cm-rewrite-del';
      else if (part.added) span.className = 'cm-rewrite-ins';
      span.textContent = part.value;
      root.appendChild(span);
    }
    return root;
  }

  ignoreEvent() {
    return false;
  }
}

export const diffTheme = EditorView.baseTheme({
  '.cm-rewrite-selection': {
    backgroundColor: '#ede9fe',
    boxShadow: '0 0 0 2px #ede9fe',
    borderRadius: '2px',
  },
  '.cm-rewrite-widget': { whiteSpace: 'pre-wrap', borderRadius: '2px' },
  '.cm-rewrite-stream': { backgroundColor: '#ede9fe', color: '#4c1d95', boxShadow: '0 0 0 2px #ede9fe' },
  '.cm-rewrite-result': { backgroundColor: '#ede9fe', boxShadow: '0 0 0 2px #ede9fe' },
  '.cm-rewrite-diff': { boxShadow: '0 0 0 2px #f5f3ff', backgroundColor: '#f5f3ff' },
  '.cm-rewrite-del': {
    backgroundColor: '#ffe4e6',
    color: '#be123c',
    textDecoration: 'line-through',
    textDecorationColor: '#fb7185',
  },
  '.cm-rewrite-ins': { backgroundColor: '#dcfce7', color: '#15803d' },
  '.cm-rewrite-caret': {
    display: 'inline-block',
    width: '2px',
    height: '1em',
    verticalAlign: 'text-bottom',
    marginLeft: '1px',
    backgroundColor: '#7c3aed',
    animation: 'cm-rewrite-blink 1s steps(2, start) infinite',
  },
  '@keyframes cm-rewrite-blink': { to: { visibility: 'hidden' } },
});
