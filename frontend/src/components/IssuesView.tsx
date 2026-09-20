import type { Issue } from '../api/types';
import { Button } from './ui/button';
import { IssuesList } from './IssuesList';

interface IssuesViewProps {
  /** Issues from the last Check, or null when none has run. */
  issues: Issue[] | null;
  busy: boolean;
  /** Out of AI budget: revise is disabled; editing the issues is not. */
  aiBlocked: boolean;
  onChange: (issues: Issue[]) => void;
  onRevise: () => void;
}

export function IssuesView({ issues, busy, aiBlocked, onChange, onRevise }: IssuesViewProps) {
  return (
    <section className="flex flex-1 flex-col overflow-hidden bg-[#fafaf7]">
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-2">
        <h2 className="text-sm font-semibold text-gray-800">Continuity issues</h2>
        <Button
          size="sm"
          disabled={busy || aiBlocked || !issues?.length}
          onClick={() => {
            if (
              window.confirm('Revise the draft from these issues? This replaces the chapter text.')
            )
              onRevise();
          }}
        >
          Revise Draft
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl">
          {issues ? (
            <IssuesList issues={issues} onChange={onChange} />
          ) : (
            <p className="py-16 text-center text-sm text-gray-500">
              No check has run yet — use Check to review this chapter.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
