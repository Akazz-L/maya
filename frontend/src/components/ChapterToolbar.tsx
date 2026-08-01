import { Button } from './ui/button';

interface ChapterToolbarProps {
  busy: boolean;
  onGeneratePlan: () => void;
  onGenerateDraft: () => void;
  onCheck: () => void;
  /** Whether the panel has anything to show — a saved plan or issues. */
  hasPanelContent: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

export function ChapterToolbar({
  busy,
  onGeneratePlan,
  onGenerateDraft,
  onCheck,
  hasPanelContent,
  panelOpen,
  onTogglePanel,
}: ChapterToolbarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-6 py-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={onGeneratePlan}>
        Generate Plan
      </Button>
      <Button size="sm" disabled={busy} onClick={onGenerateDraft}>
        Generate Draft
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={onCheck}>
        Check
      </Button>
      {/* Without this, a plan saved on the server is unreachable after a reload
          unless you regenerate it. */}
      <Button
        size="sm"
        variant="secondary"
        disabled={!hasPanelContent}
        onClick={onTogglePanel}
        className="ml-auto"
      >
        {panelOpen ? 'Hide plan' : 'Show plan'}
      </Button>
    </div>
  );
}
