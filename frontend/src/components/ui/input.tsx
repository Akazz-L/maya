import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1.5 text-sm',
        'focus:border-blue-300 focus:bg-white focus:outline-none',
        className,
      )}
      {...props}
    />
  );
}
