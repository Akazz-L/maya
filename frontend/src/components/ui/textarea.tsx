import type { Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
import { controlClass } from './control';

/** `ref` is a plain prop here: React 19 passes it through without forwardRef. */
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, ...props }: TextareaProps) {
  return <textarea className={cn(controlClass, 'py-2 leading-relaxed', className)} {...props} />;
}
