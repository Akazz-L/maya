import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { FieldLabel } from './ui/card';

interface GeneratePlanButtonProps {
  disabled: boolean;
  /** The chapter notes as saved: what the planner will read. */
  brief: string;
  /** Saves any edit still pending, so the pop-up shows the notes the planner reads. */
  beforeOpen: () => Promise<unknown>;
  onGenerate: () => void;
  onEditNotes: () => void;
}

/**
 * Generate Plan behind a small confirmation pop-up that shows what the plan
 * will be built from, so a writer is never surprised by a plan drawn from
 * notes they forgot, or from none at all.
 */
export function GeneratePlanButton({
  disabled,
  brief,
  beforeOpen,
  onGenerate,
  onEditNotes,
}: GeneratePlanButtonProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const notes = brief.trim();

  // Dismiss on an outside press or Escape. Listeners are bound only while open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    if (open) setOpen(false);
    else void beforeOpen().finally(() => setOpen(true));
  };

  return (
    <div ref={root} className="relative">
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        Generate Plan
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Generate a scene plan"
          className="absolute left-0 top-full z-20 mt-1.5 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-3 shadow-lg shadow-gray-900/10"
        >
          <p className="text-sm font-semibold text-gray-800">Generate a scene plan</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Built from your chapter notes, the story bible, and the chapters before this one.
          </p>
          {notes ? (
            <div className="mt-2.5">
              <FieldLabel>Chapter notes</FieldLabel>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-gray-100 bg-[#fcfcfa] px-2.5 py-2 text-sm text-gray-700">
                {notes}
              </p>
            </div>
          ) : (
            <p className="mt-2.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
              No chapter notes yet, so the AI will propose what happens next from the story so far.
            </p>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setOpen(false);
                onEditNotes();
              }}
            >
              {notes ? 'Edit notes' : 'Add notes'}
            </Button>
            <Button
              size="sm"
              autoFocus
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onGenerate();
              }}
            >
              Generate
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
