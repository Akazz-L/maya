import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap select-none',
    'transition-[background-color,border-color,color,box-shadow] duration-150',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        /** The one action a view is for, and anything that starts or accepts the AI's work. */
        primary: 'bg-brand text-on-accent hover:bg-brand-strong',
        secondary:
          'border border-line bg-surface text-ink shadow-xs hover:border-line-strong hover:bg-surface-muted',
        ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        danger: 'bg-danger text-on-accent hover:bg-danger/90',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-8 px-3 text-sm',
        lg: 'h-10 px-4 text-sm',
        icon: 'size-8',
        'icon-sm': 'size-7 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
