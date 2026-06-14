import { Input } from '../ui/input';
import { FieldLabel } from '../ui/card';

interface ListFieldProps {
  label: string;
  items: string[];
  addLabel: string;
  onChange: (items: string[]) => void;
}

export function ListField({ label, items, addLabel, onChange }: ListFieldProps) {
  const update = (i: number, value: string) =>
    onChange(items.map((item, j) => (j === i ? value : item)));
  const remove = (i: number) =>
    onChange(items.filter((_, j) => j !== i));
  const add = () => onChange([...items, '']);

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={item}
              onChange={(e) => update(i, e.target.value)}
            />
            <button
              onClick={() => remove(i)}
              className="rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:border-blue-300 focus:outline-none"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={add}
        className="mt-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:border-blue-300 focus:outline-none"
      >
        {addLabel}
      </button>
    </div>
  );
}
