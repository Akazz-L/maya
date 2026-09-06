import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProseEditor } from './ProseEditor';
import { typeAtEnd, viewFor } from '../test/editor';

describe('ProseEditor', () => {
  it('renders the value as editable text with the aria label', () => {
    render(<ProseEditor value="The rain." onChange={vi.fn()} readOnly={false} ariaLabel="Body" />);
    const el = screen.getByLabelText('Body');
    expect(el).toHaveTextContent('The rain.');
    expect(el).toHaveAttribute('contenteditable', 'true');
  });

  it('calls onChange with the full text on a user edit', () => {
    const onChange = vi.fn();
    render(<ProseEditor value="The rain." onChange={onChange} readOnly={false} ariaLabel="Body" />);
    typeAtEnd('Body', '!');
    expect(onChange).toHaveBeenCalledWith('The rain.!');
  });

  it('follows an external value change without reporting it as an edit', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ProseEditor value="The rain." onChange={onChange} readOnly={false} ariaLabel="Body" />,
    );
    rerender(<ProseEditor value="The rain. More." onChange={onChange} readOnly={false} ariaLabel="Body" />);
    expect(viewFor('Body').state.doc.toString()).toBe('The rain. More.');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('honours readOnly and can flip it without losing the document', () => {
    const { rerender } = render(
      <ProseEditor value="The rain." onChange={vi.fn()} readOnly ariaLabel="Body" />,
    );
    expect(screen.getByLabelText('Body')).toHaveAttribute('contenteditable', 'false');
    rerender(<ProseEditor value="The rain." onChange={vi.fn()} readOnly={false} ariaLabel="Body" />);
    expect(screen.getByLabelText('Body')).toHaveAttribute('contenteditable', 'true');
    expect(screen.getByLabelText('Body')).toHaveTextContent('The rain.');
  });

  it('hands the view to onViewReady once', () => {
    const onViewReady = vi.fn();
    const { rerender } = render(
      <ProseEditor value="x" onChange={vi.fn()} readOnly={false} ariaLabel="Body" onViewReady={onViewReady} />,
    );
    rerender(
      <ProseEditor value="y" onChange={vi.fn()} readOnly={false} ariaLabel="Body" onViewReady={onViewReady} />,
    );
    expect(onViewReady).toHaveBeenCalledTimes(1);
    expect(onViewReady.mock.calls[0][0]).toBe(viewFor('Body'));
  });
});
