// The "+" beside the chat composer: specialist passes over the chapter. Picking
// one sends its turn straight away — the pass has nothing to ask, it reads the
// chapter and answers with fixes in the prose.
import { useEffect, useRef, useState } from 'react';
import type { AgentOption } from '../api/types';
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

  // Click-away and Escape, so the menu never strands the composer.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Run a specialist"
        aria-expanded={open}
        title="Specialist passes over this chapter"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full border text-base leading-none transition',
          open
            ? 'border-violet-300 bg-violet-50 text-violet-700'
            : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700',
        )}
      >
        +
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Specialists"
          className="absolute bottom-9 left-0 z-30 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl shadow-gray-900/10"
        >
          <p className="border-b border-gray-100 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">
            Review this chapter
          </p>
          {disabledReason ? (
            <p className="px-3 py-2.5 text-xs text-gray-500">{disabledReason}</p>
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
                className="block w-full px-3 py-2 text-left hover:bg-violet-50"
              >
                <span className="block text-xs font-medium text-gray-800">{agent.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">
                  {agent.hint}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2.5 text-xs text-gray-500">No specialists available.</p>
          )}
        </div>
      )}
    </div>
  );
}
