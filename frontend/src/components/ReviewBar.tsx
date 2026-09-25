// The small floating bars that carry the AI's work over the prose: a proposal
// or rewrite under review, or one still being written. Shared so every one of
// them looks and behaves alike.
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { pencilPanel } from './ui/floating';

interface ReviewBarProps {
  /** Names the toolbar for assistive tech: "Review proposal". */
  label: string;
  /** A failed request: the bar turns red and offers retry rather than accept. */
  failed?: boolean;
  children: ReactNode;
}

export function ReviewBar({ label, failed = false, children }: ReviewBarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn(
        pencilPanel,
        'flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1 p-1 animate-pop',
        failed && 'border-danger-line',
      )}
    >
      {children}
    </div>
  );
}

export function ReviewDivider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px bg-line" />;
}

/** The keyboard shortcuts, for a pointer user to learn; hidden on small screens. */
export function ReviewHint({ children }: { children: ReactNode }) {
  return (
    <span className="hidden items-center gap-1 px-1.5 text-[11px] text-ink-subtle sm:flex">
      {children}
    </span>
  );
}

/** Work in progress: "Writing…", with an optional way to stop it. */
export function ProgressChip({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        pencilPanel,
        'flex items-center gap-2 py-1.5 pr-1.5 pl-3 text-xs font-medium text-pencil-strong animate-pop',
        !action && 'pr-3',
      )}
    >
      <span aria-hidden className="relative flex size-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-pencil/40" />
        <span className="relative size-2 rounded-full bg-pencil" />
      </span>
      {children}
      {action}
    </div>
  );
}
