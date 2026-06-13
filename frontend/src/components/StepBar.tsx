import { cn } from '../lib/utils';
import type { ViewStep } from '../hooks/workflowReducer';

const STEPS = [
  { key: 'plan', label: 'Plan' },
  { key: 'draft', label: 'Draft' },
  { key: 'check', label: 'Check' },
] as const;

type Status = 'idle' | 'active' | 'done';

function statusFor(step: ViewStep, index: number): Status {
  if (step === 'saved') return 'done';
  const current = STEPS.findIndex((s) => s.key === step);
  if (current === -1) return 'idle'; // empty
  if (index < current) return 'done';
  if (index === current) return 'active';
  return 'idle';
}

export function StepBar({ step }: { step: ViewStep }) {
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => {
        const status = statusFor(step, i);
        return (
          <div key={s.key} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  'mx-1 h-0.5 w-10',
                  statusFor(step, i - 1) === 'done' && step !== 'empty'
                    ? 'bg-green-600'
                    : 'bg-gray-300',
                )}
              />
            )}
            <div
              className={cn(
                'flex items-center gap-1.5 text-[13px]',
                status === 'active' && 'font-semibold text-blue-600',
                status === 'done' && 'text-green-600',
                status === 'idle' && 'text-gray-400',
              )}
            >
              <span
                className={cn(
                  'flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold',
                  status === 'active' && 'border-blue-600 bg-blue-600 text-white',
                  status === 'done' && 'border-green-600 bg-green-600 text-white',
                  status === 'idle' && 'border-gray-300',
                )}
              >
                {i + 1}
              </span>
              {s.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
