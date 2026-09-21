import { useLayoutEffect, type RefObject } from 'react';

const FOCUSABLE =
  'textarea:not([disabled]), input:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * For a panel that opens over the page: move focus into it when it opens, and
 * hand it back to whatever had it when it closes.
 */
export function useFocusReturn(open: boolean, container: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    container.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => previous?.focus?.();
  }, [open, container]);
}
