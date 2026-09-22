import { cn } from '../lib/utils';

/** "maya." in the manuscript face, the full stop set in the writer's ink. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn('font-serif text-xl font-semibold tracking-tight text-ink italic', className)}
    >
      maya<span className="text-accent not-italic">.</span>
    </span>
  );
}
