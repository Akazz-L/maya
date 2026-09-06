import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentDetail } from '../api/types';
import { typeAtEnd, viewFor } from '../test/editor';

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
    render(<DocumentEditor document={DOC} projectId="p1" readOnly={false} onSave={vi.fn()} saveState="idle" />);
    expect(screen.getByDisplayValue('Chapter 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mara waits.')).toBeInTheDocument();
    expect(screen.getByLabelText('Document body')).toHaveTextContent('The rain.');
  });

  it('debounces the body save', () => {
    const onSave = vi.fn();
    render(<DocumentEditor document={DOC} projectId="p1" readOnly={false} onSave={onSave} saveState="idle" />);

    typeAtEnd('Document body', '!');
    onSave.mockClear();

    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).toHaveBeenCalledWith({ body: 'The rain.!' });
  });

  it('does not save before the debounce elapses', () => {
    const onSave = vi.fn();
    render(<DocumentEditor document={DOC} projectId="p1" readOnly={false} onSave={onSave} saveState="idle" />);

    typeAtEnd('Document body', '!');
    act(() => void vi.advanceTimersByTime(400));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('hides the brief field on non-chapter documents', () => {
    render(
      <DocumentEditor
        document={{ ...DOC, kind: 'bible', brief: '' }}
        projectId="p1"
        readOnly={false}
        onSave={vi.fn()}
        saveState="idle"
      />,
    );
    expect(screen.queryByLabelText('Chapter brief')).not.toBeInTheDocument();
  });

  it('disables the body while read-only', () => {
    render(<DocumentEditor document={DOC} projectId="p1" readOnly onSave={vi.fn()} saveState="idle" />);
    expect(screen.getByLabelText('Document body')).toHaveAttribute('contenteditable', 'false');
  });

  it('shows the streaming override instead of local state', () => {
    render(
      <DocumentEditor
        document={DOC}
        projectId="p1"
        readOnly
        onSave={vi.fn()}
        saveState="idle"
        bodyOverride="The rain. Streaming…"
      />,
    );
    expect(viewFor('Document body').state.doc.toString()).toBe('The rain. Streaming…');
  });

  it('merges edits made inside one debounce window', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DocumentEditor document={DOC} projectId="p1" readOnly={false} onSave={onSave} saveState="idle" />);

    await user.type(screen.getByLabelText('Document title'), '!');
    typeAtEnd('Document body', '?');
    onSave.mockClear();

    act(() => void vi.advanceTimersByTime(800));
    // The title edit must not be dropped by the later body edit.
    expect(onSave).toHaveBeenCalledWith({ title: 'Chapter 1!', body: 'The rain.?' });
  });

  it('flushes a pending edit on unmount instead of losing it', () => {
    const onSave = vi.fn();
    const { unmount } = render(
      <DocumentEditor document={DOC} projectId="p1" readOnly={false} onSave={onSave} saveState="idle" />,
    );

    typeAtEnd('Document body', '!');
    onSave.mockClear();

    unmount(); // e.g. the user switched documents mid-debounce
    expect(onSave).toHaveBeenCalledWith({ body: 'The rain.!' });
  });

  it('reports the save state', () => {
    render(<DocumentEditor document={DOC} projectId="p1" readOnly={false} onSave={vi.fn()} saveState="saving" />);
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
  });

  it('does not autosave the streaming override', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <DocumentEditor document={DOC} projectId="p1" readOnly onSave={onSave} saveState="idle" bodyOverride="The rain. S" />,
    );
    rerender(
      <DocumentEditor document={DOC} projectId="p1" readOnly onSave={onSave} saveState="idle" bodyOverride="The rain. St" />,
    );
    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).not.toHaveBeenCalled();
  });
});
