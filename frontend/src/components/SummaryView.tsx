import { useLayoutEffect, useRef, useState } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import type { SummaryStatus } from '../api/types';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { ConfirmDialog } from './ui/confirm-dialog';
import { controlClass } from './ui/control';
import { EmptyState, Spinner } from './ui/feedback';

interface SummaryViewProps {
  /** The summary as the writer is editing it. */
  summary: string;
  /** How that text stands against the chapter body, as the server sees it. */
  status: SummaryStatus;
  /** A summarize request is in flight for this chapter. */
  generating: boolean;
  busy: boolean;
  /** Out of AI budget: summarizing is disabled; writing a summary by hand is not. */
  aiBlocked: boolean;
  onChange: (value: string) => void;
  onGenerate: () => void;
}

/** What each status tells the writer, and whether it needs their attention. */
const STATUS: Record<SummaryStatus, { label: string; detail: string; warn: boolean }> = {
  empty: {
    label: 'Nothing to summarize',
    detail: 'Write the chapter first.',
    warn: false,
  },
  missing: {
    label: 'Not summarized yet',
    detail: 'The first AI request that reads this chapter writes one, and pays for it.',
    warn: false,
  },
  current: {
    label: 'Up to date',
    detail: 'Written by the AI from the chapter as it stands.',
    warn: false,
  },
  stale: {
    label: 'Out of date',
    detail: 'The chapter has changed. The next AI request that reads it writes a new summary.',
    warn: true,
  },
  edited: {
    label: 'Edited by you',
    detail: 'Yours, and kept: nothing rewrites it unless you ask.',
    warn: false,
  },
  edited_stale: {
    label: 'Edited by you',
    detail:
      'The chapter has changed since you wrote this, and your summary is still what the AI reads. Regenerate it if it no longer holds.',
    warn: true,
  },
};

export function SummaryView({
  summary,
  status,
  generating,
  busy,
  aiBlocked,
  onChange,
  onGenerate,
}: SummaryViewProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [confirming, setConfirming] = useState(false);
  const written = status !== 'empty';
  const mine = status === 'edited' || status === 'edited_stale';
  const { label, detail, warn } = STATUS[status];

  // Grows with its content: a summary is a paragraph, not a one-liner.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 160)}px`;
  }, [summary]);

  // Regenerating discards the writer's own text, so it is asked about first.
  const generate = () => (mine ? setConfirming(true) : onGenerate());

  return (
    <section aria-labelledby="chapter-summary-title" className="flex-1 overflow-y-auto bg-surface">
      <header className="mx-auto flex w-full max-w-page flex-wrap items-end gap-x-4 gap-y-3 px-6 pt-6 pb-4 sm:pt-8">
        <div className="min-w-0 flex-1">
          <h2
            id="chapter-summary-title"
            className="font-serif text-2xl font-semibold tracking-[-0.01em] sm:text-[28px]"
          >
            Summary
          </h2>
          <p className="mt-1 text-sm text-ink-subtle">
            What the AI remembers of this chapter. Later chapters are written from this summary, not
            from the chapter itself.
          </p>
        </div>
        {written && (
          <Button
            variant={summary ? 'secondary' : 'pencil'}
            disabled={busy || aiBlocked || generating}
            onClick={generate}
          >
            {summary ? <RotateCcw aria-hidden /> : <Sparkles aria-hidden />}
            {summary ? 'Regenerate' : 'Summarize now'}
          </Button>
        )}
      </header>

      {written ? (
        <div className="mx-auto w-full max-w-page px-6 pb-16">
          <p
            role="status"
            className={cn(
              'flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm',
              warn ? 'text-warning' : 'text-ink-subtle',
            )}
          >
            {generating ? (
              <span className="flex items-center gap-2 text-pencil-strong">
                <Spinner /> Summarizing the chapter…
              </span>
            ) : (
              <>
                <span className="font-medium text-ink-muted">{label}</span>
                <span className="min-w-0">{detail}</span>
              </>
            )}
          </p>

          {/* Editable whatever the status: correcting a wrong fact here is the
              cheapest way to fix every later chapter that would inherit it. */}
          <textarea
            ref={textarea}
            value={summary}
            aria-label="Chapter summary"
            aria-describedby="chapter-summary-reach"
            disabled={generating}
            placeholder="No summary yet. Write one, or let the AI summarize the chapter."
            onChange={(e) => onChange(e.target.value)}
            className={cn(controlClass, 'mt-3 block resize-y py-2.5 leading-relaxed')}
          />

          <p id="chapter-summary-reach" className="mt-2 text-xs text-ink-subtle">
            Read by the next chapter's chat, and by planning and review passes for up to the next ten
            chapters. Clear it to hand the chapter back to the AI.
          </p>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-page px-6 pb-16">
          <EmptyState title={label}>
            {detail} Once there is prose here, the AI summarizes it and later chapters read that
            summary in place of the whole chapter.
          </EmptyState>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title="Replace your summary?"
          description="The AI will write a new summary of this chapter from its text. What you wrote here is lost."
          confirmLabel="Regenerate"
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
