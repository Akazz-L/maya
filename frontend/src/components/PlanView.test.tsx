import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanView, type PlanUndo } from './PlanView';
import { EMPTY_PLAN, type ScenePlan } from '../api/types';

function props(overrides: Partial<React.ComponentProps<typeof PlanView>> = {}) {
  return {
    plan: { ...EMPTY_PLAN, goal: 'Escape' } as ScenePlan | null,
    generating: false,
    failed: false,
    undo: null as PlanUndo | null,
    busy: false,
    aiBlocked: false,
    onChange: vi.fn(),
    onGenerate: vi.fn(),
    onRemove: vi.fn(),
    onUndo: vi.fn(),
    onStartBlank: vi.fn(),
    onGenerateDraft: vi.fn(),
    ...overrides,
  };
}

describe('PlanView', () => {
  it('shows the plan fields', () => {
    render(<PlanView {...props()} />);
    expect(screen.getByDisplayValue('Escape')).toBeEnabled();
  });

  it('regenerates the plan', async () => {
    const p = props();
    render(<PlanView {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(p.onGenerate).toHaveBeenCalled();
  });

  it('drafts from the plan', async () => {
    const p = props();
    render(<PlanView {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /draft from plan/i }));
    expect(p.onGenerateDraft).toHaveBeenCalled();
  });

  it('shows progress rather than an empty form while the first plan generates', () => {
    render(<PlanView {...props({ plan: null, generating: true })} />);
    expect(screen.getByText(/planning from your brief/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /blank plan/i })).not.toBeInTheDocument();
  });

  it('locks the fields while a regenerate is in flight', () => {
    // Anything typed now would be overwritten the moment the new plan lands.
    render(<PlanView {...props({ generating: true, busy: true })} />);
    expect(screen.getByDisplayValue('Escape')).toBeDisabled();
    expect(screen.getByText(/regenerating/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /draft from plan/i })).toBeDisabled();
  });

  it('offers to undo a regenerate', async () => {
    const p = props({ undo: 'regenerated' });
    render(<PlanView {...p} />);
    expect(screen.getByText(/plan regenerated/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(p.onUndo).toHaveBeenCalled();
  });

  it('removes the plan, even once the budget is spent', async () => {
    // Removing calls no model; planning is optional, so a plan must be removable.
    const p = props({ aiBlocked: true });
    render(<PlanView {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /remove plan/i }));
    expect(p.onRemove).toHaveBeenCalled();
  });

  it('will not remove a plan while a regenerate is in flight', () => {
    // The regenerated plan would land after the removal and bring a plan back.
    render(<PlanView {...props({ generating: true, busy: true })} />);
    expect(screen.getByRole('button', { name: /remove plan/i })).toBeDisabled();
  });

  it('offers to undo a removal from the empty state', async () => {
    const p = props({ plan: null, undo: 'removed' });
    render(<PlanView {...p} />);
    expect(screen.getByText(/plan removed/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(p.onUndo).toHaveBeenCalled();
  });

  it('offers to generate or start blank when there is no plan', async () => {
    const p = props({ plan: null });
    render(<PlanView {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /generate plan/i }));
    await userEvent.click(screen.getByRole('button', { name: /start a blank plan/i }));
    expect(p.onGenerate).toHaveBeenCalled();
    expect(p.onStartBlank).toHaveBeenCalled();
  });

  it('offers a retry when generation failed', async () => {
    const p = props({ plan: null, failed: true });
    render(<PlanView {...p} />);
    expect(screen.getByText(/could not generate a plan/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(p.onGenerate).toHaveBeenCalled();
  });

  it('offers only a blank plan once the budget is spent', async () => {
    const p = props({ plan: null, aiBlocked: true });
    render(<PlanView {...p} />);
    expect(screen.getByText(/ai budget used/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate plan|retry/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /start a blank plan/i }));
    expect(p.onStartBlank).toHaveBeenCalled();
  });

  it('keeps a plan editable once the budget is spent, but will not call the model', () => {
    render(<PlanView {...props({ aiBlocked: true })} />);
    expect(screen.getByDisplayValue('Escape')).toBeEnabled();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /draft from plan/i })).toBeDisabled();
  });
});
