// Pinned to the editor while a chat proposal is under review. Accept is
// focused on mount so Enter accepts; the layer also listens for Escape and ⌘↵.
import { useEffect, useRef } from 'react';

export interface ProposalReviewBarProps {
  showDiff: boolean;
  onToggleDiff: () => void;
  onAccept: () => void;
  onDiscard: () => void;
}

const ghost =
  'rounded-lg px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800';

export function ProposalReviewBar({ showDiff, onToggleDiff, onAccept, onDiscard }: ProposalReviewBarProps) {
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
      <span className="px-1.5 text-xs font-medium text-violet-700">Chat proposal</span>
      <button
        ref={primary}
        type="button"
        onClick={onAccept}
        className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700"
      >
        ✓ Accept
      </button>
      <button type="button" onClick={onDiscard} className={ghost}>
        ✕ Discard
      </button>
      <span className="mx-0.5 h-4 w-px bg-gray-200" aria-hidden />
      <button type="button" onClick={onToggleDiff} className={ghost}>
        {showDiff ? 'Show result' : 'Show diff'}
      </button>
      <span className="pl-1 pr-1.5 text-[11px] text-gray-400">⌘↵ accept · esc discard</span>
    </div>
  );
}
