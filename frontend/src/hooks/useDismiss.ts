import { useEffect, useRef, type RefObject } from 'react';

/**
 * Close a popover on a press outside `root` or on Escape. Listeners are bound
 * only while it is open, so a closed menu costs nothing. Escape is stopped
 * here so it does not also discard a review the popover sits above.
 */
export function useDismiss(root: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void) {
  const latest = useRef(onDismiss);
  useEffect(() => {
    latest.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent | MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) latest.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      latest.current();
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, root]);
}
