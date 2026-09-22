// The ⌘K card: one instruction, a few presets, one send button. Anchored
// under the selection by the layer that renders it.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Sparkles } from 'lucide-react';

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
      className="w-[26rem] max-w-[calc(100vw-2rem)] animate-rise rounded-2xl border border-ai-line bg-raised p-2 shadow-pop"
    >
      <div className="flex items-center gap-2 rounded-xl bg-surface py-1 pr-1 pl-3 focus-within:shadow-[0_0_0_3px_var(--ai-soft)]">
        <Sparkles aria-hidden className="size-4 shrink-0 text-ai" />
        <input
          ref={input}
          value={instruction}
          aria-label="Rewrite instruction"
          placeholder="How should this passage change?"
          onChange={(e) => setInstruction(e.target.value)}
          className="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="h-8 rounded-lg bg-ai px-3 text-[13px] font-medium text-on-ai transition-colors hover:bg-ai-hover disabled:opacity-40"
        >
          Rewrite
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 px-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setInstruction(p.instruction);
              input.current?.focus();
            }}
            className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2 transition-colors hover:border-ai-line hover:bg-ai-soft hover:text-ai-ink"
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-ink-3 max-sm:hidden">↵ rewrite · esc close</span>
      </div>
    </div>
  );
}
