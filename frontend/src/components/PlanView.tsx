import { PenLine, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { EMPTY_PLAN, type ScenePlan } from '../api/types';
import type { PlanUndo } from '../hooks/useChapterPlan';
import { ChapterContext } from './ChapterContext';
import { Button } from './ui/button';
import { Skeleton, Spinner } from './ui/feedback';
import { PlanForm } from './PlanForm';

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

/** The form's shape, while the first plan is on its way. */
function PlanSkeleton({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="flex items-center gap-2 text-sm text-pencil-strong">
        <Spinner /> {message}
      </p>
      <Skeleton className="h-16" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    </div>
  );
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
    <section aria-labelledby="scene-plan-title" className="flex-1 overflow-y-auto bg-surface">
      <header className="mx-auto flex w-full max-w-page flex-wrap items-end gap-x-4 gap-y-3 px-6 pt-6 pb-4 sm:pt-8">
        <div className="min-w-0 flex-1">
          <h2
            id="scene-plan-title"
            className="font-serif text-2xl font-semibold tracking-[-0.01em] sm:text-[28px]"
          >
            Scene plan
          </h2>
          <p className="mt-1 text-sm text-ink-subtle" role="status">
            {generating
              ? plan
                ? 'Regenerating…'
                : 'Generating…'
              : 'Optional. Fill it in by hand, or let the AI propose one.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {plan && (
            // Calls no model, so the budget has no say; but a regenerate in flight
            // would land after the removal and bring a plan straight back.
            <Button variant="ghost" disabled={generating} onClick={onRemove}>
              <Trash2 aria-hidden />
              Remove plan
            </Button>
          )}
          <Button
            variant={plan ? 'secondary' : 'pencil'}
            disabled={aiDisabled}
            onClick={onGenerate}
          >
            {plan ? <RotateCcw aria-hidden /> : <Sparkles aria-hidden />}
            {plan ? 'Regenerate' : 'Generate plan'}
          </Button>
          {plan && (
            <Button variant="pencil" disabled={aiDisabled} onClick={onGenerateDraft}>
              <PenLine aria-hidden />
              Draft from plan
            </Button>
          )}
        </div>
      </header>

      {/* The same field the Write view shows, against the same text: what the
          planner reads stays in sight, and is editable, right where a plan is made. */}
      <ChapterContext value={context} onChange={onContextChange} />

      {undo && (
        <div className="mx-auto w-full max-w-page px-6 pb-3">
          <div
            role="status"
            className="flex items-center gap-3 rounded-panel bg-ink px-3.5 py-2 text-sm text-white animate-pop"
          >
            <span className="flex-1">
              {undo === 'regenerated' ? 'Plan regenerated.' : 'Plan removed.'}
            </span>
            <button
              type="button"
              onClick={onUndo}
              className="rounded px-1.5 py-0.5 font-medium text-pencil-soft underline-offset-2 hover:underline"
            >
              Undo
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-page px-6 pt-3 pb-16">
        {generating && !plan ? (
          <PlanSkeleton
            message={
              context.trim()
                ? 'Planning from your chapter context…'
                : 'Proposing a plan from the story so far…'
            }
          />
        ) : (
          // Empty and editable when there is no plan yet: a writer can fill it in
          // by hand, or press Generate plan. Locked while a regenerate is in
          // flight, since anything typed would be overwritten as it lands.
          <fieldset disabled={generating} className="min-w-0 disabled:opacity-60">
            <PlanForm plan={plan ?? EMPTY_PLAN} onChange={onChange} />
          </fieldset>
        )}
      </div>
    </section>
  );
}
