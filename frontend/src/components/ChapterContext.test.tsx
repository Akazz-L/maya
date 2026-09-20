import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ChapterContext } from './ChapterContext';

function Controlled({
  initial,
  onChange,
}: {
  initial: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ChapterContext
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

const toggle = () => screen.getAllByRole('button', { name: /chapter context/i })[0];

afterEach(() => localStorage.clear());

describe('ChapterContext', () => {
  it('starts collapsed, previewing the first line of the context', () => {
    render(<Controlled initial={'\n  Mara waits.\nThe bell rings.'} />);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveTextContent('Mara waits.');
    expect(toggle()).not.toHaveTextContent('The bell rings.');
    expect(screen.queryByLabelText('Chapter context')).not.toBeInTheDocument();
  });

  it('says the context is optional while there is none', () => {
    render(<Controlled initial="" />);
    expect(toggle()).toHaveTextContent(/optional/i);
  });

  it('expands to the full context and remembers that it is open', async () => {
    render(<Controlled initial={'Mara waits.\nThe bell rings.'} />);
    await userEvent.click(toggle());

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Chapter context')).toHaveValue('Mara waits.\nThe bell rings.');
    expect(localStorage.getItem('maya.context.open')).toBe('1');
  });

  it('starts open when the writer left it open', () => {
    localStorage.setItem('maya.context.open', '1');
    render(<Controlled initial="Mara waits." />);
    expect(screen.getByLabelText('Chapter context')).toBeInTheDocument();
  });

  it('reports every edit, newlines included', async () => {
    const onChange = vi.fn();
    render(<Controlled initial="" onChange={onChange} />);
    await userEvent.click(toggle());
    await userEvent.type(screen.getByLabelText('Chapter context'), 'One{Enter}Two');
    expect(onChange).toHaveBeenLastCalledWith('One\nTwo');
  });

  it('opens every copy at once, so the Write and Plan views agree', async () => {
    // Both views render this component; expanding in one must expand the other.
    render(
      <>
        <Controlled initial="Mara waits." />
        <Controlled initial="Mara waits." />
      </>,
    );
    await userEvent.click(toggle());

    expect(screen.getAllByLabelText('Chapter context')).toHaveLength(2);
  });
});
