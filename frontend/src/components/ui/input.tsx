import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '../../lib/utils';
import { controlClass } from './control';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

export function Input({ className, ...props }: InputProps) {
  return <input className={cn(controlClass, 'h-9', className)} {...props} />;
}
