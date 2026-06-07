import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-md border border-gray-200 p-3.5', className)} {...props} />;
}

/** Uppercase field label, matching the old `.field-group label` styling. */
export function FieldLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500',
        className,
      )}
      {...props}
    />
  );
}
