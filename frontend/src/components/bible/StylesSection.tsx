import type { BibleData } from '../../api/bible-types';
import { FieldLabel } from '../ui/card';
import { ListField } from './ListField';

interface Props {
  style_guide: BibleData['style_guide'];
  onChange: (style_guide: BibleData['style_guide']) => void;
}

export function StylesSection({ style_guide, onChange }: Props) {
  return (
    <section id="styles" className="mb-10">
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-lg font-bold text-gray-800">
        🎨 Styles
      </h2>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <FieldLabel>Voice</FieldLabel>
          <textarea
            value={style_guide.voice}
            onChange={(e) => onChange({ ...style_guide, voice: e.target.value })}
            rows={3}
            className="w-full resize-y rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1.5 text-sm focus:border-blue-300 focus:bg-white focus:outline-none"
          />
        </div>
        <ListField
          label="Avoid"
          items={style_guide.avoid}
          addLabel="+ Add"
          onChange={(avoid) => onChange({ ...style_guide, avoid })}
        />
      </div>
    </section>
  );
}
