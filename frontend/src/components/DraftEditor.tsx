import { useEffect, useRef } from 'react';
import { cn } from '../lib/utils';

interface Props {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /** Keep the textarea scrolled to the bottom as tokens stream in. */
  autoScroll?: boolean;
}

export function DraftEditor({ value, onChange, readOnly, autoScroll }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [value, autoScroll]);

  return (
    <textarea
      ref={ref}
      value={value}
      readOnly={readOnly}
      spellCheck={false}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn(
        'min-h-[480px] w-full resize-y rounded-md border border-gray-300 p-3.5',
        'font-serif text-[15px] leading-relaxed',
        'focus:border-blue-300 focus:outline-none',
        readOnly && 'bg-gray-50 text-gray-600',
      )}
    />
  );
}
