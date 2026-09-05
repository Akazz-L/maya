import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentSidebar } from './DocumentSidebar';
import type { DocumentSummary } from '../api/types';

const DOCS: DocumentSummary[] = [
  { id: 'b', title: 'Story Bible', kind: 'bible', position: 0, updated_at: '2026-01-01' },
  { id: 'c1', title: 'Chapter 1', kind: 'chapter', position: 1, updated_at: '2026-01-01' },
  { id: 'n1', title: 'Research', kind: 'note', position: 2, updated_at: '2026-01-01' },
];

function setup(overrides: Partial<React.ComponentProps<typeof DocumentSidebar>> = {}) {
  const props = {
    documents: DOCS,
    activeId: 'c1',
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  render(<DocumentSidebar {...props} />);
  return props;
}

afterEach(() => vi.restoreAllMocks());

describe('DocumentSidebar', () => {
  it('lists every document', () => {
    setup();
    expect(screen.getByText('Story Bible')).toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Research')).toBeInTheDocument();
  });

  it('selects a document on click', async () => {
    const props = setup();
    await userEvent.click(screen.getByText('Research'));
    expect(props.onSelect).toHaveBeenCalledWith('n1');
  });

  it('creates a chapter from the main half of the split button', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'New chapter' }));
    expect(props.onCreate).toHaveBeenCalledWith('chapter');
  });

  it('creates a note from the kind menu', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Choose document type' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /new note/i }));
    expect(props.onCreate).toHaveBeenCalledWith('note');
  });

  it('keeps the kind menu closed until the caret is pressed', async () => {
    setup();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose document type' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes the kind menu on Escape without creating anything', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Choose document type' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('closes the kind menu on an outside press', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Choose document type' }));
    await userEvent.click(screen.getByText('Chapter 1'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renames on double-click and Enter', async () => {
    const props = setup();
    await userEvent.dblClick(screen.getByText('Chapter 1'));
    const input = screen.getByDisplayValue('Chapter 1');
    await userEvent.clear(input);
    await userEvent.type(input, 'The Gates{Enter}');
    expect(props.onRename).toHaveBeenCalledWith('c1', 'The Gates');
  });

  it('abandons a rename on Escape', async () => {
    const props = setup();
    await userEvent.dblClick(screen.getByText('Chapter 1'));
    await userEvent.type(screen.getByDisplayValue('Chapter 1'), '{Escape}');
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it('deletes behind a confirm', async () => {
    const props = setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByTitle('Delete Chapter 1'));
    expect(props.onDelete).toHaveBeenCalledWith('c1');
  });

  it('does not delete when the confirm is declined', async () => {
    const props = setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(screen.getByTitle('Delete Chapter 1'));
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it('offers no delete control for the story bible', () => {
    setup();
    expect(screen.queryByTitle('Delete Story Bible')).not.toBeInTheDocument();
  });

  it('collapses to icons only', () => {
    setup({ collapsed: true });
    expect(screen.queryByText('Chapter 1')).not.toBeInTheDocument();
  });
});
