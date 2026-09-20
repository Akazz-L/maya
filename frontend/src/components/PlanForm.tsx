import { useLayoutEffect, useRef } from 'react';
import type { ScenePlan } from '../api/types';
import { FieldLabel } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

interface Props {
  plan: ScenePlan;
  onChange: (plan: ScenePlan) => void;
}

interface BeatFieldProps {
  index: number;
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
}

/**
 * A beat is a sentence or two, not a word: it wraps and grows with its text
 * rather than scrolling sideways out of sight.
 */
function BeatField({ index, value, onChange, onRemove }: BeatFieldProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="flex items-start gap-1.5">
      <span className="mt-2 w-[18px] flex-shrink-0 text-right text-xs text-gray-400">
        {index + 1}.
      </span>
      <Textarea
        ref={textarea}
        value={value}
        rows={1}
        aria-label={`Beat ${index + 1}`}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 resize-none overflow-hidden leading-relaxed"
      />
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        className="mt-0.5 flex-shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm leading-none text-gray-400 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
      >
        ×
      </button>
    </div>
  );
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
      <div className="mb-3.5 flex flex-col gap-1">
        <FieldLabel>Goal</FieldLabel>
        <Textarea
          value={plan.goal}
          aria-label="Goal"
          onChange={(e) => set('goal', e.target.value)}
          className="min-h-14 resize-y leading-relaxed"
        />
      </div>

      <div className="mb-3.5 grid gap-3.5 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <FieldLabel>POV Character</FieldLabel>
          <Input
            value={plan.pov_character}
            aria-label="POV Character"
            onChange={(e) => set('pov_character', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>Location</FieldLabel>
          <Input
            value={plan.location}
            aria-label="Location"
            onChange={(e) => set('location', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>Sensory Anchor</FieldLabel>
          <Input
            value={plan.sensory_anchor}
            aria-label="Sensory Anchor"
            onChange={(e) => set('sensory_anchor', e.target.value)}
          />
        </div>
      </div>

      <div className="mb-3.5 grid gap-3.5 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <FieldLabel>Opening Image</FieldLabel>
          <Textarea
            value={plan.opening_image}
            aria-label="Opening Image"
            onChange={(e) => set('opening_image', e.target.value)}
            className="min-h-14 resize-y leading-relaxed"
          />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>Closing Image</FieldLabel>
          <Textarea
            value={plan.closing_image}
            aria-label="Closing Image"
            onChange={(e) => set('closing_image', e.target.value)}
            className="min-h-14 resize-y leading-relaxed"
          />
        </div>
      </div>

      <div className="mb-3.5">
        <FieldLabel>Beats</FieldLabel>
        <div className="flex flex-col gap-1.5">
          {plan.beats.map((beat, i) => (
            <BeatField
              key={i}
              index={i}
              value={beat}
              onChange={(value) => setBeat(i, value)}
              onRemove={() => removeBeat(i)}
            />
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
