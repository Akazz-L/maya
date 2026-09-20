// Shows a chat proposal in the chapter it would change.
//
// A whole-chapter draft streams into place while the model writes it, then waits
// as a single diff. A review pass instead draws each of its fixes where it
// applies, with its own card and its own Accept — taking one leaves the others
// live, shifted by whatever the splice added or removed. The document only ever
// changes through the transactions dispatched here, which reach the editor's
// autosave and undo history like any other edit.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import type { ProposalOutcome, Suggestion } from '../api/types';
import {
  revealPos,
  setProposalOverlay,
  type ProposalOverlay,
  type SuggestionsOverlay,
} from '../editor/proposalExtension';
import type { SuggestionHost } from '../editor/suggestionWidget';
import { changedSpan, liveFixes, shiftFixes, sha256Hex, streamingBody, type LiveFix } from '../lib/chat';
import { ProposalReviewBar } from './ProposalReviewBar';

export type ProposalView =
  | { phase: 'streaming'; mode: 'replace' | 'append' | null; text: string }
  | {
      phase: 'reviewing';
      kind: 'write';
      /** The whole chapter as the proposal would leave it. */
      proposed: string;
      /** sha256 of the body the proposal was computed against. */
      baseHash: string;
      /** Where the review starts: a diff suits edits, the clean text a new draft. */
      showDiff: boolean;
    }
  | {
      phase: 'reviewing';
      kind: 'suggestions';
      /** Every fix the pass proposed, resolved ones included, so a card can
       *  number itself the way the chat message counts them. */
      suggestions: Suggestion[];
      baseHash: string;
      /** What the pass is called, for the review bar: "Continuity check". */
      label?: string;
    };

export interface ProposalLayerProps {
  view: EditorView;
  proposal: ProposalView | null;
  /** The box the editor's proposal extension reads its callbacks from. */
  hostRef: { current: SuggestionHost };
  onResolve: (outcome: ProposalOutcome, indexes?: number[]) => void;
}

/** The unreviewed fixes of one proposal, at their live offsets. */
interface Live {
  key: string;
  live: LiveFix[];
}

/** The fixes left to review, or null once there are none to draw. */
function overlayFor(fixes: LiveFix[], total: number): SuggestionsOverlay | null {
  if (!fixes.length) return null;
  return {
    kind: 'suggestions',
    total,
    fixes: fixes.map((fix) => ({
      index: fix.index,
      from: fix.from,
      to: fix.to,
      original: fix.find,
      replacement: fix.replace,
      explanation: fix.explanation,
      severity: fix.severity,
    })),
  };
}

