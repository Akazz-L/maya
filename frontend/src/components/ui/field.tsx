import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

interface FieldProps {
  label: ReactNode;
  /** Help text under the control, announced with it. */
  description?: ReactNode;
  error?: string | null;
  className?: string;
  /** Receives the ids that tie the control to its label, help, and error. */
  children: (control: FieldControlProps) => ReactNode;
}

/** A labelled form control: a real <label>, with help and error text wired to it. */
export function Field({ label, description, error, className, children }: FieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-ink-muted">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {description && (
        <p id={descriptionId} className="text-xs text-ink-subtle">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
