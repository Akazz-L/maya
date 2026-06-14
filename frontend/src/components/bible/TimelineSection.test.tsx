import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimelineSection } from './TimelineSection';

describe('TimelineSection', () => {
  it('renders existing events', () => {
    render(<TimelineSection timeline={['Elena leaves home']} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Elena leaves home')).toBeInTheDocument();
  });

  it('calls onChange with new event when Add event is clicked', async () => {
    const onChange = vi.fn();
    render(<TimelineSection timeline={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /add event/i }));
    expect(onChange).toHaveBeenCalledWith(['']);
  });
});
