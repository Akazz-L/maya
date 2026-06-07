// Drives the SSE draft/revise endpoints, exposing streaming/error state to the
// UI. The caller supplies onDelta/onDone to route tokens into the editor.

import { useCallback, useState } from 'react';
import { streamPost, type StreamCallbacks } from '../api/stream';

export function useDraftStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (url: string, body: unknown, callbacks: StreamCallbacks) => {
      setIsStreaming(true);
      setError(null);
      try {
        await streamPost(url, body, callbacks);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setIsStreaming(false);
      }
    },
    [],
  );

  return { run, isStreaming, error };
}
