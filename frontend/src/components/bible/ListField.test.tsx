import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListField } from './ListField';

describe('ListField', () => {
  it('renders existing items', () => {
    render(<ListField label="Traits" items={['brave', 'clever']} addLabel="+ Add" onChange={() => {}} />);
    expect(screen.getByDisplayValue('brave')).toBeInTheDocument();
    expect(screen.getByDisplayValue('clever')).toBeInTheDocument();
  });

  it('calls onChange with new empty item when add button is clicked', async () => {
    const onChange = vi.fn();
    render(<ListField label="Traits" items={['a']} addLabel="+ Add trait" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Add trait' }));
    expect(onChange).toHaveBeenCalledWith(['a', '']);
  });

  it('calls onChange without the removed item when × is clicked', async () => {
    const onChange = vi.fn();
    render(<ListField label="Traits" items={['a', 'b']} addLabel="+ Add" onChange={onChange} />);
    const removeButtons = screen.getAllByRole('button', { name: '×' });
    await userEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('calls onChange with updated value when an item is edited', async () => {
    const onChange = vi.fn();
    render(<ListField label="Traits" items={['a']} addLabel="+ Add" onChange={onChange} />);
    await userEvent.type(screen.getByDisplayValue('a'), 'x');
    expect(onChange).toHaveBeenLastCalledWith(['ax']);
  });
});
