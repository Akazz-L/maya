import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ChapterNotes } from './ChapterNotes';

function Controlled({
  initial,
  onChange,
  focusRef,
}: {
  initial: string;
  onChange?: (value: string) => void;
  focusRef?: { current: (() => void) | null };
}) {
  const [value, setValue] = useState(initial);
  return (
    <ChapterNotes
      value={value}
      focusRef={focusRef}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

const toggle = () => screen.getByRole('button', { name: /chapter notes/i });

describe('ChapterNotes', () => {
  it('starts collapsed, previewing the first line of the notes', () => {
    render(<Controlled initial={'\n  Mara waits.\nThe bell rings.'} />);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveTextContent('Mara waits.');
    expect(toggle()).not.toHaveTextContent('The bell rings.');
    expect(screen.queryByLabelText('Chapter notes')).not.toBeInTheDocument();
  });

  it('says the notes are optional while there are none', () => {
    render(<Controlled initial="" />);
    expect(toggle()).toHaveTextContent(/optional/i);
  });

  it('expands to the full notes and remembers that it is open', async () => {
    render(<Controlled initial={'Mara waits.\nThe bell rings.'} />);
    await userEvent.click(toggle());

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Chapter notes')).toHaveValue('Mara waits.\nThe bell rings.');
    expect(localStorage.getItem('maya.notes.open')).toBe('1');
  });

  it('starts open when the writer left it open', () => {
    localStorage.setItem('maya.notes.open', '1');
    render(<Controlled initial="Mara waits." />);
    expect(screen.getByLabelText('Chapter notes')).toBeInTheDocument();
  });

  it('reports every edit, newlines included', async () => {
    const onChange = vi.fn();
    render(<Controlled initial="" onChange={onChange} />);
    await userEvent.click(toggle());
    await userEvent.type(screen.getByLabelText('Chapter notes'), 'One{Enter}Two');
    expect(onChange).toHaveBeenLastCalledWith('One\nTwo');
  });

  it('expands and focuses the notes on request', () => {
    const focusRef: { current: (() => void) | null } = { current: null };
    render(<Controlled initial="Mara waits." focusRef={focusRef} />);

    act(() => focusRef.current?.());

    expect(screen.getByLabelText('Chapter notes')).toHaveFocus();
  });
});
