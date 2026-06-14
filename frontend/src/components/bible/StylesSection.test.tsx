import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StylesSection } from './StylesSection';

describe('StylesSection', () => {
  it('renders voice and avoid items', () => {
    render(
      <StylesSection
        style_guide={{ voice: 'sparse', avoid: ['adverbs'] }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue('sparse')).toBeInTheDocument();
    expect(screen.getByDisplayValue('adverbs')).toBeInTheDocument();
  });

  it('calls onChange when voice is edited', async () => {
    const onChange = vi.fn();
    render(<StylesSection style_guide={{ voice: '', avoid: [] }} onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'v');
    expect(onChange).toHaveBeenLastCalledWith({ voice: 'v', avoid: [] });
  });
});
