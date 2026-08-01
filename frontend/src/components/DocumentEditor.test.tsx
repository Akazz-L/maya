import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentDetail } from '../api/types';

const DOC: DocumentDetail = {
  id: 'c1',
  title: 'Chapter 1',
  kind: 'chapter',
  position: 1,
  updated_at: '2026-01-01',
  body: 'The rain.',
  brief: 'Mara waits.',
  plan: null,
  issues: null,
};

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('DocumentEditor', () => {
  it('renders the title, brief, and body', () => {
    render(<DocumentEditor document={DOC} readOnly={false} onSave={vi.fn()} saveState="idle" />);
    expect(screen.getByDisplayValue('Chapter 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mara waits.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('The rain.')).toBeInTheDocument();
  });

  it('debounces the body save', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DocumentEditor document={DOC} readOnly={false} onSave={onSave} saveState="idle" />);

    await user.type(screen.getByLabelText('Document body'), '!');
    onSave.mockClear();

    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).toHaveBeenCalledWith({ body: 'The rain.!' });
  });

  it('does not save before the debounce elapses', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DocumentEditor document={DOC} readOnly={false} onSave={onSave} saveState="idle" />);

    await user.type(screen.getByLabelText('Document body'), '!');
    act(() => void vi.advanceTimersByTime(400));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('hides the brief field on non-chapter documents', () => {
    render(
      <DocumentEditor
        document={{ ...DOC, kind: 'bible', brief: '' }}
        readOnly={false}
        onSave={vi.fn()}
        saveState="idle"
      />,
    );
    expect(screen.queryByLabelText('Chapter brief')).not.toBeInTheDocument();
  });

  it('disables the body while read-only', () => {
    render(<DocumentEditor document={DOC} readOnly onSave={vi.fn()} saveState="idle" />);
    expect(screen.getByLabelText('Document body')).toBeDisabled();
  });

  it('shows the streaming override instead of local state', () => {
    render(
      <DocumentEditor
        document={DOC}
        readOnly
        onSave={vi.fn()}
        saveState="idle"
        bodyOverride="The rain. Streaming…"
      />,
    );
    expect(screen.getByDisplayValue('The rain. Streaming…')).toBeInTheDocument();
  });

  it('merges edits made inside one debounce window', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DocumentEditor document={DOC} readOnly={false} onSave={onSave} saveState="idle" />);

    await user.type(screen.getByLabelText('Document title'), '!');
    await user.type(screen.getByLabelText('Document body'), '?');
    onSave.mockClear();

    act(() => void vi.advanceTimersByTime(800));
    // The title edit must not be dropped by the later body edit.
    expect(onSave).toHaveBeenCalledWith({ title: 'Chapter 1!', body: 'The rain.?' });
  });

  it('flushes a pending edit on unmount instead of losing it', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(
      <DocumentEditor document={DOC} readOnly={false} onSave={onSave} saveState="idle" />,
    );

    await user.type(screen.getByLabelText('Document body'), '!');
    onSave.mockClear();

    unmount(); // e.g. the user switched documents mid-debounce
    expect(onSave).toHaveBeenCalledWith({ body: 'The rain.!' });
  });

  it('reports the save state', () => {
    render(<DocumentEditor document={DOC} readOnly={false} onSave={vi.fn()} saveState="saving" />);
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
  });
});
