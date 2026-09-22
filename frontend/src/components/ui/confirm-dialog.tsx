import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** `danger` for anything that cannot be undone. */
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal question with one answer that acts and one that backs out.
 *
 * Built on the native <dialog>: the browser owns the focus trap, the inert
 * page behind it, and Escape. Cancel takes focus first, so a stray Enter never
 * confirms something destructive.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el || !open) return;
    // jsdom has no showModal; the open attribute is enough for it to render.
    if (typeof el.showModal === 'function') el.showModal();
    else el.setAttribute('open', '');
    cancel.current?.focus();
    return () => {
      if (typeof el.close === 'function') el.close();
      else el.removeAttribute('open');
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        // A press on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) onCancel();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] animate-rise rounded-2xl border border-line bg-raised p-0 text-ink shadow-pop"
    >
      <div className="flex flex-col gap-2 px-6 pt-5 pb-4">
        <h2 className="font-serif text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm leading-relaxed text-ink-2">{description}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line-soft bg-surface px-6 py-3">
        <Button ref={cancel} variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={tone} size="sm" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
