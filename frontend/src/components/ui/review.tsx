// Shared pieces of the floating AI chrome that sits over the prose: the bar a
// proposal is reviewed from, and the chip shown while something streams. They
// are iris throughout, because everything in them is the machine's.
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../../lib/utils';

export function FloatingBar({
  className,
  tone = 'ai',
  children,
  ...props
}: {
  className?: string;
  tone?: 'ai' | 'danger';
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex max-w-[calc(100vw-2rem)] animate-rise flex-wrap items-center gap-1 rounded-xl border bg-raised p-1.5 shadow-pop',
        tone === 'danger' ? 'border-danger/30' : 'border-ai-line',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface BarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  primary?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function BarButton({ primary = false, className, ...props }: BarButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors [&_svg]:size-3.5',
        primary
          ? 'bg-ai text-on-ai hover:bg-ai-hover'
          : 'text-ink-2 hover:bg-ink/6 hover:text-ink',
        className,
      )}
      {...props}
    />
  );
}

export function BarDivider() {
  return <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />;
}

export function BarHint({ children }: { children: ReactNode }) {
  return <span className="px-1.5 text-[11px] text-ink-3 max-sm:hidden">{children}</span>;
}

/** "Writing…", "Rewriting…": a pulse and a word while a stream runs. */
export function StreamingChip({ children }: { children: ReactNode }) {
  return (
    <div className="flex animate-rise items-center gap-2 rounded-full border border-ai-line bg-raised py-1.5 pr-2 pl-3 text-xs font-medium text-ai-ink shadow-pop">
      <span className="size-1.5 animate-pulse rounded-full bg-ai" aria-hidden />
      {children}
    </div>
  );
}
