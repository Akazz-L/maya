// The ⌘K card: one instruction, a few presets, one send button. Anchored
// under the selection by the layer that renders it.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../lib/utils';

const PRESETS: { label: string; instruction: string }[] = [
  { label: 'Tighten', instruction: 'Tighten this passage. Cut every word that is not pulling weight.' },
  { label: 'More tension', instruction: 'Raise the tension. Keep what happens the same.' },
  {
    label: "Show, don't tell",
    instruction: 'Replace told emotions with concrete action and sensory detail.',
  },
];

export interface RewritePromptProps {
  initialInstruction: string;
  onSubmit: (instruction: string) => void;
  onCancel: () => void;
}

export function RewritePrompt({ initialInstruction, onSubmit, onCancel }: RewritePromptProps) {
  const [instruction, setInstruction] = useState(initialInstruction);
  const input = useRef<HTMLInputElement>(null);
  const canSubmit = instruction.trim().length > 0;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const submit = () => {
    if (canSubmit) onSubmit(instruction.trim());
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && e.target === input.current) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Rewrite selection"
      onKeyDown={onKeyDown}
      className="w-[26rem] max-w-[calc(100vw-4rem)] rounded-xl border border-violet-200 bg-white p-2.5 shadow-lg shadow-violet-900/10"
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-violet-600">
        <span aria-hidden>✦</span> Rewrite selection
      </div>
      <div className="flex items-center gap-1.5">
        <input
          ref={input}
          value={instruction}
          aria-label="Rewrite instruction"
          placeholder="e.g. make this more tense"
          onChange={(e) => setInstruction(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-[#fcfcfa] px-3 py-1.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
        >
          Rewrite
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 px-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setInstruction(p.instruction);
              input.current?.focus();
            }}
            className={cn(
              'rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600',
              'hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700',
            )}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-gray-400">↵ to rewrite · esc to close</span>
      </div>
    </div>
  );
}
