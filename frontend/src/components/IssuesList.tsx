import type { Issue } from '../api/types';
import { IssueCard } from './IssueCard';

interface Props {
  issues: Issue[];
  onChange: (issues: Issue[]) => void;
}

export function IssuesList({ issues, onChange }: Props) {
  if (issues.length === 0) {
    return (
      <div className="py-5 text-center text-sm text-gray-500">
        No issues found — ready to accept.
      </div>
    );
  }

  const update = (i: number, issue: Issue) =>
    onChange(issues.map((iss, j) => (j === i ? issue : iss)));

  const remove = (i: number) => onChange(issues.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-3.5">
      {issues.map((issue, i) => (
        <IssueCard
          key={i}
          issue={issue}
          index={i}
          onChange={(updated) => update(i, updated)}
          onRemove={() => remove(i)}
        />
      ))}
    </div>
  );
}
