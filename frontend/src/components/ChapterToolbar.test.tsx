import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChapterToolbar } from './ChapterToolbar';

function props(overrides: Partial<React.ComponentProps<typeof ChapterToolbar>> = {}) {
  return {
    view: 'write' as const,
    onViewChange: vi.fn(),
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
    const p = props({ view: 'plan' });
    render(<ChapterToolbar {...p} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Write' }));
    expect(p.onViewChange).toHaveBeenCalledWith('write');
  });

  it('has a Write, a Plan and a Memory view, and nothing else', () => {
    render(<ChapterToolbar {...props()} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Write',
      'Plan',
      'Memory',
    ]);
  });

  it('no longer carries an Issues view: a review draws its findings in the prose', () => {
    render(<ChapterToolbar {...props()} />);
    expect(screen.queryByRole('tab', { name: /issues/i })).not.toBeInTheDocument();
  });

  it('carries no model action at all: reviewing is a pass in the chat picker', () => {
    render(<ChapterToolbar {...props()} />);
    expect(screen.queryByRole('button', { name: /^review$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^check$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
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
