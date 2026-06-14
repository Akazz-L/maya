import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OutlinesSection } from './OutlinesSection';

describe('OutlinesSection', () => {
  it('renders chapter beats with labels', () => {
    render(<OutlinesSection chapters={['Elena arrives', 'Elena leaves']} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Elena arrives')).toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Chapter 2')).toBeInTheDocument();
  });

  it('calls onChange with new chapter when Add chapter is clicked', async () => {
    const onChange = vi.fn();
    render(<OutlinesSection chapters={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /add chapter/i }));
    expect(onChange).toHaveBeenCalledWith(['']);
  });
});
