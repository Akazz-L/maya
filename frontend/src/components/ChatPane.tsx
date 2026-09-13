// The chapter's conversation with the assistant. Presentational: the
// workspace owns the stream and the proposal; this renders them and collects
// the next message.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ProposalProgress } from '../api/stream';
import type { ChatMessage, ChatProposal } from '../api/types';
import { describeProposal, outcomeLabel, wordCount } from '../lib/chat';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

export interface ChatStreaming {
  /** The message being answered, shown until the stored copy replaces it. */
  pendingUser: string;
  reply: string;
  progress: ProposalProgress | null;
}

export interface ChatPaneProps {
  messages: ChatMessage[];
  loading: boolean;
  streaming: ChatStreaming | null;
  error: string | null;
  /** Why a message cannot be sent right now, shown under the input; null when it can. */
  disabledReason: string | null;
  /** Resolves false when the message did not go through, so its text can be restored. */
  onSend: (content: string) => Promise<boolean>;
  onClear: () => void;
  onClose: () => void;
}

const ghost =
  'rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40 disabled:hover:bg-transparent';

function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-8 whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-sm text-gray-800 shadow-sm ring-1 ring-gray-200">
      {text}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: ChatProposal }) {
  return (
    <div
      className={cn(
        'mt-1.5 flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-xs',
        proposal.outcome === null ? 'border-violet-200 bg-violet-50' : 'border-gray-200 bg-white',
      )}
    >
      <span className="font-medium text-gray-700">{describeProposal(proposal)}</span>
      <span className={proposal.outcome === null ? 'text-violet-700' : 'text-gray-500'}>
        {outcomeLabel(proposal.outcome)}
      </span>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="mr-8 text-sm text-gray-700">
      {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
      {message.proposal && <ProposalCard proposal={message.proposal} />}
    </div>
  );
}

export function ChatPane({
  messages,
  loading,
  streaming,
  error,
  disabledReason,
  onSend,
  onClear,
  onClose,
}: ChatPaneProps) {
  const [input, setInput] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const inputDisabled = Boolean(disabledReason) || streaming !== null;

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const submit = async () => {
    const text = input.trim();
    if (!text || inputDisabled) return;
    setInput('');
    const sent = await onSend(text);
    // Give the text back unless the writer has already started a new one.
    if (!sent) setInput((current) => current || text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <aside
      aria-label="Chapter chat"
      className="flex w-[22rem] flex-shrink-0 flex-col border-l border-gray-200 bg-[#fafaf7]"
    >
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <h2 className="text-sm font-semibold text-gray-700">Chat</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={ghost}
            disabled={!messages.length || streaming !== null}
            onClick={() => {
              if (window.confirm("Clear this chapter's conversation? The chapter text is not affected."))
                onClear();
            }}
          >
            Clear
          </button>
          <button type="button" aria-label="Hide chat" className={ghost} onClick={onClose}>
            ✕
          </button>
        </div>
      </header>

      <div ref={list} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          !messages.length &&
          !streaming && (
            <p className="text-sm text-gray-400">
              Ask for a first draft, a continuation, or changes to the chapter. Every change is
              proposed in the editor for you to accept or discard.
            </p>
          )
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <UserBubble key={m.id} text={m.content} />
          ) : (
            <AssistantMessage key={m.id} message={m} />
          ),
        )}

        {streaming && (
          <>
            <UserBubble text={streaming.pendingUser} />
            <div className="mr-8 text-sm text-gray-700">
              {streaming.reply && <p className="whitespace-pre-wrap">{streaming.reply}</p>}
              {streaming.progress ? (
                <p className="mt-1 text-xs text-violet-700">
                  Writing… {wordCount(streaming.progress.text)} words
                </p>
              ) : (
                !streaming.reply && <p className="text-xs text-gray-400">Thinking…</p>
              )}
            </div>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="border-t border-gray-200 bg-white p-3">
        <textarea
          aria-label="Message"
          value={input}
          rows={3}
          disabled={inputDisabled}
          placeholder="Ask for a draft, a continuation, or a change…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full resize-none rounded-md border border-gray-200 px-2.5 py-2 text-sm text-gray-800 outline-none focus:border-violet-300 disabled:bg-gray-50 disabled:text-gray-400"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400">{disabledReason ?? '↵ send · ⇧↵ new line'}</span>
          <Button type="submit" size="sm" disabled={inputDisabled || !input.trim()}>
            Send
          </Button>
        </div>
      </form>
    </aside>
  );
}
