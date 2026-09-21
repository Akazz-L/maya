import { useEffect, type RefObject } from 'react';

/**
 * Close a floating element on a press outside it or on Escape. Listeners are
 * bound only while it is open, so a closed one costs nothing. Escape stops
 * there: a menu closing must not also discard a proposal under review.
 */
export function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onDismiss: (reason: 'outside' | 'escape') => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onDismiss('outside');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onDismiss('escape');
    };
    window.addEventListener('pointerdown', onPointerDown);
    // Capture, so this runs before window listeners that act on Escape.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, ref, onDismiss]);
}
