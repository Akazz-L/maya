import { EMPTY_PLAN, type ScenePlan } from '../api/types';
import { ChapterContext } from './ChapterContext';
import { Button } from './ui/button';
import { PlanForm } from './PlanForm';

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
    <section className="flex flex-1 flex-col overflow-hidden bg-[#fafaf7]">
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-gray-800">Scene plan</h2>
          {generating && (
            <span className="text-xs text-gray-400">{plan ? 'Regenerating…' : 'Generating…'}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {plan && (
            // Calls no model, so the budget has no say; but a regenerate in flight
            // would land after the removal and bring a plan straight back.
            <Button size="sm" variant="secondary" disabled={generating} onClick={onRemove}>
              Remove plan
            </Button>
          )}
          <Button
            size="sm"
            variant={plan ? 'secondary' : 'primary'}
            disabled={aiDisabled}
            onClick={onGenerate}
          >
            {plan ? '↻ Regenerate' : 'Generate plan'}
          </Button>
          {plan && (
            <Button size="sm" disabled={aiDisabled} onClick={onGenerateDraft}>
              Draft from plan →
            </Button>
          )}
        </div>
      </div>

      {/* The same field the Write view shows, against the same text: what the
          planner reads stays in sight, and is editable, right where a plan is made. */}
      <ChapterContext value={context} onChange={onContextChange} />

      {undo && (
        <div
          role="status"
          className="flex items-center gap-3 border-b border-blue-100 bg-blue-50 px-6 py-1.5 text-xs text-blue-800"
        >
          {undo === 'regenerated' ? 'Plan regenerated.' : 'Plan removed.'}
          <button
            type="button"
            onClick={onUndo}
            className="font-medium underline underline-offset-2 hover:text-blue-950"
          >
            Undo
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl">
          {generating && !plan ? (
            <p className="animate-pulse py-16 text-center text-sm text-gray-500">
              {context.trim()
                ? 'Planning from your chapter context…'
                : 'Proposing a plan from the story so far…'}
            </p>
          ) : (
            // Empty and editable when there is no plan yet: a writer can fill it in
            // by hand, or press Generate plan. Locked while a regenerate is in
            // flight, since anything typed would be overwritten as it lands.
            <fieldset disabled={generating}>
              <PlanForm plan={plan ?? EMPTY_PLAN} onChange={onChange} />
            </fieldset>
          )}
        </div>
      </div>
    </section>
  );
}
