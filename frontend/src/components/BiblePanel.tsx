import { useState } from 'react';
import { useBible, useOutline, useSaveBible, useSaveOutline } from '../hooks/queries';
import { Button } from './ui/button';

function SaveState({ isError, isSuccess }: { isError: boolean; isSuccess: boolean }) {
  if (isError) return <span className="text-xs text-red-700">Error saving.</span>;
  if (isSuccess) return <span className="text-xs text-green-700">Saved.</span>;
  return null;
}

export function BiblePanel({ projectId }: { projectId: string }) {
  const bible = useBible(projectId);
  const outline = useOutline(projectId);
  const saveBible = useSaveBible(projectId);
  const saveOutline = useSaveOutline(projectId);

  // Track only the user's edits; fall back to the loaded server content until
  // they type. This derives the editor value without a seeding effect.
  const [bibleEdit, setBibleEdit] = useState<string | null>(null);
  const [outlineEdit, setOutlineEdit] = useState<string | null>(null);
  const bibleText = bibleEdit ?? bible.data?.content ?? '';
  const outlineText = outlineEdit ?? outline.data?.content ?? '';

  return (
    <aside className="flex w-80 min-w-[220px] flex-col gap-2 border-r border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-gray-400">Story Bible</h2>
        <SaveState isError={saveBible.isError} isSuccess={saveBible.isSuccess} />
      </div>
      <textarea
        value={bibleText}
        onChange={(e) => setBibleEdit(e.target.value)}
        spellCheck={false}
        className="flex-[2] resize-none rounded-md border border-gray-300 p-2 font-mono text-xs"
      />
      <Button variant="dark" onClick={() => saveBible.mutate(bibleText)} disabled={saveBible.isPending}>
        Save Bible
      </Button>

      <div className="mt-2 flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-gray-400">Outline</h2>
        <SaveState isError={saveOutline.isError} isSuccess={saveOutline.isSuccess} />
      </div>
      <textarea
        value={outlineText}
        onChange={(e) => setOutlineEdit(e.target.value)}
        spellCheck={false}
        className="flex-1 resize-none rounded-md border border-gray-300 p-2 font-mono text-xs"
      />
      <Button
        variant="dark"
        onClick={() => saveOutline.mutate(outlineText)}
        disabled={saveOutline.isPending}
      >
        Save Outline
      </Button>
    </aside>
  );
}
