import { useCallback, useState } from 'react';

// Storage can throw (private windows, blocked site data); a preference that
// cannot be remembered still works for the session.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Remembered for this session only.
  }
}

/** A boolean UI preference remembered per browser, such as whether a pane is open. */
export function usePersistentFlag(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => {
    const stored = read(key);
    return stored === null ? fallback : stored === '1';
  });
  const set = useCallback(
    (next: boolean) => {
      writeFlag(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, set] as const;
}
