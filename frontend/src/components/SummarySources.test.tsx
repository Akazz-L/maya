import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SummaryContext } from '../api/types';
import { SummarySources } from './SummarySources';

const summaries: SummaryContext = {
  mode: 'summaries',
  previous: [
    { id: 'a', title: 'The Wastes', summary_status: 'current' },
    { id: 'b', title: 'The Gates', summary_status: 'missing' },
  ],
  digest: { status: 'current', covers: ['One', 'Two', 'Three'] },
};

describe('SummarySources', () => {
  it('names the running record and the summaries the AI reads', () => {
    render(<SummarySources context={summaries} onOpen={() => {}} onOpenStory={() => {}} />);
    expect(screen.getByRole('button', { name: /the story so far \(3 chapters\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /the wastes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /the gates/i })).toBeInTheDocument();
  });

  it('says the last chapter reaches the draft as prose, not as a summary', () => {
    render(<SummarySources context={summaries} onOpen={() => {}} onOpenStory={() => {}} />);
    expect(screen.getByText(/end of The Gates, verbatim/i)).toBeInTheDocument();
  });

  it('opens the summary of the chapter clicked', async () => {
    const onOpen = vi.fn();
    render(<SummarySources context={summaries} onOpen={onOpen} onOpenStory={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /the wastes/i }));
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('opens this chapter’s own memory for the running record', async () => {
    const onOpenStory = vi.fn();
    render(<SummarySources context={summaries} onOpen={() => {}} onOpenStory={onOpenStory} />);

    await userEvent.click(screen.getByRole('button', { name: /the story so far/i }));
    expect(onOpenStory).toHaveBeenCalled();
  });

  it('flags a chapter whose summary the next request has to write', () => {
    render(<SummarySources context={summaries} onOpen={() => {}} onOpenStory={() => {}} />);
    expect(
      screen.getByRole('button', { name: /the gates.*not summarized yet/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open The Wastes' })).toBeInTheDocument();
  });

  it('flags a running record whose chapters have changed under it', () => {
    render(
      <SummarySources
        context={{ ...summaries, digest: { status: 'stale', covers: ['One'] } }}
        onOpen={() => {}}
        onOpenStory={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /story so far.*has changed/i }),
    ).toBeInTheDocument();
  });

  it('says when the project is short enough to be read in full', () => {
    render(
      <SummarySources
        context={{
          mode: 'prose',
          previous: [{ id: 'a', title: 'The Wastes', summary_status: 'empty' }],
          digest: null,
        }}
        onOpen={() => {}}
        onOpenStory={() => {}}
      />,
    );
    expect(screen.getByText(/reads your earlier chapters in full/i)).toBeInTheDocument();
    expect(screen.queryByText(/summaries of/i)).not.toBeInTheDocument();
  });

  it('says so on a first chapter, with nothing behind it', () => {
    render(
      <SummarySources
        context={{ mode: 'prose', previous: [], digest: null }}
        onOpen={() => {}}
        onOpenStory={() => {}}
      />,
    );
    expect(screen.getByText(/no earlier chapters behind it yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows nothing at all until the context has loaded', () => {
    const { container } = render(
      <SummarySources context={null} onOpen={() => {}} onOpenStory={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
