import type { ScenePlan } from '../api/types';
import { Button } from './ui/button';
import { PlanForm } from './PlanForm';

/** What the Undo bar would revert: a regenerate, or removing the plan. */
export type PlanUndo = 'regenerated' | 'removed';

interface PlanViewProps {
  plan: ScenePlan | null;
  /** The saved chapter notes: what the planner reads, shown so a plan never surprises. */
  notes: string;
  /** A plan request is in flight: the first plan, a retry, or a regenerate. */
  generating: boolean;
  /** The last plan request failed; its reason is in the workspace error bar. */
  failed: boolean;
  /** The plan was just regenerated or removed, and the one before it can still be restored. */
  undo: PlanUndo | null;
  busy: boolean;
  /** Out of AI budget: generating and drafting are disabled; editing by hand is not. */
  aiBlocked: boolean;
  onChange: (plan: ScenePlan) => void;
  onGenerate: () => void;
  /** Planning is optional: without a plan, the chat and checker work from the chapter notes. */
  onRemove: () => void;
  onUndo: () => void;
  onStartBlank: () => void;
  onGenerateDraft: () => void;
  /** Takes the writer to the chapter notes, which live in the Write view. */
  onEditNotes: () => void;
}

export function PlanView({
  plan,
  notes,
  generating,
  failed,
  undo,
  busy,
  aiBlocked,
  onChange,
  onGenerate,
  onRemove,
  onUndo,
  onStartBlank,
  onGenerateDraft,
  onEditNotes,
}: PlanViewProps) {
  const aiDisabled = busy || aiBlocked;
  const trimmedNotes = notes.trim();
  return (
    <section className="flex flex-1 flex-col overflow-hidden bg-[#fafaf7]">
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-gray-800">Scene plan</h2>
          {plan && generating && <span className="text-xs text-gray-400">Regenerating…</span>}
        </div>
        {plan && (
          <div className="flex items-center gap-2">
            {/* Calls no model, so the budget has no say; but a regenerate in flight
                would land after the removal and bring a plan straight back. */}
            <Button size="sm" variant="secondary" disabled={generating} onClick={onRemove}>
              Remove plan
            </Button>
            <Button size="sm" variant="secondary" disabled={aiDisabled} onClick={onGenerate}>
              ↻ Regenerate
            </Button>
            <Button size="sm" disabled={aiDisabled} onClick={onGenerateDraft}>
              Draft from plan →
            </Button>
          </div>
        )}
      </div>

      {/* A plan is generated the moment this view opens, so what it reads stays in
          sight: a plan drawn from forgotten notes, or from none, is never a surprise. */}
      <section
        aria-label="What the plan is built from"
        className="flex items-start gap-3 border-b border-gray-200 bg-[#fcfcfa] px-6 py-2 text-xs"
      >
        {trimmedNotes ? (
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
              Chapter notes
            </span>
            <p className="line-clamp-2 whitespace-pre-wrap text-gray-600">{trimmedNotes}</p>
          </div>
        ) : (
          <p className="min-w-0 flex-1 text-amber-800">
            No chapter notes yet, so the AI proposes what happens next from the story so far.
          </p>
        )}
        <button
          type="button"
          onClick={onEditNotes}
          className="shrink-0 font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
        >
          {trimmedNotes ? 'Edit notes' : 'Add notes'}
        </button>
      </section>

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
          {plan ? (
            // Locked while a regenerate is in flight: anything typed now would be
            // overwritten the moment the new plan lands.
            <fieldset disabled={generating}>
              <PlanForm plan={plan} onChange={onChange} />
            </fieldset>
          ) : generating ? (
            <p className="animate-pulse py-16 text-center text-sm text-gray-500">
              {trimmedNotes
                ? 'Planning from your chapter notes…'
                : 'Proposing a plan from the story so far…'}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-gray-500">
                {aiBlocked
                  ? 'AI budget used — you can still write a plan by hand.'
                  : failed
                    ? 'Could not generate a plan.'
                    : 'No plan yet for this chapter.'}
              </p>
              <div className="flex items-center gap-2">
                {!aiBlocked && (
                  <Button size="sm" disabled={busy} onClick={onGenerate}>
                    {failed ? 'Retry' : 'Generate plan'}
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={onStartBlank}>
                  Start a blank plan
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
