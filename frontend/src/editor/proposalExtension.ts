// Draws a chat proposal inside the document without touching it. Kept apart
// from the rewrite overlay so neither flow can clear the other's decoration.
//
// A write proposal is one span shown as a diff. A suggestion set is several,
// each with its own card and its own Accept — so the field holds a list, and the
// document only changes through the transactions ProposalLayer dispatches.
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Severity } from '../api/types';
import { DiffWidget, diffTheme } from './diffWidget';
import { SuggestionWidget, suggestionTheme, type SuggestionHost } from './suggestionWidget';

/** The whole-chapter proposal: one changed span, streaming or under review. */
export interface WriteOverlay {
  kind: 'write';
  /** The changed span in the current document; empty for a pure insertion. */
  from: number;
  to: number;
  original: string;
  replacement: string;
  phase: 'streaming' | 'reviewing';
  showDiff: boolean;
}

export interface OverlayFix {
  /** Position in the stored suggestion set. */
  index: number;
  from: number;
  to: number;
  original: string;
  replacement: string;
  explanation: string;
  severity: Severity | null;
}

/** A review pass's fixes, at their live offsets in the current document. */
export interface SuggestionsOverlay {
  kind: 'suggestions';
  fixes: OverlayFix[];
  /** How many fixes the pass proposed, so a card can say "2 of 4". */
  total: number;
}

export type ProposalOverlay = WriteOverlay | SuggestionsOverlay;

export const setProposalOverlay = StateEffect.define<ProposalOverlay | null>();

/**
 * Where the writer should be looking: the next fix to review, or the one span a
 * whole-chapter proposal changes.
 *
 * A review pass finds things anywhere in the chapter while the review bar sits
 * at the top of the editor, so without scrolling here the writer is told there
 * are fixes and shown none of them.
 */
export function revealPos(overlay: ProposalOverlay): number | null {
  if (overlay.kind === 'write') return overlay.from;
  return overlay.fixes.length ? overlay.fixes[0].from : null;
}

export const proposalOverlayField = StateField.define<ProposalOverlay | null>({
  create: () => null,
  update(value, tr) {
    // Offsets only mean something against the document they were computed on.
    // Accepting one fix re-dispatches the rest in the same transaction, so the
    // overlay is replaced rather than dropped.
    if (tr.docChanged) value = null;
    for (const e of tr.effects) if (e.is(setProposalOverlay)) value = e.value;
    return value;
  },
});

function writeDecorations(overlay: WriteOverlay): DecorationSet {
  const widget = new DiffWidget(overlay);
  if (overlay.from === overlay.to) {
    return overlay.replacement
      ? Decoration.set(Decoration.widget({ widget, side: 1 }).range(overlay.from))
      : Decoration.none;
  }
  return Decoration.set(Decoration.replace({ widget }).range(overlay.from, overlay.to));
}

function suggestionDecorations(
  overlay: SuggestionsOverlay,
  host: { current: SuggestionHost },
): DecorationSet {
  return Decoration.set(
    overlay.fixes.map((fix) =>
      Decoration.replace({
        widget: new SuggestionWidget(
          {
            index: fix.index,
            number: fix.index + 1,
            total: overlay.total,
            original: fix.original,
            replacement: fix.replacement,
            explanation: fix.explanation,
            severity: fix.severity,
          },
          host,
        ),
      }).range(fix.from, fix.to),
    ),
    true, // sort: the fixes arrive in document order, but do not rely on it
  );
}

export function proposalExtension(host: { current: SuggestionHost }): Extension {
  return [
    proposalOverlayField,
    EditorView.decorations.compute([proposalOverlayField], (state): DecorationSet => {
      const overlay = state.field(proposalOverlayField);
      if (!overlay) return Decoration.none;
      return overlay.kind === 'write'
        ? writeDecorations(overlay)
        : suggestionDecorations(overlay, host);
    }),
    diffTheme,
    suggestionTheme,
  ];
}
