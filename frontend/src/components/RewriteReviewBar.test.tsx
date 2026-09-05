import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RewriteReviewBar } from './RewriteReviewBar';

function renderBar(over: Partial<Parameters<typeof RewriteReviewBar>[0]> = {}) {
  const props = {
    error: null,
    showDiff: true,
    onToggleDiff: vi.fn(),
    onAccept: vi.fn(),
    onDiscard: vi.fn(),
    onRetry: vi.fn(),
    ...over,
  };
  render(<RewriteReviewBar {...props} />);
  return props;
}

describe('RewriteReviewBar', () => {
  it('fires accept, discard, try again, and the diff toggle', async () => {
    const p = renderBar();
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));
    await userEvent.click(screen.getByRole('button', { name: /discard/i }));
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await userEvent.click(screen.getByRole('button', { name: /show result/i }));
    expect(p.onAccept).toHaveBeenCalled();
    expect(p.onDiscard).toHaveBeenCalled();
    expect(p.onRetry).toHaveBeenCalled();
    expect(p.onToggleDiff).toHaveBeenCalled();
  });

  it('focuses Accept so Enter accepts', () => {
    renderBar();
    expect(screen.getByRole('button', { name: /accept/i })).toHaveFocus();
  });

  it('labels the toggle by what it will show', () => {
    renderBar({ showDiff: false });
    expect(screen.getByRole('button', { name: /show diff/i })).toBeInTheDocument();
  });

  it('shows the error with Retry and Discard only', () => {
    renderBar({ error: 'model exploded' });
    expect(screen.getByText('model exploded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument();
  });
});
