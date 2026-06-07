import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
  {
    variants: {
      variant: {
        primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-400',
        success: 'bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-400',
        secondary:
          'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 focus-visible:ring-blue-300',
        dark: 'bg-gray-900 text-white hover:bg-black focus-visible:ring-gray-400',
      },
      size: {
        default: 'px-5 py-2',
        sm: 'px-3 py-1.5 text-xs',
        full: 'w-full px-4 py-2',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
