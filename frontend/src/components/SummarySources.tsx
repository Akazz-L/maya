import { BookOpen } from 'lucide-react';
import type { SummaryContext, SummarySource } from '../api/types';
import { cn } from '../lib/utils';

interface SummarySourcesProps {
  /** What the AI reads of the story before this chapter. */
  context: SummaryContext | null;
  /** Opens that chapter's Memory view. */
  onOpen: (documentId: string) => void;
  /** Opens this chapter's own Memory view, where the story so far is edited. */
  onOpenStory: () => void;
}

/** Said on the chip of a chapter whose summary the next request has to write. */
const PENDING: Partial<Record<SummarySource['summary_status'], string>> = {
  missing: 'Not summarized yet — the next AI request writes one.',
  stale: 'This chapter changed — the next AI request rewrites its summary.',
  edited_stale: 'Your summary, and the chapter has changed since.',
};

function Chip({
  label,
  pending,
  onClick,
}: {
  label: string;
  pending?: string;
  onClick: () => void;
}) {
  const name = `Open ${label}${pending ? ` — ${pending}` : ''}`;
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      onClick={onClick}
      className={cn(
        'inline-flex max-w-[14rem] items-center gap-1 rounded-control border border-line bg-surface-muted px-1.5 py-0.5',
        'text-[11px] font-medium text-ink-muted hover:border-line-strong hover:text-ink',
      )}
    >
      <span className="truncate">{label}</span>
      {pending && (
        <span aria-hidden className="text-warning">
          •
        </span>
      )}
    </button>
  );
}

/**
 * Names what the AI reads of the story so far, where the writing happens.
 *
 * Earlier chapters reach the model as a running record and a few summaries,
 * not as their prose — except on a short project, where they are cheap enough
 * to send whole. Either way it is invisible without this line: a writer has no
 * way to know a draft came from four paragraphs rather than four chapters.
 */
export function SummarySources({ context, onOpen, onOpenStory }: SummarySourcesProps) {
  if (!context) return null;
  const { mode, previous, digest } = context;

  return (
    <section className="mx-auto w-full max-w-page shrink-0 px-6 pb-3">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-subtle">
        <BookOpen aria-hidden className="size-3.5 shrink-0" />
        {previous.length === 0 ? (
          <span>
            The AI reads the story bible and this chapter. No earlier chapters behind it yet.
          </span>
        ) : mode === 'prose' ? (
          <>
            {/* Short project: summarizing would cost a call per chapter and
                lose the writer's own sentences, so nothing is summarized. */}
            <span>The project is short, so the AI reads your earlier chapters in full:</span>
            {previous.map((source) => (
              <Chip key={source.id} label={source.title} onClick={() => onOpen(source.id)} />
            ))}
          </>
        ) : (
          <>
            <span>The AI reads the story bible, this chapter,</span>
            {digest && (
              <>
                <Chip
                  label={`the story so far (${digest.covers.length} chapters)`}
                  pending={
                    digest.status === 'missing'
                      ? 'Not written yet — the next AI request writes it.'
                      : digest.status === 'stale' || digest.status === 'edited_stale'
                        ? 'A chapter it covers has changed.'
                        : undefined
                  }
                  onClick={onOpenStory}
                />
                <span>and</span>
              </>
            )}
            <span>summaries of:</span>
            {previous.map((source) => (
              <Chip
                key={source.id}
                label={source.title}
                pending={PENDING[source.summary_status]}
                onClick={() => onOpen(source.id)}
              />
            ))}
            {/* The drafter also gets the end of the last chapter word for word:
                a summary carries no voice, and voice is what a draft copies. */}
            <span>It drafts from the end of {previous[previous.length - 1].title}, verbatim.</span>
          </>
        )}
      </p>
    </section>
  );
}
