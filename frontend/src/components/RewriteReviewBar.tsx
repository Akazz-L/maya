// Sits under the reviewed span. Accept is focused on mount so Enter accepts;
// the layer also listens for Escape and ⌘↵ window-wide while reviewing.
import { useEffect, useRef } from 'react';
import { cn } from '../lib/utils';

export interface RewriteReviewBarProps {
  error: string | null;
  showDiff: boolean;
  onToggleDiff: () => void;
  onAccept: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}

const ghost =
  'rounded-lg px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800';

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

  return (
    <div
      role="toolbar"
      aria-label="Review rewrite"
      className={cn(
        'flex max-w-[calc(100vw-4rem)] items-center gap-1 rounded-xl border bg-white p-1.5 shadow-lg',
        error ? 'border-red-200 shadow-red-900/10' : 'border-violet-200 shadow-violet-900/10',
      )}
    >
      {error ? (
        <>
          <span className="max-w-xs truncate px-2 text-xs text-red-700" title={error}>
            {error}
          </span>
          <button ref={primary} type="button" onClick={onRetry} className={ghost}>
            ↻ Retry
          </button>
          <button type="button" onClick={onDiscard} className={ghost}>
            ✕ Discard
          </button>
        </>
      ) : (
        <>
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
          <button type="button" onClick={onRetry} className={ghost}>
            ↻ Try again
          </button>
          <span className="mx-0.5 h-4 w-px bg-gray-200" aria-hidden />
          <button type="button" onClick={onToggleDiff} className={ghost}>
            {showDiff ? 'Show result' : 'Show diff'}
          </button>
          <span className="pl-1 pr-1.5 text-[11px] text-gray-400">↵ accept · esc discard</span>
        </>
      )}
    </div>
  );
}
