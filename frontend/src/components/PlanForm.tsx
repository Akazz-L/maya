import { Plus, X } from 'lucide-react';
import type { ScenePlan } from '../api/types';
import { Field, Input, Textarea } from './ui/field';

interface Props {
  plan: ScenePlan;
  onChange: (plan: ScenePlan) => void;
}

type TextKey = Exclude<keyof ScenePlan, 'beats'>;

const SETTING: { key: TextKey; label: string; placeholder: string }[] = [
  { key: 'pov_character', label: 'POV Character', placeholder: 'Whose eyes' },
  { key: 'location', label: 'Location', placeholder: 'Where it happens' },
  { key: 'sensory_anchor', label: 'Sensory Anchor', placeholder: 'A sound, a smell' },
];

const IMAGES: { key: TextKey; label: string; placeholder: string }[] = [
  { key: 'opening_image', label: 'Opening Image', placeholder: 'The first thing the reader sees' },
  { key: 'closing_image', label: 'Closing Image', placeholder: 'What the chapter leaves behind' },
];

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

  return (
    <div className="flex flex-col gap-6">
      <Field label="Goal">
        <Textarea
          autoGrow
          rows={2}
          value={plan.goal}
          aria-label="Goal"
          placeholder="What this chapter has to accomplish"
          onChange={(e) => set('goal', e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        {SETTING.map(({ key, label, placeholder }) => (
          <Field key={key} label={label}>
            <Input
              value={plan[key]}
              aria-label={label}
              placeholder={placeholder}
              onChange={(e) => set(key, e.target.value)}
            />
          </Field>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {IMAGES.map(({ key, label, placeholder }) => (
          <Field key={key} label={label}>
            <Textarea
              autoGrow
              rows={2}
              value={plan[key]}
              aria-label={label}
              placeholder={placeholder}
              onChange={(e) => set(key, e.target.value)}
            />
          </Field>
        ))}
      </div>

      <section aria-labelledby="plan-beats" className="flex flex-col gap-2">
        <h3 id="plan-beats" className="text-[13px] font-medium text-ink-2">
          Beats
        </h3>
        {/* Beats are the chapter in order, so they are numbered. */}
        <ol className="flex flex-col gap-2">
          {plan.beats.map((beat, i) => (
            <li key={i} className="group flex items-start gap-2">
              <span
                aria-hidden
                className="w-6 shrink-0 pt-2 text-right font-serif text-sm text-ink-3 tabular-nums"
              >
                {i + 1}
              </span>
              {/* A beat is a sentence or two, not a word: it wraps and grows with
                  its text rather than scrolling sideways out of sight. */}
              <Textarea
                autoGrow
                rows={1}
                value={beat}
                aria-label={`Beat ${i + 1}`}
                onChange={(e) => setBeat(i, e.target.value)}
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => removeBeat(i)}
                title="Remove"
                aria-label={`Remove beat ${i + 1}`}
                className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 opacity-60 transition hover:bg-danger-soft hover:text-danger hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => set('beats', [...plan.beats, ''])}
          className="ml-8 flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-[13px] text-ink-2 transition-colors hover:border-accent hover:bg-accent-soft/40 hover:text-accent-ink"
        >
          <Plus aria-hidden className="size-4" />
          Add beat
        </button>
      </section>
    </div>
  );
}
