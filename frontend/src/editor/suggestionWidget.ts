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
    head.appendChild(
      document.createTextNode(
        `${severity ? SEVERITY_LABEL[severity] : 'Suggestion'} · ${number} of ${total}`,
      ),
    );
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

const SANS = 'var(--font-sans)';

// A margin note under the passage it concerns: the edge colour says how much
// the fix matters, the rest is iris because the note is the AI's.
export const suggestionTheme = EditorView.baseTheme({
  '.cm-suggestion': { whiteSpace: 'pre-wrap' },
  '.cm-suggestion-diff': {
    borderRadius: '2px',
    backgroundColor: 'color-mix(in oklab, var(--ai-soft) 55%, transparent)',
    boxShadow: '0 0 0 2px color-mix(in oklab, var(--ai-soft) 55%, transparent)',
  },
  '.cm-suggestion-card': {
    display: 'block',
    margin: '8px 0 14px',
    padding: '10px 12px',
    borderRadius: '10px',
    border: '1px solid var(--ai-line)',
    borderLeft: '3px solid var(--ai)',
    backgroundColor: 'var(--raised)',
    boxShadow: '0 1px 2px rgb(29 36 51 / 0.06)',
    font: `400 13px/1.5 ${SANS}`,
    whiteSpace: 'normal',
    maxWidth: '34rem',
  },
  '.cm-suggestion-critical': { borderLeftColor: 'var(--danger)' },
  '.cm-suggestion-minor': { borderLeftColor: 'var(--warn)' },
  '.cm-suggestion-style': { borderLeftColor: 'var(--ai)' },
  '.cm-suggestion-head': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--ink-2)',
  },
  '.cm-suggestion-dot': {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--ai)',
  },
  '.cm-suggestion-critical .cm-suggestion-dot': { backgroundColor: 'var(--danger)' },
  '.cm-suggestion-minor .cm-suggestion-dot': { backgroundColor: 'var(--warn)' },
  '.cm-suggestion-why': { display: 'block', marginTop: '3px', color: 'var(--ink)' },
  '.cm-suggestion-actions': { display: 'flex', gap: '6px', marginTop: '9px' },
  '.cm-suggestion-actions button': {
    height: '26px',
    borderRadius: '7px',
    border: '1px solid transparent',
    padding: '0 10px',
    font: `500 12px ${SANS}`,
    cursor: 'pointer',
    transition: 'background-color 150ms',
  },
  '.cm-suggestion-accept': { backgroundColor: 'var(--ai)', color: 'var(--on-ai)' },
  '.cm-suggestion-accept:hover': { backgroundColor: 'var(--ai-hover)' },
  '.cm-suggestion-discard': {
    backgroundColor: 'transparent',
    borderColor: 'var(--line)',
    color: 'var(--ink-2)',
  },
  '.cm-suggestion-discard:hover': { backgroundColor: 'var(--surface)', color: 'var(--ink)' },
  '.cm-suggestion-actions button:focus-visible': {
    outline: '2px solid var(--accent)',
    outlineOffset: '2px',
  },
});
