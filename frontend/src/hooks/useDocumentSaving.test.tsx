import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDocumentSaving } from './useDocumentSaving';
import { updateDocument } from '../api/endpoints';
import type { DocumentDetail } from '../api/types';

vi.mock('../api/endpoints', () => ({ updateDocument: vi.fn() }));

const saved: DocumentDetail = {
  id: 'd1',
  title: 'Chapter',
  kind: 'chapter',
  position: 0,
  updated_at: '2026-01-01T00:00:00Z',
  body: 'text',
  brief: '',
  plan: null,
  summary: null,
  summary_status: 'empty',
  digest: null,
};
const offline = () => Promise.reject(new Error('offline'));

function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useDocumentSaving('p1', 'd1', '', '', ''), { wrapper });
}

beforeEach(() => vi.mocked(updateDocument).mockReset());
afterEach(() => vi.restoreAllMocks());

describe('useDocumentSaving.settle', () => {
  it('resolves once the pending save has landed', async () => {
    vi.mocked(updateDocument).mockResolvedValue(saved);
    const { result } = render();

    await result.current.save({ body: 'new text' });
    await expect(result.current.settle()).resolves.toBeUndefined();
  });

  /**
   * The whole point of settle: a request that reads the document server-side
   * must not proceed on text the server never received.
   */
  it('rejects when a save failed, rather than letting the caller read stale text', async () => {
    vi.mocked(updateDocument).mockImplementationOnce(offline);
    const { result } = render();

    // A save reports failure by resolving false; it never rejects, because most
    // callers fire and forget.
    await expect(result.current.save({ body: 'new text' })).resolves.toBe(false);
    await expect(result.current.settle()).rejects.toThrow(/could not be saved/i);
    expect(vi.mocked(updateDocument).mock.calls.length).toBe(1);
  });

  it('recovers once a later save succeeds', async () => {
    vi.mocked(updateDocument).mockImplementationOnce(offline);
    const { result } = render();

    await result.current.save({ body: 'first' });
    await expect(result.current.settle()).rejects.toThrow(/could not be saved/i);

    vi.mocked(updateDocument).mockResolvedValue(saved);
    await expect(result.current.save({ body: 'second' })).resolves.toBe(true);
    await expect(result.current.settle()).resolves.toBeUndefined();
  });
});
