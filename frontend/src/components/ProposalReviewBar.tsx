// Pinned to the editor while a chat proposal is under review: a whole-chapter
// draft, or what is left of a review pass's fixes. The per-fix buttons live on
// the cards in the prose; this bar is for the whole thing at once. Accept is
// focused on mount so Enter accepts; the layer also listens for Escape and ⌘↵.
import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { ReviewBar, ReviewDivider, ReviewHint } from './ReviewBar';
import { Button } from './ui/button';
import { Kbd } from './ui/feedback';

export interface ProposalReviewBarProps {
  /** What is under review: "Chat proposal", or "Continuity check · 2 of 4 left". */
  title: string;
  onAccept: () => void;
  onDiscard: () => void;
  acceptLabel?: string;
  discardLabel?: string;
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
  showDiff,
  onToggleDiff,
}: ProposalReviewBarProps) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, []);

  return (
    <ReviewBar label="Review proposal">
      <span className="px-2 text-xs font-medium text-pencil-strong">{title}</span>
      <Button ref={primary} variant="pencil" size="sm" onClick={onAccept}>
        <Check aria-hidden />
        {acceptLabel}
      </Button>
      <Button variant="ghost" size="sm" onClick={onDiscard}>
        <X aria-hidden />
        {discardLabel}
      </Button>
      {onToggleDiff && (
        <>
          <ReviewDivider />
          <Button variant="ghost" size="sm" onClick={onToggleDiff}>
            {showDiff ? 'Show result' : 'Show diff'}
          </Button>
        </>
      )}
      <ReviewHint>
        <Kbd>⌘↵</Kbd> {acceptLabel.toLowerCase()}
        <Kbd className="ml-1">esc</Kbd> {discardLabel.toLowerCase()}
      </ReviewHint>
    </ReviewBar>
  );
}
