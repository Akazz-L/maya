import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChapterToolbar } from './ChapterToolbar';

function props(overrides: Partial<React.ComponentProps<typeof ChapterToolbar>> = {}) {
  return {
    view: 'write' as const,
    onViewChange: vi.fn(),
    issueCount: null,
    busy: false,
    aiBlocked: false,
    onGenerateDraft: vi.fn(),
    onCheck: vi.fn(),
    ...overrides,
  };
}

describe('ChapterToolbar', () => {
  it('marks the current view as selected', () => {
    render(<ChapterToolbar {...props({ view: 'plan' })} />);
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Write' })).toHaveAttribute('aria-selected', 'false');
  });

  it('switches views', async () => {
    const p = props();
    render(<ChapterToolbar {...p} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Issues' }));
    expect(p.onViewChange).toHaveBeenNthCalledWith(1, 'plan');
    expect(p.onViewChange).toHaveBeenNthCalledWith(2, 'issues');
  });

  it('shows the issue count on the issues tab', () => {
    render(<ChapterToolbar {...props({ issueCount: 2 })} />);
    expect(screen.getByRole('tab', { name: 'Issues (2)' })).toBeInTheDocument();
  });

  it('fires the model actions', async () => {
    const p = props();
    render(<ChapterToolbar {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /generate draft/i }));
    await userEvent.click(screen.getByRole('button', { name: /^check$/i }));
    expect(p.onGenerateDraft).toHaveBeenCalled();
    expect(p.onCheck).toHaveBeenCalled();
  });

  it('disables the model actions but not the view switcher while busy', () => {
    // Switching views calls no model; locking it would strand a writer in the
    // Plan view for as long as a plan takes to generate.
    render(<ChapterToolbar {...props({ busy: true })} />);
    expect(screen.getByRole('button', { name: /generate draft/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();
    screen.getAllByRole('tab').forEach((t) => expect(t).toBeEnabled());
  });

  it('disables the model actions when AI is blocked', () => {
    render(<ChapterToolbar {...props({ aiBlocked: true })} />);
    expect(screen.getByRole('button', { name: /generate draft/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();
    screen.getAllByRole('tab').forEach((t) => expect(t).toBeEnabled());
  });
});
