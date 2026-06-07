// SSE reader over a POST request. EventSource can't POST, so we read the
// response body stream directly and parse `data: {...}\n\n` frames.
// Ported from the old index.html `streamPost()`.

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onDone: (draft: string) => void;
}

interface DeltaFrame {
  type: 'delta';
  text: string;
}
interface DoneFrame {
  type: 'done';
  draft: string;
}
interface ErrorFrame {
  type: 'error';
  detail: string;
}
type Frame = DeltaFrame | DoneFrame | ErrorFrame;

export async function streamPost(
  url: string,
  body: unknown,
  { onDelta, onDone }: StreamCallbacks,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
  });
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

  for (;;) {
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
      else if (evt.type === 'done') onDone(evt.draft);
      else if (evt.type === 'error') throw new Error(evt.detail);
    }
  }
}
