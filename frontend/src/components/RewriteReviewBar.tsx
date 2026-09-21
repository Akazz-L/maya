// Sits under the reviewed span. Accept is focused on mount so Enter accepts;
// the layer also listens for Escape and ⌘↵ window-wide while reviewing.
import { useEffect, useRef } from 'react';
import { AlertCircle, Check, RotateCcw, X } from 'lucide-react';
import { ReviewBar, ReviewDivider, ReviewHint } from './ReviewBar';
import { Button } from './ui/button';
import { Kbd } from './ui/feedback';

export interface RewriteReviewBarProps {
  error: string | null;
  showDiff: boolean;
  onToggleDiff: () => void;
  onAccept: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}

export function RewriteReviewBar({
  error,
  showDiff,
  onToggleDiff,
  onAccept,
  onDiscard,
  onRetry,
}: RewriteReviewBarProps) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, []);

  if (error) {
    return (
      <ReviewBar label="Review rewrite" failed>
        <span role="alert" className="flex max-w-xs items-center gap-1.5 px-2 text-xs text-danger">
          <AlertCircle aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate" title={error}>
            {error}
          </span>
        </span>
        <Button ref={primary} variant="secondary" size="sm" onClick={onRetry}>
          <RotateCcw aria-hidden />
          Retry
        </Button>
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          <X aria-hidden />
          Discard
        </Button>
      </ReviewBar>
    );
  }

  return (
    <ReviewBar label="Review rewrite">
      <Button ref={primary} variant="pencil" size="sm" onClick={onAccept}>
        <Check aria-hidden />
        Accept
      </Button>
      <Button variant="ghost" size="sm" onClick={onDiscard}>
        <X aria-hidden />
        Discard
      </Button>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        <RotateCcw aria-hidden />
        Try again
      </Button>
      <ReviewDivider />
      <Button variant="ghost" size="sm" onClick={onToggleDiff}>
        {showDiff ? 'Show result' : 'Show diff'}
      </Button>
      <ReviewHint>
        <Kbd>↵</Kbd> accept
        <Kbd className="ml-1">esc</Kbd> discard
      </ReviewHint>
    </ReviewBar>
  );
}
