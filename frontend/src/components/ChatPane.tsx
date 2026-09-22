// The chapter's conversation with the assistant. Presentational: the
// workspace owns the stream and the proposal; this renders them and collects
// the next message.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Eraser, FileDiff, Sparkles, Wand2, X } from 'lucide-react';
import type { ProposalProgress } from '../api/stream';
import type { AgentOption, ChatMessage, ChatProposal } from '../api/types';
import { describeProposal, outcomeLabel, outcomeSummary, wordCount } from '../lib/chat';
import { cn } from '../lib/utils';
import { AgentPicker } from './AgentPicker';
import { Button } from './ui/button';
import { ConfirmDialog } from './ui/confirm-dialog';
import { Textarea } from './ui/field';

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
}

/** Ways to start, offered while the conversation is empty. Each is sent as written. */
const STARTERS = [
  'Draft this chapter.',
  'Continue from where the chapter stops.',
  'Tighten the prose without changing what happens.',
];

function UserBubble({ text, agent }: { text: string; agent?: string | null }) {
  // A pass the writer ran reads as an action, not as something they typed.
  if (agent) {
    return (
      <div className="flex items-center gap-2 self-end rounded-full border border-ai-line bg-ai-soft px-3 py-1.5 text-xs font-medium text-ai-ink">
        <Wand2 aria-hidden className="size-3.5" />
        {text}
      </div>
    );
  }
  return (
    <div className="ml-10 self-end rounded-2xl rounded-br-md bg-paper px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-ink shadow-[0_1px_2px_rgb(29_36_51/0.08)] ring-1 ring-line-soft">
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
        'mt-2 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[13px]',
        pending ? 'border-ai-line bg-ai-soft/60' : 'border-line-soft bg-paper/60',
      )}
    >
      <FileDiff
        aria-hidden
        className={cn('mt-0.5 size-4 shrink-0', pending ? 'text-ai' : 'text-ink-3')}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-ink">{describeProposal(proposal)}</span>
        <span className={pending ? 'text-ai-ink' : 'text-ink-3'}>{status}</span>
      </span>
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
    <span className="flex items-center gap-2 text-xs text-ink-3">
      <span aria-hidden className="flex gap-1">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 animate-pulse rounded-full bg-ai/60"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      Thinking…
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
}: ChatPaneProps) {
  const [input, setInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const inputDisabled = Boolean(disabledReason) || streaming !== null;
  const empty = !loading && !messages.length && !streaming;

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const send = async (text: string) => {
    if (!text || inputDisabled) return;
    setInput('');
    const sent = await onSend(text);
    // Give the text back unless the writer has already started a new one.
    if (!sent) setInput((current) => current || text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input.trim());
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input.trim());
  };

  return (
    <aside
      aria-label="Chapter chat"
      className="flex w-[min(24rem,100vw)] shrink-0 flex-col border-l border-line-soft bg-surface max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-pop"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line-soft px-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles aria-hidden className="size-4 text-ai" />
          Chat
        </h2>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="xs"
            disabled={!messages.length || streaming !== null}
            onClick={() => setConfirmClear(true)}
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
        aria-live="polite"
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5"
      >
        {loading && <Thinking />}

        {empty && (
          <div className="flex flex-col gap-4 pt-4">
            <p className="text-sm leading-relaxed text-ink-2">
              Ask for a first draft, a continuation, or changes to the chapter, or use
              <span className="mx-1 inline-flex size-5 items-center justify-center rounded-md border border-line bg-paper align-[-3px] text-xs">
                +
              </span>
              to run a specialist over it. Every change arrives in the chapter as a proposal you
              accept or discard.
            </p>
            <div className="flex flex-col items-start gap-1.5">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  disabled={inputDisabled}
                  onClick={() => void send(starter)}
                  className="rounded-full border border-line bg-paper px-3 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:border-ai-line hover:bg-ai-soft hover:text-ai-ink disabled:opacity-50"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
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
            <div className="mr-6 flex flex-col gap-1.5 text-sm leading-relaxed text-ink">
              {streaming.reply && <p className="whitespace-pre-wrap">{streaming.reply}</p>}
              {streaming.progress ? (
                <p className="flex items-center gap-2 text-xs font-medium text-ai-ink">
                  <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-ai" />
                  Writing… {wordCount(streaming.progress.text)} words
                </p>
              ) : (
                !streaming.reply && <Thinking />
              )}
            </div>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="mx-3 mb-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="shrink-0 px-3 pb-3">
        <div
          className={cn(
            'rounded-2xl border border-line bg-paper p-2 shadow-xs transition-[border-color,box-shadow]',
            'focus-within:border-ai-line focus-within:shadow-[0_0_0_3px_var(--ai-soft)]',
          )}
        >
          <Textarea
            autoGrow
            aria-label="Message"
            value={input}
            rows={2}
            disabled={inputDisabled}
            placeholder="Ask for a draft, a continuation, or a change…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-48 overflow-y-auto border-none bg-transparent px-1.5 py-1 shadow-none hover:border-none focus:bg-transparent focus:shadow-none"
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex min-w-0 items-center gap-2">
              <AgentPicker agents={agents} disabledReason={disabledReason} onRun={onRunAgent} />
              <span className="truncate text-[11px] text-ink-3">
                {disabledReason ?? '↵ send · ⇧↵ new line'}
              </span>
            </div>
            <Button
              type="submit"
              variant="ai"
              size="icon-sm"
              aria-label="Send"
              className="rounded-full"
              disabled={inputDisabled || !input.trim()}
            >
              <ArrowUp aria-hidden />
            </Button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmClear}
        title="Clear this conversation?"
        description="The chapter text is not affected."
        confirmLabel="Clear"
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          onClear();
        }}
      />
    </aside>
  );
}
