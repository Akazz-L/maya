import type { ViewStep } from '../hooks/workflowReducer';
import { Button } from './ui/button';

export interface ActionHandlers {
  onGeneratePlan: () => void;
  onGenerateDraft: () => void;
  onBackToPlan: () => void;
  onCheck: () => void;
  onRevise: () => void;
  onAccept: () => void;
  onRedo: () => void;
}

interface Props extends ActionHandlers {
  step: ViewStep;
  planReady: boolean;
  busy: boolean;
  status: { text: string; isError: boolean };
}

export function ActionRow({
  step,
  planReady,
  busy,
  status,
  onGeneratePlan,
  onGenerateDraft,
  onBackToPlan,
  onCheck,
  onRevise,
  onAccept,
  onRedo,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {(step === 'empty' || step === 'plan') && (
        <Button variant="primary" onClick={onGeneratePlan} disabled={busy}>
          Generate Plan
        </Button>
      )}
      {step === 'plan' && planReady && (
        <Button variant="primary" onClick={onGenerateDraft} disabled={busy}>
          Generate Draft →
        </Button>
      )}
      {step === 'draft' && (
        <>
          <Button variant="secondary" onClick={onBackToPlan} disabled={busy}>
            ← Edit Plan
          </Button>
          <Button variant="primary" onClick={onCheck} disabled={busy}>
            Check Issues →
          </Button>
        </>
      )}
      {step === 'check' && (
        <>
          <Button variant="secondary" onClick={onRevise} disabled={busy}>
            ← Revise Draft
          </Button>
          <Button variant="success" onClick={onAccept} disabled={busy}>
            Accept &amp; Save
          </Button>
        </>
      )}
      {step === 'saved' && (
        <Button variant="secondary" onClick={onRedo} disabled={busy}>
          Redo chapter
        </Button>
      )}

      {busy && <span className="text-[13px] text-gray-500">Working…</span>}
      {status.text && (
        <span className={status.isError ? 'text-[13px] text-red-700' : 'text-[13px] text-green-700'}>
          {status.text}
        </span>
      )}
    </div>
  );
}
