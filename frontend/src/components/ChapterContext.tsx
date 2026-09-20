import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

const OPEN_KEY = 'maya.context.open';
/** Keeps every mounted copy in step: the Write and Plan views each render one. */
const OPEN_EVENT = 'maya:context-open';

interface ChapterContextProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * What the AI is told about a chapter beyond its prose: an outline, a line of
 * intent, or nothing at all. The chat, Review, and Generate plan all read it.
 *
 * The Write and Plan views both render this against the same text, so an edit
 * in one is already in the other. Collapsed, the first line stays in view.
 * Whether it starts open is remembered per browser: it follows how the writer
 * works, not which chapter is open.
 */
export function ChapterContext({ value, onChange }: ChapterContextProps) {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  useEffect(() => {
    const onShared = (e: Event) => setOpen((e as CustomEvent<boolean>).detail);
    window.addEventListener(OPEN_EVENT, onShared);
    return () => window.removeEventListener(OPEN_EVENT, onShared);
  }, []);

  const remember = (next: boolean) => {
    localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: next }));
  };

  // Grows with its content up to a cap, then scrolls.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, open]);

  const preview = value
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return (
    <section className="border-b border-gray-200 bg-[#fcfcfa]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => remember(!open)}
        className="flex w-full items-center gap-2 px-6 py-2 text-left text-sm hover:bg-gray-50"
      >
        <span
          aria-hidden
          className={cn('text-[9px] text-gray-400 transition-transform', open && 'rotate-90')}
        >
          ▶
        </span>
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-gray-500">
          Chapter context
        </span>
        {!open && (
          <span className={cn('min-w-0 truncate', preview ? 'text-gray-600' : 'text-gray-400')}>
            {preview ?? 'Optional — an outline, a mood, anything the AI should know'}
          </span>
        )}
      </button>
      {open && (
        <div id={id} className="px-6 pb-3">
          <textarea
            ref={textarea}
            value={value}
            rows={2}
            aria-label="Chapter context"
            placeholder="What happens, who is in it, the mood, what it should set up… As much or as little as you like."
            onChange={(e) => onChange(e.target.value)}
            className="block max-h-[40vh] w-full resize-none overflow-y-auto rounded-md border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-300"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            Optional. The chat, Review, and Generate plan read this on every request.
          </p>
        </div>
      )}
    </section>
  );
}
