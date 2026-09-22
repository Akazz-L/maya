import type { ModelKey, ModelOption } from '../api/types';
import { Select } from './ui/field';

interface ModelPickerProps {
  models: ModelOption[];
  value: ModelKey;
  onChange: (modelKey: ModelKey) => void;
  /** True while the change is in flight; the picker is never disabled by generation. */
  saving?: boolean;
}

/**
 * Which model this writer generates with.
 *
 * Deliberately stays enabled while a generation is streaming and while the
 * budget is spent: the server reads the preference per request, so a change
 * applies to the next call and cannot disturb one already running.
 *
 * A native select, so the list is keyboard- and screen-reader-complete for free.
 */
export function ModelPicker({ models, value, onChange, saving = false }: ModelPickerProps) {
  return (
    <Select
      aria-label="Model"
      value={value}
      disabled={saving}
      onChange={(e) => onChange(e.target.value as ModelKey)}
      className="h-8 w-auto max-w-[7rem] border-transparent sm:max-w-[15rem] bg-transparent text-[13px] font-medium hover:border-line hover:bg-raised"
    >
      {models.map((model) => (
        <option key={model.key} value={model.key}>
          {model.label} · {model.hint}
        </option>
      ))}
    </Select>
  );
}
