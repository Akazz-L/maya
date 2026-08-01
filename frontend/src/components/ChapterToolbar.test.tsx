import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChapterToolbar } from './ChapterToolbar';

describe('ChapterToolbar', () => {
  it('fires each action', async () => {
    const props = {
      busy: false,
      onGeneratePlan: vi.fn(),
      onGenerateDraft: vi.fn(),
      onCheck: vi.fn(),
    };
    render(<ChapterToolbar {...props} />);

    await userEvent.click(screen.getByRole('button', { name: /generate plan/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate draft/i }));
    await userEvent.click(screen.getByRole('button', { name: /^check$/i }));

    expect(props.onGeneratePlan).toHaveBeenCalled();
    expect(props.onGenerateDraft).toHaveBeenCalled();
    expect(props.onCheck).toHaveBeenCalled();
  });

  it('disables everything while busy', () => {
    render(
      <ChapterToolbar busy onGeneratePlan={vi.fn()} onGenerateDraft={vi.fn()} onCheck={vi.fn()} />,
    );
    screen.getAllByRole('button').forEach((b) => expect(b).toBeDisabled());
  });
});
