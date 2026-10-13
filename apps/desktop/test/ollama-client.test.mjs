import assert from 'node:assert/strict';
import test from 'node:test';
import { OllamaClient, OllamaError } from '../src/ollama-client.mjs';

test('lists only named models returned by the local Ollama tags endpoint', async () => {
  const client = new OllamaClient({
    fetchImpl: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:11434/api/tags');
      assert.equal(init.method, 'GET');
      return new Response(
        JSON.stringify({
          models: [
            {
              name: 'qwen3.5:4b-q4_K_M',
              size: 1234,
              modified_at: '2026-10-08T00:00:00Z',
            },
            { name: '' },
            null,
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  assert.deepEqual(await client.listModels(), [
    {
      name: 'qwen3.5:4b-q4_K_M',
      size: 1234,
      modifiedAt: '2026-10-08T00:00:00Z',
    },
  ]);
});

test('parses NDJSON across arbitrary network chunk boundaries', async () => {
  const encoder = new TextEncoder();
  const payload =
    '{"message":{"content":"你好"},"done":false}\n{"message":{"content":"，Noema。"},"done":false}\n{"done":true}\n';
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload.slice(0, 17)));
      controller.enqueue(encoder.encode(payload.slice(17, 41)));
      controller.enqueue(encoder.encode(payload.slice(41)));
      controller.close();
    },
  });
  const client = new OllamaClient({
    fetchImpl: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:11434/api/chat');
      const request = JSON.parse(init.body);
      assert.equal(request.stream, true);
      assert.equal(request.options.num_ctx, 16_384);
      return new Response(stream, { status: 200 });
    },
  });
  const deltas = [];
  for await (const delta of client.streamChat({
    model: 'qwen3.5:4b-q4_K_M',
    messages: [{ role: 'user', content: '你好' }],
    signal: new AbortController().signal,
  }))
    deltas.push(delta);
  assert.deepEqual(deltas, ['你好', '，Noema。']);
});

test('surfaces missing local models as a recoverable error', async () => {
  const client = new OllamaClient({
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'model qwen3:missing not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
  });
  await assert.rejects(
    async () => {
      for await (const _delta of client.streamChat({
        model: 'qwen3:missing',
        messages: [{ role: 'user', content: 'x' }],
        signal: new AbortController().signal,
      })) {
        /* no deltas expected */
      }
    },
    (error) => error instanceof OllamaError && error.code === 'model_missing',
  );
});

test('does not disguise a refused localhost connection as a remote fallback', async () => {
  const client = new OllamaClient({
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(
    client.listModels(),
    (error) => error.code === 'ollama_unavailable',
  );
});
