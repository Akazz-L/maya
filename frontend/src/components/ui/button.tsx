import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../../lib/utils';

/**
 * One button for the whole app. The variant names whose action it is, not how
 * it looks: `primary` is the writer's, `ai` calls a model, `ghost` is chrome.
 */
const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium',
    'transition-[background-color,color,border-color,box-shadow] duration-150',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent shadow-xs hover:bg-accent-hover',
        ai: 'bg-ai text-on-ai shadow-xs hover:bg-ai-hover',
        secondary: 'border border-line bg-raised text-ink hover:border-ink-3/60 hover:bg-surface',
        ghost: 'text-ink-2 hover:bg-ink/6 hover:text-ink',
        danger: 'bg-danger text-white hover:bg-danger/90',
      },
      size: {
        default: 'h-9 px-4 text-sm',
        sm: 'h-8 px-3 text-[13px]',
        xs: 'h-7 px-2 text-xs [&_svg]:size-3.5',
        icon: 'size-8 p-0',
        'icon-sm': 'size-7 p-0 [&_svg]:size-3.5',
        full: 'h-10 w-full px-4 text-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
