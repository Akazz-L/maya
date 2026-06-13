import type { Issue, Severity } from '../api/types';
import { SEVERITIES } from '../api/types';
import { FieldLabel } from './ui/card';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';

interface Props {
  issue: Issue;
  index: number;
  onChange: (issue: Issue) => void;
  onRemove: () => void;
}

export function IssueCard({ issue, index, onChange, onRemove }: Props) {
  const set = <K extends keyof Issue>(key: K, value: Issue[K]) =>
    onChange({ ...issue, [key]: value });

  return (
    <div className="rounded-md border border-gray-200 p-3.5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="text-[11px] text-gray-400">#{index + 1}</span>
        <Select
          value={issue.severity}
          onChange={(e) => set('severity', e.target.value as Severity)}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="col-span-2">
          <FieldLabel>Issue</FieldLabel>
          <Textarea
            value={issue.issue}
            onChange={(e) => set('issue', e.target.value)}
            className="min-h-[52px] resize-y text-[13px]"
          />
        </div>
        <div>
          <FieldLabel>Location</FieldLabel>
          <Input
            value={issue.location}
            onChange={(e) => set('location', e.target.value)}
            className="text-[13px]"
          />
        </div>
        <div>
          <FieldLabel>Suggested Fix</FieldLabel>
          <Textarea
            value={issue.suggested_fix}
            onChange={(e) => set('suggested_fix', e.target.value)}
            className="min-h-[52px] resize-y text-[13px]"
          />
        </div>
      </div>
    </div>
  );
}
