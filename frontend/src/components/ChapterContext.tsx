import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { usePersistentFlag } from '../hooks/usePersistentFlag';
import { cn } from '../lib/utils';
import { controlClass } from './ui/control';

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
  const [open, setOpen] = usePersistentFlag(OPEN_KEY, false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  useEffect(() => {
    const onShared = (e: Event) => setOpen((e as CustomEvent<boolean>).detail);
    window.addEventListener(OPEN_EVENT, onShared);
    return () => window.removeEventListener(OPEN_EVENT, onShared);
  }, [setOpen]);

  const remember = (next: boolean) => {
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
    <section className="mx-auto w-full max-w-page shrink-0 px-6 pb-3">
      <div className="rounded-panel border border-line bg-surface-muted">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => remember(!open)}
          className="flex h-9 w-full items-center gap-2 rounded-panel px-3 text-left text-sm hover:bg-surface-sunken/60"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-ink-subtle transition-transform duration-150',
              open && 'rotate-90',
            )}
          />
          <span className="shrink-0 text-xs font-medium text-ink-muted">Chapter context</span>
          {!open && (
            <span
              className={cn(
                'min-w-0 truncate text-[13px]',
                preview ? 'text-ink-muted' : 'text-ink-faint',
              )}
            >
              {preview ?? 'Optional: an outline, a mood, anything the AI should know'}
            </span>
          )}
        </button>
        {open && (
          <div id={id} className="px-3 pb-3">
            <textarea
              ref={textarea}
              value={value}
              rows={2}
              aria-label="Chapter context"
              aria-describedby={`${id}-help`}
              placeholder="What happens, who is in it, the mood, what it should set up… As much or as little as you like."
              onChange={(e) => onChange(e.target.value)}
              className={cn(
                controlClass,
                'block max-h-[40vh] resize-none overflow-y-auto py-2 leading-relaxed',
              )}
            />
            <p id={`${id}-help`} className="mt-1.5 text-xs text-ink-subtle">
              The chat, specialist passes, and Generate plan read this on every request.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
