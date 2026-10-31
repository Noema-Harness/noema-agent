import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenAICompatibleClient,
  DEFAULT_MODEL_BASE_URL,
  ModelProviderError,
  normalizeBaseUrl,
  resolveConfiguredModelBaseUrl,
} from '../../../src/main/providers/openai-compatible-client.mjs';

test('a new model client defaults to the direct HTTPS provider endpoint', () => {
  const client = new OpenAICompatibleClient({ getApiKey: () => null });
  assert.equal(DEFAULT_MODEL_BASE_URL, 'https://api.deepseek.com/v1');
  assert.equal(client.baseUrl, DEFAULT_MODEL_BASE_URL);
});

test('provider endpoint selection keeps current and legacy credentials paired', () => {
  assert.equal(
    resolveConfiguredModelBaseUrl({
      hasCurrentProviderCredential: true,
      currentProviderBaseUrl: 'https://api.openai.com/v1',
      legacyFreeLlmApiBaseUrl: 'http://127.0.0.1:31415/v1',
    }),
    'https://api.openai.com/v1',
  );
  assert.equal(
    resolveConfiguredModelBaseUrl({
      hasCurrentProviderCredential: true,
      legacyFreeLlmApiBaseUrl: 'http://127.0.0.1:31415/v1',
    }),
    DEFAULT_MODEL_BASE_URL,
  );
  assert.equal(
    resolveConfiguredModelBaseUrl({
      hasCurrentProviderCredential: false,
      legacyFreeLlmApiBaseUrl: 'http://127.0.0.1:31415/v1',
    }),
    'http://127.0.0.1:31415/v1',
  );
  assert.equal(
    resolveConfiguredModelBaseUrl({ hasCurrentProviderCredential: false }),
    DEFAULT_MODEL_BASE_URL,
  );
});

test('lists only the explicitly verified free routes from available models', async () => {
  const client = new OpenAICompatibleClient({
    baseUrl: 'http://127.0.0.1:31415',
    getApiKey: () => 'test-key',
    legacyFreeRouteMode: true,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:31415/v1/models');
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.authorization, 'Bearer test-key');
      return Response.json({
        data: [
          { id: 'auto:noema-free', available: true },
          { id: 'free-router', available: true },
          {
            id: 'kilo-auto/free',
            available: true,
            execution_status: 'ready',
          },
          {
            id: 'nemotron-3-super-120b',
            available: true,
            execution_status: 'ready',
          },
          {
            id: 'nvidia/nemotron-3.5-lightning',
            available: true,
            execution_status: 'exhausted',
          },
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
      label: 'Noema 免费模型链 · 自动路由',
      routeKind: 'router',
      executionStatus: null,
    },
    {
      name: 'free-router',
      label: '旧版自动路由（兼容）',
      routeKind: 'router',
      executionStatus: null,
    },
    {
      name: 'kilo-auto/free',
      label: 'Kilo 免费自动路由',
      routeKind: 'router',
      executionStatus: 'ready',
    },
    {
      name: 'nvidia/nemotron-3-super-120b-a12b:free',
      label: 'Nemotron 3 Super 120B · 免费',
      routeKind: 'direct',
      executionStatus: 'ready',
    },
    {
      name: 'nvidia/nemotron-3.5-lightning',
      label: 'Nemotron 3.5 Lightning · 免费',
      routeKind: 'direct',
      executionStatus: 'exhausted',
    },
    {
      name: 'cohere/north-mini-code',
      label: 'Cohere North Mini Code · 免费',
      routeKind: 'direct',
      executionStatus: null,
    },
    {
      name: 'nvidia/llama-3.2-11b-vision',
      label: 'NVIDIA Llama 3.2 11B · 免费',
      routeKind: 'direct',
      executionStatus: null,
    },
  ]);
});

test('keeps optional free routes hidden while FreeLLMAPI marks them unavailable', async () => {
  const client = new OpenAICompatibleClient({
    baseUrl: 'http://127.0.0.1:31415',
    getApiKey: () => 'test-key',
    legacyFreeRouteMode: true,
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

test('buffers automatic router replies so FreeLLMAPI can fail over before delivery', async () => {
  let requestBody;
  let receivedRoute;
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    legacyFreeRouteMode: true,
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return Response.json(
        {
          choices: [
            {
              message: { role: 'assistant', content: '完整回复' },
              finish_reason: 'stop',
            },
          ],
        },
        { headers: { 'X-Routed-Via': 'ovh/model' } },
      );
    },
  });
  const deltas = [];
  for await (const delta of client.streamChat({
    model: 'auto:noema-free',
    messages: [{ role: 'user', content: '请回答' }],
    signal: new AbortController().signal,
    onRouteMetadata: (route) => {
      receivedRoute = route;
    },
  })) {
    deltas.push(delta);
  }

  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.max_tokens, 1024);
  assert.deepEqual(deltas, ['完整回复']);
  assert.equal(receivedRoute, 'ovh/model');
});

test('preserves tool calls for buffered automatic router replies', async () => {
  let receivedCalls;
  let requestBody;
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    legacyFreeRouteMode: true,
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return Response.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'delegate_task',
                    arguments: '{"task":"Inspect the project"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
    },
  });
  const deltas = [];
  for await (const delta of client.streamChat({
    model: 'kilo-auto/free',
    messages: [{ role: 'user', content: 'Inspect the project' }],
    signal: new AbortController().signal,
    tools: [{ type: 'function', function: { name: 'delegate_task' } }],
    toolChoice: {
      type: 'function',
      function: { name: 'delegate_task' },
    },
    onToolCalls: (calls) => {
      receivedCalls = calls;
    },
  })) {
    deltas.push(delta);
  }

  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.model, 'kilo-auto/free');
  assert.deepEqual(requestBody.tool_choice, {
    type: 'function',
    function: { name: 'delegate_task' },
  });
  assert.deepEqual(deltas, []);
  assert.deepEqual(receivedCalls, [
    {
      id: 'call_1',
      type: 'function',
      function: {
        name: 'delegate_task',
        arguments: '{"task":"Inspect the project"}',
      },
    },
  ]);
});

