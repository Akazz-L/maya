// Draws a chat proposal inside the document without touching it. Kept apart
// from the rewrite overlay so neither flow can clear the other's decoration.
// The document only changes through ProposalLayer's Accept transaction.
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { DiffWidget, diffTheme } from './diffWidget';

export interface ProposalOverlay {
  /** The changed span in the current document; empty for a pure insertion. */
  from: number;
  to: number;
  original: string;
  replacement: string;
  phase: 'streaming' | 'reviewing';
  showDiff: boolean;
}

export const setProposalOverlay = StateEffect.define<ProposalOverlay | null>();

export const proposalOverlayField = StateField.define<ProposalOverlay | null>({
  create: () => null,
  update(value, tr) {
    // Offsets only mean something against the document they were computed on.
    if (tr.docChanged) value = null;
    for (const e of tr.effects) if (e.is(setProposalOverlay)) value = e.value;
    return value;
  },
});

const decorations = EditorView.decorations.compute([proposalOverlayField], (state): DecorationSet => {
  const o = state.field(proposalOverlayField);
  if (!o) return Decoration.none;
  const widget = new DiffWidget(o);
  if (o.from === o.to) {
    return o.replacement
      ? Decoration.set(Decoration.widget({ widget, side: 1 }).range(o.from))
      : Decoration.none;
  }
  return Decoration.set(Decoration.replace({ widget }).range(o.from, o.to));
});

export function proposalExtension(): Extension {
  return [proposalOverlayField, decorations, diffTheme];
}
