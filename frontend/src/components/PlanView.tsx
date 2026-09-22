import { PenLine, RefreshCw, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { EMPTY_PLAN, type ScenePlan } from '../api/types';
import { ChapterContext } from './ChapterContext';
import { PlanForm } from './PlanForm';
import { Button } from './ui/button';

/** What the Undo bar would revert: a regenerate, or removing the plan. */
export type PlanUndo = 'regenerated' | 'removed';

interface PlanViewProps {
  plan: ScenePlan | null;
  /** The chapter context, shared live with the Write view and read by every AI call. */
  context: string;
  onContextChange: (value: string) => void;
  /** A plan request is in flight: the first plan or a regenerate. */
  generating: boolean;
  /** The plan was just regenerated or removed, and the one before it can still be restored. */
  undo: PlanUndo | null;
  busy: boolean;
  /** Out of AI budget: generating and drafting are disabled; writing a plan by hand is not. */
  aiBlocked: boolean;
  onChange: (plan: ScenePlan) => void;
  onGenerate: () => void;
  /** Planning is optional: without a plan, the chat and Review work from the context. */
  onRemove: () => void;
  onUndo: () => void;
  onGenerateDraft: () => void;
}

export function PlanView({
  plan,
  context,
  onContextChange,
  generating,
  undo,
  busy,
  aiBlocked,
  onChange,
  onGenerate,
  onRemove,
  onUndo,
  onGenerateDraft,
}: PlanViewProps) {
  const aiDisabled = busy || aiBlocked;
  return (
    <section className="flex flex-1 flex-col overflow-hidden bg-desk">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-soft px-3 py-2 sm:px-5">
        <div className="flex items-baseline gap-3">
          <h2 className="font-serif text-base font-semibold">Scene plan</h2>
          {generating && (
            <span className="flex items-center gap-1.5 text-xs text-ai-ink">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-ai" />
              {plan ? 'Regenerating…' : 'Generating…'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {plan && (
            // Calls no model, so the budget has no say; but a regenerate in flight
            // would land after the removal and bring a plan straight back.
            <Button size="sm" variant="ghost" disabled={generating} onClick={onRemove}>
              <Trash2 aria-hidden />
              Remove plan
            </Button>
          )}
          <Button
            size="sm"
            variant={plan ? 'secondary' : 'ai'}
            disabled={aiDisabled}
            onClick={onGenerate}
          >
            {plan ? <RefreshCw aria-hidden /> : <Sparkles aria-hidden />}
            {plan ? 'Regenerate' : 'Generate plan'}
          </Button>
          {plan && (
            <Button size="sm" variant="ai" disabled={aiDisabled} onClick={onGenerateDraft}>
              <PenLine aria-hidden />
              Draft from plan
            </Button>
          )}
        </div>
      </div>

      {undo && (
        <div
          role="status"
          className="flex animate-fade items-center gap-3 border-b border-line-soft bg-accent-soft px-5 py-2 text-[13px] text-accent-ink"
        >
          {undo === 'regenerated' ? 'Plan regenerated.' : 'Plan removed.'}
          <button
            type="button"
            onClick={onUndo}
            className="flex items-center gap-1 font-semibold underline-offset-4 hover:underline"
          >
            <Undo2 aria-hidden className="size-3.5" />
            Undo
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-4 [scrollbar-gutter:stable_both-edges] sm:px-10 sm:py-8">
        <div className="mx-auto flex max-w-[46rem] flex-col gap-6 bg-paper px-5 py-8 shadow-paper sm:px-12 sm:py-10">
          {/* The same field the Write view shows, against the same text: what the
              planner reads stays in sight, and is editable, right where a plan is made. */}
          <ChapterContext value={context} onChange={onContextChange} />
          <hr className="border-line-soft" />

          {generating && !plan ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Sparkles aria-hidden className="size-5 animate-pulse text-ai" />
              <p className="font-serif text-base text-ink-2 italic">
                {context.trim()
                  ? 'Planning from your chapter context…'
                  : 'Proposing a plan from the story so far…'}
              </p>
            </div>
          ) : (
            // Empty and editable when there is no plan yet: a writer can fill it in
            // by hand, or press Generate plan. Locked while a regenerate is in
            // flight, since anything typed would be overwritten as it lands.
            <fieldset disabled={generating} className="transition-opacity disabled:opacity-60">
              <PlanForm plan={plan ?? EMPTY_PLAN} onChange={onChange} />
            </fieldset>
          )}
        </div>
      </div>
    </section>
  );
}
