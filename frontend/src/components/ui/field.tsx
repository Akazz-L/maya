import {
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

/** The shared look of every text control: a quiet well that lifts onto paper when focused. */
const control = cn(
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink',
  'placeholder:text-ink-3 transition-[border-color,background-color,box-shadow] duration-150',
  'hover:border-ink-3/50',
  'focus:border-accent focus:bg-paper focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-60',
);

interface FieldProps {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A labelled control: wrapping it in the <label> ties the two together. */
export function Field({ label, hint, className, children }: FieldProps) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

export function Input({ className, ...props }: InputProps) {
  return <input className={cn(control, 'h-9 py-0', className)} {...props} />;
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow with the text instead of scrolling inside a fixed box. */
  autoGrow?: boolean;
}

export function Textarea({ className, autoGrow = false, value, ...props }: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!autoGrow || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [autoGrow, value]);

  return (
    <textarea
      ref={ref}
      value={value}
      className={cn(control, 'leading-relaxed', autoGrow && 'resize-none overflow-hidden', className)}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative inline-flex">
      <select className={cn(control, 'h-9 appearance-none py-0 pr-8', className)} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-3"
      />
    </span>
  );
}
