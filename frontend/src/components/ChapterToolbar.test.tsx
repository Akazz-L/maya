import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChapterToolbar } from './ChapterToolbar';

function props(overrides: Partial<React.ComponentProps<typeof ChapterToolbar>> = {}) {
  return {
    busy: false,
    aiBlocked: false,
    onGeneratePlan: vi.fn(),
    onCheck: vi.fn(),
    hasPanelContent: false,
    panelOpen: false,
    onTogglePanel: vi.fn(),
    chatOpen: false,
    onToggleChat: vi.fn(),
    ...overrides,
  };
}

describe('ChapterToolbar', () => {
  it('fires each action', async () => {
    const p = props();
    render(<ChapterToolbar {...p} />);

    await userEvent.click(screen.getByRole('button', { name: /generate plan/i }));
    await userEvent.click(screen.getByRole('button', { name: /^check$/i }));

    expect(p.onGeneratePlan).toHaveBeenCalled();
    expect(p.onCheck).toHaveBeenCalled();
  });

  it('no longer drafts behind a hidden plan: drafting lives in the chat', () => {
    render(<ChapterToolbar {...props()} />);
    expect(screen.queryByRole('button', { name: /generate draft/i })).not.toBeInTheDocument();
  });

  it('disables the model actions while busy, but never the chat toggle', () => {
    render(<ChapterToolbar {...props({ busy: true })} />);
    expect(screen.getByRole('button', { name: /generate plan/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^chat$/i })).toBeEnabled();
  });

  it('disables the model actions but not the toggles when AI is blocked', () => {
    render(<ChapterToolbar {...props({ aiBlocked: true, hasPanelContent: true })} />);
    expect(screen.getByRole('button', { name: /generate plan/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /show plan/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^chat$/i })).toBeEnabled();
  });

  it('disables the panel toggle when there is nothing to show', () => {
    render(<ChapterToolbar {...props()} />);
    expect(screen.getByRole('button', { name: /show plan/i })).toBeDisabled();
  });

  it('toggles a saved plan back into view', async () => {
    const p = props({ hasPanelContent: true });
    render(<ChapterToolbar {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /show plan/i }));
    expect(p.onTogglePanel).toHaveBeenCalled();
  });

  it('toggles the chat and shows whether it is open', async () => {
    const p = props({ chatOpen: true });
    render(<ChapterToolbar {...p} />);
    const toggle = screen.getByRole('button', { name: /^chat$/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    expect(p.onToggleChat).toHaveBeenCalled();
  });
});
