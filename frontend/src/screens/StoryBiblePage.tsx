import { useEffect, useRef, useState } from 'react';
import { EMPTY_BIBLE, EMPTY_OUTLINE } from '../api/bible-types';
import type { BibleData, OutlineData } from '../api/bible-types';
import { CharactersSection } from '../components/bible/CharactersSection';
import { OutlinesSection } from '../components/bible/OutlinesSection';
import { StylesSection } from '../components/bible/StylesSection';
import { TimelineSection } from '../components/bible/TimelineSection';
import { WorldSection } from '../components/bible/WorldSection';
import { useBible, useOutline, useSaveBible, useSaveOutline } from '../hooks/queries';
import type { View } from '../components/NavBar';

type BibleView = Exclude<View, 'write'>;

function SaveIndicator({
  isPending,
  isError,
  isSuccess,
}: {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}) {
  if (isPending) return <span className="text-xs text-gray-400">Saving…</span>;
  if (isError) return <span className="text-xs text-red-600">Error saving.</span>;
  if (isSuccess) return <span className="text-xs text-green-600">Saved.</span>;
  return null;
}

export function StoryBiblePage({
  projectId,
  activeSection,
}: {
  projectId: string;
  activeSection: BibleView;
}) {
  const bibleQuery = useBible(projectId);
  const outlineQuery = useOutline(projectId);
  const saveBible = useSaveBible(projectId);
  const saveOutline = useSaveOutline(projectId);

  const [bibleData, setBibleData] = useState<BibleData>(EMPTY_BIBLE);
  const [outlineData, setOutlineData] = useState<OutlineData>(EMPTY_OUTLINE);
  const bibleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (bibleQuery.data) setBibleData(bibleQuery.data);
  }, [bibleQuery.data]);

  useEffect(() => {
    if (outlineQuery.data) setOutlineData(outlineQuery.data);
  }, [outlineQuery.data]);

  useEffect(() => {
    document.getElementById(activeSection)?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSection]);

  const updateBible = (data: BibleData) => {
    setBibleData(data);
    if (bibleTimerRef.current) clearTimeout(bibleTimerRef.current);
    bibleTimerRef.current = setTimeout(() => saveBible.mutate(data), 800);
  };

  const updateOutline = (data: OutlineData) => {
    setOutlineData(data);
    if (outlineTimerRef.current) clearTimeout(outlineTimerRef.current);
    outlineTimerRef.current = setTimeout(() => saveOutline.mutate(data), 800);
  };

  if (bibleQuery.isLoading || outlineQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-2">
        <h2 className="text-sm font-medium text-gray-600">Story Bible</h2>
        <div className="flex items-center gap-4">
          <SaveIndicator
            isPending={saveBible.isPending}
            isError={saveBible.isError}
            isSuccess={saveBible.isSuccess}
          />
          <SaveIndicator
            isPending={saveOutline.isPending}
            isError={saveOutline.isError}
            isSuccess={saveOutline.isSuccess}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <CharactersSection
          characters={bibleData.characters}
          onChange={(characters) => updateBible({ ...bibleData, characters })}
        />
        <WorldSection
          world={bibleData.world}
          onChange={(world) => updateBible({ ...bibleData, world })}
        />
        <StylesSection
          style_guide={bibleData.style_guide}
          onChange={(style_guide) => updateBible({ ...bibleData, style_guide })}
        />
        <TimelineSection
          timeline={bibleData.timeline}
          onChange={(timeline) => updateBible({ ...bibleData, timeline })}
        />
        <OutlinesSection
          chapters={outlineData.chapters}
          onChange={(chapters) => updateOutline({ chapters })}
        />
      </div>
    </main>
  );
}
