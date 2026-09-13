import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsageMeter } from './UsageMeter';
import type { UsageSnapshot } from '../api/types';

const PERIOD_END = '2026-10-01T00:00:00+00:00';

// The reset instant is UTC, but it is shown in the reader's own timezone —
// west of Greenwich that is the evening of Sep 30, and saying "Oct 1" there
// would be wrong. Derived here so the assertion holds wherever tests run.
const RESET_LABEL = new Date(PERIOD_END).toLocaleDateString(undefined, {
  month: 'short',
  day: 'numeric',
});

const snapshot = (over: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  spent_usd: 1.25,
  budget_usd: 5,
  percent: 25,
  blocked: false,
  period_end: PERIOD_END,
  ...over,
});

describe('UsageMeter', () => {
  it('reads out spend against the budget', () => {
    render(<UsageMeter usage={snapshot()} />);
    expect(screen.getByText('$1.25 / $5.00 · 25%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('says AI is paused once the budget is spent, naming the reset', () => {
    render(<UsageMeter usage={snapshot({ spent_usd: 5, percent: 100, blocked: true })} />);
    // The reset date is what tells a blocked writer when they get it back.
    expect(
      screen.getByText(`Budget used — AI paused until ${RESET_LABEL}`),
    ).toBeInTheDocument();
  });

  it('does not overflow its track when a call overshot the cap', () => {
    // Enforcement is pre-flight, so the last call can land past 100%.
    render(<UsageMeter usage={snapshot({ spent_usd: 5.4, percent: 108, blocked: true })} />);
    const fill = screen.getByRole('progressbar').firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('shows sub-cent spend as more than nothing', () => {
    render(<UsageMeter usage={snapshot({ spent_usd: 0.004, percent: 0.1 })} />);
    expect(screen.getByText(/<\$0\.01/)).toBeInTheDocument();
  });

  it('renders a fresh account as untouched rather than as an error', () => {
    render(<UsageMeter usage={snapshot({ spent_usd: 0, percent: 0 })} />);
    expect(screen.getByText('$0.00 / $5.00 · 0%')).toBeInTheDocument();
  });
});
