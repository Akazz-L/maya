import { useLayoutEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import type { ScenePlan } from '../api/types';
import { Field } from './ui/field';
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
    <li className="group flex items-start gap-2">
      <span
        aria-hidden
        className="mt-2 w-5 shrink-0 text-right font-serif text-sm text-ink-subtle tabular-nums"
      >
        {index + 1}
      </span>
      <Textarea
        ref={textarea}
        value={value}
        rows={1}
        aria-label={`Beat ${index + 1}`}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 resize-none overflow-hidden"
      />
      <button
        type="button"
        onClick={onRemove}
        title={`Remove beat ${index + 1}`}
        aria-label={`Remove beat ${index + 1}`}
        className="mt-1.5 flex size-7 shrink-0 items-center justify-center rounded-control text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <X aria-hidden className="size-4" />
      </button>
    </li>
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

  const text = (key: 'pov_character' | 'location' | 'sensory_anchor', label: string) => (
    <Field label={label}>
      {(control) => (
        <Input {...control} value={plan[key]} onChange={(e) => set(key, e.target.value)} />
      )}
    </Field>
  );

  const passage = (key: 'goal' | 'opening_image' | 'closing_image', label: string) => (
    <Field label={label}>
      {(control) => (
        <Textarea
          {...control}
          value={plan[key]}
          onChange={(e) => set(key, e.target.value)}
          className="min-h-16 resize-y"
        />
      )}
    </Field>
  );

  return (
    <div className="flex flex-col gap-6">
      {passage('goal', 'Goal')}

      <div className="grid gap-4 sm:grid-cols-3">
        {text('pov_character', 'POV character')}
        {text('location', 'Location')}
        {text('sensory_anchor', 'Sensory anchor')}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {passage('opening_image', 'Opening image')}
        {passage('closing_image', 'Closing image')}
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-xs font-medium text-ink-muted">Beats</legend>
        {plan.beats.length > 0 && (
          <ol className="mb-2 flex flex-col gap-2">
            {plan.beats.map((beat, i) => (
              <BeatField
                key={i}
                index={i}
                value={beat}
                onChange={(value) => setBeat(i, value)}
                onRemove={() => removeBeat(i)}
              />
            ))}
          </ol>
        )}
        <button
          type="button"
          onClick={addBeat}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-control border border-dashed border-line-strong text-sm text-ink-subtle transition-colors hover:border-ink-faint hover:bg-surface-muted hover:text-ink"
        >
          <Plus aria-hidden className="size-4" />
          Add beat
        </button>
      </fieldset>
    </div>
  );
}
