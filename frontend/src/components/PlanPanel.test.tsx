import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanPanel } from './PlanPanel';
import { EMPTY_PLAN, type Issue } from '../api/types';

const ISSUES: Issue[] = [
  { issue: 'Wrong hand', severity: 'critical', location: 'p1', suggested_fix: 'left' },
];

function props(overrides: Partial<React.ComponentProps<typeof PlanPanel>> = {}) {
  return {
    plan: { ...EMPTY_PLAN, goal: 'Escape' },
    issues: null,
    height: 240,
    onHeightChange: vi.fn(),
    onPlanChange: vi.fn(),
    onIssuesChange: vi.fn(),
    onDrop: vi.fn(),
    onGenerateDraft: vi.fn(),
    onRevise: vi.fn(),
    busy: false,
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('PlanPanel', () => {
  it('shows the plan fields', () => {
    render(<PlanPanel {...props()} />);
    expect(screen.getByDisplayValue('Escape')).toBeInTheDocument();
  });

  it('prompts to generate a plan when there is none', () => {
    render(<PlanPanel {...props({ plan: null })} />);
    expect(screen.getByText(/no plan yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate draft/i })).toBeDisabled();
  });

  it('drops the plan', async () => {
    const p = props();
    render(<PlanPanel {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /drop/i }));
    expect(p.onDrop).toHaveBeenCalled();
  });

  it('generates a draft from the plan', async () => {
    const p = props();
    render(<PlanPanel {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /generate draft/i }));
    expect(p.onGenerateDraft).toHaveBeenCalled();
  });

  it('switches to the issues tab and offers revise', async () => {
    const p = props({ issues: ISSUES });
    render(<PlanPanel {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /issues/i }));
    expect(screen.getByDisplayValue('Wrong hand')).toBeInTheDocument();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /revise draft/i }));
    expect(p.onRevise).toHaveBeenCalled();
  });

  it('does not revise when the confirm is declined', async () => {
    const p = props({ issues: ISSUES });
    render(<PlanPanel {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /issues/i }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(screen.getByRole('button', { name: /revise draft/i }));
    expect(p.onRevise).not.toHaveBeenCalled();
  });

  it('shows the issue count on the tab', () => {
    render(<PlanPanel {...props({ issues: ISSUES })} />);
    expect(screen.getByRole('button', { name: 'Issues (1)' })).toBeInTheDocument();
  });
});
