// The chapter's conversation with the assistant. Presentational: the
// workspace owns the stream and the proposal; this renders them and collects
// the next message.
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Eraser, MessageSquare, ScanSearch, X } from 'lucide-react';
import type { ProposalProgress } from '../api/stream';
import type { AgentOption, ChatMessage, ChatProposal } from '../api/types';
import { describeProposal, outcomeLabel, outcomeSummary, wordCount } from '../lib/chat';
import { cn } from '../lib/utils';
import { AgentPicker } from './AgentPicker';
import { Button } from './ui/button';
import { ConfirmDialog } from './ui/confirm-dialog';
import { EmptyState, InlineAlert, Kbd, Skeleton } from './ui/feedback';

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
  /** The specialist passes the "+" offers, and running one. */
  agents: AgentOption[];
  onRunAgent: (key: string) => void;
  onClear: () => void;
  onClose: () => void;
  className?: string;
}

function UserBubble({ text, agent }: { text: string; agent?: string | null }) {
  // A pass the writer ran reads as an action, not as something they typed.
  if (agent) {
    return (
      <div className="ml-auto flex max-w-[85%] items-center gap-1.5 rounded-full border border-pencil-line bg-pencil-faint py-1 pr-3 pl-2.5 text-xs font-medium text-pencil-strong">
        <ScanSearch aria-hidden className="size-3.5 shrink-0" />
        {text}
      </div>
    );
  }
  return (
    <div className="ml-auto max-w-[85%] rounded-panel rounded-br-[4px] bg-surface-sunken px-3 py-2 text-sm whitespace-pre-wrap text-ink">
      {text}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: ChatProposal }) {
  // A set is pending while any one fix is; the detail is on the cards in the prose.
  const pending =
    proposal.kind === 'suggestions'
      ? proposal.suggestions.some((s) => s.outcome === null)
      : proposal.outcome === null;
  const status =
    proposal.kind === 'suggestions'
      ? outcomeSummary(proposal.suggestions)
      : outcomeLabel(proposal.outcome);

  return (
    <div
      className={cn(
        'mt-2 flex flex-col gap-0.5 rounded-control border border-l-[3px] px-3 py-2 text-xs',
        pending
          ? 'border-pencil-line border-l-pencil bg-pencil-faint'
          : 'border-line border-l-line-strong bg-surface',
      )}
    >
      <span className="font-medium text-ink">{describeProposal(proposal)}</span>
      <span className={pending ? 'text-pencil-strong' : 'text-ink-subtle'}>{status}</span>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="mr-6 text-sm leading-relaxed text-ink">
      {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
      {message.proposal && <ProposalCard proposal={message.proposal} />}
    </div>
  );
}

function Thinking() {
  return (
    <span className="flex items-center gap-1 text-xs text-ink-subtle">
      Thinking
      <span aria-hidden className="flex gap-0.5">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1 animate-pulse rounded-full bg-ink-faint"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    </span>
  );
}

export function ChatPane({
  messages,
  loading,
  streaming,
  error,
  disabledReason,
  onSend,
  agents,
  onRunAgent,
  onClear,
  onClose,
  className,
}: ChatPaneProps) {
  const [input, setInput] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const hintId = useId();
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

  const empty = !loading && !messages.length && !streaming;

  return (
    <aside
      aria-label="Chapter chat"
      className={cn('flex flex-col border-l border-line bg-surface-muted', className)}
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface pr-2 pl-4">
        <h2 className="text-sm font-semibold">Chat</h2>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={!messages.length || streaming !== null}
            onClick={() => setConfirmingClear(true)}
          >
            <Eraser aria-hidden />
            Clear
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Hide chat" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
      </header>

      <div
        ref={list}
        role="log"
        aria-label="Conversation"
        // Held while a reply streams in, so a screen reader reads it once, whole.
        aria-busy={streaming !== null}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        {loading && (
          <div aria-hidden className="flex flex-col gap-4">
            <Skeleton className="ml-auto h-9 w-3/5" />
            <Skeleton className="h-14 w-4/5" />
            <Skeleton className="ml-auto h-9 w-2/5" />
          </div>
        )}

        {empty && (
          <EmptyState
            icon={<MessageSquare />}
            title="Draft and revise with the chat"
            className="my-auto"
          >
            Ask for a first draft, a continuation, or changes to the chapter, or use <Kbd>+</Kbd> to
            run a specialist over it. Every change is proposed in the chapter itself, one fix at a
            time, for you to accept or discard.
          </EmptyState>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <UserBubble key={m.id} text={m.content} agent={m.agent} />
          ) : (
            <AssistantMessage key={m.id} message={m} />
          ),
        )}

        {streaming && (
          <>
            <UserBubble text={streaming.pendingUser} />
            <div className="mr-6 text-sm leading-relaxed text-ink">
              {streaming.reply && <p className="whitespace-pre-wrap">{streaming.reply}</p>}
              {streaming.progress ? (
                <p className="mt-1.5 text-xs font-medium text-pencil-strong">
                  Writing… {wordCount(streaming.progress.text)} words
                </p>
              ) : (
                !streaming.reply && <Thinking />
              )}
            </div>
          </>
        )}
      </div>

      {error && <InlineAlert className="border-t">{error}</InlineAlert>}

      <form onSubmit={onSubmit} className="shrink-0 border-t border-line bg-surface p-3">
        <div
          className={cn(
            'rounded-panel border border-line bg-surface shadow-xs transition-[border-color,box-shadow]',
            'focus-within:border-pencil focus-within:ring-3 focus-within:ring-pencil/15',
            inputDisabled && 'bg-surface-muted',
          )}
        >
          <textarea
            aria-label="Message"
            aria-describedby={hintId}
            value={input}
            rows={3}
            disabled={inputDisabled}
            placeholder="Ask for a draft, a continuation, or a change…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-sm text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed disabled:text-ink-subtle"
          />
          <div className="flex items-center justify-between gap-2 p-2 pt-1">
            <div className="flex min-w-0 items-center gap-2">
              <AgentPicker agents={agents} disabledReason={disabledReason} onRun={onRunAgent} />
              <span
                id={hintId}
                className={cn(
                  'truncate text-[11px]',
                  disabledReason ? 'text-warning' : 'text-ink-subtle',
                )}
              >
                {disabledReason ?? (
                  <span className="hidden items-center gap-1 sm:flex">
                    <Kbd>↵</Kbd> send <Kbd className="ml-1">⇧↵</Kbd> new line
                  </span>
                )}
              </span>
            </div>
            <Button type="submit" size="sm" disabled={inputDisabled || !input.trim()}>
              <ArrowUp aria-hidden />
              Send
            </Button>
          </div>
        </div>
      </form>

      {confirmingClear && (
        <ConfirmDialog
          title="Clear this conversation?"
          description="The chapter's messages are removed. The chapter text is not affected."
          confirmLabel="Clear conversation"
          destructive
          onCancel={() => setConfirmingClear(false)}
          onConfirm={() => {
            setConfirmingClear(false);
            onClear();
          }}
        />
      )}
    </aside>
  );
}
