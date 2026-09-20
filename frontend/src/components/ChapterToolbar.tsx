import { cn } from '../lib/utils';
import { chapterPanelId, chapterTabId, type ChapterView } from './chapterView';
import { Button } from './ui/button';

interface ChapterToolbarProps {
  view: ChapterView;
  onViewChange: (view: ChapterView) => void;
  /** Issues from the last Review, or null when none has run: the tab appears with the first. */
  issueCount: number | null;
  busy: boolean;
  /** Out of AI budget: Review is disabled, the view switcher and chat toggle are not. */
  aiBlocked: boolean;
  onReview: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

export function ChapterToolbar({
  view,
  onViewChange,
  issueCount,
  busy,
  aiBlocked,
  onReview,
  chatOpen,
  onToggleChat,
}: ChapterToolbarProps) {
  const views: { id: ChapterView; label: string }[] = [
    { id: 'write', label: 'Write' },
    { id: 'plan', label: 'Plan' },
    // Nothing to show before the first Review, so the tab stays out of the way.
    ...(issueCount === null
      ? []
      : [{ id: 'issues' as const, label: issueCount ? `Issues (${issueCount})` : 'Issues' }]),
  ];

  return (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-6 py-2">
      {/* Switching views calls no model, so neither busy nor aiBlocked locks it:
          a writer must be able to leave the Plan view while a plan generates. */}
      <div
        role="tablist"
        aria-label="Chapter view"
        className="flex items-center gap-0.5 rounded-md bg-gray-100 p-0.5"
      >
        {views.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={chapterTabId(id)}
            aria-selected={view === id}
            aria-controls={chapterPanelId(id)}
            onClick={() => onViewChange(id)}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              view === id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy || aiBlocked} onClick={onReview}>
          Review
        </Button>
        {/* Never disabled: the chat is where a running generation is followed. */}
        <Button
          size="sm"
          variant={chatOpen ? 'primary' : 'secondary'}
          aria-pressed={chatOpen}
          onClick={onToggleChat}
        >
          Chat
        </Button>
      </div>
    </div>
  );
}
