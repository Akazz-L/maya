import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IssuesView } from './IssuesView';
import type { Issue } from '../api/types';

const ISSUES: Issue[] = [
  { issue: 'Wrong hand', severity: 'critical', location: 'p1', suggested_fix: 'left' },
];

function props(overrides: Partial<React.ComponentProps<typeof IssuesView>> = {}) {
  return {
    issues: ISSUES as Issue[] | null,
    busy: false,
    aiBlocked: false,
    onChange: vi.fn(),
    onRevise: vi.fn(),
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('IssuesView', () => {
  it('shows the issues', () => {
    render(<IssuesView {...props()} />);
    expect(screen.getByDisplayValue('Wrong hand')).toBeInTheDocument();
  });

  it('revises the draft once confirmed', async () => {
    const p = props();
    render(<IssuesView {...p} />);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /revise draft/i }));
    expect(p.onRevise).toHaveBeenCalled();
  });

  it('does not revise when the confirm is declined', async () => {
    const p = props();
    render(<IssuesView {...p} />);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(screen.getByRole('button', { name: /revise draft/i }));
    expect(p.onRevise).not.toHaveBeenCalled();
  });

  it('points at Check before any check has run', () => {
    render(<IssuesView {...props({ issues: null })} />);
    expect(screen.getByText(/no check has run/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revise draft/i })).toBeDisabled();
  });

  it('does not offer revise while busy or when AI is blocked', () => {
    const { rerender } = render(<IssuesView {...props({ busy: true })} />);
    expect(screen.getByRole('button', { name: /revise draft/i })).toBeDisabled();
    rerender(<IssuesView {...props({ aiBlocked: true })} />);
    expect(screen.getByRole('button', { name: /revise draft/i })).toBeDisabled();
  });
});
