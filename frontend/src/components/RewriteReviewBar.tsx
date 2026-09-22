// Sits under the reviewed span. Accept is focused on mount so Enter accepts;
// the layer also listens for Escape and ⌘↵ window-wide while reviewing.
import { useEffect, useRef } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { BarButton, BarDivider, BarHint, FloatingBar } from './ui/review';

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
      <FloatingBar role="toolbar" aria-label="Review rewrite" tone="danger">
        <span className="max-w-xs truncate px-2 text-xs text-danger" title={error}>
          {error}
        </span>
        <BarButton ref={primary} onClick={onRetry}>
          <RotateCcw aria-hidden />
          Retry
        </BarButton>
        <BarButton onClick={onDiscard}>
          <X aria-hidden />
          Discard
        </BarButton>
      </FloatingBar>
    );
  }

  return (
    <FloatingBar role="toolbar" aria-label="Review rewrite">
      <BarButton ref={primary} primary onClick={onAccept}>
        <Check aria-hidden />
        Accept
      </BarButton>
      <BarButton onClick={onDiscard}>
        <X aria-hidden />
        Discard
      </BarButton>
      <BarButton onClick={onRetry}>
        <RotateCcw aria-hidden />
        Try again
      </BarButton>
      <BarDivider />
      <BarButton onClick={onToggleDiff}>{showDiff ? 'Show result' : 'Show diff'}</BarButton>
      <BarHint>↵ accept · esc discard</BarHint>
    </FloatingBar>
  );
}
