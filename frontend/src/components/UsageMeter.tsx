import { cn } from '../lib/utils';
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
  const tone = blocked ? 'danger' : percent >= WARN_AT ? 'warning' : 'neutral';
  const reset = formatReset(usage.period_end);
  const spent = `${formatUsd(usage.spent_usd)} / ${formatUsd(usage.budget_usd)} · ${Math.round(percent)}%`;
  const summary = blocked
    ? `AI is paused until the budget resets on ${reset}.`
    : `${formatUsd(usage.spent_usd)} of ${formatUsd(usage.budget_usd)} used this month. Resets ${reset}.`;

  return (
    <div className="flex items-center gap-2" title={summary}>
      <div
        role="progressbar"
        aria-label="AI budget used"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={summary}
        className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-sunken sm:w-20"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-ink-subtle',
          )}
          // Capped at 100 so a call that overshot the cap doesn't overflow the track.
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {/* The bar and its value text carry the reading on a narrow screen. */}
      {blocked ? (
        <span className="hidden text-xs font-medium text-danger md:inline">
          Budget used — AI paused until {reset}
        </span>
      ) : (
        <span
          className={cn(
            'hidden text-xs tabular-nums md:inline',
            tone === 'warning' ? 'font-medium text-warning' : 'text-ink-subtle',
          )}
        >
          {spent}
        </span>
      )}
    </div>
  );
}
