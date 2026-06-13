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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamingResponse([
        'data: {"type":"delta","text":"Hello "}\n\n',
        'data: {"type":"delta","text":"world"}\n\n',
        'data: {"type":"done","dra',
        'ft":"Hello world"}\n\n',
      ]),
    );

    const deltas: string[] = [];
    let done = '';
    await streamPost('/x', {}, { onDelta: (t) => deltas.push(t), onDone: (d) => (done = d) });

    expect(deltas).toEqual(['Hello ', 'world']);
    expect(done).toBe('Hello world');
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
});
