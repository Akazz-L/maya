import { Input } from '../ui/input';

interface Props {
  chapters: string[];
  onChange: (chapters: string[]) => void;
}

export function OutlinesSection({ chapters, onChange }: Props) {
  const update = (i: number, value: string) =>
    onChange(chapters.map((c, j) => (j === i ? value : c)));
  const remove = (i: number) =>
    onChange(chapters.filter((_, j) => j !== i));
  const add = () => onChange([...chapters, '']);

  return (
    <section id="outlines" className="mb-10">
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-lg font-bold text-gray-800">
        📋 Outlines
      </h2>
      <div className="flex flex-col gap-1.5">
        {chapters.map((chapter, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-20 flex-shrink-0 text-right text-xs text-gray-400">
              Chapter {i + 1}
            </span>
            <Input value={chapter} onChange={(e) => update(i, e.target.value)} className="flex-1" />
            <button
              type="button"
              onClick={() => remove(i)}
              className="flex-shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm leading-none text-gray-400 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-1.5 w-full rounded-md border border-dashed border-gray-300 bg-gray-50 py-1.5 text-[13px] text-gray-400 hover:bg-gray-100"
      >
        + Add chapter
      </button>
    </section>
  );
}
