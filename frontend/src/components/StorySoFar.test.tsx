import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { SummaryStatus } from '../api/types';
import { StorySoFar } from './StorySoFar';

function Controlled({
  initial = 'Elena reached the Citadel. Teodor owes the House.',
  status = 'current' as SummaryStatus,
  covers = ['Chapter 1', 'Chapter 2', 'Chapter 3'],
  generating = false,
  busy = false,
  aiBlocked = false,
  onGenerate = () => {},
}) {
  const [value, setValue] = useState(initial);
  return (
    <StorySoFar
      digest={value}
      status={status}
      covers={covers}
      generating={generating}
      busy={busy}
      aiBlocked={aiBlocked}
      onChange={setValue}
      onGenerate={onGenerate}
    />
  );
}

const field = () => screen.getByRole('textbox', { name: 'The story so far' });

describe('StorySoFar', () => {
  it('says it stands in for the chapters it covers', () => {
    render(<Controlled />);
    expect(screen.getByRole('heading', { name: /the story so far/i })).toBeInTheDocument();
    expect(screen.getByText(/the AI reads this in their place/i)).toBeInTheDocument();
    expect(screen.getByText(/Chapter 1 – Chapter 3 \(3 chapters\)/)).toBeInTheDocument();
  });

  it('is editable, because a wrong fact here reaches every later chapter', async () => {
    render(<Controlled />);
    await userEvent.type(field(), ' She is left-handed.');
    expect(field()).toHaveValue(
      'Elena reached the Citadel. Teodor owes the House. She is left-handed.',
    );
  });

  it.each([
    ['missing', /not written yet/i],
    ['current', /up to date/i],
    ['stale', /out of date/i],
    ['edited', /edited by you/i],
    ['edited_stale', /edited by you/i],
  ] as const)('describes the %s record', (status, wording) => {
    render(<Controlled status={status} initial={status === 'missing' ? '' : 'A record.'} />);
    expect(screen.getByRole('status')).toHaveTextContent(wording);
  });

  it('warns when a chapter it covers has changed under it', () => {
    render(<Controlled status="edited_stale" />);
    expect(screen.getByRole('status')).toHaveTextContent(/has changed since you wrote this/i);
    expect(screen.getByRole('status')).toHaveTextContent(/still what the AI reads/i);
  });

  it('offers to write a record that does not exist yet', async () => {
    const onGenerate = vi.fn();
    render(<Controlled initial="" status="missing" onGenerate={onGenerate} />);
    await userEvent.click(screen.getByRole('button', { name: /write it now/i }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it('asks before replacing a record the writer wrote', async () => {
    const onGenerate = vi.fn();
    render(<Controlled status="edited" onGenerate={onGenerate} />);

    await userEvent.click(screen.getByRole('button', { name: /rebuild/i }));
    expect(onGenerate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/what you wrote here is lost/i);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Rebuild' }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('rebuilds a generated record without asking', async () => {
    const onGenerate = vi.fn();
    render(<Controlled status="stale" onGenerate={onGenerate} />);
    await userEvent.click(screen.getByRole('button', { name: /rebuild/i }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it('locks the field while the model is reading back over the story', () => {
    render(<Controlled generating />);
    expect(screen.getByRole('status')).toHaveTextContent(/reading back over the story/i);
    expect(field()).toBeDisabled();
  });

  it.each([
    ['another AI action is running', { busy: true }],
    ['the budget is spent', { aiBlocked: true }],
  ])('cannot rebuild while %s', (_case, props) => {
    render(<Controlled {...props} />);
    expect(screen.getByRole('button', { name: /rebuild/i })).toBeDisabled();
    // Writing it by hand calls no model, so it stays available.
    expect(field()).toBeEnabled();
  });

  it('has nothing to condense while every chapter is still in the window', () => {
    render(<Controlled status="empty" covers={[]} />);
    expect(screen.getByText(/nothing to condense/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
