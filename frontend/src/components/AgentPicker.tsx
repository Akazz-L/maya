// The "+" beside the chat composer: specialist passes over the chapter. Picking
// one sends its turn straight away — the pass has nothing to ask, it reads the
// chapter and answers with fixes in the prose.
import { useRef, useState } from 'react';
import { Plus, Wand2 } from 'lucide-react';
import type { AgentOption } from '../api/types';
import { useDismiss } from '../hooks/useDismiss';
import { cn } from '../lib/utils';

export interface AgentPickerProps {
  agents: AgentOption[];
  /** Why no pass can run right now, shown in place of the list; null when one can. */
  disabledReason: string | null;
  onRun: (key: string) => void;
}

export function AgentPicker({ agents, disabledReason, onRun }: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Run a specialist"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Specialist passes over this chapter"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex size-7 items-center justify-center rounded-full border transition-[background-color,border-color,color,transform]',
          open
            ? 'rotate-45 border-ai-line bg-ai-soft text-ai-ink'
            : 'border-line bg-raised text-ink-2 hover:border-ai-line hover:text-ai-ink',
        )}
      >
        <Plus aria-hidden className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Specialists"
          className="absolute bottom-10 left-0 z-30 w-72 origin-bottom-left animate-rise overflow-hidden rounded-xl border border-line bg-raised p-1 shadow-pop"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-ink-2">Review this chapter</p>
          {disabledReason ? (
            <p className="px-2.5 py-2 text-xs text-ink-3">{disabledReason}</p>
          ) : agents.length ? (
            agents.map((agent) => (
              <button
                key={agent.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onRun(agent.key);
                }}
                className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-ai-soft"
              >
                <Wand2 aria-hidden className="mt-0.5 size-4 shrink-0 text-ai" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-ink">{agent.label}</span>
                  <span className="text-xs leading-snug text-ink-2">{agent.hint}</span>
                </span>
              </button>
            ))
          ) : (
            <p className="px-2.5 py-2 text-xs text-ink-3">No specialists available.</p>
          )}
        </div>
      )}
    </div>
  );
}
