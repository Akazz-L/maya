// Pinned to the editor while a chat proposal is under review: a whole-chapter
// draft, or what is left of a review pass's fixes. The per-fix buttons live on
// the cards in the prose; this bar is for the whole thing at once. Accept is
// focused on mount so Enter accepts; the layer also listens for Escape and ⌘↵.
import { useEffect, useRef } from 'react';

export interface ProposalReviewBarProps {
  /** What is under review: "Chat proposal", or "Continuity check · 2 of 4 left". */
  title: string;
  onAccept: () => void;
  onDiscard: () => void;
  acceptLabel?: string;
  discardLabel?: string;
  hint?: string;
  /** Diff toggle, for a whole-chapter proposal only; a fix is always a diff. */
  showDiff?: boolean;
  onToggleDiff?: () => void;
}

const ghost =
  'rounded-lg px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800';

export function ProposalReviewBar({
  title,
  onAccept,
  onDiscard,
  acceptLabel = '✓ Accept',
  discardLabel = '✕ Discard',
  hint = '⌘↵ accept · esc discard',
  showDiff,
  onToggleDiff,
}: ProposalReviewBarProps) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, []);

  return (
    <div
      role="toolbar"
      aria-label="Review proposal"
      className="flex items-center gap-1 rounded-xl border border-violet-200 bg-white p-1.5 shadow-lg shadow-violet-900/10"
    >
      <span className="px-1.5 text-xs font-medium text-violet-700">{title}</span>
      <button
        ref={primary}
        type="button"
        onClick={onAccept}
        className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700"
      >
        {acceptLabel}
      </button>
      <button type="button" onClick={onDiscard} className={ghost}>
        {discardLabel}
      </button>
      {onToggleDiff && (
        <>
          <span className="mx-0.5 h-4 w-px bg-gray-200" aria-hidden />
          <button type="button" onClick={onToggleDiff} className={ghost}>
            {showDiff ? 'Show result' : 'Show diff'}
          </button>
        </>
      )}
      <span className="pl-1 pr-1.5 text-[11px] text-gray-400">{hint}</span>
    </div>
  );
}
