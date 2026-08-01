import { Button } from './ui/button';

interface ChapterToolbarProps {
  busy: boolean;
  onGeneratePlan: () => void;
  onGenerateDraft: () => void;
  onCheck: () => void;
}

export function ChapterToolbar({
  busy,
  onGeneratePlan,
  onGenerateDraft,
  onCheck,
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
    </div>
  );
}
