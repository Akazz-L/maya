import { BookOpen } from 'lucide-react';
import type { SummarySource } from '../api/types';
import { cn } from '../lib/utils';

interface SummarySourcesProps {
  /** The preceding chapters this chapter's AI calls read, in order. */
  sources: SummarySource[];
  /** Opens that chapter's Summary view. */
  onOpen: (documentId: string) => void;
}

/** Said on the chip of a chapter whose summary the next request has to write. */
const PENDING: Partial<Record<SummarySource['summary_status'], string>> = {
  missing: 'Not summarized yet — the next AI request writes one.',
  stale: 'This chapter changed — the next AI request rewrites its summary.',
  edited_stale: 'Your summary, and the chapter has changed since.',
};

/**
 * Names what the AI reads of the story so far, where the writing happens.
 *
 * Earlier chapters reach the model as summaries, never as their prose. That
 * keeps a request affordable and focused, but it is invisible: a writer has no
 * way to know a plan came from four paragraphs rather than four chapters. Each
 * chapter here opens its own summary, which is editable.
 */
export function SummarySources({ sources, onOpen }: SummarySourcesProps) {
  return (
    <section className="mx-auto w-full max-w-page shrink-0 px-6 pb-3">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-subtle">
        <BookOpen aria-hidden className="size-3.5 shrink-0" />
        {sources.length === 0 ? (
          <span>
            The AI reads the story bible and this chapter. No earlier chapters to summarize yet.
          </span>
        ) : (
          <>
            <span>
              The AI reads the story bible, this chapter, and, in place of the earlier chapters,
              their summaries:
            </span>
            {sources.map((source) => {
              const pending = PENDING[source.summary_status];
              // Named for what the button does, since the sidebar carries the
              // same chapter titles; the warning is part of the name, so it is
              // not hover-only.
              const label = `Open ${source.title}'s summary${pending ? ` — ${pending}` : ''}`;
              return (
                <button
                  key={source.id}
                  type="button"
                  aria-label={label}
                  title={label}
                  onClick={() => onOpen(source.id)}
                  className={cn(
                    'inline-flex max-w-[12rem] items-center gap-1 rounded-control border border-line bg-surface-muted px-1.5 py-0.5',
                    'text-[11px] font-medium text-ink-muted hover:border-line-strong hover:text-ink',
                  )}
                >
                  <span className="truncate">{source.title}</span>
                  {pending && (
                    <span aria-hidden className="text-warning">
                      •
                    </span>
                  )}
                </button>
              );
            })}
            {/* The chat drafts from the chapter immediately before this one;
                the planner and the review passes read the whole window. */}
            <span>The chat reads only the last of these.</span>
          </>
        )}
      </p>
    </section>
  );
}
