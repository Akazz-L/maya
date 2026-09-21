// The ⌘K card: one instruction, a few presets, one send button. Anchored
// under the selection by the layer that renders it.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { controlClass } from './ui/control';
import { Kbd } from './ui/feedback';
import { pencilPanel } from './ui/floating';

const PRESETS: { label: string; instruction: string }[] = [
  {
    label: 'Tighten',
    instruction: 'Tighten this passage. Cut every word that is not pulling weight.',
  },
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
      className={cn(pencilPanel, 'w-[26rem] max-w-[calc(100vw-2rem)] p-2.5 animate-pop')}
    >
      <div className="mb-2 flex items-center gap-1.5 px-0.5 text-xs font-medium text-pencil-strong">
        <Sparkles aria-hidden className="size-3.5" /> Rewrite selection
      </div>
      <div className="flex items-center gap-1.5">
        <input
          ref={input}
          value={instruction}
          aria-label="Rewrite instruction"
          placeholder="How should it change?"
          onChange={(e) => setInstruction(e.target.value)}
          className={cn(controlClass, 'h-8 min-w-0 flex-1')}
        />
        <Button variant="pencil" disabled={!canSubmit} onClick={submit}>
          Rewrite
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={instruction === p.instruction}
            onClick={() => {
              setInstruction(p.instruction);
              input.current?.focus();
            }}
            className={cn(
              'h-6 rounded-full border border-line px-2.5 text-xs text-ink-muted transition-colors',
              'hover:border-pencil-line hover:bg-pencil-faint hover:text-pencil-strong',
              'aria-pressed:border-pencil-line aria-pressed:bg-pencil-soft aria-pressed:text-pencil-strong',
            )}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto hidden items-center gap-1 text-[11px] text-ink-subtle sm:flex">
          <Kbd>↵</Kbd> rewrite <Kbd className="ml-1">esc</Kbd> close
        </span>
      </div>
    </div>
  );
}
