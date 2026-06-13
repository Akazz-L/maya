import { DraftEditor } from './DraftEditor';

interface Props {
  chapter: number;
  draft: string;
}

export function SavedView({ chapter, draft }: Props) {
  return (
    <div>
      <div className="mb-3.5 rounded-md border border-green-200 bg-green-50 px-3.5 py-2.5 text-[13px] text-green-700">
        ✓ Chapter {chapter} is saved — read-only. Click “Redo chapter” to replace it.
      </div>
      <DraftEditor value={draft} readOnly />
    </div>
  );
}
