import { AlertCircle, LoaderCircle, X } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn('size-4 animate-spin', className)} />;
}

/** A placeholder block in the shape of content that is still loading. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-control bg-surface-sunken', className)}
      {...props}
    />
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line bg-surface-muted px-1 font-sans text-[10.5px] font-medium text-ink-subtle',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** What a blank area is for, and the one thing to do about it. */
export function EmptyState({ icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-sunken text-ink-subtle [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-subtle">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

interface InlineAlertProps {
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/** A failure the writer should know about, announced when it appears. */
export function InlineAlert({ children, onDismiss, className }: InlineAlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 border-danger-line bg-danger-soft px-4 py-2 text-xs text-danger',
        className,
      )}
    >
      <AlertCircle aria-hidden className="mt-px size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">{children}</p>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="-m-1 rounded p-1 hover:bg-danger/10"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  );
}
