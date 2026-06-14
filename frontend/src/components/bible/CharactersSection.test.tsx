import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CharactersSection } from './CharactersSection';
import type { Character } from '../../api/bible-types';

describe('CharactersSection', () => {
  it('renders existing character name and traits', () => {
    const chars: Character[] = [{ name: 'Elena', traits: ['brave'], dialogue_examples: [] }];
    render(<CharactersSection characters={chars} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Elena')).toBeInTheDocument();
    expect(screen.getByDisplayValue('brave')).toBeInTheDocument();
  });

  it('calls onChange with an empty character when Add character is clicked', async () => {
    const onChange = vi.fn();
    render(<CharactersSection characters={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /add character/i }));
    expect(onChange).toHaveBeenCalledWith([{ name: '', traits: [], dialogue_examples: [] }]);
  });

  it('calls onChange without the character when Remove is clicked', async () => {
    const onChange = vi.fn();
    const chars: Character[] = [{ name: 'Elena', traits: [], dialogue_examples: [] }];
    render(<CharactersSection characters={chars} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
