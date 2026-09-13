// Renders the selection-rewrite flow inside the document without touching it.
// The document is only changed by the one transaction that accepts a rewrite;
// until then the original text sits underneath a decoration.
import { Annotation, Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import type { TextRange } from '../lib/rewrite';
import { DiffWidget, diffTheme } from './diffWidget';

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

const selectionMark = Decoration.mark({ class: 'cm-rewrite-selection' });

const decorations = EditorView.decorations.compute([rewriteOverlayField], (state): DecorationSet => {
  const o = state.field(rewriteOverlayField);
  if (!o || o.range.from >= o.range.to) return Decoration.none;
  // An errored review shows the untouched text, so the writer sees exactly
  // what Retry will act on.
  if (o.phase === 'prompting' || o.error) {
    return Decoration.set(selectionMark.range(o.range.from, o.range.to));
  }
  const widget = new DiffWidget({
    phase: o.phase,
    original: o.original,
    replacement: o.replacement,
    showDiff: o.showDiff,
  });
  return Decoration.set(Decoration.replace({ widget }).range(o.range.from, o.range.to));
});

function currentRange(view: EditorView): TextRange | null {
  const { from, to } = view.state.selection.main;
  return from === to ? null : { from, to };
}

export function rewriteExtension(host: { current: RewriteHost }): Extension {
  return [
    rewriteOverlayField,
    decorations,
    diffTheme,
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
