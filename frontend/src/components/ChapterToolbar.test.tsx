import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChapterToolbar } from './ChapterToolbar';

function props(overrides: Partial<React.ComponentProps<typeof ChapterToolbar>> = {}) {
  return {
    view: 'write' as const,
    onViewChange: vi.fn(),
    issueCount: 0 as number | null,
    busy: false,
    aiBlocked: false,
    onReview: vi.fn(),
    chatOpen: false,
    onToggleChat: vi.fn(),
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

  it('hides the Issues tab until a review has run', () => {
    // issueCount is null before the first Review; a clean review reports 0.
    render(<ChapterToolbar {...props({ issueCount: null })} />);
    expect(screen.queryByRole('tab', { name: /issues/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Write' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Plan' })).toBeInTheDocument();
  });

  it('shows the issue count once a review found some', () => {
    render(<ChapterToolbar {...props({ issueCount: 2 })} />);
    expect(screen.getByRole('tab', { name: 'Issues (2)' })).toBeInTheDocument();
  });

  it('runs a review', async () => {
    const p = props();
    render(<ChapterToolbar {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /^review$/i }));
    expect(p.onReview).toHaveBeenCalled();
  });

  it('no longer drafts or plans from the toolbar: those live in the chat and the Plan view', () => {
    render(<ChapterToolbar {...props()} />);
    expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^check$/i })).not.toBeInTheDocument();
  });

  it('disables Review while busy, but never the view switcher or the chat toggle', () => {
    // Switching views calls no model; locking it would strand a writer in the
    // Plan view for as long as a plan takes to generate.
    render(<ChapterToolbar {...props({ busy: true })} />);
    expect(screen.getByRole('button', { name: /^review$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^chat$/i })).toBeEnabled();
    screen.getAllByRole('tab').forEach((t) => expect(t).toBeEnabled());
  });

  it('disables Review but not the toggles when AI is blocked', () => {
    render(<ChapterToolbar {...props({ aiBlocked: true })} />);
    expect(screen.getByRole('button', { name: /^review$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^chat$/i })).toBeEnabled();
    screen.getAllByRole('tab').forEach((t) => expect(t).toBeEnabled());
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
