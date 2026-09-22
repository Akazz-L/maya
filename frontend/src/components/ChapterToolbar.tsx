import { ListTree, MessageSquare, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { chapterPanelId, chapterTabId, type ChapterView } from './chapterView';

interface ChapterToolbarProps {
  view: ChapterView;
  onViewChange: (view: ChapterView) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

const VIEWS: { id: ChapterView; label: string; icon: ReactNode }[] = [
  { id: 'write', label: 'Write', icon: <PenLine aria-hidden /> },
  { id: 'plan', label: 'Plan', icon: <ListTree aria-hidden /> },
];

export function ChapterToolbar({
  view,
  onViewChange,
  chatOpen,
  onToggleChat,
}: ChapterToolbarProps) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-soft bg-desk px-3 sm:px-5">
      {/* Switching views calls no model, so nothing locks it: a writer must be
          able to leave the Plan view while a plan generates. */}
      <div
        role="tablist"
        aria-label="Chapter view"
        className="flex items-center gap-0.5 rounded-lg bg-ink/6 p-0.5"
      >
        {VIEWS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={chapterTabId(id)}
            aria-selected={view === id}
            aria-controls={chapterPanelId(id)}
            onClick={() => onViewChange(id)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-all [&_svg]:size-3.5',
              view === id
                ? 'bg-paper text-ink shadow-[0_1px_2px_rgb(29_36_51/0.1)]'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* Reviewing lives in the chat's + picker, beside every other specialist,
          so the toolbar carries no model action of its own. Never disabled:
          the chat is where a running generation is followed. */}
      <button
        type="button"
        aria-pressed={chatOpen}
        onClick={onToggleChat}
        className={cn(
          'ml-auto flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors [&_svg]:size-4',
          chatOpen
            ? 'bg-ai-soft text-ai-ink hover:bg-ai-soft/70'
            : 'text-ink-2 hover:bg-ink/6 hover:text-ink',
        )}
      >
        <MessageSquare aria-hidden />
        Chat
      </button>
    </div>
  );
}
