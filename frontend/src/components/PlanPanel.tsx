import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Issue, ScenePlan } from '../api/types';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { IssuesList } from './IssuesList';
import { PlanForm } from './PlanForm';

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

interface PlanPanelProps {
  plan: ScenePlan | null;
  issues: Issue[] | null;
  height: number;
  onHeightChange: (px: number) => void;
  onPlanChange: (plan: ScenePlan) => void;
  onIssuesChange: (issues: Issue[]) => void;
  onDrop: () => void;
  onGenerateDraft: () => void;
  onRevise: () => void;
  busy: boolean;
}

export function PlanPanel({
  plan,
  issues,
  height,
  onHeightChange,
  onPlanChange,
  onIssuesChange,
  onDrop,
  onGenerateDraft,
  onRevise,
  busy,
}: PlanPanelProps) {
  const [tab, setTab] = useState<'plan' | 'issues'>('plan');

  // Drag the top edge to resize. Listeners go on window so the drag survives
  // the cursor leaving the 6px handle.
  const startResize = (e: ReactPointerEvent) => {
    const startY = e.clientY;
    const startHeight = height;
    const move = (ev: PointerEvent) =>
      onHeightChange(
        Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight - (ev.clientY - startY))),
      );
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const tabButton = (id: 'plan' | 'issues', label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        'rounded px-2 py-0.5 text-xs',
        tab === id ? 'bg-white font-medium text-gray-800' : 'text-gray-400 hover:text-gray-600',
      )}
    >
      {label}
    </button>
  );

  return (
    <section
      style={{ height }}
      className="flex flex-shrink-0 flex-col border-t border-gray-300 bg-[#fafaf7]"
    >
      <div
        onPointerDown={startResize}
        role="separator"
        aria-label="Resize panel"
        className="h-1.5 cursor-ns-resize bg-gray-200 hover:bg-blue-300"
      />

      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-1.5">
        <div className="flex items-center gap-1">
          {tabButton('plan', 'Plan')}
          {tabButton('issues', `Issues${issues?.length ? ` (${issues.length})` : ''}`)}
        </div>
        <div className="flex items-center gap-2">
          {tab === 'plan' ? (
            <>
              <Button size="sm" variant="secondary" onClick={onDrop} disabled={busy}>
                ✕ Drop
              </Button>
              <Button size="sm" onClick={onGenerateDraft} disabled={busy || !plan}>
                Generate Draft →
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={busy || !issues?.length}
              onClick={() => {
                if (
                  window.confirm(
                    'Revise the draft from these issues? This replaces the chapter text.',
                  )
                )
                  onRevise();
              }}
            >
              Revise Draft
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === 'plan' ? (
          plan ? (
            <PlanForm plan={plan} onChange={onPlanChange} />
          ) : (
            <p className="text-sm text-gray-400">No plan yet — use Generate Plan.</p>
          )
        ) : (
          <IssuesList issues={issues ?? []} onChange={onIssuesChange} />
        )}
      </div>
    </section>
  );
}
