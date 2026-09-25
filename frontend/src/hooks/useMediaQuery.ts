import { useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches. `fallback` answers where matchMedia is
 * unavailable, which in practice means a desktop-first test environment.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
  );
}

// Match Tailwind's md and lg breakpoints, which the layout classes use.
/** Wide enough for the document list to sit beside the page. */
export const SIDEBAR_DOCKS = '(min-width: 768px)';
/** Wide enough for the chat to sit beside the page rather than over it. */
export const CHAT_DOCKS = '(min-width: 1024px)';
