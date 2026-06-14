import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorldSection } from './WorldSection';

describe('WorldSection', () => {
  it('renders existing locations and rules', () => {
    render(<WorldSection world={{ locations: ['The Citadel'], rules: ['No magic'] }} onChange={() => {}} />);
    expect(screen.getByDisplayValue('The Citadel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('No magic')).toBeInTheDocument();
  });

  it('calls onChange when a location is added', async () => {
    const onChange = vi.fn();
    render(<WorldSection world={{ locations: [], rules: [] }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /add location/i }));
    expect(onChange).toHaveBeenCalledWith({ locations: [''], rules: [] });
  });
});