test('repairs one malformed buffered tool call before exposing it to tools', async () => {
  const requests = [];
  let receivedCalls;
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    legacyFreeRouteMode: true,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const message =
        requests.length === 1
          ? {
              role: 'assistant',
              content: '我来组建团队。',
              tool_calls: [
                {
                  id: 'call_bad',
                  type: 'function',
                  function: {
                    name: 'create_project_team',
                    arguments: '{"brief":',
                  },
                },
              ],
            }
          : {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_fixed',
                  type: 'function',
                  function: {
                    name: 'create_project_team',
                    arguments: '{"brief":"验证团队组建","members":[]}',
                  },
                },
              ],
            };
      return Response.json({
        choices: [{ message, finish_reason: 'tool_calls' }],
      });
    },
  });
  const deltas = [];
  for await (const delta of client.streamChat({
    model: 'auto:noema-free',
    messages: [{ role: 'user', content: '组建项目团队' }],
    signal: new AbortController().signal,
    tools: [{ type: 'function', function: { name: 'create_project_team' } }],
    onToolCalls: (calls) => {
      receivedCalls = calls;
    },
  }))
    deltas.push(delta);

  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.at(-2).role, 'assistant');
  assert.equal(
    requests[1].messages.at(-2).tool_calls[0].function.arguments,
    '{"brief":',
  );
  assert.equal(requests[1].messages.at(-1).role, 'tool');
  assert.match(requests[1].messages.at(-1).content, /这批调用均未执行/);
  assert.deepEqual(deltas, ['我来组建团队。']);
  assert.equal(receivedCalls[0].id, 'call_fixed');
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
  const client = new OpenAICompatibleClient({
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
    model: 'nvidia/nemotron-3.5-lightning',
    messages: [{ role: 'user', content: 'Read this project' }],
    signal: new AbortController().signal,
    tools: [{ type: 'function', function: { name: 'delegate_task' } }],
    toolChoice: {
      type: 'function',
      function: { name: 'delegate_task' },
    },
    onToolCalls: (calls) => {
      receivedCalls = calls;
    },
    onRouteMetadata: (route) => {
      receivedRoute = route;
    },
  }))
    text.push(delta);

  assert.equal(requestBody.model, 'nvidia/nemotron-3.5-lightning');
  assert.equal(requestBody.stream, true);
  assert.deepEqual(requestBody.tool_choice, {
    type: 'function',
    function: { name: 'delegate_task' },
  });
  assert.equal(requestBody.max_tokens, 1024);
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

