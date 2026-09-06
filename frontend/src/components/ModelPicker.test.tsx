import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelPicker } from './ModelPicker';

const MODELS = [
  { key: 'haiku' as const, label: 'Haiku 4.5', hint: 'fastest, cheapest' },
  { key: 'sonnet' as const, label: 'Sonnet 5', hint: '2x the cost of Haiku' },
  { key: 'opus' as const, label: 'Opus 5', hint: 'best prose, 5x the cost of Haiku' },
];

describe('ModelPicker', () => {
  it('names the relative cost of each model, so the choice is legible', () => {
    render(<ModelPicker models={MODELS} value="haiku" onChange={() => {}} />);
    expect(screen.getByRole('option', { name: /opus 5 · best prose, 5x the cost/i })).toBeInTheDocument();
  });

  it('reports the chosen model', async () => {
    const onChange = vi.fn();
    render(<ModelPicker models={MODELS} value="haiku" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'opus');
    expect(onChange).toHaveBeenCalledWith('opus');
  });

  it('stays usable while a change is not in flight', () => {
    render(<ModelPicker models={MODELS} value="sonnet" onChange={() => {}} />);
    expect(screen.getByLabelText('Model')).toBeEnabled();
  });

  it('locks only while the change is saving', () => {
    render(<ModelPicker models={MODELS} value="sonnet" onChange={() => {}} saving />);
    expect(screen.getByLabelText('Model')).toBeDisabled();
  });
});
