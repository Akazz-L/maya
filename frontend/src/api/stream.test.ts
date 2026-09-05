import { describe, expect, it, vi } from 'vitest';
import { streamPost } from './stream';

/** Build a Response whose body streams the given chunks as a ReadableStream. */
function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe('streamPost', () => {
  it('parses delta frames then a done frame, even across split chunks', async () => {
    // The "done" frame is split across two network chunks to exercise buffering.
    // It carries the document's full new body, not just the generated draft.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamingResponse([
        'data: {"type":"delta","text":"Hello "}\n\n',
        'data: {"type":"delta","text":"world"}\n\n',
        'data: {"type":"done","bo',
        'dy":"Existing.\\n\\nHello world"}\n\n',
      ]),
    );

    const deltas: string[] = [];
    let done = '';
    await streamPost('/x', {}, { onDelta: (t) => deltas.push(t), onDone: (b) => (done = b) });

    expect(deltas).toEqual(['Hello ', 'world']);
    expect(done).toBe('Existing.\n\nHello world');
  });

  it('throws on an error frame', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamingResponse(['data: {"type":"error","detail":"boom"}\n\n']),
    );
    await expect(
      streamPost('/x', {}, { onDelta: () => {}, onDone: () => {} }),
    ).rejects.toThrow('boom');
  });

  it('throws the detail message on a non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'bad request' }), { status: 400 }),
    );
    await expect(
      streamPost('/x', {}, { onDelta: () => {}, onDone: () => {} }),
    ).rejects.toThrow('bad request');
  });

  it('resolves silently when the request is aborted before it starts', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
    );
    await expect(
      streamPost('/x', {}, { onDelta: () => {}, onDone: () => {} }, controller.signal),
    ).resolves.toBeUndefined();
  });

  it('stops reading and resolves when aborted mid-stream', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    // A body that delivers one delta, then stays open forever.
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode('data: {"type":"delta","text":"one"}\n\n'));
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    const deltas: string[] = [];
    const run = streamPost(
      '/x',
      {},
      {
        onDelta: (t) => {
          deltas.push(t);
          controller.abort();
        },
        onDone: () => {},
      },
      controller.signal,
    );
    await expect(run).resolves.toBeUndefined();
    expect(deltas).toEqual(['one']);
  });
});
