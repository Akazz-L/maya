import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// This jsdom build doesn't expose localStorage, so provide a minimal in-memory
// polyfill for tests that exercise the token store.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const localStorageMock: Storage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
  });
}

// jsdom has no layout engine, so Range is missing getClientRects. CodeMirror
// calls it to map a document position to screen coordinates; an empty list is
// the "no layout yet" answer it already understands (coordsAtPos returns null),
// where a missing method is a TypeError.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  const empty = Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects = () => empty;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