test('repairs one malformed streamed tool call and releases the first stream before retrying', async () => {
  const encoder = new TextEncoder();
  const requests = [];
  let receivedCalls;
  const makeStream = (events) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const event of events)
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          controller.enqueue(encoder.encode('data: [DONE]\n'));
          controller.close();
        },
      }),
    );
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      if (requests.length === 1) {
        return makeStream([
          { choices: [{ delta: { content: '我先建立项目。' } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_bad',
                      type: 'function',
                      function: {
                        name: 'create_project_team',
                        arguments: '{"brief":',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ]);
      }
      return makeStream([
        {
          choices: [
            {
              delta: {
                content: '项目组已建立。',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_fixed',
                    type: 'function',
                    function: {
                      name: 'create_project_team',
                      arguments: '{"brief":"验证团队组建","members":[]}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ]);
    },
  });
  const deltas = [];
  for await (const delta of client.streamChat({
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: '组建项目团队' }],
    signal: new AbortController().signal,
    tools: [{ type: 'function', function: { name: 'create_project_team' } }],
    onToolCalls: (calls) => {
      receivedCalls = calls;
    },
  }))
    deltas.push(delta);

  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.at(-2).tool_calls[0].id, 'call_bad');
  assert.equal(requests[1].messages.at(-1).tool_call_id, 'call_bad');
  assert.deepEqual(deltas, ['我先建立项目。', '项目组已建立。']);
  assert.equal(receivedCalls[0].id, 'call_fixed');
});

test('bounds malformed tool-call correction to one additional model request', async () => {
  let requestCount = 0;
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    legacyFreeRouteMode: true,
    fetchImpl: async () => {
      requestCount += 1;
      return Response.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `call_bad_${requestCount}`,
                  type: 'function',
                  function: { name: 'create_project_team', arguments: '{' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
    },
  });

  await assert.rejects(
    async () => {
      for await (const _delta of client.streamChat({
        model: 'auto:noema-free',
        messages: [{ role: 'user', content: '组建项目团队' }],
        signal: new AbortController().signal,
        tools: [
          { type: 'function', function: { name: 'create_project_team' } },
        ],
      })) {
        /* consume */
      }
    },
    (error) =>
      error instanceof ModelProviderError && error.code === 'invalid_tool_call',
  );
  assert.equal(requestCount, 2);
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
  const client = new OpenAICompatibleClient({
    baseUrl: 'http://localhost:31415/v1',
    getApiKey: () => 'test-key',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'http://localhost:31415/v1/chat/completions');
      assert.equal(init.headers.authorization, 'Bearer test-key');
      const request = JSON.parse(init.body);
      assert.equal(request.model, 'nvidia/nemotron-3.5-lightning');
      assert.equal(request.stream, true);
      assert.equal(request.max_tokens, 1024);
      return new Response(stream, { status: 200 });
    },
  });
  const deltas = [];
  let routedVia = 'unexpected';
  for await (const delta of client.streamChat({
    model: 'nvidia/nemotron-3.5-lightning',
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

test('rejects a stream that closes without FreeLLMAPI terminal marker', async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"choices":[{"delta":{"content":"部分回复"}}]}\n\n',
        ),
      );
      controller.close();
    },
  });
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () => new Response(stream, { status: 200 }),
  });
  const partial = [];
  await assert.rejects(
    async () => {
      for await (const delta of client.streamChat({
        model: 'nvidia/nemotron-3.5-lightning',
        messages: [{ role: 'user', content: '你好' }],
        signal: new AbortController().signal,
      })) {
        partial.push(delta);
      }
    },
    (error) => error.code === 'incomplete_stream',
  );
  assert.deepEqual(partial, ['部分回复']);
});

test('bounds streamed response bytes and cancels before accepting tool calls', async () => {
  let canceled = false;
  const oversizedEvent = `data: {"choices":[{"delta":{"content":"${'a'.repeat(1_000_000)}"}}]}\n\n`;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(oversizedEvent));
    },
    cancel() {
      canceled = true;
    },
  });
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () => new Response(body, { status: 200 }),
  });
  let receivedCalls = false;

  await assert.rejects(
    async () => {
      for await (const _delta of client.streamChat({
        model: 'nvidia/nemotron-3.5-lightning',
        messages: [{ role: 'user', content: 'bounded response test' }],
        signal: new AbortController().signal,
        onToolCalls: () => {
          receivedCalls = true;
        },
      })) {
        /* no over-budget response should be yielded */
      }
    },
    (error) => error.code === 'response_too_large',
  );

  assert.equal(receivedCalls, false);
  assert.equal(canceled, true);
});

