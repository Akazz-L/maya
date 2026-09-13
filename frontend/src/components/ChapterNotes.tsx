import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

const OPEN_KEY = 'maya.notes.open';

interface ChapterNotesProps {
  value: string;
  onChange: (value: string) => void;
  /** Filled with a function that expands the notes and puts the cursor in them. */
  focusRef?: { current: (() => void) | null };
}

/**
 * The writer's own notes for a chapter: an outline, a line of intent, or
 * nothing at all. The chat and the planner read them when there are some.
 *
 * Collapsed, the first line stays in view so the notes are never out of mind.
 * Whether they start open is remembered per browser: it follows how the writer
 * works, not which chapter is open.
 */
export function ChapterNotes({ value, onChange, focusRef }: ChapterNotesProps) {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const focusPending = useRef(false);
  const id = useId();

  const remember = (next: boolean) => {
    localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    setOpen(next);
  };

  useEffect(() => {
    if (!focusRef) return;
    focusRef.current = () => {
      if (textarea.current) {
        textarea.current.focus();
      } else {
        // Not mounted while collapsed: focus once the expand has rendered.
        focusPending.current = true;
        remember(true);
      }
    };
    return () => {
      focusRef.current = null;
    };
  });

  // Grows with its content up to a cap, then scrolls.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (focusPending.current) {
      focusPending.current = false;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
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
          Chapter notes
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
            aria-label="Chapter notes"
            placeholder="What happens, who is in it, the mood, what it should set up… As much or as little as you like."
            onChange={(e) => onChange(e.target.value)}
            className="block max-h-[40vh] w-full resize-none overflow-y-auto rounded-md border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-300"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            Optional. The chat and Generate Plan read these on every request.
          </p>
        </div>
      )}
    </section>
  );
}
