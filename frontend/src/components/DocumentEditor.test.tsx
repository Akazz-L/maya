import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentDetail } from '../api/types';
import { typeAtEnd } from '../test/editor';

const DOC: DocumentDetail = {
  id: 'c1',
  title: 'Chapter 1',
  kind: 'chapter',
  position: 1,
  updated_at: '2026-01-01',
  body: 'The rain.',
  brief: 'Mara waits.',
  plan: null,
};

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('DocumentEditor', () => {
  it('renders the title, chapter context, and body', () => {
    render(
      <DocumentEditor
        document={DOC}
        projectId="p1"
        onSave={vi.fn()}
        saveState="idle"
        context="Mara waits."
      />,
    );
    expect(screen.getByDisplayValue('Chapter 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /chapter context/i })).toHaveTextContent(
      'Mara waits.',
    );
    expect(screen.getByLabelText('Document body')).toHaveTextContent('The rain.');
  });

  it('debounces the body save', () => {
    const onSave = vi.fn();
    render(<DocumentEditor document={DOC} projectId="p1" onSave={onSave} saveState="idle" />);

    typeAtEnd('Document body', '!');
    onSave.mockClear();

    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).toHaveBeenCalledWith({ body: 'The rain.!' });
  });

  it('does not save before the debounce elapses', () => {
    const onSave = vi.fn();
    render(<DocumentEditor document={DOC} projectId="p1" onSave={onSave} saveState="idle" />);

    typeAtEnd('Document body', '!');
    act(() => void vi.advanceTimersByTime(400));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('hides the chapter context on non-chapter documents', () => {
    render(
      <DocumentEditor
        document={{ ...DOC, kind: 'bible', brief: '' }}
        projectId="p1"
        onSave={vi.fn()}
        saveState="idle"
      />,
    );
    expect(screen.queryByRole('button', { name: /chapter context/i })).not.toBeInTheDocument();
  });

  it.each([
    ['bible', /AI reads this/],
    ['chapter', /ask the chat for a draft/],
    ['note', /not included in the AI context/],
  ] as const)('shows a %s helper while the body is empty', (kind, helper) => {
    render(
      <DocumentEditor
        document={{ ...DOC, kind, body: '' }}
        projectId="p1"
        onSave={vi.fn()}
        saveState="idle"
      />,
    );
    expect(screen.getByLabelText('Document body')).toHaveTextContent(helper);
  });

  it('hides the helper once the body has text', () => {
    render(
      <DocumentEditor
        document={{ ...DOC, kind: 'note', body: '' }}
        projectId="p1"
        onSave={vi.fn()}
        saveState="idle"
      />,
    );
    typeAtEnd('Document body', 'Salt prices.');
    expect(screen.getByLabelText('Document body')).not.toHaveTextContent(/AI context/);
  });

  it('reports chapter context edits to its owner rather than saving them itself', async () => {
    // The Plan view edits the same text, so the workspace owns it and its save.
    const onSave = vi.fn();
    const onContextChange = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <DocumentEditor
        document={DOC}
        projectId="p1"
        onSave={onSave}
        saveState="idle"
        context=""
        onContextChange={onContextChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /chapter context/i }));
    await user.type(screen.getByLabelText('Chapter context'), 'M');
    act(() => void vi.advanceTimersByTime(800));

    expect(onContextChange).toHaveBeenLastCalledWith('M');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('locks the body while a chat proposal is on screen', () => {
    render(
      <DocumentEditor
        document={DOC}
        projectId="p1"
        onSave={vi.fn()}
        saveState="idle"
        proposal={{ phase: 'streaming', mode: 'append', text: '' }}
      />,
    );
    expect(screen.getByLabelText('Document body')).toHaveAttribute('contenteditable', 'false');
  });

  it('merges edits made inside one debounce window', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DocumentEditor document={DOC} projectId="p1" onSave={onSave} saveState="idle" />);

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
      <DocumentEditor document={DOC} projectId="p1" onSave={onSave} saveState="idle" />,
    );

    typeAtEnd('Document body', '!');
    onSave.mockClear();

    unmount(); // e.g. the user switched documents mid-debounce
    expect(onSave).toHaveBeenCalledWith({ body: 'The rain.!' });
  });

  it('reports the save state', () => {
    render(<DocumentEditor document={DOC} projectId="p1" onSave={vi.fn()} saveState="saving" />);
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
  });
});
