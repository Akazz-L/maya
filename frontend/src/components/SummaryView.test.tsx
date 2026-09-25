import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { SummaryStatus } from '../api/types';
import { SummaryView } from './SummaryView';

function Controlled({
  initial = '',
  status = 'current',
  generating = false,
  busy = false,
  aiBlocked = false,
  onChange,
  onGenerate = () => {},
}: {
  initial?: string;
  status?: SummaryStatus;
  generating?: boolean;
  busy?: boolean;
  aiBlocked?: boolean;
  onChange?: (value: string) => void;
  onGenerate?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SummaryView
      summary={value}
      status={status}
      generating={generating}
      busy={busy}
      aiBlocked={aiBlocked}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      onGenerate={onGenerate}
    />
  );
}

const field = () => screen.getByLabelText('Chapter summary');

describe('SummaryView', () => {
  it('says the summary is what later chapters are written from', () => {
    render(<Controlled initial="Elena left home." />);
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText(/written from this summary, not/i)).toBeInTheDocument();
    expect(screen.getByText(/read by the next chapter's chat/i)).toBeInTheDocument();
  });

  it('shows the summary and reports every edit', async () => {
    const onChange = vi.fn();
    render(<Controlled initial="Elena left home." onChange={onChange} />);
    expect(field()).toHaveValue('Elena left home.');

    await userEvent.type(field(), ' She took the road north.');
    expect(onChange).toHaveBeenLastCalledWith('Elena left home. She took the road north.');
  });

  it.each([
    ['current', /up to date/i],
    ['missing', /not summarized yet/i],
    ['stale', /out of date/i],
    ['edited', /edited by you/i],
    ['edited_stale', /edited by you/i],
  ] as const)('describes the %s summary', (status, wording) => {
    render(<Controlled initial={status === 'missing' ? '' : 'Elena left home.'} status={status} />);
    expect(screen.getByRole('status')).toHaveTextContent(wording);
  });

  it('warns that an edited summary may no longer fit the chapter', () => {
    render(<Controlled initial="Elena left home." status="edited_stale" />);
    expect(screen.getByRole('status')).toHaveTextContent(/chapter has changed since you wrote this/i);
    // It is still what the AI reads, which is the part a writer needs to know.
    expect(screen.getByRole('status')).toHaveTextContent(/still what the AI reads/i);
  });

  it('offers to summarize a chapter that has never been summarized', async () => {
    const onGenerate = vi.fn();
    render(<Controlled initial="" status="missing" onGenerate={onGenerate} />);

    await userEvent.click(screen.getByRole('button', { name: /summarize now/i }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it('regenerates a generated summary without asking', async () => {
    const onGenerate = vi.fn();
    render(<Controlled initial="Elena left home." status="stale" onGenerate={onGenerate} />);

    await userEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it('asks before replacing a summary the writer wrote', async () => {
    const onGenerate = vi.fn();
    render(<Controlled initial="Mine." status="edited" onGenerate={onGenerate} />);

    await userEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(onGenerate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/what you wrote here is lost/i);

    // The dialog's own button, not the header's, which opened it.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Regenerate' }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('keeps the summary when the writer cancels the regenerate', async () => {
    const onGenerate = vi.fn();
    render(<Controlled initial="Mine." status="edited" onGenerate={onGenerate} />);

    await userEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('locks the field while the model is summarizing', () => {
    render(<Controlled initial="Elena left home." generating />);
    expect(screen.getByRole('status')).toHaveTextContent(/summarizing/i);
    expect(field()).toBeDisabled();
  });

  it.each([
    ['another AI action is running', { busy: true }],
    ['the budget is spent', { aiBlocked: true }],
  ])('cannot summarize while %s', (_case, props) => {
    render(<Controlled initial="Elena left home." {...props} />);
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeDisabled();
    // Writing the summary by hand calls no model, so it stays available.
    expect(field()).toBeEnabled();
  });

  it('has nothing to summarize on an empty chapter', () => {
    render(<Controlled initial="" status="empty" />);
    expect(screen.getByText(/nothing to summarize/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Chapter summary')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /summarize/i })).not.toBeInTheDocument();
  });
});
