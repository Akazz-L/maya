// The "+" beside the chat composer: specialist passes over the chapter. Picking
// one sends its turn straight away — the pass has nothing to ask, it reads the
// chapter and answers with fixes in the prose.
import { Plus, ScanSearch } from 'lucide-react';
import type { AgentOption } from '../api/types';
import { cn } from '../lib/utils';
import { Menu, MenuItem, MenuLabel } from './ui/menu';

export interface AgentPickerProps {
  agents: AgentOption[];
  /** Why no pass can run right now, shown in place of the list; null when one can. */
  disabledReason: string | null;
  onRun: (key: string) => void;
}

export function AgentPicker({ agents, disabledReason, onRun }: AgentPickerProps) {
  return (
    <Menu
      label="Specialists"
      side="top"
      className="w-72"
      trigger={(props, open) => (
        <button
          type="button"
          {...props}
          aria-label="Run a specialist"
          title="Specialist passes over this chapter"
          className={cn(
            'flex size-7 items-center justify-center rounded-full border transition-colors',
            open
              ? 'border-pencil-line bg-pencil-soft text-pencil-strong'
              : 'border-line bg-surface text-ink-subtle hover:border-line-strong hover:text-ink',
          )}
        >
          <Plus aria-hidden className={cn('size-4 transition-transform', open && 'rotate-45')} />
        </button>
      )}
    >
      <MenuLabel>Review this chapter</MenuLabel>
      {disabledReason ? (
        <p className="px-2.5 pb-2 text-xs text-ink-subtle">{disabledReason}</p>
      ) : agents.length ? (
        agents.map((agent) => (
          <MenuItem
            key={agent.key}
            icon={<ScanSearch />}
            hint={agent.hint}
            onSelect={() => onRun(agent.key)}
          >
            {agent.label}
          </MenuItem>
        ))
      ) : (
        <p className="px-2.5 pb-2 text-xs text-ink-subtle">No specialists available.</p>
      )}
    </Menu>
  );
}
