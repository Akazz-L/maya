import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavBar } from './NavBar';

describe('NavBar', () => {
  it('renders all 6 navigation buttons', () => {
    render(<NavBar view="write" onViewChange={() => {}} />);
    expect(screen.getByTitle('Write')).toBeInTheDocument();
    expect(screen.getByTitle('Characters')).toBeInTheDocument();
    expect(screen.getByTitle('World')).toBeInTheDocument();
    expect(screen.getByTitle('Styles')).toBeInTheDocument();
    expect(screen.getByTitle('Timeline')).toBeInTheDocument();
    expect(screen.getByTitle('Outlines')).toBeInTheDocument();
  });

  it('applies active style to the current view button', () => {
    render(<NavBar view="characters" onViewChange={() => {}} />);
    expect(screen.getByTitle('Characters')).toHaveClass('bg-blue-500');
    expect(screen.getByTitle('Write')).not.toHaveClass('bg-blue-500');
  });

  it('calls onViewChange with the clicked view key', async () => {
    const onViewChange = vi.fn();
    render(<NavBar view="write" onViewChange={onViewChange} />);
    await userEvent.click(screen.getByTitle('Characters'));
    expect(onViewChange).toHaveBeenCalledWith('characters');
  });
});
