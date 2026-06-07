import type { SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1.5 text-sm',
        'focus:border-blue-300 focus:bg-white focus:outline-none',
        className,
      )}
      {...props}
    />
  );
}