export function ProposalLayer({ view, proposal, hostRef, onResolve }: ProposalLayerProps) {
  const reviewing = proposal?.phase === 'reviewing' ? proposal : null;
  const write = reviewing?.kind === 'write' ? reviewing : null;
  const set = reviewing?.kind === 'suggestions' ? reviewing : null;

  // A toggle belongs to the proposal it was made on; a new one starts from its default.
  const [toggle, setToggle] = useState<{ proposed: string; showDiff: boolean } | null>(null);
  const showDiff = write && toggle?.proposed === write.proposed ? toggle.showDiff : (write?.showDiff ?? true);
  const applying = useRef(false);

  // The fixes as the editor holds them: identified by the proposal they came
  // from, so an outcome landing in the query cache does not reset their offsets.
  const setKey = set ? `${set.baseHash}:${set.suggestions.length}` : null;
  const [fixes, setFixes] = useState<Live | null>(null);
  // Mirrored in a ref, written together with the state: a card's button reads
  // the list at click time, and two clicks in one tick must not both act on the
  // offsets from before the first.
  const fixesRef = useRef<Live | null>(null);
  const commit = useCallback((next: Live | null) => {
    fixesRef.current = next;
    setFixes(next);
  }, []);

  const latest = useRef({ onResolve });
  useEffect(() => {
    latest.current = { onResolve };
  });

  // A set arrives: take its offsets, but only after confirming the chapter is
  // still the text they were measured against. The editor is read-only while a
  // proposal shows, so nothing but a reload can break that — and if it did,
  // splicing by offset would corrupt the prose.
  useLayoutEffect(() => {
    // No set, or one already in hand: a stale entry for another proposal is
    // simply ignored below, so there is nothing to clear.
    if (!setKey || !set || fixesRef.current?.key === setKey) return;
    let current = true;
    const pending = liveFixes(set.suggestions);
    void sha256Hex(view.state.doc.toString()).then((hash) => {
      if (!current) return;
      if (hash === set.baseHash) {
        commit({ key: setKey, live: pending });
      } else {
        commit({ key: setKey, live: [] });
        latest.current.onResolve(
          'stale',
          pending.map((fix) => fix.index),
        );
      }
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setKey, view, commit]);

  const phase = proposal?.phase ?? null;
  const mode = proposal?.phase === 'streaming' ? proposal.mode : null;
  const text = proposal?.phase === 'streaming' ? proposal.text : null;
  const proposed = write?.proposed ?? null;
  const live = fixes?.key === setKey ? fixes.live : null;
  const total = set?.suggestions.length ?? 0;

  // The editor is read-only for as long as a proposal is shown, so the text the
  // overlay is computed against cannot move under it.
  useLayoutEffect(() => {
    let overlay: ProposalOverlay | null = null;
    if (live) {
      overlay = overlayFor(live, total);
    } else if (phase === 'streaming' || proposed !== null) {
      const base = view.state.doc.toString();
      const target =
        phase === 'streaming' ? streamingBody(base, mode, text ?? '') : (proposed ?? base);
      const span = changedSpan(base, target);
      if (span.from !== span.to || span.insert) {
        overlay = {
          kind: 'write',
          from: span.from,
          to: span.to,
          original: base.slice(span.from, span.to),
          replacement: span.insert,
          phase: phase === 'streaming' ? 'streaming' : 'reviewing',
          showDiff,
        };
      }
    }
    // A review pass finds things anywhere in the chapter, and the review bar is
    // pinned to the top of the editor: without this the writer is told there are
    // fixes to review and shown none of them, because the first one is a
    // thousand words below the fold. Runs again whenever the live set changes,
    // so resolving one fix brings the next into view.
    // Not while a draft streams: the text grows on every frame, and the editor
    // would chase it instead of letting the writer read.
    const streaming = overlay?.kind === 'write' && overlay.phase === 'streaming';
    const reveal = overlay && !streaming ? revealPos(overlay) : null;
    view.dispatch({
      effects:
        reveal === null
          ? setProposalOverlay.of(overlay)
          : [setProposalOverlay.of(overlay), EditorView.scrollIntoView(reveal, { y: 'center' })],
    });
  }, [view, phase, mode, text, proposed, showDiff, live, total]);

  // ── resolving a whole-chapter proposal ────────────────────────────────────

  const acceptWrite = async () => {
    if (!write || applying.current) return;
    applying.current = true;
    try {
      const current = view.state.doc.toString();
      if ((await sha256Hex(current)) !== write.baseHash) {
        onResolve('stale');
        return;
      }
      const { from, to, insert } = changedSpan(current, write.proposed);
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        effects: setProposalOverlay.of(null),
        userEvent: 'input.chat',
      });
      onResolve('accepted');
    } finally {
      applying.current = false;
    }
  };

  // ── resolving one fix ─────────────────────────────────────────────────────

  /** Take a fix out of the review without touching the prose. */
  const drop = useCallback(
    (index: number, outcome: ProposalOutcome) => {
      const current = fixesRef.current;
      if (!current) return;
      const remaining = current.live.filter((fix) => fix.index !== index);
      commit({ key: current.key, live: remaining });
      view.dispatch({ effects: setProposalOverlay.of(overlayFor(remaining, total)) });
      latest.current.onResolve(outcome, [index]);
    },
    [view, total, commit],
  );

  const acceptFix = useCallback(
    (index: number) => {
      const current = fixesRef.current;
      const fix = current?.live.find((f) => f.index === index);
      if (!current || !fix) return;
      // The span must still read as the passage the model quoted. It always
      // should — the prose is read-only under review — but splicing on a stale
      // offset would rewrite the wrong words, so this is checked, not assumed.
      if (view.state.sliceDoc(fix.from, fix.to) !== fix.find) {
        drop(index, 'stale');
        return;
      }
      const applied = { from: fix.from, to: fix.to, insert: fix.replace };
      const remaining = shiftFixes(
        current.live.filter((f) => f.index !== index),
        applied,
      );
      commit({ key: current.key, live: remaining });
      view.dispatch({
        changes: applied,
        selection: { anchor: fix.from + fix.replace.length },
        effects: setProposalOverlay.of(overlayFor(remaining, total)),
        userEvent: 'input.chat',
      });
      latest.current.onResolve('accepted', [index]);
    },
    [view, drop, total, commit],
  );

  const discardFix = useCallback((index: number) => drop(index, 'discarded'), [drop]);

  // ── resolving the whole set ───────────────────────────────────────────────

  const acceptAll = useCallback(() => {
    const current = fixesRef.current;
    if (!current?.live.length) return;
    const matching = current.live.filter(
      (fix) => view.state.sliceDoc(fix.from, fix.to) === fix.find,
    );
    const gone = current.live.filter((fix) => !matching.includes(fix));

    commit({ key: current.key, live: [] });
    view.dispatch({
      // Non-overlapping by construction, and read against the document as it is
      // now, so one transaction applies them all.
      changes: matching.map((fix) => ({ from: fix.from, to: fix.to, insert: fix.replace })),
      effects: setProposalOverlay.of(null),
      userEvent: 'input.chat',
    });
    if (matching.length)
      latest.current.onResolve(
        'accepted',
        matching.map((fix) => fix.index),
      );
    if (gone.length)
      latest.current.onResolve(
        'stale',
        gone.map((fix) => fix.index),
      );
  }, [view, commit]);

  const discardAll = useCallback(() => {
    const current = fixesRef.current;
    if (!current?.live.length) return;
    commit({ key: current.key, live: [] });
    view.dispatch({ effects: setProposalOverlay.of(null) });
    latest.current.onResolve(
      'discarded',
      current.live.map((fix) => fix.index),
    );
  }, [view, commit]);

  // ── keyboard ──────────────────────────────────────────────────────────────

  const keys = useRef({ acceptWrite, acceptAll, discardAll, onResolve, isSet: Boolean(set) });
  useEffect(() => {
    keys.current = { acceptWrite, acceptAll, discardAll, onResolve, isSet: Boolean(set) };
    // The cards live inside CodeMirror; this is how their buttons reach here.
    // Set after the commit, so a widget rendered this pass is already wired by
    // the time anything can click it.
    hostRef.current = { onAccept: acceptFix, onDiscard: discardFix };
  });

  useEffect(() => {
    if (phase !== 'reviewing') return;
    const onKey = (e: KeyboardEvent) => {
      // Text fields keep their own Escape and Enter.
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (keys.current.isSet) keys.current.discardAll();
        else keys.current.onResolve('discarded');
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (keys.current.isSet) keys.current.acceptAll();
        else void keys.current.acceptWrite();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (!proposal) return null;
  if (set && !live?.length) return null; // every fix reviewed; the bar goes with them

  return (
    <div className="absolute right-4 top-3 z-20">
      {proposal.phase === 'streaming' ? (
        <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs text-violet-700 shadow-lg shadow-violet-900/10">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" aria-hidden />
          Writing…
        </div>
      ) : set ? (
        <ProposalReviewBar
          title={`${set.label ?? 'Suggested fixes'} · ${live!.length} of ${total} left`}
          onAccept={acceptAll}
          onDiscard={discardAll}
          acceptLabel="✓ Accept all"
          discardLabel="✕ Discard all"
          hint="⌘↵ accept all · esc discard all"
        />
      ) : (
        <ProposalReviewBar
          title="Chat proposal"
          onAccept={() => void acceptWrite()}
          onDiscard={() => onResolve('discarded')}
          showDiff={showDiff}
          onToggleDiff={() => setToggle({ proposed: write!.proposed, showDiff: !showDiff })}
          hint="⌘↵ accept · esc discard"
        />
      )}
    </div>
  );
}
