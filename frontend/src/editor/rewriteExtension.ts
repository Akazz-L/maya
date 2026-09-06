// Renders the selection-rewrite flow inside the document without touching it.
// The document is only changed by the one transaction that accepts a rewrite;
// until then the original text sits underneath a decoration.
import { Annotation, Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from '@codemirror/view';
import { wordDiff, type TextRange } from '../lib/rewrite';

export interface RewriteOverlay {
  range: TextRange;
  phase: 'prompting' | 'streaming' | 'reviewing';
  original: string;
  replacement: string;
  showDiff: boolean;
  error: boolean;
}

export interface RewriteHost {
  /** The editor's selection changed; null when it is empty. */
  onSelectionChange(range: TextRange | null): void;
  /** The document changed under the overlay — never for the accept transaction. */
  onDocChanged(): void;
  /** ⌘K / Ctrl+K pressed. Return true if handled. */
  onRequestOpen(): boolean;
  /** Escape pressed in the editor. Return true if handled. */
  onEscape(): boolean;
}

export const setRewriteOverlay = StateEffect.define<RewriteOverlay | null>();

/** Marks the one transaction that accepts a rewrite, so it is not mistaken for
 * an external edit that invalidates the range. */
export const acceptTx = Annotation.define<boolean>();

export const rewriteOverlayField = StateField.define<RewriteOverlay | null>({
  create: () => null,
  update(value, tr) {
    // Any document change invalidates the range. Accept sends its change and
    // a null overlay in one transaction; an external replacement (a finished
    // generation) simply drops the overlay.
    if (tr.docChanged) value = null;
    for (const e of tr.effects) if (e.is(setRewriteOverlay)) value = e.value;
    return value;
  },
});

class RewriteWidget extends WidgetType {
  constructor(readonly overlay: RewriteOverlay) {
    super();
  }

  // `error` is left out on purpose: decorations() never builds a widget when it
  // is true, so two widgets can never differ by it alone.
  eq(other: RewriteWidget) {
    const a = this.overlay;
    const b = other.overlay;
    return (
      a.phase === b.phase &&
      a.replacement === b.replacement &&
      a.original === b.original &&
      a.showDiff === b.showDiff
    );
  }

  toDOM() {
    const { phase, original, replacement, showDiff } = this.overlay;
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

const selectionMark = Decoration.mark({ class: 'cm-rewrite-selection' });

const decorations = EditorView.decorations.compute([rewriteOverlayField], (state): DecorationSet => {
  const o = state.field(rewriteOverlayField);
  if (!o || o.range.from >= o.range.to) return Decoration.none;
  if (o.phase === 'prompting' || o.error) {
    return Decoration.set(selectionMark.range(o.range.from, o.range.to));
  }
  return Decoration.set(
    Decoration.replace({ widget: new RewriteWidget(o) }).range(o.range.from, o.range.to),
  );
});

const theme = EditorView.baseTheme({
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

function currentRange(view: EditorView): TextRange | null {
  const { from, to } = view.state.selection.main;
  return from === to ? null : { from, to };
}

export function rewriteExtension(host: { current: RewriteHost }): Extension {
  return [
    rewriteOverlayField,
    decorations,
    theme,
    EditorView.updateListener.of((u) => {
      if (u.selectionSet || u.docChanged) host.current.onSelectionChange(currentRange(u.view));
      if (u.docChanged && !u.transactions.some((t) => t.annotation(acceptTx))) {
        host.current.onDocChanged();
      }
    }),
    Prec.highest(
      keymap.of([
        { key: 'Mod-k', run: () => host.current.onRequestOpen() },
        { key: 'Escape', run: () => host.current.onEscape() },
      ]),
    ),
  ];
}
