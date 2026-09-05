import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RewritePrompt } from './RewritePrompt';

describe('RewritePrompt', () => {
  it('focuses the input and submits on Enter', async () => {
    const onSubmit = vi.fn();
    render(<RewritePrompt initialInstruction="" onSubmit={onSubmit} onCancel={vi.fn()} />);
    const input = screen.getByLabelText('Rewrite instruction');
    expect(input).toHaveFocus();
    await userEvent.type(input, 'make it tense{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('make it tense');
  });

  it('does not submit an empty instruction', async () => {
    const onSubmit = vi.fn();
    render(<RewritePrompt initialInstruction="" onSubmit={onSubmit} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Rewrite instruction'), '   {Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /rewrite/i })).toBeDisabled();
  });

  it('cancels on Escape', async () => {
    const onCancel = vi.fn();
    render(<RewritePrompt initialInstruction="" onSubmit={vi.fn()} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('seeds the input with the previous instruction', () => {
    render(<RewritePrompt initialInstruction="tighten" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Rewrite instruction')).toHaveValue('tighten');
  });

  it('fills the input from a preset chip', async () => {
    const onSubmit = vi.fn();
    render(<RewritePrompt initialInstruction="" onSubmit={onSubmit} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'More tension' }));
    expect(screen.getByLabelText('Rewrite instruction')).toHaveValue(
      'Raise the tension. Keep what happens the same.',
    );
    await userEvent.click(screen.getByRole('button', { name: /^rewrite$/i }));
    expect(onSubmit).toHaveBeenCalledWith('Raise the tension. Keep what happens the same.');
  });
});
