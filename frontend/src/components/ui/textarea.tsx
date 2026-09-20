import type { Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/** `ref` is a plain prop here: React 19 passes it through without forwardRef. */
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'w-full rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1.5 text-sm',
        'focus:border-blue-300 focus:bg-white focus:outline-none',
        'read-only:bg-gray-50 read-only:text-gray-600',
        className,
      )}
      {...props}
    />
  );
}
