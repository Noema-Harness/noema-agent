import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FreeLLMAPIClient,
  FreeLLMAPIError,
  normalizeBaseUrl,
} from '../src/freellmapi-client.mjs';

test('lists only the explicitly verified free routes from available models', async () => {
  const client = new FreeLLMAPIClient({
    baseUrl: 'http://127.0.0.1:31415',
    getApiKey: () => 'test-key',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:31415/v1/models?available=true');
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.authorization, 'Bearer test-key');
      return Response.json({
        data: [
          { id: 'auto:noema-free', available: true },
          { id: 'free-router', available: true },
          { id: 'nemotron-3-super-120b', available: true },
          { id: 'nvidia/nemotron-3.5-lightning', available: true },
          { id: 'cohere/north-mini-code', available: true },
          { id: 'nvidia/llama-3.2-11b-vision', available: true },
          { id: 'gemini-2.5-flash', available: true },
          { id: 'nvidia/nemotron-3-super-120b-a12b:free', available: false },
        ],
      });
    },
  });

  assert.deepEqual(await client.listModels(), [
    {
      name: 'auto:noema-free',
      label: 'Noema 免费模型链',
    },
    { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    {
      name: 'nvidia/nemotron-3-super-120b-a12b:free',
      label: 'Nemotron 3 Super 120B · 免费',
    },
    {
      name: 'nvidia/nemotron-3.5-lightning',
      label: 'Nemotron 3.5 Lightning · 免费',
    },
    {
      name: 'cohere/north-mini-code',
      label: 'Cohere North Mini Code · 免费',
    },
    {
      name: 'nvidia/llama-3.2-11b-vision',
      label: 'NVIDIA Llama 3.2 11B · 免费',
    },
  ]);
});

test('keeps optional free routes hidden while FreeLLMAPI marks them unavailable', async () => {
  const client = new FreeLLMAPIClient({
    baseUrl: 'http://127.0.0.1:31415',
    getApiKey: () => 'test-key',
    fetchImpl: async () =>
      Response.json({
        data: [
          { id: 'nvidia/nemotron-3.5-lightning', available: false },
          { id: 'cohere/north-mini-code', available: false },
          { id: 'nvidia/llama-3.2-11b-vision', available: false },
        ],
      }),
  });

  assert.deepEqual(await client.listModels(), []);
});

test('assembles streamed FreeLLMAPI tool-call deltas without exposing arguments as chat text', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"delegate_task","arguments":"{\\"task\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Read this project\\"}"}}]}}]}\n\n',
    'data: [DONE]\n',
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  let requestBody;
  let receivedCalls;
  let receivedRoute;
  const client = new FreeLLMAPIClient({
    getApiKey: () => 'test-key',
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(stream, {
        status: 200,
        headers: { 'X-Routed-Via': 'blockrun/model%2Fname' },
      });
    },
  });
  const text = [];
  for await (const delta of client.streamChat({
    model: 'auto:noema-free',
    messages: [{ role: 'user', content: 'Read this project' }],
    signal: new AbortController().signal,
    tools: [{ type: 'function', function: { name: 'delegate_task' } }],
    onToolCalls: (calls) => {
      receivedCalls = calls;
    },
    onRouteMetadata: (route) => {
      receivedRoute = route;
    },
  }))
    text.push(delta);

  assert.equal(requestBody.model, 'auto:noema-free');
  assert.equal(requestBody.tool_choice, 'auto');
  assert.deepEqual(text, []);
  assert.deepEqual(receivedCalls, [
    {
      id: 'call_1',
      type: 'function',
      function: {
        name: 'delegate_task',
        arguments: '{"task":"Read this project"}',
      },
    },
  ]);
  assert.equal(receivedRoute, 'blockrun/model/name');
});

test('streams OpenAI-compatible SSE across arbitrary network chunk boundaries', async () => {
  const encoder = new TextEncoder();
  const payload =
    'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"，Noema。"}}]}\n\ndata: [DONE]\n';
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload.slice(0, 31)));
      controller.enqueue(encoder.encode(payload.slice(31, 83)));
      controller.enqueue(encoder.encode(payload.slice(83)));
      controller.close();
    },
  });
  const client = new FreeLLMAPIClient({
    baseUrl: 'http://localhost:31415/v1',
    getApiKey: () => 'test-key',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'http://localhost:31415/v1/chat/completions');
      assert.equal(init.headers.authorization, 'Bearer test-key');
      const request = JSON.parse(init.body);
      assert.equal(request.model, 'free-router');
      assert.equal(request.stream, true);
      assert.equal(request.max_tokens, 4096);
      return new Response(stream, { status: 200 });
    },
  });
  const deltas = [];
  let routedVia = 'unexpected';
  for await (const delta of client.streamChat({
    model: 'free-router',
    messages: [{ role: 'user', content: '你好' }],
    signal: new AbortController().signal,
    onRouteMetadata: (route) => {
      routedVia = route;
    },
  })) {
    deltas.push(delta);
  }
  assert.deepEqual(deltas, ['你好', '，Noema。']);
  assert.equal(routedVia, null);
});

test('rejects non-local endpoints before attaching the API key', async () => {
  assert.throws(
    () => normalizeBaseUrl('https://models.example.test/v1'),
    (error) =>
      error instanceof FreeLLMAPIError && error.code === 'non_local_base_url',
  );
  assert.equal(
    normalizeBaseUrl('http://127.0.0.1:31415'),
    'http://127.0.0.1:31415/v1',
  );
});

test('reports unavailable gateway without exposing provider response bodies', async () => {
  const client = new FreeLLMAPIClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () => {
      throw new TypeError('socket closed');
    },
  });
  await assert.rejects(
    client.listModels(),
    (error) =>
      error.code === 'gateway_unavailable' && !/test-key/.test(error.message),
  );
});

test('requires credentials before making a request', async () => {
  const client = new FreeLLMAPIClient({ getApiKey: () => null });
  await assert.rejects(
    client.listModels(),
    (error) => error.code === 'credentials_missing',
  );
});

test('maps provider exhaustion into an actionable but non-leaking message', async () => {
  const client = new FreeLLMAPIClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ error: { message: 'private provider diagnostics' } }),
        { status: 502 },
      ),
  });
  await assert.rejects(
    async () => {
      for await (const _delta of client.streamChat({
        model: 'free-router',
        messages: [{ role: 'user', content: 'x' }],
        signal: new AbortController().signal,
      })) {
        /* no stream expected */
      }
    },
    (error) =>
      error.code === 'provider_unavailable' &&
      !/private provider diagnostics/.test(error.message),
  );
});
