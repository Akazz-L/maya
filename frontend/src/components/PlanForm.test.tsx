import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanForm } from './PlanForm';
import { EMPTY_PLAN, type ScenePlan } from '../api/types';

describe('PlanForm', () => {
  it('renders existing plan values', () => {
    const plan: ScenePlan = { ...EMPTY_PLAN, goal: 'Escape', pov_character: 'Maya' };
    render(<PlanForm plan={plan} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Escape')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Maya')).toBeInTheDocument();
  });

  it('emits an updated plan when a field changes', async () => {
    const onChange = vi.fn();
    render(<PlanForm plan={EMPTY_PLAN} onChange={onChange} />);
    // Field order: [0] Goal, [1] POV Character, [2] Location, ... — type into POV.
    const pov = screen.getAllByRole('textbox')[1];
    await userEvent.type(pov, 'M');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ pov_character: 'M' }),
    );
  });

  it('adds and removes beats', async () => {
    const onChange = vi.fn();
    const plan: ScenePlan = { ...EMPTY_PLAN, beats: ['first'] };
    render(<PlanForm plan={plan} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /add beat/i }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ beats: ['first', ''] }));

    onChange.mockClear();
    await userEvent.click(screen.getByTitle('Remove'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ beats: [] }));
  });
});
