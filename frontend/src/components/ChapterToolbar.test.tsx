import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChapterToolbar } from './ChapterToolbar';

describe('ChapterToolbar', () => {
  it('fires each action', async () => {
    const props = {
      busy: false,
      aiBlocked: false,
      onGeneratePlan: vi.fn(),
      onGenerateDraft: vi.fn(),
      onCheck: vi.fn(),
      hasPanelContent: false,
      panelOpen: false,
      onTogglePanel: vi.fn(),
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
      <ChapterToolbar
        busy
        aiBlocked={false}
        onGeneratePlan={vi.fn()}
        onGenerateDraft={vi.fn()}
        onCheck={vi.fn()}
        hasPanelContent={false}
        panelOpen={false}
        onTogglePanel={vi.fn()}
      />,
    );
    screen.getAllByRole('button').forEach((b) => expect(b).toBeDisabled());
  });

  it('disables the model actions but not the panel toggle when AI is blocked', () => {
    render(
      <ChapterToolbar
        busy={false}
        aiBlocked
        onGeneratePlan={vi.fn()}
        onGenerateDraft={vi.fn()}
        onCheck={vi.fn()}
        hasPanelContent
        panelOpen={false}
        onTogglePanel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /generate plan/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /generate draft/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^check$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /show plan/i })).toBeEnabled();
  });

  it('disables the panel toggle when there is nothing to show', () => {
    render(
      <ChapterToolbar
        busy={false}
        aiBlocked={false}
        onGeneratePlan={vi.fn()}
        onGenerateDraft={vi.fn()}
        onCheck={vi.fn()}
        hasPanelContent={false}
        panelOpen={false}
        onTogglePanel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /show plan/i })).toBeDisabled();
  });

  it('toggles a saved plan back into view', async () => {
    const onTogglePanel = vi.fn();
    render(
      <ChapterToolbar
        busy={false}
        aiBlocked={false}
        onGeneratePlan={vi.fn()}
        onGenerateDraft={vi.fn()}
        onCheck={vi.fn()}
        hasPanelContent
        panelOpen={false}
        onTogglePanel={onTogglePanel}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /show plan/i }));
    expect(onTogglePanel).toHaveBeenCalled();
  });
});
