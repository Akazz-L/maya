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
      this.button(`✓ Accept`, `Accept fix ${number}`, 'cm-suggestion-accept', () =>
        this.host.current.onAccept(index),
      ),
    );
    actions.appendChild(
      this.button(`✕ Discard`, `Discard fix ${number}`, 'cm-suggestion-discard', () =>
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

export const suggestionTheme = EditorView.baseTheme({
  '.cm-suggestion': { whiteSpace: 'pre-wrap' },
  '.cm-suggestion-diff': {
    borderRadius: '2px',
    backgroundColor: '#f5f3ff',
    boxShadow: '0 0 0 2px #f5f3ff',
  },
  '.cm-suggestion-card': {
    display: 'block',
    margin: '6px 0 10px',
    padding: '7px 9px',
    borderRadius: '8px',
    border: '1px solid #ddd6fe',
    borderLeft: '3px solid #a78bfa',
    backgroundColor: '#fbfaff',
    font: '500 12px/1.45 ui-sans-serif, system-ui, sans-serif',
    whiteSpace: 'normal',
    maxWidth: '34rem',
  },
  '.cm-suggestion-critical': { borderLeftColor: '#f43f5e' },
  '.cm-suggestion-minor': { borderLeftColor: '#f59e0b' },
  '.cm-suggestion-style': { borderLeftColor: '#a78bfa' },
  '.cm-suggestion-head': {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '10.5px',
    fontWeight: '600',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#6b7280',
  },
  '.cm-suggestion-dot': {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#a78bfa',
  },
  '.cm-suggestion-critical .cm-suggestion-dot': { backgroundColor: '#f43f5e' },
  '.cm-suggestion-minor .cm-suggestion-dot': { backgroundColor: '#f59e0b' },
  '.cm-suggestion-why': { display: 'block', marginTop: '3px', color: '#374151', fontWeight: '400' },
  '.cm-suggestion-actions': { display: 'flex', gap: '5px', marginTop: '7px' },
  '.cm-suggestion-actions button': {
    borderRadius: '6px',
    border: '1px solid transparent',
    padding: '2px 8px',
    font: '500 11.5px ui-sans-serif, system-ui, sans-serif',
    cursor: 'pointer',
  },
  '.cm-suggestion-accept': { backgroundColor: '#7c3aed', color: '#fff' },
  '.cm-suggestion-accept:hover': { backgroundColor: '#6d28d9' },
  '.cm-suggestion-discard': { backgroundColor: '#fff', borderColor: '#e5e7eb', color: '#4b5563' },
  '.cm-suggestion-discard:hover': { backgroundColor: '#f9fafb' },
});
