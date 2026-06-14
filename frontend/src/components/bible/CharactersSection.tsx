import type { Character } from '../../api/bible-types';
import { FieldLabel } from '../ui/card';
import { Input } from '../ui/input';
import { ListField } from './ListField';

interface Props {
  characters: Character[];
  onChange: (characters: Character[]) => void;
}

export function CharactersSection({ characters, onChange }: Props) {
  const updateChar = (i: number, char: Character) =>
    onChange(characters.map((c, j) => (j === i ? char : c)));
  const removeChar = (i: number) =>
    onChange(characters.filter((_, j) => j !== i));
  const addChar = () =>
    onChange([...characters, { name: '', traits: [], dialogue_examples: [] }]);

  return (
    <section id="characters" className="mb-10">
      <h2 className="mb-4 border-b-2 border-blue-500 pb-2 text-lg font-bold text-gray-800">
        👤 Characters
      </h2>
      <div className="flex flex-col gap-4">
        {characters.map((char, i) => (
          <div key={i} className="rounded-md border border-gray-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <FieldLabel>Character {i + 1}</FieldLabel>
              <button
                type="button"
                onClick={() => removeChar(i)}
                className="text-xs text-gray-400 hover:text-red-600"
              >
                Remove
              </button>
            </div>
            <div className="mb-3 flex flex-col gap-1">
              <FieldLabel>Name</FieldLabel>
              <Input
                value={char.name}
                onChange={(e) => updateChar(i, { ...char, name: e.target.value })}
              />
            </div>
            <div className="mb-3">
              <ListField
                label="Traits"
                items={char.traits}
                addLabel="+ Add trait"
                onChange={(traits) => updateChar(i, { ...char, traits })}
              />
            </div>
            <ListField
              label="Dialogue examples"
              items={char.dialogue_examples}
              addLabel="+ Add example"
              onChange={(dialogue_examples) => updateChar(i, { ...char, dialogue_examples })}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addChar}
        className="mt-3 w-full rounded-md border border-dashed border-gray-300 bg-gray-50 py-2 text-sm text-gray-400 hover:bg-gray-100"
      >
        + Add character
      </button>
    </section>
  );
}
