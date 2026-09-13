import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GeneratePlanButton } from './GeneratePlanButton';

function props(overrides: Partial<React.ComponentProps<typeof GeneratePlanButton>> = {}) {
  return {
    disabled: false,
    brief: 'Mara waits.\nThe bell rings.',
    beforeOpen: vi.fn(() => Promise.resolve()),
    onGenerate: vi.fn(),
    onEditNotes: vi.fn(),
    ...overrides,
  };
}

const trigger = () => screen.getByRole('button', { name: /generate plan/i });

describe('GeneratePlanButton', () => {
  it('shows the notes the plan will be built from before generating', async () => {
    const p = props();
    render(<GeneratePlanButton {...p} />);

    await userEvent.click(trigger());

    const dialog = await screen.findByRole('dialog', { name: /generate a scene plan/i });
    expect(p.beforeOpen).toHaveBeenCalled();
    expect(dialog).toHaveTextContent('Mara waits. The bell rings.');
    expect(p.onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^generate$/i })).toHaveFocus();
  });

  it('generates on confirm and closes', async () => {
    const p = props();
    render(<GeneratePlanButton {...p} />);
    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole('button', { name: /^generate$/i }));

    expect(p.onGenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says what happens without notes, and offers to add some', async () => {
    const p = props({ brief: '  \n' });
    render(<GeneratePlanButton {...p} />);
    await userEvent.click(trigger());

    expect(await screen.findByRole('dialog')).toHaveTextContent(/no chapter notes yet/i);
    await userEvent.click(screen.getByRole('button', { name: /add notes/i }));

    expect(p.onEditNotes).toHaveBeenCalled();
    expect(p.onGenerate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the button', async () => {
    render(<GeneratePlanButton {...props()} />);
    await userEvent.click(trigger());
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('closes on a press outside', async () => {
    render(<GeneratePlanButton {...props()} />);
    await userEvent.click(trigger());
    await screen.findByRole('dialog');

    await userEvent.click(document.body);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cannot be opened while disabled', () => {
    render(<GeneratePlanButton {...props({ disabled: true })} />);
    expect(trigger()).toBeDisabled();
  });
});
