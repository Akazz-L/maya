// SSE reader over a POST request. EventSource can't POST, so we read the
// response body stream directly and parse `data: {...}\n\n` frames.
// Ported from the old index.html `streamPost()`.

import { authHeaders, handleUnauthorized } from '../auth/token';
import type { ChatMessage, UsageSnapshot } from './types';

/** The prose of a chat proposal as the model writes it. */
export interface ProposalProgress {
  /** Null until the model has written the mode. */
  mode: 'replace' | 'append' | null;
  text: string;
}

export interface DoneFrame {
  type: 'done';
  /** The document's new body for revise, the replacement span for rewrite. */
  body?: string;
  /** The writer's spend including this call. */
  usage?: UsageSnapshot;
  /** Chat only: the writer's message and the reply, as stored. */
  messages?: ChatMessage[];
}

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  /**
   * The stream finished. `body` is the completed text of the stream (empty for
   * chat); `usage` is the writer's spend including this call — token counts are
   * only known once the stream ends, so this is the first moment the meter can
   * move. `frame` is the whole frame, for routes that send more.
   */
  onDone: (body: string, usage?: UsageSnapshot, frame?: DoneFrame) => void;
  /** Chat only. */
  onProposalProgress?: (progress: ProposalProgress) => void;
}

interface DeltaFrame {
  type: 'delta';
  text: string;
}
interface ProposalProgressFrame extends ProposalProgress {
  type: 'proposal_progress';
}
interface ErrorFrame {
  type: 'error';
  detail: string;
}
type Frame = DeltaFrame | ProposalProgressFrame | DoneFrame | ErrorFrame;

export async function streamPost(
  url: string,
  body: unknown,
  { onDelta, onDone, onProposalProgress }: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: body ? JSON.stringify(body) : null,
      signal,
    });
  } catch (e) {
    if (signal?.aborted) return; // the caller gave up; not an error
    throw e;
  }
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail || res.statusText);
  }
  if (!res.body) {
    throw new Error('Streaming not supported by this response');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, sep).replace(/^data: /, '');
        buf = buf.slice(sep + 2);
        if (!raw) continue;
        const evt = JSON.parse(raw) as Frame;
        if (evt.type === 'delta') onDelta(evt.text);
        else if (evt.type === 'proposal_progress')
          onProposalProgress?.({ mode: evt.mode, text: evt.text });
        else if (evt.type === 'done') onDone(evt.body ?? '', evt.usage, evt);
        else if (evt.type === 'error') throw new Error(evt.detail);
        if (signal?.aborted) {
          await reader.cancel();
          return;
        }
      }
    }
  } catch (e) {
    if (signal?.aborted) return;
    throw e;
  }
}
