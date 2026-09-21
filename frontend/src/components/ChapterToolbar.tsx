import type { KeyboardEvent } from 'react';
import { ListTree, MessageSquare, PenLine } from 'lucide-react';
import { cn } from '../lib/utils';
import { chapterPanelId, chapterTabId, type ChapterView } from './chapterView';
import { Button } from './ui/button';

interface ChapterToolbarProps {
  view: ChapterView;
  onViewChange: (view: ChapterView) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

const VIEWS = [
  { id: 'write', label: 'Write', Icon: PenLine },
  { id: 'plan', label: 'Plan', Icon: ListTree },
] as const satisfies readonly { id: ChapterView; label: string; Icon: unknown }[];

export function ChapterToolbar({
  view,
  onViewChange,
  chatOpen,
  onToggleChat,
}: ChapterToolbarProps) {
  // Tabs follow the arrow keys, and only the selected one sits in the tab order.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const at = VIEWS.findIndex((v) => v.id === view);
    const next = VIEWS[(at + (e.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) % VIEWS.length];
    onViewChange(next.id);
    document.getElementById(chapterTabId(next.id))?.focus();
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
      {/* Switching views calls no model, so nothing locks it: a writer must be
          able to leave the Plan view while a plan generates. */}
      <div
        role="tablist"
        aria-label="Chapter view"
        onKeyDown={onKeyDown}
        className="flex items-center gap-0.5 rounded-[7px] bg-surface-sunken p-0.5"
      >
        {VIEWS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={chapterTabId(id)}
            aria-selected={view === id}
            aria-controls={chapterPanelId(id)}
            tabIndex={view === id ? 0 : -1}
            onClick={() => onViewChange(id)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-xs font-medium transition-colors',
              view === id ? 'bg-surface text-ink shadow-xs' : 'text-ink-subtle hover:text-ink',
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
      {/* Reviewing lives in the chat's + picker, beside every other specialist,
          so the toolbar carries no model action of its own. Never disabled: the
          chat is where a running generation is followed. */}
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={chatOpen}
        onClick={onToggleChat}
        className="ml-auto aria-pressed:bg-pencil-soft aria-pressed:text-pencil-strong"
      >
        <MessageSquare aria-hidden />
        Chat
      </Button>
    </div>
  );
}
