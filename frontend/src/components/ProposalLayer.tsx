// Shows a chat proposal in the chapter it would change: streamed into place
// while the model writes it, then as a diff with Accept and Discard. The
// document changes only through Accept's single transaction, which reaches the
// editor's autosave and undo history like any other edit.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import type { ProposalOutcome } from '../api/types';
import { setProposalOverlay, type ProposalOverlay } from '../editor/proposalExtension';
import { changedSpan, sha256Hex, streamingBody } from '../lib/chat';
import { ProposalReviewBar } from './ProposalReviewBar';

export type ProposalView =
  | { phase: 'streaming'; mode: 'replace' | 'append' | null; text: string }
  | {
      phase: 'reviewing';
      /** The whole chapter as the proposal would leave it. */
      proposed: string;
      /** sha256 of the body the proposal was computed against. */
      baseHash: string;
      /** Where the review starts: a diff suits edits, the clean text a new draft. */
      showDiff: boolean;
    };

export interface ProposalLayerProps {
  view: EditorView;
  proposal: ProposalView | null;
  onResolve: (outcome: ProposalOutcome) => void;
}

export function ProposalLayer({ view, proposal, onResolve }: ProposalLayerProps) {
  const reviewing = proposal?.phase === 'reviewing' ? proposal : null;
  // A toggle belongs to the proposal it was made on; a new one starts from its default.
  const [toggle, setToggle] = useState<{ proposed: string; showDiff: boolean } | null>(null);
  const showDiff =
    reviewing && toggle?.proposed === reviewing.proposed ? toggle.showDiff : (reviewing?.showDiff ?? true);
  const applying = useRef(false);

  const phase = proposal?.phase ?? null;
  const mode = proposal?.phase === 'streaming' ? proposal.mode : null;
  const text = proposal?.phase === 'streaming' ? proposal.text : null;
  const proposed = reviewing?.proposed ?? null;

  // The editor is read-only for as long as a proposal is shown, so the text
  // the overlay is computed against cannot move under it.
  useLayoutEffect(() => {
    let overlay: ProposalOverlay | null = null;
    if (phase) {
      const base = view.state.doc.toString();
      const target = phase === 'streaming' ? streamingBody(base, mode, text ?? '') : (proposed ?? base);
      const span = changedSpan(base, target);
      if (span.from !== span.to || span.insert) {
        overlay = {
          from: span.from,
          to: span.to,
          original: base.slice(span.from, span.to),
          replacement: span.insert,
          phase,
          showDiff,
        };
      }
    }
    view.dispatch({ effects: setProposalOverlay.of(overlay) });
  }, [view, phase, mode, text, proposed, showDiff]);

  const accept = async () => {
    if (!reviewing || applying.current) return;
    applying.current = true;
    try {
      const current = view.state.doc.toString();
      if ((await sha256Hex(current)) !== reviewing.baseHash) {
        onResolve('stale');
        return;
      }
      const { from, to, insert } = changedSpan(current, reviewing.proposed);
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

  const latest = useRef({ accept, onResolve });
  useEffect(() => {
    latest.current = { accept, onResolve };
  });

  useEffect(() => {
    if (phase !== 'reviewing') return;
    const onKey = (e: KeyboardEvent) => {
      // Text fields keep their own Escape and Enter.
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        latest.current.onResolve('discarded');
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void latest.current.accept();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (!proposal) return null;

  return (
    <div className="absolute right-4 top-3 z-20">
      {proposal.phase === 'streaming' ? (
        <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs text-violet-700 shadow-lg shadow-violet-900/10">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" aria-hidden />
          Writing…
        </div>
      ) : (
        <ProposalReviewBar
          showDiff={showDiff}
          onToggleDiff={() => setToggle({ proposed: proposal.proposed, showDiff: !showDiff })}
          onAccept={() => void accept()}
          onDiscard={() => onResolve('discarded')}
        />
      )}
    </div>
  );
}
