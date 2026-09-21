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

// Colours are the design tokens from index.css: the AI's work in blue pencil,
// removals in proofreader's red, insertions in green.
export const diffTheme = EditorView.baseTheme({
  '.cm-rewrite-selection': {
    backgroundColor: 'var(--color-pencil-soft)',
    boxShadow: '0 0 0 2px var(--color-pencil-soft)',
    borderRadius: '2px',
  },
  '.cm-rewrite-widget': { whiteSpace: 'pre-wrap', borderRadius: '2px' },
  '.cm-rewrite-stream': {
    backgroundColor: 'var(--color-pencil-faint)',
    color: 'var(--color-pencil-strong)',
    boxShadow: '0 0 0 2px var(--color-pencil-faint)',
  },
  '.cm-rewrite-result': {
    backgroundColor: 'var(--color-pencil-faint)',
    boxShadow: '0 0 0 2px var(--color-pencil-faint)',
  },
  '.cm-rewrite-diff': {
    backgroundColor: 'var(--color-pencil-faint)',
    boxShadow: '0 0 0 2px var(--color-pencil-faint)',
  },
  '.cm-rewrite-del': {
    backgroundColor: 'var(--color-diff-del-bg)',
    color: 'var(--color-diff-del)',
    textDecoration: 'line-through',
    textDecorationThickness: '1px',
  },
  '.cm-rewrite-ins': {
    backgroundColor: 'var(--color-diff-ins-bg)',
    color: 'var(--color-diff-ins)',
  },
  '.cm-rewrite-caret': {
    display: 'inline-block',
    width: '2px',
    height: '1em',
    verticalAlign: 'text-bottom',
    marginLeft: '1px',
    backgroundColor: 'var(--color-pencil)',
    animation: 'cm-rewrite-blink 1s steps(2, start) infinite',
  },
  '@keyframes cm-rewrite-blink': { to: { visibility: 'hidden' } },
});
