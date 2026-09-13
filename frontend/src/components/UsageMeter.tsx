import type { UsageSnapshot } from '../api/types';

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
  const tone = blocked ? 'red' : percent >= WARN_AT ? 'amber' : 'neutral';
  const reset = formatReset(usage.period_end);

  return (
    <div
      className="flex items-center gap-2"
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
        className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200"
      >
        <div
          className={
            tone === 'red' ? 'h-full bg-red-500' : tone === 'amber' ? 'h-full bg-amber-500' : 'h-full bg-gray-500'
          }
          // Capped at 100 so a call that overshot the cap doesn't overflow the track.
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {blocked ? (
        <span className="text-xs font-medium text-red-700">Budget used — AI paused until {reset}</span>
      ) : (
        <span className={tone === 'amber' ? 'text-xs text-amber-700' : 'text-xs text-gray-500'}>
          {formatUsd(usage.spent_usd)} / {formatUsd(usage.budget_usd)} · {Math.round(percent)}%
        </span>
      )}
    </div>
  );
}
