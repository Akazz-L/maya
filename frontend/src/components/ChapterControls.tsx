import { Input } from './ui/input';

interface Props {
  chapter: number;
  onChange: (n: number) => void;
}

export function ChapterControls({ chapter, onChange }: Props) {
  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        Chapter
        <Input
          type="number"
          min={1}
          value={chapter}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 1)}
          className="w-16"
        />
      </label>
    </div>
  );
}
