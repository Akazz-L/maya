import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './button';

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** A destructive action gets a red button, and focus starts on Cancel. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before an action that cannot be taken back. Mount it to open it.
 *
 * A native modal <dialog>: the browser traps focus, makes the page behind it
 * inert, and closes it on Escape, so none of that is reimplemented here.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    el.showModal();
    return () => el.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      // Escape: the browser closes the dialog; tell the owner so it unmounts it.
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      // A press on the backdrop lands on the dialog element itself.
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-panel border border-line bg-surface p-0 text-ink shadow-overlay animate-pop"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <div id={descriptionId} className="mt-1.5 text-sm text-ink-muted">
          {description}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line bg-surface-muted px-5 py-3">
        <Button variant="secondary" autoFocus={destructive} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          autoFocus={!destructive}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
