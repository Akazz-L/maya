import type { BibleData } from '../../api/bible-types';
import { ListField } from './ListField';

interface Props {
  world: BibleData['world'];
  onChange: (world: BibleData['world']) => void;
}

export function WorldSection({ world, onChange }: Props) {
  return (
    <section id="world" className="mb-10">
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-lg font-bold text-gray-800">
        🌍 World
      </h2>
      <div className="flex flex-col gap-5">
        <ListField
          label="Locations"
          items={world.locations}
          addLabel="+ Add location"
          onChange={(locations) => onChange({ ...world, locations })}
        />
        <ListField
          label="Rules"
          items={world.rules}
          addLabel="+ Add rule"
          onChange={(rules) => onChange({ ...world, rules })}
        />
      </div>
    </section>
  );
}
