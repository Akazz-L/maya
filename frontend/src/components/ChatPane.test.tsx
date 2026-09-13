import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPane } from './ChatPane';
import type { ChatMessage } from '../api/types';

const MESSAGES: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'Draft it.', proposal: null, created_at: null },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Here is a draft.',
    proposal: {
      kind: 'write',
      mode: 'replace',
      text: 'one two three',
      base_hash: 'h',
      proposed_body: null,
      outcome: 'accepted',
    },
    created_at: null,
  },
  { id: 'u2', role: 'user', content: 'Tighten it.', proposal: null, created_at: null },
  {
    id: 'a2',
    role: 'assistant',
    content: '',
    proposal: {
      kind: 'edit',
      edits: [{ find: 'a', replace: 'b' }],
      base_hash: 'h',
      proposed_body: 'x',
      outcome: null,
    },
    created_at: null,
  },
];

function props(overrides: Partial<React.ComponentProps<typeof ChatPane>> = {}) {
  return {
    messages: MESSAGES,
    loading: false,
    streaming: null,
    error: null,
    disabledReason: null,
    onSend: vi.fn(async () => true),
    onClear: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('ChatPane', () => {
  it('shows the conversation with each proposal and what became of it', () => {
    render(<ChatPane {...props()} />);
    expect(screen.getByText('Draft it.')).toBeInTheDocument();
    expect(screen.getByText('Here is a draft.')).toBeInTheDocument();
    expect(screen.getByText('New draft · 3 words')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('1 edit')).toBeInTheDocument();
    expect(screen.getByText('Awaiting review in the editor')).toBeInTheDocument();
  });

  it('invites a first message when the conversation is empty', () => {
    render(<ChatPane {...props({ messages: [] })} />);
    expect(screen.getByText(/ask for a first draft/i)).toBeInTheDocument();
  });

  it('sends on Enter and clears the input', async () => {
    const p = props({ messages: [] });
    render(<ChatPane {...p} />);
    await userEvent.type(screen.getByLabelText('Message'), 'Write the opening.{Enter}');
    expect(p.onSend).toHaveBeenCalledWith('Write the opening.');
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });

  it('keeps a newline on Shift+Enter', async () => {
    const p = props({ messages: [] });
    render(<ChatPane {...p} />);
    await userEvent.type(screen.getByLabelText('Message'), 'One{Shift>}{Enter}{/Shift}Two');
    expect(screen.getByLabelText('Message')).toHaveValue('One\nTwo');
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it('does not send a blank message', async () => {
    const p = props({ messages: [] });
    render(<ChatPane {...p} />);
    await userEvent.type(screen.getByLabelText('Message'), '   {Enter}');
    expect(p.onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('puts the message back when sending fails', async () => {
    render(<ChatPane {...props({ messages: [], onSend: vi.fn(async () => false) })} />);
    await userEvent.type(screen.getByLabelText('Message'), 'Write the opening.{Enter}');
    await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue('Write the opening.'));
  });

  it('explains why sending is unavailable', () => {
    render(<ChatPane {...props({ disabledReason: 'Accept or discard the proposal in the editor first.' })} />);
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByText('Accept or discard the proposal in the editor first.')).toBeInTheDocument();
  });

  it('streams the reply under the message being answered', () => {
    render(
      <ChatPane
        {...props({
          messages: [],
          streaming: { pendingUser: 'Continue.', reply: 'Adding a scene', progress: { mode: 'append', text: 'one two' } },
        })}
      />,
    );
    expect(screen.getByText('Continue.')).toBeInTheDocument();
    expect(screen.getByText('Adding a scene')).toBeInTheDocument();
    expect(screen.getByText('Writing… 2 words')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
  });

  it('shows an error', () => {
    render(<ChatPane {...props({ error: 'model exploded' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('model exploded');
  });

  it('clears the conversation once confirmed', async () => {
    const p = props();
    render(<ChatPane {...p} />);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(p.onClear).not.toHaveBeenCalled();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(p.onClear).toHaveBeenCalled();
  });

  it('hides itself', async () => {
    const p = props();
    render(<ChatPane {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /hide chat/i }));
    expect(p.onClose).toHaveBeenCalled();
  });
});
