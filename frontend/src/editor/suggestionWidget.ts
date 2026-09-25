// One reviewer's fix, drawn where it applies: the word diff inline, and under
// it a card naming the problem with Accept and Discard. Plain DOM rather than a
// React portal, so the widget lives and dies with the decoration; the buttons
// call back through the host box the extension was built with, exactly as the
// rewrite extension reaches its React layer.
import { EditorView, WidgetType } from '@codemirror/view';
import type { Severity } from '../api/types';
import { wordDiff } from '../lib/rewrite';

export interface SuggestionHost {
  onAccept: (index: number) => void;
  onDiscard: (index: number) => void;
}

export interface SuggestionContent {
  /** Position in the stored suggestion set — how an outcome is recorded. */
  index: number;
  /** Where it sits in the review order the writer sees: "Fix 2 of 4". */
  number: number;
  total: number;
  original: string;
  replacement: string;
  explanation: string;
  severity: Severity | null;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  minor: 'Minor',
  style: 'Style',
};

export class SuggestionWidget extends WidgetType {
  constructor(
    readonly content: SuggestionContent,
    readonly host: { current: SuggestionHost },
  ) {
    super();
  }

  eq(other: SuggestionWidget) {
    const a = this.content;
    const b = other.content;
    return (
      a.index === b.index &&
      a.number === b.number &&
      a.total === b.total &&
      a.original === b.original &&
      a.replacement === b.replacement &&
      a.explanation === b.explanation &&
      a.severity === b.severity
    );
  }

  toDOM() {
    const { index, number, total, original, replacement, explanation, severity } = this.content;

    const root = document.createElement('span');
    root.className = 'cm-suggestion';

    const diff = document.createElement('span');
    diff.className = 'cm-suggestion-diff';
    for (const part of wordDiff(original, replacement)) {
      const span = document.createElement('span');
      if (part.removed) span.className = 'cm-rewrite-del';
      else if (part.added) span.className = 'cm-rewrite-ins';
      span.textContent = part.value;
      diff.appendChild(span);
    }
    root.appendChild(diff);

    const card = document.createElement('span');
    card.className = 'cm-suggestion-card';
    if (severity) card.classList.add(`cm-suggestion-${severity}`);

    const head = document.createElement('span');
    head.className = 'cm-suggestion-head';
    const dot = document.createElement('span');
    dot.className = 'cm-suggestion-dot';
    head.appendChild(dot);
    head.appendChild(document.createTextNode(severity ? SEVERITY_LABEL[severity] : 'Suggestion'));
    const count = document.createElement('span');
    count.className = 'cm-suggestion-count';
    count.textContent = `Fix ${number} of ${total}`;
    head.appendChild(count);
    card.appendChild(head);

    const why = document.createElement('span');
    why.className = 'cm-suggestion-why';
    why.textContent = explanation;
    card.appendChild(why);

    const actions = document.createElement('span');
    actions.className = 'cm-suggestion-actions';
    // Labelled by number, so a chapter under review has one unambiguous Accept
    // per fix for both a screen reader and a test.
    actions.appendChild(
      this.button('Accept', `Accept fix ${number}`, 'cm-suggestion-accept', () =>
        this.host.current.onAccept(index),
      ),
    );
    actions.appendChild(
      this.button('Discard', `Discard fix ${number}`, 'cm-suggestion-discard', () =>
        this.host.current.onDiscard(index),
      ),
    );
    card.appendChild(actions);

    root.appendChild(card);
    return root;
  }

  private button(text: string, label: string, className: string, onClick: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.addEventListener('mousedown', (e) => e.preventDefault()); // keep the click off the selection
    button.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    return button;
  }

  // The card is UI, not text: CodeMirror should not read its clicks as editing.
  ignoreEvent() {
    return true;
  }
}

// Colours are the design tokens from index.css. The card's left rule carries
// the severity, so the writer can triage a set at a glance.
export const suggestionTheme = EditorView.baseTheme({
  '.cm-suggestion': { whiteSpace: 'pre-wrap' },
  '.cm-suggestion-diff': {
    borderRadius: '2px',
    backgroundColor: 'var(--color-pencil-faint)',
    boxShadow: '0 0 0 2px var(--color-pencil-faint)',
  },
  '.cm-suggestion-card': {
    display: 'block',
    margin: '8px 0 12px',
    padding: '9px 11px 10px',
    borderRadius: 'var(--radius-panel)',
    border: '1px solid var(--color-line)',
    borderLeft: '3px solid var(--color-pencil)',
    backgroundColor: 'var(--color-surface)',
    boxShadow: 'var(--shadow-float)',
    font: '400 13px/1.5 var(--font-sans)',
    color: 'var(--color-ink)',
    whiteSpace: 'normal',
    maxWidth: '34rem',
  },
  '.cm-suggestion-critical': { borderLeftColor: 'var(--color-danger)' },
  '.cm-suggestion-minor': { borderLeftColor: 'var(--color-warning)' },
  '.cm-suggestion-style': { borderLeftColor: 'var(--color-pencil)' },
  '.cm-suggestion-head': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--color-ink)',
  },
  '.cm-suggestion-count': {
    marginLeft: 'auto',
    fontWeight: '400',
    color: 'var(--color-ink-subtle)',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-suggestion-dot': {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: 'var(--color-pencil)',
  },
  '.cm-suggestion-critical .cm-suggestion-dot': { backgroundColor: 'var(--color-danger)' },
  '.cm-suggestion-minor .cm-suggestion-dot': { backgroundColor: 'var(--color-warning)' },
  '.cm-suggestion-why': { display: 'block', marginTop: '3px', color: 'var(--color-ink-muted)' },
  '.cm-suggestion-actions': { display: 'flex', gap: '6px', marginTop: '9px' },
  '.cm-suggestion-actions button': {
    height: '26px',
    borderRadius: 'var(--radius-control)',
    border: '1px solid transparent',
    padding: '0 10px',
    font: '500 12px var(--font-sans)',
    cursor: 'pointer',
    transition: 'background-color 150ms, border-color 150ms',
  },
  '.cm-suggestion-actions button:focus-visible': {
    outline: '2px solid var(--color-pencil)',
    outlineOffset: '2px',
  },
  '.cm-suggestion-accept': { backgroundColor: 'var(--color-pencil)', color: '#fff' },
  '.cm-suggestion-accept:hover': { backgroundColor: 'var(--color-pencil-strong)' },
  // Scoped like the rule above, which would otherwise win and hide the border.
  '.cm-suggestion-actions .cm-suggestion-discard': {
    backgroundColor: 'var(--color-surface)',
    borderColor: 'var(--color-line)',
    color: 'var(--color-ink-muted)',
  },
  '.cm-suggestion-discard:hover': { backgroundColor: 'var(--color-surface-muted)' },
});