test('cancels the provider body when the consumer stops reading a stream', async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
        ),
      );
    },
    cancel() {
      canceled = true;
    },
  });
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () => new Response(body, { status: 200 }),
  });

  for await (const _delta of client.streamChat({
    model: 'nvidia/nemotron-3.5-lightning',
    messages: [{ role: 'user', content: 'stop after first chunk' }],
    signal: new AbortController().signal,
  })) {
    break;
  }

  assert.equal(canceled, true);
});

test('bounds buffered router responses while preserving the size error', async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1_000_001));
    },
    cancel() {
      canceled = true;
    },
  });
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    legacyFreeRouteMode: true,
    fetchImpl: async () => new Response(body, { status: 200 }),
  });

  await assert.rejects(
    async () => {
      for await (const _delta of client.streamChat({
        model: 'free-router',
        messages: [{ role: 'user', content: 'bounded router response test' }],
        signal: new AbortController().signal,
      })) {
        /* buffered replies yield only after complete validation */
      }
    },
    (error) => error.code === 'response_too_large',
  );
  assert.equal(canceled, true);
});

test('classifies a body transport failure without exposing the underlying error', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new TypeError('terminated: private transport details'));
    },
  });
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () => new Response(stream, { status: 200 }),
  });

  await assert.rejects(
    async () => {
      for await (const _delta of client.streamChat({
        model: 'nvidia/nemotron-3.5-lightning',
        messages: [{ role: 'user', content: '检查流连接错误分类' }],
        signal: new AbortController().signal,
      })) {
        /* no stream delta expected */
      }
    },
    (error) =>
      error.code === 'provider_unavailable' &&
      !/private transport details|test-key/.test(error.message),
  );
});

test('classifies Electron network errors raised while reading an SSE body', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new Error('net::ERR_CONNECTION_CLOSED'));
    },
  });
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () => new Response(stream, { status: 200 }),
  });

  await assert.rejects(
    async () => {
      for await (const _delta of client.streamChat({
        model: 'nvidia/nemotron-3.5-lightning',
        messages: [{ role: 'user', content: '检查 Electron SSE 断连' }],
        signal: new AbortController().signal,
      })) {
        /* no stream delta expected */
      }
    },
    (error) =>
      error.code === 'provider_unavailable' &&
      error.transportCode === 'ERR_CONNECTION_CLOSED' &&
      !/test-key|net::/.test(error.message),
  );
});

test('allows HTTPS model providers and limits cleartext HTTP to localhost', async () => {
  assert.throws(
    () => normalizeBaseUrl('http://models.example.test/v1'),
    (error) =>
      error instanceof ModelProviderError &&
      error.code === 'insecure_transport',
  );
  assert.equal(
    normalizeBaseUrl('https://api.deepseek.com'),
    'https://api.deepseek.com/v1',
  );
  assert.equal(
    normalizeBaseUrl('http://127.0.0.1:31415'),
    'http://127.0.0.1:31415/v1',
  );
});

test('exposes the configured provider model catalog outside FreeLLMAPI routes', async () => {
  const client = new OpenAICompatibleClient({
    baseUrl: 'https://api.deepseek.com',
    getApiKey: () => 'test-key',
    fetchImpl: async (url) => {
      assert.equal(url, 'https://api.deepseek.com/v1/models');
      return Response.json({
        data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }],
      });
    },
  });

  assert.deepEqual(await client.listModels(), [
    {
      name: 'deepseek-flash',
      label: 'deepseek-flash',
      routeKind: 'direct',
      executionStatus: 'ready',
    },
    {
      name: 'deepseek-v4-pro',
      label: 'deepseek-v4-pro',
      routeKind: 'direct',
      executionStatus: 'ready',
    },
  ]);
});

test('generic provider catalogs are not filtered by legacy route metadata', async () => {
  const client = new OpenAICompatibleClient({
    baseUrl: 'https://models.example.test',
    getApiKey: () => 'test-key',
    fetchImpl: async () =>
      Response.json({
        data: [
          { id: 'free-router', available: true, execution_status: 'exhausted' },
          { id: 'custom-model' },
        ],
      }),
  });

  assert.deepEqual(await client.listModels(), [
    {
      name: 'free-router',
      label: 'free-router',
      routeKind: 'direct',
      executionStatus: 'ready',
    },
    {
      name: 'custom-model',
      label: 'custom-model',
      routeKind: 'direct',
      executionStatus: 'ready',
    },
  ]);
});

