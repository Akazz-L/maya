import { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import { useStoredFlag } from '../hooks/useStoredFlag';
import { cn } from '../lib/utils';
import { Textarea } from './ui/field';

const OPEN_KEY = 'maya.context.open';

interface ChapterContextProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * What the AI is told about a chapter beyond its prose: an outline, a line of
 * intent, or nothing at all. The chat, Review, and Generate plan all read it.
 *
 * The Write and Plan views both render this against the same text, so an edit
 * in one is already in the other, and opening one opens both. Collapsed, the
 * first line stays in view. Whether it starts open is remembered per browser:
 * it follows how the writer works, not which chapter is open.
 */
export function ChapterContext({ value, onChange }: ChapterContextProps) {
  const [open, setOpen] = useStoredFlag(OPEN_KEY, false);
  const id = useId();

  const preview = value
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return (
    <section className="-mx-2.5 rounded-lg transition-colors has-[button:hover]:bg-surface/70">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px]"
      >
        <ChevronRight
          aria-hidden
          className={cn('size-3.5 shrink-0 text-ink-3 transition-transform', open && 'rotate-90')}
        />
        <span className="shrink-0 font-medium text-ink-2">Chapter context</span>
        {!open && (
          <span className={cn('min-w-0 truncate', preview ? 'text-ink-2' : 'text-ink-3')}>
            {preview ?? 'Optional. An outline, a mood, anything the AI should know'}
          </span>
        )}
      </button>
      {open && (
        <div id={id} className="animate-fade px-2.5 pb-2">
          <Textarea
            autoGrow
            value={value}
            rows={2}
            aria-label="Chapter context"
            placeholder="What happens, who is in it, the mood, what it should set up. As much or as little as you like."
            onChange={(e) => onChange(e.target.value)}
            className="max-h-[40vh] overflow-y-auto"
          />
          <p className="mt-1.5 text-xs text-ink-3">
            The chat, reviews, and Generate plan read this on every request.
          </p>
        </div>
      )}
    </section>
  );
}
