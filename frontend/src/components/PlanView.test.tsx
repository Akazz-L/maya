import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlanUndo } from '../hooks/useChapterPlan';
import { PlanView } from './PlanView';
import { EMPTY_PLAN, type ScenePlan } from '../api/types';

function props(overrides: Partial<React.ComponentProps<typeof PlanView>> = {}) {
  return {
    plan: { ...EMPTY_PLAN, goal: 'Escape' } as ScenePlan | null,
    context: 'Mara waits.',
    onContextChange: vi.fn(),
    generating: false,
    undo: null as PlanUndo | null,
    busy: false,
    aiBlocked: false,
    onChange: vi.fn(),
    onGenerate: vi.fn(),
    onRemove: vi.fn(),
    onUndo: vi.fn(),
    onGenerateDraft: vi.fn(),
    ...overrides,
  };
}

afterEach(() => localStorage.clear());

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

  it('offers an empty, editable plan rather than generating one on sight', async () => {
    // Opening Plan on a chapter without one must not spend a model call: the
    // writer decides, by typing or by pressing Generate plan.
    const p = props({ plan: null });
    render(<PlanView {...p} />);

    expect(screen.getByLabelText('Goal')).toHaveValue('');
    expect(screen.getByRole('button', { name: /generate plan/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /draft from plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove plan/i })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Goal'), 'E');
    expect(p.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ goal: 'E' }));
  });

  it('writes a plan by hand even once the budget is spent', async () => {
    const p = props({ plan: null, aiBlocked: true });
    render(<PlanView {...p} />);

    expect(screen.getByRole('button', { name: /generate plan/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Goal'), 'E');
    expect(p.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ goal: 'E' }));
  });

  it('shows progress rather than an empty form while the first plan generates', () => {
    render(<PlanView {...props({ plan: null, generating: true })} />);
    expect(screen.getByText(/planning from your chapter context/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Goal')).not.toBeInTheDocument();
  });

  it('says a plan without context is proposed from the story so far', () => {
    render(<PlanView {...props({ plan: null, context: '  \n', generating: true })} />);
    expect(screen.getByText(/proposing a plan from the story so far/i)).toBeInTheDocument();
  });

  it('edits the chapter context in place, without leaving for the Write view', async () => {
    const p = props();
    render(<PlanView {...p} />);
    await userEvent.click(screen.getAllByRole('button', { name: /chapter context/i })[0]);
    await userEvent.type(screen.getByLabelText('Chapter context'), '!');
    expect(p.onContextChange).toHaveBeenLastCalledWith('Mara waits.!');
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

  it('offers to undo a removal from the empty form', async () => {
    const p = props({ plan: null, undo: 'removed' });
    render(<PlanView {...p} />);
    expect(screen.getByText(/plan removed/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(p.onUndo).toHaveBeenCalled();
  });

  it('keeps a plan editable once the budget is spent, but will not call the model', () => {
    render(<PlanView {...props({ aiBlocked: true })} />);
    expect(screen.getByDisplayValue('Escape')).toBeEnabled();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /draft from plan/i })).toBeDisabled();
  });
});
