import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
import { controlClass } from './control';

/** A native select, for its free keyboard and mobile behaviour, with a drawn chevron. */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <select className={cn(controlClass, 'h-8 appearance-none pr-7 text-xs')} {...props} />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-subtle"
      />
    </span>
  );
}
