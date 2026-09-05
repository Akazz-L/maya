import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  initialRewriteState,
  rewriteReducer,
  useSelectionRewrite,
  type RewriteState,
} from './useSelectionRewrite';
import * as streamApi from '../api/stream';

const RANGE = { from: 4, to: 12 };

function at(phase: RewriteState['phase'], extra: Partial<RewriteState> = {}): RewriteState {
  return { ...initialRewriteState, phase, range: RANGE, original: 'Old text', ...extra };
}

describe('rewriteReducer', () => {
  it('open moves idle to prompting with the range and original text', () => {
    const s = rewriteReducer(initialRewriteState, { type: 'open', range: RANGE, original: 'Old text' });
    expect(s).toEqual(at('prompting'));
  });

  it('submit moves prompting to streaming and keeps the instruction', () => {
    const s = rewriteReducer(at('prompting'), { type: 'submit', instruction: 'tighten' });
    expect(s.phase).toBe('streaming');
    expect(s.instruction).toBe('tighten');
    expect(s.replacement).toBe('');
    expect(s.error).toBeNull();
  });

  it('delta appends while streaming and is ignored otherwise', () => {
    const streaming = rewriteReducer(at('streaming'), { type: 'delta', text: 'New ' });
    expect(rewriteReducer(streaming, { type: 'delta', text: 'text' }).replacement).toBe('New text');
    expect(rewriteReducer(at('reviewing'), { type: 'delta', text: 'x' })).toEqual(at('reviewing'));
  });

  it('done moves to reviewing with the edge whitespace matched to the original', () => {
    const s = rewriteReducer(at('streaming', { original: 'Old text\n' }), { type: 'done', text: ' New text ' });
    expect(s.phase).toBe('reviewing');
    expect(s.replacement).toBe('New text\n');
    expect(s.error).toBeNull();
  });

  it('done with an empty reply becomes an error', () => {
    const s = rewriteReducer(at('streaming'), { type: 'done', text: '  \n' });
    expect(s.phase).toBe('reviewing');
    expect(s.error).toMatch(/empty/i);
    expect(s.replacement).toBe('');
  });

  it('error moves streaming to reviewing with the message', () => {
    const s = rewriteReducer(at('streaming', { replacement: 'partial' }), { type: 'error', message: 'boom' });
    expect(s).toEqual(at('reviewing', { error: 'boom', replacement: '' }));
  });

  it('retry returns to prompting and keeps the instruction', () => {
    const s = rewriteReducer(at('reviewing', { instruction: 'tighten', replacement: 'x', error: 'boom' }), {
      type: 'retry',
    });
    expect(s).toEqual(at('prompting', { instruction: 'tighten' }));
  });

  it('cancel resets to idle from any phase', () => {
    for (const phase of ['prompting', 'streaming', 'reviewing'] as const) {
      expect(rewriteReducer(at(phase), { type: 'cancel' })).toEqual(initialRewriteState);
    }
  });
});

describe('useSelectionRewrite', () => {
  it('streams deltas into the replacement and lands in reviewing', async () => {
    vi.spyOn(streamApi, 'streamPost').mockImplementation(async (_url, _body, cb) => {
      cb.onDelta('New ');
      cb.onDelta('text');
      cb.onDone('New text');
    });
    const { result } = renderHook(() => useSelectionRewrite({ projectId: 'p', documentId: 'd' }));

    act(() => result.current.open(RANGE, 'Old text'));
    await act(() => result.current.submit('tighten', { selection: 'Old text', before: '', after: '' }));

    expect(result.current.state.phase).toBe('reviewing');
    expect(result.current.state.replacement).toBe('New text');
    expect(streamApi.streamPost).toHaveBeenCalledWith(
      '/projects/p/documents/d/rewrite/stream',
      { instruction: 'tighten', selection: 'Old text', before: '', after: '' },
      expect.anything(),
      expect.any(AbortSignal),
    );
  });

  it('surfaces a stream failure as an error', async () => {
    vi.spyOn(streamApi, 'streamPost').mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSelectionRewrite({ projectId: 'p', documentId: 'd' }));

    act(() => result.current.open(RANGE, 'Old text'));
    await act(() => result.current.submit('tighten', { selection: 'Old text', before: '', after: '' }));

    expect(result.current.state.phase).toBe('reviewing');
    expect(result.current.state.error).toBe('boom');
  });

  it('cancel aborts the in-flight request and returns to idle', async () => {
    let seenSignal: AbortSignal | undefined;
    vi.spyOn(streamApi, 'streamPost').mockImplementation(
      (_url, _body, _cb, signal) =>
        new Promise<void>((resolve) => {
          seenSignal = signal;
          signal!.addEventListener('abort', () => resolve());
        }),
    );
    const { result } = renderHook(() => useSelectionRewrite({ projectId: 'p', documentId: 'd' }));

    act(() => result.current.open(RANGE, 'Old text'));
    let pending: Promise<void>;
    act(() => {
      pending = result.current.submit('tighten', { selection: 'Old text', before: '', after: '' });
    });
    expect(result.current.state.phase).toBe('streaming');

    act(() => result.current.cancel());
    await act(() => pending!);

    expect(seenSignal?.aborted).toBe(true);
    expect(result.current.state).toEqual(initialRewriteState);
  });

  it('aborts on unmount', () => {
    let seenSignal: AbortSignal | undefined;
    vi.spyOn(streamApi, 'streamPost').mockImplementation(
      (_url, _body, _cb, signal) =>
        new Promise<void>(() => {
          seenSignal = signal;
        }),
    );
    const { result, unmount } = renderHook(() =>
      useSelectionRewrite({ projectId: 'p', documentId: 'd' }),
    );
    act(() => result.current.open(RANGE, 'Old text'));
    act(() => {
      void result.current.submit('tighten', { selection: 'Old text', before: '', after: '' });
    });
    unmount();
    expect(seenSignal?.aborted).toBe(true);
  });
});
