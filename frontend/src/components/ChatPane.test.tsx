import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPane } from './ChatPane';
import type { AgentOption, ChatMessage, ProposalOutcome, Suggestion } from '../api/types';

const AGENTS: AgentOption[] = [
  { key: 'continuity', label: 'Continuity check', hint: 'Contradictions against the bible' },
];

function suggestion(n: number, outcome: ProposalOutcome | null): Suggestion {
  return {
    find: `find${n}`,
    replace: `replace${n}`,
    explanation: `because ${n}`,
    severity: 'minor',
    from: n * 10,
    to: n * 10 + 5,
    outcome,
  };
}

const MESSAGES: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'Draft it.', agent: null, proposal: null, created_at: null },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Here is a draft.',
    agent: null,
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
  {
    id: 'u2',
    role: 'user',
    content: 'Check this chapter for continuity problems.',
    agent: 'continuity',
    proposal: null,
    created_at: null,
  },
  {
    id: 'a2',
    role: 'assistant',
    content: 'Two problems.',
    agent: 'continuity',
    proposal: {
      kind: 'suggestions',
      base_hash: 'h',
      suggestions: [suggestion(0, 'accepted'), suggestion(1, null)],
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
    agents: AGENTS,
    onRunAgent: vi.fn(),
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
    // A review pass: how many fixes it found, and how far through them the writer is.
    expect(screen.getByText('2 suggested fixes')).toBeInTheDocument();
    expect(screen.getByText('1 still awaiting review in the chapter')).toBeInTheDocument();
  });

  it('shows a pass the writer ran as the turn it was', () => {
    render(<ChatPane {...props()} />);
    expect(screen.getByText('Check this chapter for continuity problems.')).toBeInTheDocument();
  });

  it('runs a specialist from the + picker', async () => {
    const p = props();
    render(<ChatPane {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /run a specialist/i }));
    expect(screen.getByText('Contradictions against the bible')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('menuitem', { name: /continuity check/i }));
    expect(p.onRunAgent).toHaveBeenCalledWith('continuity');
    // The menu closes behind it.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('says why no pass can run instead of offering one', async () => {
    render(<ChatPane {...props({ disabledReason: 'AI budget used — chat is paused.' })} />);
    await userEvent.click(screen.getByRole('button', { name: /run a specialist/i }));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(screen.getByRole('menu')).toHaveTextContent('AI budget used');
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
    render(<ChatPane {...props({ disabledReason: 'Accept or discard the suggestions in the chapter first.' })} />);
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(
      screen.getByText('Accept or discard the suggestions in the chapter first.'),
    ).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onClear).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    const dialog = screen.getByRole('alertdialog', { name: /clear this conversation/i });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
    expect(p.onClear).toHaveBeenCalled();
  });

  it('offers starters on an empty conversation, and sends one as written', async () => {
    const p = props({ messages: [] });
    render(<ChatPane {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Draft this chapter.' }));
    expect(p.onSend).toHaveBeenCalledWith('Draft this chapter.');
  });

  it('disables the starters while a message cannot be sent', () => {
    render(<ChatPane {...props({ messages: [], disabledReason: 'AI budget used — chat is paused.' })} />);
    expect(screen.getByRole('button', { name: 'Draft this chapter.' })).toBeDisabled();
  });

  it('hides itself', async () => {
    const p = props();
    render(<ChatPane {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /hide chat/i }));
    expect(p.onClose).toHaveBeenCalled();
  });
});
