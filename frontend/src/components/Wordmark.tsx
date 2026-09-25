import { cn } from '../lib/utils';

/** The product name, set in the manuscript face it is about. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-serif font-semibold tracking-[-0.01em] text-ink', className)}>
      Maya
    </span>
  );
}
