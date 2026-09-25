import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SummarySource } from '../api/types';
import { SummarySources } from './SummarySources';

const sources: SummarySource[] = [
  { id: 'a', title: 'The Wastes', summary_status: 'current' },
  { id: 'b', title: 'The Gates', summary_status: 'missing' },
];

describe('SummarySources', () => {
  it('says the earlier chapters reach the AI as summaries', () => {
    render(<SummarySources sources={sources} onOpen={() => {}} />);
    expect(screen.getByText(/in place of the earlier/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /the wastes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /the gates/i })).toBeInTheDocument();
  });

  it('names the one chapter the chat reads', () => {
    render(<SummarySources sources={sources} onOpen={() => {}} />);
    expect(screen.getByText(/the chat reads only the last of these/i)).toBeInTheDocument();
  });

  it('opens the summary of the chapter clicked', async () => {
    const onOpen = vi.fn();
    render(<SummarySources sources={sources} onOpen={onOpen} />);

    await userEvent.click(screen.getByRole('button', { name: /the wastes/i }));
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('flags a chapter whose summary the next request has to write', () => {
    render(<SummarySources sources={sources} onOpen={() => {}} />);
    expect(
      screen.getByRole('button', { name: /the gates.*not summarized yet/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Open The Wastes's summary" })).toBeInTheDocument();
  });

  it('says so on a first chapter, with nothing behind it', () => {
    render(<SummarySources sources={[]} onOpen={() => {}} />);
    expect(screen.getByText(/no earlier chapters to summarize yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
