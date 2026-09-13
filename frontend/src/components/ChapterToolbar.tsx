import { GeneratePlanButton } from './GeneratePlanButton';
import { Button } from './ui/button';

interface ChapterToolbarProps {
  busy: boolean;
  /** Out of AI budget: the model actions are disabled, the toggles are not. */
  aiBlocked: boolean;
  /** The saved chapter notes, shown before a plan is generated from them. */
  brief: string;
  /** Saves pending edits before the plan pop-up shows the notes. */
  beforeOpenPlan: () => Promise<unknown>;
  onGeneratePlan: () => void;
  onEditNotes: () => void;
  onCheck: () => void;
  /** Whether the panel has anything to show — a saved plan or issues. */
  hasPanelContent: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

export function ChapterToolbar({
  busy,
  aiBlocked,
  brief,
  beforeOpenPlan,
  onGeneratePlan,
  onEditNotes,
  onCheck,
  hasPanelContent,
  panelOpen,
  onTogglePanel,
  chatOpen,
  onToggleChat,
}: ChapterToolbarProps) {
  const aiDisabled = busy || aiBlocked;
  return (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-6 py-2">
      <GeneratePlanButton
        disabled={aiDisabled}
        brief={brief}
        beforeOpen={beforeOpenPlan}
        onGenerate={onGeneratePlan}
        onEditNotes={onEditNotes}
      />
      <Button size="sm" variant="secondary" disabled={aiDisabled} onClick={onCheck}>
        Check
      </Button>
      <div className="ml-auto flex items-center gap-2">
        {/* Without this, a plan saved on the server is unreachable after a reload
            unless you regenerate it. */}
        <Button size="sm" variant="secondary" disabled={!hasPanelContent} onClick={onTogglePanel}>
          {panelOpen ? 'Hide plan' : 'Show plan'}
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