test('reconfiguring the provider leaves legacy route semantics behind', () => {
  const client = new OpenAICompatibleClient({
    baseUrl: 'http://127.0.0.1:31415',
    getApiKey: () => 'test-key',
    legacyFreeRouteMode: true,
  });

  client.setBaseUrl('https://api.deepseek.com');

  assert.equal(client.legacyFreeRouteMode, false);
  assert.equal(client.baseUrl, 'https://api.deepseek.com/v1');
});

test('disables DeepSeek thinking by default to avoid unneeded reasoning tokens', async () => {
  let requestBody;
  const client = new OpenAICompatibleClient({
    baseUrl: 'https://api.deepseek.com',
    getApiKey: () => 'test-key',
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(
        'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });

  const chunks = [];
  for await (const chunk of client.streamChat({
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: 'test' }],
    signal: new AbortController().signal,
    maxTokens: 32,
  })) {
    chunks.push(chunk);
  }

  assert.equal(requestBody.thinking.type, 'disabled');
  assert.equal(requestBody.max_tokens, 32);
  assert.deepEqual(chunks, ['OK']);
});

test('reports a model-list transport reset without leaking request details', async () => {
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () => {
      throw new TypeError('request failed', {
        cause: { code: 'ECONNRESET', message: 'private socket details' },
      });
    },
  });
  await assert.rejects(
    client.listModels(),
    (error) =>
      error.code === 'gateway_unavailable' &&
      error.transportCode === 'ECONNRESET' &&
      error.message.includes('连接被对端重置') &&
      !/test-key|private socket details/.test(error.message),
  );
});

test('preserves a sanitized transport code when a chat request cannot connect', async () => {
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () => {
      throw new TypeError('request failed', {
        cause: { code: 'ENOTFOUND', message: 'private DNS details' },
      });
    },
  });

  await assert.rejects(
    async () => {
      for await (const _delta of client.streamChat({
        model: 'deepseek-flash',
        messages: [{ role: 'user', content: 'network probe' }],
        signal: new AbortController().signal,
      })) {
        /* no response expected */
      }
    },
    (error) =>
      error.code === 'gateway_unavailable' &&
      error.transportCode === 'ENOTFOUND' &&
      error.message.includes('域名解析失败') &&
      !/test-key|private DNS details/.test(error.message),
  );
});

test('requires credentials before making a request', async () => {
  const client = new OpenAICompatibleClient({ getApiKey: () => null });
  await assert.rejects(
    client.listModels(),
    (error) => error.code === 'credentials_missing',
  );
});

test('maps provider exhaustion into an actionable but non-leaking message', async () => {
  const client = new OpenAICompatibleClient({
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

test('preserves a bounded HTTP Retry-After hint for safe project recovery', async () => {
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () =>
      new Response(null, {
        status: 429,
        headers: { 'retry-after': '3' },
      }),
  });
  await assert.rejects(
    async () => {
      for await (const _delta of client.streamChat({
        model: 'free-router',
        messages: [{ role: 'user', content: 'retry-after contract' }],
        signal: new AbortController().signal,
      })) {
        /* no response expected */
      }
    },
    (error) =>
      error.code === 'rate_limited' &&
      error.status === 429 &&
      error.retryAfterSeconds === 3,
  );

  const longDelayClient = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () =>
      new Response(null, {
        status: 429,
        headers: { 'retry-after': '3600' },
      }),
  });
  await assert.rejects(
    async () => {
      for await (const _delta of longDelayClient.streamChat({
        model: 'free-router',
        messages: [{ role: 'user', content: 'long retry-after contract' }],
        signal: new AbortController().signal,
      })) {
        /* no response expected */
      }
    },
    (error) =>
      error.code === 'rate_limited' && error.retryAfterSeconds === null,
  );
});

test('classifies an oversized model request without exposing gateway diagnostics', async () => {
  const client = new OpenAICompatibleClient({
    getApiKey: () => 'test-key',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'private TPM diagnostic: requested 20449 tokens',
          },
        }),
        { status: 413 },
      ),
  });

  await assert.rejects(
    async () => {
      for await (const _delta of client.streamChat({
        model: 'free-router',
        messages: [{ role: 'user', content: 'a large project task' }],
        signal: new AbortController().signal,
      })) {
        /* no stream expected */
      }
    },
    (error) =>
      error.code === 'request_too_large' &&
      error.status === 413 &&
      /缩小委托内容/u.test(error.message) &&
      !/private TPM diagnostic|20449|test-key/u.test(error.message),
  );
});
