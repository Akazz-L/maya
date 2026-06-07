import type { ScenePlan } from '../api/types';
import { FieldLabel } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

interface Props {
  plan: ScenePlan;
  onChange: (plan: ScenePlan) => void;
}

export function PlanForm({ plan, onChange }: Props) {
  const set = <K extends keyof ScenePlan>(key: K, value: ScenePlan[K]) =>
    onChange({ ...plan, [key]: value });

  const setBeat = (i: number, value: string) =>
    set(
      'beats',
      plan.beats.map((b, j) => (j === i ? value : b)),
    );

  const removeBeat = (i: number) =>
    set(
      'beats',
      plan.beats.filter((_, j) => j !== i),
    );

  const addBeat = () => set('beats', [...plan.beats, '']);

  return (
    <div>
      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        <div className="flex flex-col gap-1">
          <FieldLabel>Goal</FieldLabel>
          <Textarea
            value={plan.goal}
            onChange={(e) => set('goal', e.target.value)}
            className="min-h-14 resize-y"
          />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>POV Character</FieldLabel>
          <Input value={plan.pov_character} onChange={(e) => set('pov_character', e.target.value)} />
        </div>
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        <div className="flex flex-col gap-1">
          <FieldLabel>Location</FieldLabel>
          <Input value={plan.location} onChange={(e) => set('location', e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>Sensory Anchor</FieldLabel>
          <Input
            value={plan.sensory_anchor}
            onChange={(e) => set('sensory_anchor', e.target.value)}
          />
        </div>
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        <div className="flex flex-col gap-1">
          <FieldLabel>Opening Image</FieldLabel>
          <Textarea
            value={plan.opening_image}
            onChange={(e) => set('opening_image', e.target.value)}
            className="min-h-14 resize-y"
          />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>Closing Image</FieldLabel>
          <Textarea
            value={plan.closing_image}
            onChange={(e) => set('closing_image', e.target.value)}
            className="min-h-14 resize-y"
          />
        </div>
      </div>

      <div className="mb-3.5">
        <FieldLabel>Beats</FieldLabel>
        <div className="flex flex-col gap-1.5">
          {plan.beats.map((beat, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-[18px] flex-shrink-0 text-right text-xs text-gray-400">
                {i + 1}.
              </span>
              <Input value={beat} onChange={(e) => setBeat(i, e.target.value)} className="flex-1" />
              <button
                type="button"
                onClick={() => removeBeat(i)}
                title="Remove"
                className="flex-shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm leading-none text-gray-400 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addBeat}
          className="mt-1.5 w-full rounded-md border border-dashed border-gray-300 bg-gray-50 py-1.5 text-[13px] text-gray-400 hover:bg-gray-100"
        >
          + Add beat
        </button>
      </div>
    </div>
  );
}
