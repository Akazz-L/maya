import { useLayoutEffect, useRef, useState } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import type { SummaryStatus } from '../api/types';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { ConfirmDialog } from './ui/confirm-dialog';
import { controlClass } from './ui/control';
import { Spinner } from './ui/feedback';

interface StorySoFarProps {
  /** The record as the writer is editing it. */
  digest: string;
  status: SummaryStatus;
  /** The chapters it stands for, in order. */
  covers: string[];
  generating: boolean;
  busy: boolean;
  aiBlocked: boolean;
  onChange: (value: string) => void;
  onGenerate: () => void;
}

const STATUS: Record<SummaryStatus, { label: string; detail: string; warn: boolean }> = {
  empty: {
    label: 'Nothing behind the recent chapters yet',
    detail: 'The AI reads the recent chapters themselves, so there is nothing to condense.',
    warn: false,
  },
  missing: {
    label: 'Not written yet',
    detail: 'The next AI request on this chapter writes it, and pays for it.',
    warn: false,
  },
  current: {
    label: 'Up to date',
    detail: 'Written by the AI from the chapters it covers.',
    warn: false,
  },
  stale: {
    label: 'Out of date',
    detail: 'One of those chapters changed. The next AI request on this chapter rewrites it.',
    warn: true,
  },
  edited: { label: 'Edited by you', detail: 'Yours, and kept: nothing rewrites it unless you ask.', warn: false },
  edited_stale: {
    label: 'Edited by you',
    detail:
      'One of those chapters has changed since you wrote this, and yours is still what the AI reads. Rebuild it if it no longer holds.',
    warn: true,
  },
};

/**
 * The story so far: every chapter before the recent ones, as one running record.
 *
 * It belongs to the chapter that reads it rather than to the project, because
 * it is a prefix — what the AI should remember while you revise chapter 6 is
 * not what it should remember while you write chapter 30.
 */
export function StorySoFar({
  digest,
  status,
  covers,
  generating,
  busy,
  aiBlocked,
  onChange,
  onGenerate,
}: StorySoFarProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [confirming, setConfirming] = useState(false);
  const mine = status === 'edited' || status === 'edited_stale';
  const { label, detail, warn } = STATUS[status];

  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 180)}px`;
  }, [digest]);

  if (status === 'empty') {
    return (
      <section aria-labelledby="story-so-far-title" className="border-t border-line pt-6">
        <h3 id="story-so-far-title" className="font-serif text-xl font-semibold">
          The story so far
        </h3>
        <p className="mt-1 text-sm text-ink-subtle">{detail}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="story-so-far-title" className="border-t border-line pt-6">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h3 id="story-so-far-title" className="font-serif text-xl font-semibold">
            The story so far
          </h3>
          <p className="mt-1 text-sm text-ink-subtle">
            Everything before the recent chapters, as one running record. The AI reads this in
            their place, so nothing older is forgotten and none of it is re-read in full.
          </p>
        </div>
        <Button
          variant={digest ? 'secondary' : 'pencil'}
          disabled={busy || aiBlocked || generating}
          onClick={() => (mine ? setConfirming(true) : onGenerate())}
        >
          {digest ? <RotateCcw aria-hidden /> : <Sparkles aria-hidden />}
          {digest ? 'Rebuild' : 'Write it now'}
        </Button>
      </div>

      <p
        role="status"
        className={cn(
          'mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm',
          warn ? 'text-warning' : 'text-ink-subtle',
        )}
      >
        {generating ? (
          <span className="flex items-center gap-2 text-pencil-strong">
            <Spinner /> Reading back over the story…
          </span>
        ) : (
          <>
            <span className="font-medium text-ink-muted">{label}</span>
            <span className="min-w-0">{detail}</span>
          </>
        )}
      </p>

      <textarea
        ref={textarea}
        value={digest}
        aria-label="The story so far"
        aria-describedby="story-so-far-covers"
        disabled={generating}
        placeholder="Not written yet. Write it yourself, or let the AI read back over the chapters."
        onChange={(e) => onChange(e.target.value)}
        className={cn(controlClass, 'mt-3 block resize-y py-2.5 leading-relaxed')}
      />

      <p id="story-so-far-covers" className="mt-2 text-xs text-ink-subtle">
        Covers {covers.length === 1 ? covers[0] : `${covers[0]} – ${covers[covers.length - 1]}`}{' '}
        ({covers.length} {covers.length === 1 ? 'chapter' : 'chapters'}). Clear it to hand the
        chapters back to the AI.
      </p>

      {confirming && (
        <ConfirmDialog
          title="Replace your record?"
          description="The AI will read back over those chapters and write a new record. What you wrote here is lost."
          confirmLabel="Rebuild"
          destructive
          onConfirm={() => {
            setConfirming(false);
            onGenerate();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
