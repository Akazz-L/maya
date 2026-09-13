import type { ModelKey, ModelOption } from '../api/types';
import { Select } from './ui/select';

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
 */
export function ModelPicker({ models, value, onChange, saving = false }: ModelPickerProps) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">Model</span>
      <Select
        aria-label="Model"
        value={value}
        disabled={saving}
        onChange={(e) => onChange(e.target.value as ModelKey)}
        className="py-1 text-xs"
      >
        {models.map((model) => (
          <option key={model.key} value={model.key}>
            {model.label} · {model.hint}
          </option>
        ))}
      </Select>
    </label>
  );
}
