import type { UsageSnapshot } from '../api/types';
import { cn } from '../lib/utils';

/** Amber once most of the month's budget is gone, so the wall isn't a surprise. */
const WARN_AT = 80;

function formatUsd(amount: number): string {
  // Sub-cent spend still reads as a real number rather than "$0.00".
  return amount > 0 && amount < 0.01 ? '<$0.01' : `$${amount.toFixed(2)}`;
}

function formatReset(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function UsageMeter({ usage }: { usage: UsageSnapshot }) {
  const { percent, blocked } = usage;
  const tone = blocked ? 'danger' : percent >= WARN_AT ? 'warn' : 'neutral';
  const reset = formatReset(usage.period_end);

  return (
    <div
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-lg px-2.5',
        // On a phone the meter only speaks up once the budget needs attention.
        tone === 'neutral' && 'max-sm:hidden',
        tone === 'danger' && 'bg-danger-soft',
        tone === 'warn' && 'bg-warn-soft',
      )}
      title={
        blocked
          ? `AI is paused until the budget resets on ${reset}.`
          : `${formatUsd(usage.spent_usd)} of ${formatUsd(usage.budget_usd)} used this month. Resets ${reset}.`
      }
    >
      <div
        role="progressbar"
        aria-label="AI budget used"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-ink/10"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-warn' : 'bg-accent',
          )}
          // Capped at 100 so a call that overshot the cap doesn't overflow the track.
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {blocked ? (
        <span className="text-xs font-medium text-danger">
          Budget used — AI paused until {reset}
        </span>
      ) : (
        <span
          className={cn(
            'text-xs tabular-nums max-sm:hidden',
            tone === 'warn' ? 'font-medium text-warn' : 'text-ink-2',
          )}
        >
          {formatUsd(usage.spent_usd)} / {formatUsd(usage.budget_usd)} · {Math.round(percent)}%
        </span>
      )}
    </div>
  );
}
