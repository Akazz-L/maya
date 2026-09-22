import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStoredFlag } from './useStoredFlag';

afterEach(() => localStorage.clear());

describe('useStoredFlag', () => {
  it('starts from the fallback when nothing is stored', () => {
    const { result } = renderHook(() => useStoredFlag('t.flag', true));
    expect(result.current[0]).toBe(true);
  });

  it('reads a stored value over the fallback', () => {
    localStorage.setItem('t.flag', '0');
    const { result } = renderHook(() => useStoredFlag('t.flag', true));
    expect(result.current[0]).toBe(false);
  });

  it("stores '1' and '0', and accepts an updater", () => {
    const { result } = renderHook(() => useStoredFlag('t.flag', false));
    act(() => result.current[1](true));
    expect(localStorage.getItem('t.flag')).toBe('1');
    act(() => result.current[1]((v) => !v));
    expect(localStorage.getItem('t.flag')).toBe('0');
    expect(result.current[0]).toBe(false);
  });

  it('keeps every reader of one key in step', () => {
    const a = renderHook(() => useStoredFlag('t.flag', false));
    const b = renderHook(() => useStoredFlag('t.flag', false));
    act(() => a.result.current[1](true));
    expect(b.result.current[0]).toBe(true);
  });

  it('follows a change made in another tab', () => {
    const { result } = renderHook(() => useStoredFlag('t.flag', false));
    act(() => {
      localStorage.setItem('t.flag', '1');
      window.dispatchEvent(new StorageEvent('storage', { key: 't.flag' }));
    });
    expect(result.current[0]).toBe(true);
  });
});
