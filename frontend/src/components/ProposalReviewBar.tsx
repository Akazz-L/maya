// Pinned to the editor while a chat proposal is under review: a whole-chapter
// draft, or what is left of a review pass's fixes. The per-fix buttons live on
// the cards in the prose; this bar is for the whole thing at once. Accept is
// focused on mount so Enter accepts; the layer also listens for Escape and ⌘↵.
import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { BarButton, BarDivider, BarHint, FloatingBar } from './ui/review';

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

export function ProposalReviewBar({
  title,
  onAccept,
  onDiscard,
  acceptLabel = 'Accept',
  discardLabel = 'Discard',
  hint = '⌘↵ accept · esc discard',
  showDiff,
  onToggleDiff,
}: ProposalReviewBarProps) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, []);

  return (
    <FloatingBar role="toolbar" aria-label="Review proposal">
      <span className="px-1.5 text-xs font-semibold text-ai-ink">{title}</span>
      <BarButton ref={primary} primary onClick={onAccept}>
        <Check aria-hidden />
        {acceptLabel}
      </BarButton>
      <BarButton onClick={onDiscard}>
        <X aria-hidden />
        {discardLabel}
      </BarButton>
      {onToggleDiff && (
        <>
          <BarDivider />
          <BarButton onClick={onToggleDiff}>{showDiff ? 'Show result' : 'Show diff'}</BarButton>
        </>
      )}
      <BarHint>{hint}</BarHint>
    </FloatingBar>
  );
}
