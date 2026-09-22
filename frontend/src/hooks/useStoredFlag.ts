import { useCallback, useSyncExternalStore } from 'react';

// Components reading the same key re-render together: the Write and Plan views
// each show a chapter-context disclosure, and opening one opens both.
const listeners = new Map<string, Set<() => void>>();

function read(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback; // storage blocked (private mode, sandboxed frame)
  }
}

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

/**
 * A boolean preference remembered in this browser, stored as '1' / '0'.
 * It follows how the writer works, not what they are working on.
 */
export function useStoredFlag(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(listener);
      // Another tab changing the same preference.
      const onStorage = (e: StorageEvent) => {
        if (e.key === key || e.key === null) listener();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        set.delete(listener);
        window.removeEventListener('storage', onStorage);
      };
    },
    [key],
  );

  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );

  const setValue = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const resolved = typeof next === 'function' ? next(read(key, fallback)) : next;
      try {
        localStorage.setItem(key, resolved ? '1' : '0');
      } catch {
        // Not remembered, but the change still applies to this page.
      }
      notify(key);
    },
    [key, fallback],
  );

  return [value, setValue];
}
