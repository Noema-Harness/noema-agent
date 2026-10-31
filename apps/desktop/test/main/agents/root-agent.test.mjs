import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ModelProviderError } from '../../../src/main/providers/openai-compatible-client.mjs';
import { RootAgent } from '../../../src/main/agents/root-agent.mjs';
import { RootStore } from '../../../src/main/storage/root-store.mjs';

function createSecretStore(configured = true) {
  return {
    value: configured ? 'test-key' : null,
    isConfigured() {
      return this.value !== null;
    },
    get() {
      return this.value;
    },
    set(value) {
      this.value = value;
    },
    setConfiguration({ apiKey, baseUrl }) {
      this.value = apiKey;
      this.baseUrl = baseUrl;
    },
    clear() {
      this.value = null;
    },
  };
}

test('saving a capture is local and does not request model output', () => {
  const store = new RootStore(':memory:');
  let modelCalls = 0;
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      async *streamChat() {
        modelCalls += 1;
        yield 'unexpected';
      },
    },
    secretStore: createSecretStore(),
  });
  const capture = agent.saveCapture('只记录，不开始对话');
  assert.equal(capture.content, '只记录，不开始对话');
  assert.equal(modelCalls, 0);
  assert.equal(store.getSnapshot().messages.length, 0);
  assert.equal(store.getSnapshot().captures.length, 1);
  store.close();
});

test('discussing a capture sends its exact text as one root turn and preserves provenance', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('free-router');
  const capture = store.createCapture('这个念头原文不能被重新概括。');
  let request;
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      async listModels() {
        return [{ name: 'free-router', label: '测试路由' }];
      },
      async *streamChat(input) {
        request = input;
        yield '我们可以从这里聊起。';
      },
    },
    secretStore: createSecretStore(),
  });

  const { turnId } = agent.discussCapture(capture.id);
  await agent.active.done;

  assert.equal(request.messages.at(-1).content, capture.content);
  assert.equal(store.getCapture(capture.id).discussionTurnId, turnId);
  assert.equal(
    store.getSnapshot().messages.filter((message) => message.role === 'user')
      .length,
    1,
  );
  assert.equal(
    store.getSnapshot().messages.find((message) => message.role === 'user')
      .content,
    capture.content,
  );
  store.close();
});

test('ordinary root turns do not retrieve older conversation context', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('auto:noema-free');
  let messages = [];
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [
        { name: 'auto:noema-free', label: 'Noema 免费模型链' },
      ],
      async *streamChat(input) {
        messages = input.messages;
        yield '我可以和你继续讨论这个新想法。';
      },
    },
    secretStore: createSecretStore(),
  });

  agent.sendMessage({ text: '我有一个新想法，想先和你讨论。' });
  await agent.active.done;

  assert.equal(
    messages.some((message) =>
      message.content?.includes('noema_history_recall'),
    ),
    false,
  );
  store.close();
});

test('first connection selects the configured provider default when available', async () => {
  const store = new RootStore(':memory:');
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
      { name: 'auto:noema-free', label: 'Noema 免费模型链' },
    ],
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
  });

  const state = await agent.refreshModels();

  assert.equal(state.selectedModel, 'free-router');
  assert.equal(store.getSelectedModel(), 'free-router');
  store.close();
});

test('first connection selects the first provider model when the preferred model is absent', async () => {
  const store = new RootStore(':memory:');
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    ],
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
  });

  const state = await agent.refreshModels();

  assert.equal(state.selectedModel, 'free-router');
  store.close();
});

test('refreshing preserves an explicit model choice when that route is unavailable', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('free-router');
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'auto:noema-free', label: 'Noema 免费模型链' },
    ],
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
  });

  const state = await agent.refreshModels();

  assert.equal(state.selectedModel, 'free-router');
  assert.equal(store.getSelectedModel(), 'free-router');
  store.close();
});

test('streams a FreeLLMAPI response into the persistent root turn', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('free-router');
  let sent;
  const events = [];
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    ],
    async *streamChat(input) {
      sent = input;
      input.onRouteMetadata('blockrun/model-name');
      yield '你好';
      yield '，这里是 Noema。';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
    emit: (event) => events.push(event),
  });
  const { turnId } = agent.sendMessage({ text: '你好' });
  await agent.active.done;

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.messages.length, 2);
  assert.equal(snapshot.messages[1].content, '你好，这里是 Noema。');
  assert.equal(snapshot.messages[1].turnStatus, 'completed');
  assert.equal(snapshot.messages[1].routeMetadataStatus, 'reported');
  assert.deepEqual(snapshot.messages[1].routedVia, ['blockrun/model-name']);
  assert.equal(sent.model, 'free-router');
  assert.equal(sent.messages.at(-1).content, '你好');
  assert.ok(!('numCtx' in sent));
  assert.ok(
    events.some(
      (event) => event.type === 'turn-completed' && event.turnId === turnId,
    ),
  );
  store.close();
});

test('sends an imported Codex snapshot as quoted context before the current root request', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('auto:noema-free');
  store.addContextImport({
    source: 'codex',
    threadId: 'thr-free-route-fixture',
    title: 'synthetic migration fixture',
    messages: [
      { role: 'user', content: 'Only change the parser.' },
      {
        role: 'assistant',
        content: 'The parser currently rejects empty input.',
      },
    ],
  });
  store.consentToContextImportTransmission();
  let sent;
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'auto:noema-free', label: 'FreeLLMAPI 免费路由' },
    ],
    async *streamChat(input) {
      sent = input;
      yield '收到。';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
  });

  agent.sendMessage({ text: '继续检查这个解析问题。' });
  await agent.active.done;

  assert.equal(sent.model, 'auto:noema-free');
  assert.equal(sent.messages.at(-1).role, 'user');
  assert.equal(sent.messages.at(-1).content, '继续检查这个解析问题。');
  const imported = sent.messages.find((message) =>
    message.content.includes('codex_context_snapshot'),
  );
  assert.equal(imported.role, 'user');
  assert.match(imported.content, /Only change the parser/);
  assert.match(imported.content, /不是本轮请求或操作授权/);
  assert.match(sent.messages[0].content, /历史参考/);
  store.close();
});

test('searches old root dialogue on request and discloses the exact source', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('auto:noema-free');
  let sourceMessageId = null;
  const firstTurn = store.beginTurn({
    text: '我后来让模型用体素化工具生成 Minecraft 模组模型的碰撞箱，这次才稳定。',
    model: 'auto:noema-free',
  });
  sourceMessageId = store
    .getSnapshot()
    .messages.find(
      (message) => message.turnId === firstTurn.id && message.role === 'user',
    ).id;
  store.appendAssistant({
    id: firstTurn.id,
    attempt: 1,
    content: '体素化工具让碰撞箱更接近模型本身。',
  });
  store.completeTurn(firstTurn.id, 1);
  for (let index = 0; index < 10; index += 1) {
    const turn = store.beginTurn({
      text: `后续讨论的普通话题 ${index}。`,
      model: 'auto:noema-free',
    });
    store.appendAssistant({
      id: turn.id,
      attempt: 1,
      content: `普通回复 ${index}。`,
    });
    store.completeTurn(turn.id, 1);
  }
  store.createCapture('未讨论速记：Minecraft 碰撞箱的私人草稿');

  const requests = [];
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'auto:noema-free', label: 'Noema 免费模型链' },
    ],
    async *streamChat(input) {
      requests.push(input);
      assert.deepEqual(input.tools, []);
      const recall = input.messages.find((message) =>
        message.content.includes('"type":"noema_history_recall"'),
      );
      assert.ok(recall);
      const payload = JSON.parse(recall.content.split('\n').at(-1));
      assert.equal(payload.status, 'found');
      assert.equal(payload.sources[0].id, sourceMessageId);
      assert.match(payload.sources[0].snippet, /体素化工具/);
      assert.ok(
        !input.messages.some(
          (message) =>
            message !== recall && message.content?.includes('体素化工具'),
        ),
      );
      input.onRouteMetadata('fixture/free-model');
      yield '你当时提到体素化工具，后来它确实让碰撞箱更稳定。';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
    allowRootActions: false,
    allowHistorySearch: true,
  });

  const sent = agent.sendMessage({
    text: '你还记得我们聊 Minecraft 碰撞箱的解决办法吗？',
  });
  await agent.active.done;

  assert.equal(requests.length, 1);
  assert.equal(store.getTurn(sent.turnId).status, 'completed');
  const assistant = store
    .getSnapshot()
    .messages.find(
      (message) =>
        message.turnId === sent.turnId && message.role === 'assistant',
    );
  assert.match(assistant.content, /体素化工具/);
  assert.ok(assistant.historySources.length >= 1);
  assert.ok(
    assistant.historySources.some((source) => source.id === sourceMessageId),
  );
  assert.ok(
    assistant.historySources.every((source) => source.snippet.length <= 322),
  );
  assert.equal(assistant.historySearchStatus, 'found');
  assert.equal(assistant.historySourcesIncluded, true);
  assert.equal(
    store.getSnapshot().captures[0].content,
    '未讨论速记：Minecraft 碰撞箱的私人草稿',
  );
  store.close();
});

test('history search with no match is supplied once and cannot fabricate sources', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('auto:noema-free');
  const requests = [];
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'auto:noema-free', label: 'Noema 免费模型链' },
    ],
    async *streamChat(input) {
      requests.push(input);
      const recall = input.messages.find((message) =>
        message.content.includes('"type":"noema_history_recall"'),
      );
      assert.ok(recall);
      const result = JSON.parse(recall.content.split('\n').at(-1));
      assert.equal(result.status, 'no_match');
      assert.deepEqual(result.sources, []);
      yield '我没有在之前的对话里找到这个主题。';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
  });

  const sent = agent.sendMessage({
    text: '你记得我们聊过从未出现过的主题词吗？',
  });
  await agent.active.done;

  assert.equal(requests.length, 1);
  const assistant = store
    .getSnapshot()
    .messages.find(
      (message) =>
        message.turnId === sent.turnId && message.role === 'assistant',
    );
  assert.equal(assistant.historySources.length, 0);
  assert.equal(assistant.historySearchStatus, 'no_match');
  assert.match(assistant.content, /没有在之前的对话里找到/);
  store.close();
});

test('records a direct interaction correction and carries it across root turns', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('auto:noema-free');
  const modelInputs = [];
  const events = [];
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'auto:noema-free', label: 'Noema 免费模型链' },
    ],
    async *streamChat(input) {
      modelInputs.push(input);
      if (input.messages.at(-1).content.includes('不要先做心理分析')) {
        input.onToolCalls([
          {
            id: 'call-adjustment',
            type: 'function',
            function: {
              name: 'record_interaction_adjustment',
              arguments: JSON.stringify({
                sourceQuote: '不要先做心理分析。',
                scope: 'conversation',
                situation: '用户分享不愉快经历但没有请求分析或建议',
                behavior: '先自然回应，并询问用户当时最在意的部分。',
              }),
            },
          },
        ]);
        return;
      }
      yield '我先听你说。';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
    emit: (event) => events.push(event),
  });

  const correction = agent.sendMessage({
    text: '当我分享不愉快的经历时，不要先做心理分析。',
  });
  await agent.active.done;
  const adjustment = store.getSnapshot().interactionAdjustments[0];
  assert.equal(adjustment.sourceTurnId, correction.turnId);
  assert.equal(adjustment.scope, 'conversation');
  assert.equal(adjustment.status, 'active');
  assert.ok(
    events.some((event) => event.type === 'interaction-adjustments-updated'),
  );
  const editedAdjustment = agent.updateInteractionAdjustment({
    id: adjustment.id,
    scope: 'conversation',
    situation: '用户分享不愉快经历但没有请求分析或建议',
    behavior: '先回应当下感受，再问一个贴近原话的问题；不要先分析或给建议。',
  });
  assert.equal(editedAdjustment.userEdited, true);
  assert.equal(
    editedAdjustment.originalBehavior,
    '先自然回应，并询问用户当时最在意的部分。',
  );

  agent.sendMessage({
    text: '朋友临时取消了约定，我有点失落。',
  });
  await agent.active.done;
  const adjustmentContext = modelInputs[1].messages.find((message) =>
    message.content.includes('interaction_adjustments'),
  );
  assert.ok(adjustmentContext);
  assert.match(
    adjustmentContext.content,
    /先回应当下感受，再问一个贴近原话的问题/,
  );
  assert.match(adjustmentContext.content, /"userEdited":true/);
  const latestRootMessage = store
    .getSnapshot()
    .messages.find(
      (message) =>
        message.turnId !== correction.turnId && message.role === 'assistant',
    );
  assert.deepEqual(latestRootMessage.interactionAdjustmentIds, [adjustment.id]);
  assert.deepEqual(
    latestRootMessage.interactionAdjustmentSnapshots[0],
    store.getInteractionAdjustment(adjustment.id) && {
      id: adjustment.id,
      scope: 'conversation',
      situation: '用户分享不愉快经历但没有请求分析或建议',
      behavior: '先回应当下感受，再问一个贴近原话的问题；不要先分析或给建议。',
      sourceQuote: '不要先做心理分析。',
      sourceSurface: 'root',
      sourceRoomId: null,
      userEdited: true,
      editedAt: store.getInteractionAdjustment(adjustment.id).editedAt,
    },
  );
  assert.equal(
    modelInputs[1].messages.at(-1).content,
    '朋友临时取消了约定，我有点失落。',
  );
  store.close();
});

test('Noema exposes local arithmetic even when background actions are disabled', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  let request;
  let callCount = 0;
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [{ name: 'test-model', label: 'Test' }],
    async *streamChat(input) {
      callCount += 1;
      if (callCount === 1) {
        request = input;
        input.onToolCalls([
          {
            id: 'call-calculate',
            type: 'function',
            function: {
              name: 'calculate_expression',
              arguments: JSON.stringify({
                expression: '4 * 200 - 4 * 30 - 600',
              }),
            },
          },
        ]);
      } else {
        assert.deepEqual(input.tools, []);
        assert.deepEqual(
          input.messages.slice(-2).map((message) => message.role),
          ['assistant', 'tool'],
        );
        assert.match(input.messages.at(-1).content, /"value":"80"/u);
        yield '4 × 200 − 4 × 30 − 600 = 80；这个结果只核验运算，不核验输入金额。';
      }
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
    allowRootActions: false,
  });
  const sent = agent.sendMessage({ text: '帮我核算四人试办的收支差。' });
  await agent.active.done;
  const calculator = request.tools.find(
    (tool) => tool.function.name === 'calculate_expression',
  );
  assert.ok(calculator);
  assert.deepEqual(
    request.tools.map((tool) => tool.function.name),
    ['calculate_expression'],
  );
  const assistant = store
    .getSnapshot()
    .messages.find(
      (message) =>
        message.turnId === sent.turnId && message.role === 'assistant',
    );
  assert.match(assistant.content, /4 × 200 − 4 × 30 − 600 = 80/u);
  assert.match(assistant.content, /不核验输入金额/u);
  assert.equal(callCount, 2);
  await agent.shutdown();
  store.close();
});

test('reports tool-result recovery accurately when the final model response is empty', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  let callCount = 0;
  const agent = new RootAgent({
    store,
    provider: {
      listModels: async () => [{ name: 'test-model', label: 'Test' }],
      async *streamChat(input) {
        callCount += 1;
        if (callCount === 1) {
          input.onToolCalls([
            {
              id: 'call-calculate-empty-follow-up',
              type: 'function',
              function: {
                name: 'calculate_expression',
                arguments: JSON.stringify({ expression: '19 * 23' }),
              },
            },
          ]);
        } else {
          yield '';
        }
      },
    },
    secretStore: createSecretStore(),
    allowRootActions: false,
  });

  try {
    const { turnId } = agent.sendMessage({ text: '计算 19 乘以 23' });
    await agent.active.done;
    const turn = store.getTurn(turnId);
    assert.equal(turn.status, 'failed');
    assert.match(turn.errorMessage, /重试会重新处理原请求/u);
    assert.match(turn.errorMessage, /计算会重新执行/u);
    assert.doesNotMatch(turn.errorMessage, /操作结果已保留/u);
    assert.equal(callCount, 2);
  } finally {
    await agent.shutdown();
    store.close();
  }
});

test('warns when retrying a failed web-backed answer can consume search quota again', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  let providerCalls = 0;
  let searchCalls = 0;
  let fetchCalls = 0;
  const agent = new RootAgent({
    store,
    provider: {
      listModels: async () => [{ name: 'test-model', label: 'Test' }],
      async *streamChat(input) {
        providerCalls += 1;
        if ([1, 3].includes(providerCalls)) {
          input.onToolCalls([
            {
              id: `search-${providerCalls}`,
              type: 'function',
              function: {
                name: 'search_web',
                arguments: JSON.stringify({ query: '本周 AI 新闻' }),
              },
            },
          ]);
        } else if (providerCalls === 2) {
          yield '';
        } else {
          yield '本周来源显示了相关动态。';
        }
      },
    },
    secretStore: createSecretStore(),
    webSearchSecretStore: createSecretStore(),
    searchWebImpl: async () => {
      searchCalls += 1;
      return {
        results: [
          {
            id: `news-${searchCalls}`,
            title: '本周行业消息',
            url: `https://example.com/news/${searchCalls}`,
          },
        ],
      };
    },
    fetchWebSourceImpl: async (url) => {
      fetchCalls += 1;
      return {
        source: {
          id: `source-${fetchCalls}`,
          title: '本周行业消息',
          url,
          fetchedAt: '2026-10-27T00:00:00.000Z',
          excerpt: '本周行业消息摘录',
          truncated: false,
        },
        content: '本周行业消息摘录',
      };
    },
  });

  try {
    const { turnId } = agent.sendMessage({ text: '请搜索本周 AI 新闻。' });
    await agent.active.done;
    const failed = store.getTurn(turnId);
    assert.equal(failed.status, 'failed');
    assert.match(failed.errorMessage, /可能再次消耗额度/u);
    assert.match(failed.errorMessage, /保留在这次失败的尝试中/u);
    assert.equal(searchCalls, 1);
    assert.equal(fetchCalls, 1);
    const failedAssistant = store
      .getSnapshot()
      .messages.find(
        (message) => message.turnId === turnId && message.role === 'assistant',
      );
    assert.equal(failedAssistant.externalSources.length, 1);

    agent.retryTurn({ turnId, model: 'test-model' });
    await agent.active.done;
    assert.equal(store.getTurn(turnId).status, 'completed');
    assert.equal(searchCalls, 2);
    assert.equal(fetchCalls, 2);
    const attempts = store
      .getSnapshot()
      .messages.filter(
        (message) => message.turnId === turnId && message.role === 'assistant',
      );
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].status, 'failed');
    assert.equal(attempts[0].externalSources.length, 1);
    assert.equal(attempts[1].status, 'complete');
    assert.equal(attempts[1].externalSources.length, 1);
  } finally {
    await agent.shutdown();
    store.close();
  }
});

test('does not claim a rejected delegate task was started in retry guidance', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  const workspace = mkdtempSync(
    path.join(tmpdir(), 'noema-rejected-delegate-'),
  );
  store.setWorkspaceDirectory(workspace);
  let providerCalls = 0;
  const agent = new RootAgent({
    store,
    provider: {
      listModels: async () => [{ name: 'test-model', label: 'Test' }],
      async *streamChat(input) {
        providerCalls += 1;
        if (providerCalls === 1) {
          input.onToolCalls([
            {
              id: 'oversized-delegate',
              type: 'function',
              function: {
                name: 'delegate_task',
                arguments: JSON.stringify({ task: 'x'.repeat(40_000) }),
              },
            },
            {
              id: 'search-after-rejected-delegate',
              type: 'function',
              function: {
                name: 'search_web',
                arguments: JSON.stringify({ query: '本周 AI 新闻' }),
              },
            },
          ]);
        } else {
          yield '';
        }
      },
    },
    secretStore: createSecretStore(),
    webSearchSecretStore: createSecretStore(),
    searchWebImpl: async () => ({ results: [] }),
    dshAdapter: { startTask: async () => assert.fail('任务不应启动') },
  });

  try {
    const { turnId } = agent.sendMessage({ text: '请搜索本周 AI 新闻。' });
    await agent.active.done;
    const failed = store.getTurn(turnId);
    assert.equal(failed.status, 'failed');
    assert.match(failed.errorMessage, /没有已创建的后台任务/u);
    assert.doesNotMatch(failed.errorMessage, /已启动的委派会继续/u);
    assert.equal(store.getBackgroundTasks().length, 0);
    assert.equal(providerCalls, 2);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('Noema reads only a user-provided URL and persists the source with its answer', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  let callCount = 0;
  let fetchCount = 0;
  let firstRequest;
  const source = {
    id: 'source-1',
    title: '项目文档',
    url: 'https://example.com/docs',
    fetchedAt: '2026-10-27T00:00:00.000Z',
    excerpt: '项目文档的原文摘录。',
    truncated: false,
  };
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'test-model', label: 'Test' }],
      async *streamChat(input) {
        callCount += 1;
        if (callCount === 1) {
          firstRequest = input;
          input.onToolCalls([
            {
              id: 'call-fetch',
              type: 'function',
              function: {
                name: 'fetch_web_page',
                arguments: JSON.stringify({ url: source.url }),
              },
            },
          ]);
        } else {
          input.onRouteMetadata('test-route');
          assert.match(input.messages.at(-1).content, /项目文档的原文摘录/u);
          assert.match(input.messages.at(-1).content, /"citationId":"S1"/u);
          yield '文档说明了项目目标。';
        }
      },
    },
    secretStore: createSecretStore(),
    fetchWebSourceImpl: async (url) => {
      fetchCount += 1;
      assert.equal(url, source.url);
      return { source, content: source.excerpt };
    },
  });

  const { turnId } = agent.sendMessage({
    text: `请阅读这个链接并概括重点：${source.url}`,
  });
  await agent.active.done;
  const assistant = store
    .getSnapshot()
    .messages.find(
      (message) => message.turnId === turnId && message.role === 'assistant',
    );
  assert.deepEqual(
    firstRequest.tools.find((tool) => tool.function.name === 'fetch_web_page')
      .function.parameters.properties.url.enum,
    [source.url],
  );
  assert.deepEqual(assistant.externalSources, [
    { ...source, citationId: 'S1' },
  ]);
  assert.equal(assistant.externalSourcesIncluded, true);
  assert.match(assistant.content, /项目目标/u);
  assert.equal(fetchCount, 1);
  await agent.shutdown();
  store.close();
});

test('Noema does not expose web fetching for chats without an explicit URL', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  let tools = [];
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'test-model', label: 'Test' }],
      async *streamChat(input) {
        tools = input.tools;
        yield '我暂时没有读取网页的入口。';
      },
    },
    secretStore: createSecretStore(),
  });
  agent.sendMessage({ text: '请告诉我这个领域最近有哪些变化。' });
  await agent.active.done;
  assert.equal(
    tools.some((tool) => tool.function.name === 'fetch_web_page'),
    false,
  );
  await agent.shutdown();
  store.close();
});

test('Noema searches only on current-source requests when configured and attaches results to the answer', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  let calls = 0;
  let firstRequest;
  const webSearchSecretStore = createSecretStore();
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'test-model', label: 'Test' }],
      async *streamChat(input) {
        calls += 1;
        if (calls === 1) {
          firstRequest = input;
          input.onToolCalls([
            {
              id: 'call-search',
              type: 'function',
              function: {
                name: 'search_web',
                arguments: JSON.stringify({ query: '本周 AI 新闻' }),
              },
            },
          ]);
          return;
        }
        input.onRouteMetadata('test-route');
        assert.match(input.messages.at(-1).content, /本周行业消息摘录/u);
        assert.match(input.messages.at(-1).content, /"citationId":"S1"/u);
        yield '搜索到的来源显示本周行业有几项新消息。';
      },
    },
    secretStore: createSecretStore(),
    webSearchSecretStore,
    searchWebImpl: async (query, key) => {
      assert.equal(query, '本周 AI 新闻');
      assert.equal(key, 'test-key');
      return {
        results: [
          {
            id: 'candidate-1',
            title: '本周行业消息',
            url: 'https://example.com/news',
          },
        ],
      };
    },
    fetchWebSourceImpl: async (url, options) => {
      assert.equal(url, 'https://example.com/news');
      assert.deepEqual(options.allowedRedirectHosts, ['example.com']);
      return {
        source: {
          id: 'search-source-1',
          title: '本周行业消息',
          url,
          fetchedAt: '2026-10-27T00:00:00.000Z',
          excerpt: '本周行业消息摘录',
          truncated: false,
        },
        content: '本周行业消息摘录',
      };
    },
  });

  const { turnId } = agent.sendMessage({ text: '请搜索本周 AI 新闻。' });
  await agent.active.done;
  const assistant = store
    .getSnapshot()
    .messages.find(
      (message) => message.turnId === turnId && message.role === 'assistant',
    );
  assert.ok(
    firstRequest.tools.some((tool) => tool.function.name === 'search_web'),
  );
  assert.deepEqual(
    assistant.externalSources.map((source) => source.url),
    ['https://example.com/news'],
  );
  assert.equal(assistant.externalSources[0].citationId, 'S1');
  assert.equal(assistant.externalSourcesIncluded, true);
  assert.match(assistant.content, /搜索到的来源/u);
  assert.equal(calls, 2);
  await agent.shutdown();
  store.close();
});

test('stopping during web search aborts the request and does not continue the model loop', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  let providerCalls = 0;
  let searchSignal;
  let resolveSearchStarted;
  const searchStarted = new Promise((resolve) => {
    resolveSearchStarted = resolve;
  });
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'test-model', label: 'Test' }],
      async *streamChat(input) {
        providerCalls += 1;
        input.onToolCalls([
          {
            id: 'call-search-to-stop',
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ query: '本周 AI 新闻' }),
            },
          },
        ]);
        yield '';
      },
    },
    secretStore: createSecretStore(),
    webSearchSecretStore: createSecretStore(),
    searchWebImpl: async (_query, _key, { signal }) => {
      searchSignal = signal;
      resolveSearchStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    },
  });

  const { turnId } = agent.sendMessage({ text: '请搜索本周 AI 新闻。' });
  await searchStarted;
  assert.equal(await agent.stopTurn(turnId), true);
  assert.equal(searchSignal.aborted, true);
  assert.equal(store.getTurn(turnId).status, 'interrupted');
  assert.equal(providerCalls, 1);
  await agent.shutdown();
  store.close();
});

test('Noema continues through bounded search, reading, and calculation before answering', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  let calls = 0;
  const webSearchSecretStore = createSecretStore();
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'test-model', label: 'Test' }],
      async *streamChat(input) {
        calls += 1;
        if (calls === 1) {
          assert.ok(
            input.tools.some((tool) => tool.function.name === 'search_web'),
          );
          assert.ok(
            input.tools.some(
              (tool) => tool.function.name === 'calculate_expression',
            ),
          );
          input.onToolCalls([
            {
              id: 'call-search-price',
              type: 'function',
              function: {
                name: 'search_web',
                arguments: JSON.stringify({ query: '本月蓝莓单价' }),
              },
            },
          ]);
          return;
        }
        if (calls === 2) {
          assert.match(input.messages.at(-1).content, /单盒蓝莓售价12元/u);
          assert.deepEqual(
            input.tools.map((tool) => tool.function.name).sort(),
            ['calculate_expression', 'fetch_web_page'],
          );
          input.onToolCalls([
            {
              id: 'call-fetch-terms',
              type: 'function',
              function: {
                name: 'fetch_web_page',
                arguments: JSON.stringify({
                  url: 'https://example.com/terms',
                }),
              },
            },
          ]);
          return;
        }
        if (calls === 3) {
          assert.match(input.messages.at(-1).content, /退货规则为签收后七日/u);
          assert.deepEqual(
            input.tools.map((tool) => tool.function.name),
            ['calculate_expression'],
          );
          input.onToolCalls([
            {
              id: 'call-calculate-total',
              type: 'function',
              function: {
                name: 'calculate_expression',
                arguments: JSON.stringify({ expression: '12 * 12' }),
              },
            },
          ]);
          return;
        }
        assert.deepEqual(input.tools, []);
        assert.match(input.messages.at(-1).content, /"value":"144"/u);
        yield '按搜索到的单盒价格计算，12 盒共 144 元（12 × 12）。单盒售价：[[S1|单盒蓝莓售价12元]]';
      },
    },
    secretStore: createSecretStore(),
    webSearchSecretStore,
    searchWebImpl: async (query, key) => {
      assert.equal(query, '本月蓝莓单价');
      assert.equal(key, 'test-key');
      return {
        results: [
          {
            id: 'blueberry-price',
            title: '蓝莓售价信息',
            url: 'https://example.com/blueberries',
          },
        ],
      };
    },
    fetchWebSourceImpl: async (url) => ({
      source: {
        id: url.endsWith('/terms') ? 'terms-source' : 'blueberry-source',
        title: url.endsWith('/terms') ? '退货条款' : '蓝莓售价信息',
        url,
        fetchedAt: '2026-10-27T00:00:00.000Z',
        excerpt: url.endsWith('/terms')
          ? '退货规则为签收后七日'
          : '单盒蓝莓售价12元',
        truncated: false,
      },
      content: url.endsWith('/terms')
        ? '退货规则为签收后七日'
        : '单盒蓝莓售价12元',
    }),
  });

  const { turnId } = agent.sendMessage({
    text: '请搜索本月蓝莓单价，阅读 https://example.com/terms 并计算12盒的总价。',
  });
  await agent.active.done;
  const assistant = store
    .getSnapshot()
    .messages.find(
      (message) => message.turnId === turnId && message.role === 'assistant',
    );
  assert.equal(calls, 4);
  assert.equal(assistant.externalSources[0].citationId, 'S1');
  assert.equal(assistant.externalSources[1].citationId, 'S2');
  assert.equal(assistant.externalSourcesIncluded, true);
  assert.match(assistant.content, /12 × 12/u);
  await agent.shutdown();
  store.close();
});

test('Noema does not expose source search without an explicit current-information request or configured key', async () => {
  for (const { text, configured } of [
    { text: '聊聊我最近的生活吧。', configured: true },
    { text: '请搜索本周 AI 新闻。', configured: false },
  ]) {
    const store = new RootStore(':memory:');
    store.setSelectedModel('test-model');
    let tools = [];
    const agent = new RootAgent({
      store,
      provider: {
        baseUrl: 'http://127.0.0.1:31415/v1',
        listModels: async () => [{ name: 'test-model', label: 'Test' }],
        async *streamChat(input) {
          tools = input.tools;
          yield '继续聊聊。';
        },
      },
      secretStore: createSecretStore(),
      webSearchSecretStore: createSecretStore(configured),
    });
    agent.sendMessage({ text });
    await agent.active.done;
    assert.equal(
      tools.some((tool) => tool.function.name === 'search_web'),
      false,
    );
    await agent.shutdown();
    store.close();
  }
});

test('search queries must be copied from the current user message rather than private prior context', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  let searchCalls = 0;
  const agent = new RootAgent({
    store,
    provider: { baseUrl: 'http://127.0.0.1:31415/v1' },
    secretStore: createSecretStore(),
    webSearchSecretStore: createSecretStore(),
    searchWebImpl: async () => {
      searchCalls += 1;
      return { results: [] };
    },
  });
  const turn = store.beginTurn({
    text: '请搜索本周 AI 新闻。',
    model: 'test-model',
  });
  await assert.rejects(
    agent.handleRootToolCall(turn, [
      {
        id: 'call-search-private-query',
        type: 'function',
        function: {
          name: 'search_web',
          arguments: JSON.stringify({ query: '家庭住址与私人健康记录' }),
        },
      },
    ]),
    (error) => error.code === 'web_search_invalid',
  );
  assert.equal(searchCalls, 0);
  await agent.shutdown();
  store.close();
});

test('web-search credentials can be replaced or removed without exposing the secret in UI state', async () => {
  const store = new RootStore(':memory:');
  const webSearchSecretStore = createSecretStore(false);
  const agent = new RootAgent({
    store,
    provider: { baseUrl: 'http://127.0.0.1:31415/v1' },
    secretStore: createSecretStore(),
    webSearchSecretStore,
  });
  agent.configureWebSearch({ apiKey: 'new-search-key' });
  const configuredState = await agent.getUiState();
  assert.equal(configuredState.webSearchConfigured, true);
  assert.equal(
    JSON.stringify(configuredState).includes('new-search-key'),
    false,
  );
  agent.clearWebSearch();
  assert.equal((await agent.getUiState()).webSearchConfigured, false);
  await agent.shutdown();
  store.close();
});

test('a failed webpage read is visible after the model response', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  let callCount = 0;
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'test-model', label: 'Test' }],
      async *streamChat(input) {
        callCount += 1;
        if (callCount === 1) {
          input.onToolCalls([
            {
              id: 'call-fetch-failure',
              type: 'function',
              function: {
                name: 'fetch_web_page',
                arguments: JSON.stringify({ url: 'https://example.com/docs' }),
              },
            },
          ]);
          return;
        }
        assert.match(input.messages.at(-1).content, /fetched.*false/u);
        yield '以下是基于现有知识的概括。';
      },
    },
    secretStore: createSecretStore(),
    fetchWebSourceImpl: async () => {
      throw new Error('该链接解析到非公开网络地址，已拒绝读取。');
    },
  });

  const { turnId } = agent.sendMessage({
    text: '请阅读这个链接并概括重点：https://example.com/docs',
  });
  await agent.active.done;
  const assistant = store
    .getSnapshot()
    .messages.find(
      (message) => message.turnId === turnId && message.role === 'assistant',
    );
  assert.match(assistant.content, /以下是基于现有知识的概括/u);
  assert.match(
    assistant.content,
    /网页读取失败（以下回答不是基于该链接）\*\*：该链接解析到非公开网络地址/u,
  );
  assert.equal(assistant.externalSources.length, 0);
  await agent.shutdown();
  store.close();
});

test('RootAgent emits a state refresh when the user revises an interaction adjustment', async () => {
  const store = new RootStore(':memory:');
  const turn = store.beginTurn({
    text: '这条长期纠正应保持可修订。',
    model: 'auto:noema-free',
  });
  const adjustment = store.addInteractionAdjustment({
    id: 'adjustment-root-agent-edit',
    sourceTurnId: turn.id,
    scope: 'conversation',
    situation: '保存纠正',
    behavior: '保留初始解释。',
    sourceQuote: '保持可修订',
  });
  const events = [];
  let modelCalls = 0;
  const agent = new RootAgent({
    store,
    provider: {
      async listModels() {
        modelCalls += 1;
        return [];
      },
      async *streamChat() {
        modelCalls += 1;
        yield 'unexpected model call';
      },
    },
    secretStore: createSecretStore(),
    emit: (event) => events.push(event),
  });

  try {
    const updated = agent.updateInteractionAdjustment({
      id: adjustment.id,
      scope: 'both',
      situation: '用户直接修订后',
      behavior: '以后使用用户当前版本。',
    });
    assert.equal(updated.userEdited, true);
    assert.equal(updated.behavior, '以后使用用户当前版本。');
    assert.deepEqual(events, [{ type: 'interaction-adjustments-updated' }]);
    assert.equal(modelCalls, 0);
    assert.equal(store.withdrawInteractionAdjustment(adjustment.id), true);
    assert.equal(
      agent.updateInteractionAdjustment({
        id: adjustment.id,
        scope: 'conversation',
        situation: '已撤回',
        behavior: '不可再编辑',
      }),
      null,
    );
    assert.equal(events.length, 1);
    assert.equal(modelCalls, 0);
  } finally {
    await agent.shutdown();
    store.close();
  }
});

test('RootAgent rejects unsolicited tool calls when its action tools are disabled', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('free-router');
  let advertisedTools;
  let workerStarts = 0;
  const agent = new RootAgent({
    store,
    provider: {
      listModels: async () => [
        { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
      ],
      async *streamChat(input) {
        advertisedTools = input.tools;
        input.onToolCalls([
          {
            id: 'unadvertised-delegate',
            type: 'function',
            function: {
              name: 'delegate_task',
              arguments: JSON.stringify({
                task: 'This must not start.',
                verificationChecks: [],
              }),
            },
          },
        ]);
        yield '这条测试回复不应被验收。';
      },
    },
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask() {
        workerStarts += 1;
        throw new Error('Unadvertised tools must not run.');
      },
    },
    allowRootActions: false,
    allowHistorySearch: false,
  });

  try {
    const { turnId } = agent.sendMessage({ text: 'Root-only smoke input.' });
    await agent.active.done;
    assert.deepEqual(advertisedTools, []);
    assert.equal(store.getTurn(turnId).status, 'failed');
    assert.equal(store.getTurn(turnId).errorCode, 'root_tool_call_invalid');
    assert.equal(store.getBackgroundTasks().length, 0);
    assert.equal(store.getInteractionAdjustments().length, 0);
    assert.equal(workerStarts, 0);
  } finally {
    await agent.shutdown();
    store.close();
  }
});

test('preserves a failed user message and retries it without duplicating the user turn', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('retired-model');
  const provider = {
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    ],
    async *streamChat() {
      yield '可用免费模型回复';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
  });
  const { turnId } = agent.sendMessage({ text: '这条消息不能丢' });
  await agent.active.done;
  assert.equal(store.getTurn(turnId).status, 'failed');

  agent.retryTurn({ turnId, model: 'free-router' });
  await agent.active.done;
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.messages.filter((message) => message.role === 'user').length,
    1,
  );
  assert.equal(snapshot.messages.at(-1).content, '可用免费模型回复');
  assert.equal(store.getTurn(turnId).status, 'completed');
  store.close();
});

test('stopping a response records an interruption and preserves partial text', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('free-router');
  const provider = {
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    ],
    async *streamChat({ signal }) {
      yield '先保存这一段';
      await new Promise((resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          {
            once: true,
          },
        );
      });
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
  });
  const { turnId } = agent.sendMessage({ text: '停止这条回复' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await agent.stopTurn(turnId), true);
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.messages[1].status, 'interrupted');
  assert.equal(snapshot.messages[1].content, '先保存这一段');
  store.close();
});

test('preserves a user turn on free-provider rate limits without changing routes', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('nvidia/nemotron-3-super-120b-a12b:free');
  let requestedModel;
  const provider = {
    listModels: async () => [
      {
        name: 'nvidia/nemotron-3-super-120b-a12b:free',
        label: 'Nemotron 3 Super 120B · 免费',
      },
    ],
    async *streamChat({ model }) {
      requestedModel = model;
      yield await Promise.reject(
        new ModelProviderError(
          'rate_limited',
          'FreeLLMAPI 免费模型额度暂时受限。稍后重试。',
          429,
        ),
      );
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
  });
  agent.sendMessage({ text: '这条消息要在限流后保留' });
  await agent.active.done;

  const snapshot = store.getSnapshot();
  assert.equal(requestedModel, 'nvidia/nemotron-3-super-120b-a12b:free');
  assert.equal(
    snapshot.messages.filter((message) => message.role === 'user').length,
    1,
  );
  assert.equal(snapshot.messages[0].content, '这条消息要在限流后保留');
  assert.equal(snapshot.messages.at(-1).turnStatus, 'failed');
  assert.equal(
    snapshot.messages.at(-1).errorMessage,
    'FreeLLMAPI 免费模型额度暂时受限。稍后重试。',
  );
  store.close();
});

test('retries one committed FreeLLMAPI provider error without losing the user turn', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('auto:noema-free');
  const requestedModels = [];
  const routedVia = [];
  const events = [];
  let calls = 0;
  const agent = new RootAgent({
    store,
    provider: {
      listModels: async () => [
        { name: 'auto:noema-free', label: 'Noema 免费模型链' },
      ],
      async *streamChat(input) {
        calls += 1;
        requestedModels.push(input.model);
        const route = `custom/test-route-${calls}`;
        routedVia.push(route);
        input.onRouteMetadata(route);
        if (calls === 1) {
          yield '上一次只返回了部分内容。';
          throw new ModelProviderError(
            'provider_error',
            'FreeLLMAPI 流式响应中途失败。',
          );
        }
        yield '重试后完整返回。';
      },
    },
    secretStore: createSecretStore(),
    emit: (event) => events.push(event),
  });

  const { turnId } = agent.sendMessage({ text: '继续回答这个问题。' });
  await agent.active.done;

  const assistantMessages = store
    .getSnapshot()
    .messages.filter(
      (message) => message.turnId === turnId && message.role === 'assistant',
    );
  assert.equal(calls, 2);
  assert.deepEqual(requestedModels, ['auto:noema-free', 'auto:noema-free']);
  assert.deepEqual(routedVia, ['custom/test-route-1', 'custom/test-route-2']);
  assert.deepEqual(
    assistantMessages.map((message) => [
      message.attempt,
      message.status,
      message.content,
    ]),
    [
      [1, 'failed', '上一次只返回了部分内容。'],
      [2, 'complete', '重试后完整返回。'],
    ],
  );
  assert.equal(store.getTurn(turnId).status, 'completed');
  assert.equal(store.getTurn(turnId).attempt, 2);
  assert.deepEqual(
    events
      .filter((event) => event.type === 'turn-started')
      .map((event) => event.attempt),
    [1, 2],
  );
  store.close();
});

test('retries one pre-response FreeLLMAPI provider_unavailable on the same selected chain', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('auto:noema-free');
  const requestedModels = [];
  let calls = 0;
  const agent = new RootAgent({
    store,
    provider: {
      listModels: async () => [
        { name: 'auto:noema-free', label: 'Noema 免费模型链' },
      ],
      async *streamChat(input) {
        calls += 1;
        requestedModels.push(input.model);
        if (calls === 1) {
          throw new ModelProviderError(
            'provider_unavailable',
            'FreeLLMAPI 上游暂时不可用。',
            503,
          );
        }
        yield '第二次请求完成。';
      },
    },
    secretStore: createSecretStore(),
  });

  const { turnId } = agent.sendMessage({ text: '测试无输出的上游故障恢复。' });
  await agent.active.done;

  const assistantMessages = store
    .getSnapshot()
    .messages.filter(
      (message) => message.turnId === turnId && message.role === 'assistant',
    );
  assert.equal(calls, 2);
  assert.deepEqual(requestedModels, ['auto:noema-free', 'auto:noema-free']);
  assert.deepEqual(
    assistantMessages.map((message) => [
      message.attempt,
      message.status,
      message.content,
    ]),
    [
      [1, 'failed', ''],
      [2, 'complete', '第二次请求完成。'],
    ],
  );
  assert.equal(
    store
      .getSnapshot()
      .messages.filter(
        (message) => message.turnId === turnId && message.role === 'user',
      ).length,
    1,
  );
  assert.equal(store.getTurn(turnId).attempt, 2);
  store.close();
});

test('does not retry provider_unavailable after text was already streamed', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('auto:noema-free');
  let calls = 0;
  const agent = new RootAgent({
    store,
    provider: {
      listModels: async () => [
        { name: 'auto:noema-free', label: 'Noema 免费模型链' },
      ],
      async *streamChat() {
        calls += 1;
        yield '已提交的部分文本。';
        throw new ModelProviderError(
          'provider_unavailable',
          '此状态不应重放已发出的文本。',
          503,
        );
      },
    },
    secretStore: createSecretStore(),
  });

  const { turnId } = agent.sendMessage({ text: '不要重复已经输出的内容。' });
  await agent.active.done;

  const assistant = store
    .getSnapshot()
    .messages.find(
      (message) => message.turnId === turnId && message.role === 'assistant',
    );
  assert.equal(calls, 1);
  assert.equal(assistant.content, '已提交的部分文本。');
  assert.equal(store.getTurn(turnId).attempt, 1);
  assert.equal(store.getTurn(turnId).status, 'failed');
  store.close();
});

test('stops after one automatic root retry when the stream fails twice', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('auto:noema-free');
  let calls = 0;
  const agent = new RootAgent({
    store,
    provider: {
      listModels: async () => [
        { name: 'auto:noema-free', label: 'Noema 免费模型链' },
      ],
      async *streamChat() {
        calls += 1;
        yield `第 ${calls} 次的未完成片段。`;
        throw new ModelProviderError(
          'provider_error',
          'FreeLLMAPI 流式响应中途失败。',
        );
      },
    },
    secretStore: createSecretStore(),
  });

  const { turnId } = agent.sendMessage({
    text: '回答一次即可，不要无限重试。',
  });
  await agent.active.done;

  const attempts = store
    .getSnapshot()
    .messages.filter(
      (message) => message.turnId === turnId && message.role === 'assistant',
    );
  assert.equal(calls, 2);
  assert.equal(store.getTurn(turnId).status, 'failed');
  assert.equal(store.getTurn(turnId).attempt, 2);
  assert.deepEqual(
    attempts.map((message) => [message.attempt, message.status]),
    [
      [1, 'failed'],
      [2, 'failed'],
    ],
  );
  store.close();
});

test('stores FreeLLMAPI connection status without exposing the API key', async () => {
  const store = new RootStore(':memory:');
  const secretStore = createSecretStore(false);
  const provider = {
    baseUrl: 'http://127.0.0.1:3001/v1',
    setBaseUrl(value) {
      this.baseUrl = value;
    },
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    ],
  };
  const agent = new RootAgent({ store, provider, secretStore });
  const state = await agent.configureProvider({
    baseUrl: 'http://127.0.0.1:31415',
    apiKey: 'sensitive-test-key',
  });
  assert.equal(secretStore.get(), 'sensitive-test-key');
  assert.equal(secretStore.baseUrl, 'http://127.0.0.1:31415/v1');
  assert.equal(state.connected, true);
  assert.equal(state.providerConfigured, true);
  assert.equal(state.providerBaseUrl, 'http://127.0.0.1:31415/v1');
  assert.equal(
    JSON.stringify(await agent.getUiState()).includes('sensitive-test-key'),
    false,
  );
  store.close();
});

test('dispatches one DSH worker on the explicit free chain and returns its result as a system event', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-worker-root-'));
  store.setSelectedModel('auto:noema-free');
  store.setWorkspaceDirectory(workspace);
  let finishWorker;
  const workerDone = new Promise((resolve) => {
    finishWorker = resolve;
  });
  const workerInput = {};
  const modelCalls = [];
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'auto:noema-free', label: 'Noema 免费模型链' },
    ],
    async *streamChat(input) {
      modelCalls.push(input);
      if (input.tools?.length) {
        assert.ok(
          input.tools.some(
            (tool) => tool.function.name === 'record_interaction_adjustment',
          ),
        );
        input.onToolCalls([
          {
            id: 'call-adjustment',
            type: 'function',
            function: {
              name: 'record_interaction_adjustment',
              arguments: JSON.stringify({
                sourceQuote: '编码任务中，除非必须由我决定，否则请继续到交付。',
                scope: 'coding',
                situation: '长期编码任务的阶段性进度汇报',
                behavior: '若没有用户决策或真实阻塞，就继续推进到验收完成。',
              }),
            },
          },
          {
            id: 'call-delegate',
            type: 'function',
            function: {
              name: 'delegate_task',
              arguments: JSON.stringify({
                task: '读取 README 并修正其中的安装说明。',
              }),
            },
          },
        ]);
        return;
      }
      assert.ok(
        input.messages.some(
          (message) =>
            message.role === 'system' &&
            message.content.includes('background_task_result'),
        ),
      );
      assert.equal(
        input.messages.some(
          (message) =>
            message.role === 'user' && message.content.includes('后台任务事件'),
        ),
        false,
      );
      yield '后台任务结果已接回。';
    },
  };
  const dshAdapter = {
    async startTask(input) {
      Object.assign(workerInput, input);
      input.onEvent({ type: 'tool-call', count: 1, tool: 'glob' });
      input.onEvent({
        type: 'tool-call',
        count: 2,
        tool: 'write',
        input: { path: 'D:\\Private\\secret.md', content: 'not retained' },
      });
      input.onEvent({
        type: 'tool-call',
        count: 3,
        tool: 'custom/secret/path',
      });
      return {
        started: Promise.resolve({ sessionId: 'session-worker-test' }),
        done: workerDone,
        stop: () => true,
      };
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
    dshAdapter,
  });
  try {
    const { turnId } = agent.sendMessage({
      text: '编码任务中，除非必须由我决定，否则请继续到交付。请在当前工作区修改 README 的安装说明。',
    });
    await agent.active.done;
    const dispatched = store.getBackgroundTasks()[0];
    const codingAdjustmentId = store.getInteractionAdjustments()[0].id;
    assert.equal(dispatched.status, 'running', JSON.stringify(dispatched));
    assert.deepEqual(dispatched.interactionAdjustmentIds, [codingAdjustmentId]);
    assert.equal(dispatched.model, 'auto:noema-free');
    assert.equal(workerInput.workspacePath, workspace);
    assert.equal(workerInput.model, 'auto:noema-free');
    assert.match(workerInput.task, /长期编码任务的阶段性进度汇报/);
    assert.match(workerInput.task, /继续推进到验收完成/);
    assert.match(workerInput.task, /读取 README 并修正其中的安装说明/);
    assert.equal(modelCalls.length, 1);
    assert.match(
      store.getSnapshot().messages.at(-1).content,
      /交给后台 DSH agent/,
    );

    finishWorker({
      status: 'completed',
      sessionId: 'session-worker-test',
      result: 'README 安装说明已修正。',
      errorCode: null,
      errorMessage: null,
      toolCallCount: 3,
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (store.getBackgroundTask(dispatched.id).eventStatus === 'delivered')
        break;
    }

    const returned = store.getBackgroundTask(dispatched.id);
    assert.equal(returned.status, 'completed');
    assert.equal(returned.eventStatus, 'delivered');
    assert.equal(returned.resultText, 'README 安装说明已修正。');
    assert.equal(returned.noemaResponse, '后台任务结果已接回。');
    assert.deepEqual(returned.toolActionCategories, ['list', 'write', 'other']);
    assert.equal(returned.toolActionsTruncated, false);
    assert.equal(
      JSON.stringify(returned).includes('D:\\Private\\secret.md'),
      false,
    );
    assert.equal(modelCalls.length, 2);
    assert.equal(
      store.getSnapshot().messages.filter((message) => message.role === 'user')
        .length,
      1,
    );
    assert.equal(store.getTurn(turnId).status, 'completed');
    assert.equal(agent.clearWorkspaceDirectory(), null);
    assert.equal(store.getWorkspaceDirectory(), null);
  } finally {
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('a root request cannot start a second DSH task when its failed turn is retried', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(
    path.join(tmpdir(), 'noema-idempotent-delegate-'),
  );
  store.setWorkspaceDirectory(workspace);
  const turn = store.beginTurn({
    text: '请把这一项交给后台处理。',
    model: 'test-model',
  });
  let workerStarts = 0;
  let finishWorker;
  const workerDone = new Promise((resolve) => {
    finishWorker = resolve;
  });
  const agent = new RootAgent({
    store,
    provider: {
      listModels: async () => [{ name: 'test-model', label: 'Test' }],
      async *streamChat() {
        yield '事件已整理。';
      },
    },
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask() {
        workerStarts += 1;
        return {
          started: Promise.resolve({ sessionId: 'idempotent-session' }),
          done: workerDone,
          stop: () => true,
        };
      },
    },
  });
  try {
    const first = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '执行一次会修改工作区的任务。',
      workspacePath: workspace,
    });
    assert.equal(first.accepted, true);
    assert.equal(workerStarts, 1);

    const duplicate = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '重试同一用户请求。',
      workspacePath: workspace,
    });
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.existingTask.id, first.taskId);
    assert.equal(duplicate.existingTask.status, 'running');
    assert.equal(workerStarts, 1);

    finishWorker({
      status: 'completed',
      sessionId: 'idempotent-session',
      result: '原任务已完成。',
      errorCode: null,
      errorMessage: null,
      toolCallCount: 0,
    });
    await first.completion;

    const retryAfterCompletion = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '再次重试同一用户请求。',
      workspacePath: workspace,
    });
    assert.equal(retryAfterCompletion.accepted, false);
    assert.equal(retryAfterCompletion.existingTask.id, first.taskId);
    assert.equal(retryAfterCompletion.existingTask.status, 'completed');
    assert.equal(workerStarts, 1);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('retrying a failed root turn reports the completed task instead of redispatching it', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('test-model');
  const workspace = mkdtempSync(
    path.join(tmpdir(), 'noema-root-retry-completed-task-'),
  );
  store.setWorkspaceDirectory(workspace);
  let providerCalls = 0;
  let workerStarts = 0;
  let finishWorker;
  let workerFinished = false;
  let turnId;
  const workerDone = new Promise((resolve) => {
    finishWorker = resolve;
  });
  const agent = new RootAgent({
    store,
    provider: {
      listModels: async () => [{ name: 'test-model', label: 'Test' }],
      async *streamChat(input) {
        providerCalls += 1;
        if ([1, 3].includes(providerCalls)) {
          input.onToolCalls([
            {
              id: `delegate-${providerCalls}`,
              type: 'function',
              function: {
                name: 'delegate_task',
                arguments: JSON.stringify({
                  task: '整理一份本周 AI 新闻简报。',
                }),
              },
            },
            ...(providerCalls === 1
              ? [
                  {
                    id: 'search-before-failure',
                    type: 'function',
                    function: {
                      name: 'search_web',
                      arguments: JSON.stringify({ query: '本周 AI 新闻' }),
                    },
                  },
                ]
              : []),
          ]);
        } else {
          yield '';
        }
      },
    },
    secretStore: createSecretStore(),
    webSearchSecretStore: createSecretStore(),
    searchWebImpl: async () => ({ results: [] }),
    dshAdapter: {
      async startTask() {
        workerStarts += 1;
        return {
          started: Promise.resolve({ sessionId: 'root-retry-session' }),
          done: workerDone,
          stop: () => true,
        };
      },
    },
  });
  agent.processPendingWorkerEvent = async () => {};

  try {
    ({ turnId } = agent.sendMessage({
      text: '请搜索本周 AI 新闻，并交给后台整理。',
    }));
    await agent.active.done;
    assert.equal(store.getTurn(turnId).status, 'failed');
    const [originalTask] = store.getBackgroundTasks();
    assert.equal(originalTask.status, 'running');
    assert.equal(workerStarts, 1);

    workerFinished = true;
    finishWorker({
      status: 'completed',
      sessionId: 'root-retry-session',
      result: '本周 AI 新闻简报已整理。',
      errorCode: null,
      errorMessage: null,
      toolCallCount: 0,
    });
    await new Promise((resolve, reject) => {
      let attempts = 0;
      const waitForCompletion = () => {
        if (store.getBackgroundTask(originalTask.id).status === 'completed') {
          resolve();
        } else if (++attempts >= 100) {
          reject(new Error('后台任务未在测试期限内完成。'));
        } else {
          setTimeout(waitForCompletion, 5);
        }
      };
      waitForCompletion();
    });

    agent.retryTurn({ turnId, model: 'test-model' });
    await agent.active.done;
    assert.equal(store.getTurn(turnId).status, 'completed');
    assert.equal(workerStarts, 1);
    assert.equal(store.getBackgroundTasks().length, 1);
    const retryMessage = store
      .getSnapshot()
      .messages.find(
        (message) =>
          message.turnId === turnId &&
          message.role === 'assistant' &&
          message.attempt === 2,
      );
    assert.equal(providerCalls, 3);
    assert.match(retryMessage.content, /后台任务（已完成）/u);
    assert.match(retryMessage.content, /没有再次启动/u);
  } finally {
    if (!workerFinished) {
      finishWorker({
        status: 'interrupted',
        sessionId: 'root-retry-session',
        result: '',
        errorCode: 'test_cleanup',
        errorMessage: 'test cleanup',
        toolCallCount: 0,
      });
    }
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('new DSH tasks carry the user-edited adjustment snapshot as the active version', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(
    path.join(tmpdir(), 'noema-edited-adjustment-'),
  );
  const correction = store.beginTurn({
    text: '这类任务里，先确认依赖，再开始修改。',
    model: 'auto:noema-free',
  });
  const adjustment = store.addInteractionAdjustment({
    id: 'adjustment-user-edited',
    sourceTurnId: correction.id,
    scope: 'coding',
    situation: '开始代码任务前',
    behavior: '先解释完整计划，然后等待确认。',
    sourceQuote: '先确认依赖',
  });
  store.updateInteractionAdjustment({
    id: adjustment.id,
    scope: 'coding',
    situation: '重大或不可逆的代码任务开始前',
    behavior: '说明关键依赖；普通改动直接执行并自行验证。',
  });
  const sourceTurn = store.getTurn(correction.id);
  store.appendAssistant({
    id: correction.id,
    attempt: 1,
    content: '明白，我会区分重大决策和普通改动。',
  });
  store.completeTurn(correction.id, 1);

  let workerInput;
  const agent = new RootAgent({
    store,
    provider: { listModels: async () => [], async *streamChat() {} },
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask(input) {
        workerInput = input;
        return {
          started: Promise.resolve({ sessionId: 'session-edited-adjustment' }),
          done: Promise.resolve({
            status: 'completed',
            sessionId: 'session-edited-adjustment',
            result: '合成任务结束。',
            errorCode: null,
            errorMessage: null,
            toolCallCount: 0,
          }),
          stop: () => true,
        };
      },
    },
  });

  try {
    const dispatch = await agent.startBackgroundTask({
      sourceTurnId: sourceTurn.id,
      prompt: '请检查这个合成代码任务。',
      workspacePath: workspace,
    });
    assert.equal(dispatch.accepted, true);
    await dispatch.completion;
    const task = store.getBackgroundTask(dispatch.taskId);
    assert.equal(task.interactionAdjustmentSnapshots.length, 1);
    assert.equal(task.interactionAdjustmentSnapshots[0].userEdited, true);
    assert.equal(
      task.interactionAdjustmentSnapshots[0].behavior,
      '说明关键依赖；普通改动直接执行并自行验证。',
    );
    assert.match(workerInput.task, /用户已直接修订/);
    assert.match(workerInput.task, /普通改动直接执行并自行验证/);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('independently verifies worker files and gives one bounded repair before acceptance', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-worker-verify-'));
  const turn = store.beginTurn({ text: '创建 README。', model: 'free-router' });
  store.appendAssistant({
    id: turn.id,
    attempt: turn.attempt,
    content: '正在处理。',
  });
  store.completeTurn(turn.id, turn.attempt);
  store.setSelectedModel('free-router');

  const dshInputs = [];
  const modelMessages = [];
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [{ name: 'free-router', label: '免费路由' }],
    async *streamChat(input) {
      modelMessages.push(input.messages);
      yield 'Noema 已核验文件并接回结果。';
    },
  };
  const dshAdapter = {
    async startTask(input) {
      dshInputs.push(input);
      return {
        started: Promise.resolve({ sessionId: 'session-verify-test' }),
        done: Promise.resolve().then(() => {
          if (dshInputs.length === 2) {
            writeFileSync(path.join(workspace, 'README.md'), 'expected body');
          }
          return {
            status: 'completed',
            sessionId: 'session-verify-test',
            result:
              dshInputs.length === 1 ? 'README 已创建。' : '缺失内容已补齐。',
            toolCallCount: 1,
          };
        }),
        stop: () => true,
      };
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
    dshAdapter,
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '在工作区创建 README.md。',
      workspacePath: workspace,
      verificationChecks: [
        { kind: 'file_contains', path: 'README.md', text: 'expected body' },
      ],
    });
    assert.equal(started.accepted, true);
    await started.completion;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (store.getBackgroundTask(started.taskId).eventStatus === 'delivered')
        break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const task = store.getBackgroundTask(started.taskId);
    assert.equal(task.status, 'completed');
    assert.equal(task.model, 'free-router');
    assert.equal(task.verificationStatus, 'verified');
    assert.equal(task.verificationAttempts, 1);
    assert.equal(task.verificationResults[0].status, 'verified');
    assert.equal(dshInputs.length, 2);
    assert.equal(dshInputs[0].model, 'free-router');
    assert.equal(dshInputs[1].model, 'free-router');
    assert.equal(dshInputs[1].sessionId, 'session-verify-test');
    assert.match(dshInputs[1].task, /工作区内做了独立文件核验/);
    assert.equal(task.toolCallCount, 2);
    assert.equal(task.eventStatus, 'delivered');
    assert.equal(modelMessages.length, 1);
    assert.match(task.noemaResponse, /Noema 已核验文件/);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('continues through bounded provider cooldowns in the same DSH session until verification passes', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(
    path.join(tmpdir(), 'noema-rate-limit-resume-'),
  );
  const turn = store.beginTurn({
    text: '完成这个小型多文件功能。',
    model: 'free-router',
  });
  store.appendAssistant({
    id: turn.id,
    attempt: turn.attempt,
    content: '已派发。',
  });
  store.completeTurn(turn.id, turn.attempt);
  store.setSelectedModel('free-router');

  const dshInputs = [];
  const delays = [];
  const dshAdapter = {
    async startTask(input) {
      dshInputs.push(input);
      if (dshInputs.length === 1) {
        mkdirSync(path.join(workspace, 'src'), { recursive: true });
        writeFileSync(path.join(workspace, 'src', 'slug.mjs'), '// partial');
        return {
          started: Promise.resolve({ sessionId: 'session-rate-limit' }),
          done: Promise.resolve({
            status: 'failed',
            sessionId: 'session-rate-limit',
            result: '',
            errorCode: 'dsh_rate_limited',
            errorMessage: 'DSH 免费模型池限流；最早约 2 秒后可续做。',
            retryAfterSeconds: 2,
            toolCallCount: 2,
          }),
          stop: () => true,
        };
      }

      assert.equal(input.sessionId, 'session-rate-limit');
      assert.match(input.task, /Noema.*核验/);
      if (dshInputs.length === 2) {
        return {
          started: Promise.resolve({ sessionId: 'session-rate-limit' }),
          done: Promise.resolve({
            status: 'failed',
            sessionId: 'session-rate-limit',
            result: '',
            errorCode: 'dsh_rate_limited',
            errorMessage: 'DSH 免费模型池限流；最早约 2 秒后可续做。',
            retryAfterSeconds: 2,
            toolCallCount: 1,
          }),
          stop: () => true,
        };
      }
      mkdirSync(path.join(workspace, 'test'), { recursive: true });
      writeFileSync(
        path.join(workspace, 'src', 'slug.mjs'),
        '// NOEMA-E2E-MARKER',
      );
      writeFileSync(
        path.join(workspace, 'test', 'slug.test.mjs'),
        '// NOEMA-E2E-MARKER',
      );
      writeFileSync(path.join(workspace, 'README.md'), '// NOEMA-E2E-MARKER');
      return {
        started: Promise.resolve({ sessionId: 'session-rate-limit' }),
        done: Promise.resolve({
          status: 'completed',
          sessionId: 'session-rate-limit',
          result: '缺失文件已补齐。',
          errorCode: null,
          errorMessage: null,
          toolCallCount: 3,
        }),
        stop: () => true,
      };
    },
  };
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'free-router', label: '免费路由' }],
      async *streamChat() {
        yield '任务已续做并完成文件验收。';
      },
    },
    secretStore: createSecretStore(),
    dshAdapter,
    delayImpl: async (milliseconds, signal) => {
      delays.push(milliseconds);
      return !signal.aborted;
    },
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '创建 src/slug.mjs、test/slug.test.mjs 和 README.md。',
      workspacePath: workspace,
      verificationChecks: [
        {
          kind: 'file_contains',
          path: 'src/slug.mjs',
          text: 'NOEMA-E2E-MARKER',
        },
        {
          kind: 'file_contains',
          path: 'test/slug.test.mjs',
          text: 'NOEMA-E2E-MARKER',
        },
        { kind: 'file_contains', path: 'README.md', text: 'NOEMA-E2E-MARKER' },
      ],
    });
    assert.equal(started.accepted, true);
    await started.completion;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (store.getBackgroundTask(started.taskId).eventStatus === 'delivered')
        break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const task = store.getBackgroundTask(started.taskId);
    assert.deepEqual(delays, [3_000, 3_000]);
    assert.equal(dshInputs.length, 3);
    assert.equal(dshInputs[0].sessionId, null);
    assert.equal(dshInputs[1].sessionId, 'session-rate-limit');
    assert.equal(dshInputs[2].sessionId, 'session-rate-limit');
    assert.equal(task.status, 'completed');
    assert.equal(task.verificationStatus, 'verified');
    assert.equal(task.verificationAttempts, 2);
    assert.equal(task.toolCallCount, 6);
    assert.equal(task.eventStatus, 'delivered');
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('continues a failed DSH session when file checks pass but the worker lacks a final result', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(
    path.join(tmpdir(), 'noema-rate-limit-finalize-'),
  );
  const turn = store.beginTurn({
    text: '完成 README 并报告最终结果。',
    model: 'free-router',
  });
  store.appendAssistant({
    id: turn.id,
    attempt: turn.attempt,
    content: '已派发。',
  });
  store.completeTurn(turn.id, turn.attempt);
  store.setSelectedModel('free-router');
  const dshInputs = [];
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'free-router', label: '免费路由' }],
      async *streamChat() {
        yield '后台任务最终状态已接回。';
      },
    },
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask(input) {
        dshInputs.push(input);
        if (dshInputs.length === 1) {
          writeFileSync(path.join(workspace, 'README.md'), 'expected marker');
          return {
            started: Promise.resolve({ sessionId: 'session-finalize' }),
            done: Promise.resolve({
              status: 'failed',
              sessionId: 'session-finalize',
              result: '',
              errorCode: 'dsh_process_failed',
              errorMessage: 'DSH 进程异常结束。',
              toolCallCount: 1,
            }),
            stop: () => true,
          };
        }
        return {
          started: Promise.resolve({ sessionId: 'session-finalize' }),
          done: Promise.resolve({
            status: 'completed',
            sessionId: 'session-finalize',
            result: 'README 已核对，任务完成。',
            errorCode: null,
            errorMessage: null,
            toolCallCount: 1,
          }),
          stop: () => true,
        };
      },
    },
    delayImpl: async () => true,
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '在工作区创建 README.md，内容包含 expected marker。',
      workspacePath: workspace,
      verificationChecks: [
        { kind: 'file_contains', path: 'README.md', text: 'expected marker' },
      ],
    });
    await started.completion;

    const task = store.getBackgroundTask(started.taskId);
    assert.equal(dshInputs.length, 2);
    assert.equal(dshInputs[1].sessionId, 'session-finalize');
    assert.match(dshInputs[1].task, /文件验收条件目前全部通过/);
    assert.match(dshInputs[1].task, /不要重放已完成的操作/);
    assert.equal(task.status, 'completed');
    assert.equal(task.verificationStatus, 'verified');
    assert.equal(task.verificationAttempts, 1);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('does not automatically restart a DSH tool loop without rejected write-argument evidence', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-tool-loop-stop-'));
  const turn = store.beginTurn({ text: '创建 README。', model: 'free-router' });
  store.appendAssistant({
    id: turn.id,
    attempt: turn.attempt,
    content: '已派发。',
  });
  store.completeTurn(turn.id, turn.attempt);
  store.setSelectedModel('free-router');
  let startCalls = 0;
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'free-router', label: '免费路由' }],
      async *streamChat() {
        yield '循环任务已停止。';
      },
    },
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask() {
        startCalls += 1;
        return {
          started: Promise.resolve({ sessionId: 'session-tool-loop' }),
          done: Promise.resolve({
            status: 'failed',
            sessionId: 'session-tool-loop',
            result: '',
            errorCode: 'dsh_tool_loop',
            errorMessage:
              '后台 agent 重复执行相同工具操作，Noema 已停止该任务。',
            toolCallCount: 3,
            workspaceMutationStatus: 'unknown',
          }),
          stop: () => true,
        };
      },
    },
    delayImpl: async () => {
      throw new Error('A stopped tool loop must not be retried.');
    },
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '在工作区创建 README.md。',
      workspacePath: workspace,
      verificationChecks: [{ kind: 'file_exists', path: 'README.md' }],
    });
    await started.completion;
    const task = store.getBackgroundTask(started.taskId);
    assert.equal(startCalls, 1);
    assert.equal(task.status, 'failed');
    assert.equal(task.errorCode, 'dsh_tool_loop');
    assert.equal(task.verificationAttempts, 0);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('continues once after a DSH write loop is proven to contain only rejected arguments', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(
    path.join(tmpdir(), 'noema-invalid-args-repair-'),
  );
  const turn = store.beginTurn({ text: '创建 README。', model: 'free-router' });
  store.appendAssistant({
    id: turn.id,
    attempt: turn.attempt,
    content: '已派发。',
  });
  store.completeTurn(turn.id, turn.attempt);
  store.setSelectedModel('free-router');
  let startCalls = 0;
  const sessionId = 'session-invalid-args-repair';
  const marker = 'requested-readme-content';
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'free-router', label: '测试路由' }],
      async *streamChat() {
        yield '验收通过。';
      },
    },
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask(input) {
        startCalls += 1;
        if (startCalls === 1) {
          return {
            started: Promise.resolve({ sessionId }),
            done: Promise.resolve({
              status: 'failed',
              sessionId,
              result: '',
              errorCode: 'dsh_tool_loop',
              errorMessage:
                '后台 agent 重复执行相同工具操作，Noema 已停止该任务。',
              toolCallCount: 3,
              workspaceMutationStatus: 'invalid_args_only',
            }),
            stop: () => true,
          };
        }
        assert.equal(input.sessionId, sessionId);
        assert.match(input.task, /参数类型/);
        assert.match(input.task, /JSON true\/false/);
        writeFileSync(path.join(workspace, 'README.md'), marker, 'utf8');
        return {
          started: Promise.resolve({ sessionId }),
          done: Promise.resolve({
            status: 'completed',
            sessionId,
            result: 'README 已创建并读取核对。',
            toolCallCount: 2,
          }),
          stop: () => true,
        };
      },
    },
    delayImpl: async () => true,
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '创建 README.md，写入指定内容。',
      workspacePath: workspace,
      verificationChecks: [
        { kind: 'file_contains', path: 'README.md', text: marker },
      ],
    });
    await started.completion;

    const task = store.getBackgroundTask(started.taskId);
    assert.equal(startCalls, 2);
    assert.equal(task.status, 'completed');
    assert.equal(task.verificationStatus, 'verified');
    assert.equal(task.verificationAttempts, 1);
    assert.equal(task.sessionId, sessionId);
    assert.equal(task.toolCallCount, 5);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('does not automatically retry a tool loop after any file mutation succeeded', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(
    path.join(tmpdir(), 'noema-mutated-tool-loop-'),
  );
  const turn = store.beginTurn({ text: '检查 README。', model: 'free-router' });
  store.appendAssistant({
    id: turn.id,
    attempt: turn.attempt,
    content: '已派发。',
  });
  store.completeTurn(turn.id, turn.attempt);
  store.setSelectedModel('free-router');
  let startCalls = 0;
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'free-router', label: '测试路由' }],
      async *streamChat() {
        yield '未完成。';
      },
    },
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask() {
        startCalls += 1;
        return {
          started: Promise.resolve({ sessionId: 'session-mutated-loop' }),
          done: Promise.resolve({
            status: 'failed',
            sessionId: 'session-mutated-loop',
            result: '',
            errorCode: 'dsh_tool_loop',
            errorMessage: 'DSH stopped a repeated file operation.',
            toolCallCount: 3,
            workspaceMutationStatus: 'mutation_succeeded',
          }),
          stop: () => true,
        };
      },
    },
    delayImpl: async () => {
      throw new Error('A successful file mutation must not be replayed.');
    },
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '修改 README。',
      workspacePath: workspace,
      verificationChecks: [{ kind: 'file_exists', path: 'README.md' }],
    });
    await started.completion;
    const task = store.getBackgroundTask(started.taskId);
    assert.equal(startCalls, 1);
    assert.equal(task.status, 'failed');
    assert.equal(task.errorCode, 'dsh_tool_loop');
    assert.equal(task.verificationAttempts, 0);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('a user stop cancels the cooldown wait without starting the automatic continuation', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-rate-limit-stop-'));
  const turn = store.beginTurn({
    text: '完成指定文件。',
    model: 'free-router',
  });
  store.appendAssistant({
    id: turn.id,
    attempt: turn.attempt,
    content: '已派发。',
  });
  store.completeTurn(turn.id, turn.attempt);
  store.setSelectedModel('free-router');

  let startCalls = 0;
  let signalRetryWait;
  let notifyRetryWait;
  const retryWaitEntered = new Promise((resolve) => {
    notifyRetryWait = resolve;
  });
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'free-router', label: '免费路由' }],
      async *streamChat() {
        yield '任务已停止。';
      },
    },
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask() {
        startCalls += 1;
        return {
          started: Promise.resolve({ sessionId: 'session-stop-test' }),
          done: Promise.resolve({
            status: 'failed',
            sessionId: 'session-stop-test',
            result: '',
            errorCode: 'dsh_rate_limited',
            errorMessage: 'DSH 免费模型池限流；最早约 2 秒后可续做。',
            retryAfterSeconds: 2,
            toolCallCount: 1,
          }),
          stop: () => true,
        };
      },
    },
    delayImpl: (_milliseconds, signal) => {
      signalRetryWait = signal;
      notifyRetryWait();
      return new Promise((resolve) => {
        if (signal.aborted) resolve(false);
        else
          signal.addEventListener('abort', () => resolve(false), {
            once: true,
          });
      });
    },
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '创建 README.md。',
      workspacePath: workspace,
      verificationChecks: [
        { kind: 'file_contains', path: 'README.md', text: 'expected marker' },
      ],
    });
    await retryWaitEntered;
    assert.equal(signalRetryWait.aborted, false);
    assert.equal(agent.stopBackgroundTask(started.taskId), true);
    await started.completion;

    const task = store.getBackgroundTask(started.taskId);
    assert.equal(startCalls, 1);
    assert.equal(task.status, 'interrupted');
    assert.equal(task.verificationStatus, 'failed');
    assert.equal(signalRetryWait.aborted, true);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('stops after three automatic follow-ups when every same-session run is still rate-limited', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(
    path.join(tmpdir(), 'noema-rate-limit-budget-'),
  );
  const turn = store.beginTurn({
    text: '创建一个 README。',
    model: 'free-router',
  });
  store.appendAssistant({
    id: turn.id,
    attempt: turn.attempt,
    content: '已派发。',
  });
  store.completeTurn(turn.id, turn.attempt);
  store.setSelectedModel('free-router');

  let startCalls = 0;
  const delays = [];
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [{ name: 'free-router', label: '免费路由' }],
      async *streamChat() {
        yield '本次续做次数已耗尽，任务仍未验收。';
      },
    },
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask({ sessionId }) {
        startCalls += 1;
        return {
          started: Promise.resolve({
            sessionId: sessionId ?? 'session-budget',
          }),
          done: Promise.resolve({
            status: 'failed',
            sessionId: sessionId ?? 'session-budget',
            result: '',
            errorCode: 'dsh_rate_limited',
            errorMessage: 'DSH 免费模型池限流；最早约 1 秒后可续做。',
            retryAfterSeconds: 1,
            toolCallCount: 0,
          }),
          stop: () => true,
        };
      },
    },
    delayImpl: async (milliseconds, signal) => {
      delays.push(milliseconds);
      return !signal.aborted;
    },
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '创建 README.md。',
      workspacePath: workspace,
      verificationChecks: [{ kind: 'file_exists', path: 'README.md' }],
    });
    await started.completion;

    const task = store.getBackgroundTask(started.taskId);
    assert.equal(startCalls, 4);
    assert.deepEqual(delays, [2_000, 2_000, 2_000]);
    assert.equal(task.status, 'failed');
    assert.equal(task.verificationAttempts, 3);
    assert.match(task.errorMessage, /自动续做 3 次/);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('does not let a worker self-report override a failed Noema file check', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-worker-reject-'));
  const turn = store.beginTurn({ text: '创建 README。', model: 'free-router' });
  store.setSelectedModel('free-router');
  let modelCalls = 0;
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [{ name: 'free-router', label: '免费路由' }],
    async *streamChat() {
      modelCalls += 1;
      yield '这条内容不应由模型生成。';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask() {
        return {
          started: Promise.resolve({ sessionId: 'session-reject-test' }),
          done: Promise.resolve({
            status: 'completed',
            sessionId: 'session-reject-test',
            result: 'README 已创建，全部完成。',
            toolCallCount: 1,
          }),
          stop: () => true,
        };
      },
    },
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '创建 README。',
      workspacePath: workspace,
      verificationChecks: [{ kind: 'file_exists', path: 'README.md' }],
    });
    assert.equal(started.accepted, true);
    await started.completion;

    const task = store.getBackgroundTask(started.taskId);
    assert.equal(task.status, 'failed');
    assert.equal(task.errorCode, 'verification_failed');
    assert.equal(task.verificationStatus, 'failed');
    assert.equal(task.verificationResults[0].reason, 'file_missing');
    assert.equal(task.noemaResponseStatus, 'complete');
    assert.match(task.noemaResponse, /本地验收没有通过/);
    assert.match(task.noemaResponse, /README\.md：文件不存在/);
    assert.equal(task.noemaResponse.includes('全部完成'), false);
    assert.equal(modelCalls, 0);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('independently checks existing artifacts after a DSH process fails', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-worker-partial-'));
  const turn = store.beginTurn({ text: '创建 README。', model: 'free-router' });
  store.setSelectedModel('free-router');
  let summaryModelCalls = 0;
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    ],
    async *streamChat() {
      summaryModelCalls += 1;
      yield 'Noema 总结不能参与不完整任务的验收。';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask() {
        return {
          started: Promise.resolve({ sessionId: 'session-partial-test' }),
          done: Promise.resolve({
            status: 'failed',
            sessionId: 'session-partial-test',
            result: '',
            errorCode: 'dsh_process_failed',
            errorMessage: 'DSH 上游在写完文件后用完本次额度。',
            toolCallCount: 2,
          }).then((outcome) => {
            writeFileSync(
              path.join(workspace, 'README.md'),
              'NOEMA-PARTIAL-MARKER\n',
            );
            return outcome;
          }),
          stop: () => true,
        };
      },
    },
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '在工作区创建 README.md。',
      workspacePath: workspace,
      verificationChecks: [
        {
          kind: 'file_contains',
          path: 'README.md',
          text: 'NOEMA-PARTIAL-MARKER',
        },
      ],
    });
    assert.equal(started.accepted, true);
    await started.completion;

    const task = store.getBackgroundTask(started.taskId);
    assert.equal(task.status, 'failed');
    assert.equal(task.errorCode, 'dsh_process_failed');
    assert.equal(task.verificationStatus, 'verified');
    assert.equal(task.verificationResults[0].status, 'verified');
    assert.equal(task.eventStatus, 'delivered');
    assert.equal(task.noemaResponseStatus, 'complete');
    assert.match(task.noemaResponse, /DSH agent 没有完整结束/);
    assert.match(task.noemaResponse, /文件条件目前都满足/);
    assert.equal(task.noemaResponse.includes('任务已经完整完成'), false);
    assert.equal(summaryModelCalls, 0);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('does not automatically retry a rejected DSH model request', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-worker-rejected-'));
  const turn = store.beginTurn({ text: '创建 README。', model: 'free-router' });
  store.setSelectedModel('free-router');
  let workerStarts = 0;
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    ],
    async *streamChat() {
      yield '模型服务拒绝了执行请求，没有自动重复调用。';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask() {
        workerStarts += 1;
        return {
          started: Promise.resolve({ sessionId: 'session-rejected-test' }),
          done: Promise.resolve({
            status: 'failed',
            sessionId: 'session-rejected-test',
            result: '',
            errorCode: 'dsh_provider_rejected',
            errorMessage: '模型服务拒绝请求（HTTP 404）；不会自动重试。',
            toolCallCount: 0,
          }),
          stop: () => true,
        };
      },
    },
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '在工作区创建 README.md。',
      workspacePath: workspace,
      verificationChecks: [
        {
          kind: 'file_contains',
          path: 'README.md',
          text: 'NOEMA-EXPECTED-CONTENT',
        },
      ],
    });
    assert.equal(started.accepted, true);
    await started.completion;

    const task = store.getBackgroundTask(started.taskId);
    assert.equal(workerStarts, 1);
    assert.equal(task.status, 'failed');
    assert.equal(task.errorCode, 'dsh_provider_rejected');
    assert.equal(task.verificationAttempts, 0);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('does not replay a timed-out DSH task after a workspace mutation may have started', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-worker-timeout-'));
  const turn = store.beginTurn({ text: '更新 README。', model: 'free-router' });
  store.setSelectedModel('free-router');
  let workerStarts = 0;
  const agent = new RootAgent({
    store,
    provider: {
      baseUrl: 'http://127.0.0.1:31415/v1',
      listModels: async () => [
        { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
      ],
      async *streamChat() {
        yield '后台任务已超时；请先检查工作区，再决定如何继续。';
      },
    },
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask() {
        workerStarts += 1;
        return {
          started: Promise.resolve({ sessionId: 'session-timeout-test' }),
          done: Promise.resolve({
            status: 'interrupted',
            sessionId: 'session-timeout-test',
            result: '',
            errorCode: 'dsh_task_timeout',
            errorMessage: '后台 DSH 任务超过允许的运行时间，已停止。',
            toolCallCount: 1,
            workspaceMutationStatus: 'unknown',
          }),
          stop: () => true,
        };
      },
    },
  });

  try {
    const started = await agent.startBackgroundTask({
      sourceTurnId: turn.id,
      prompt: '更新工作区中的 README。',
      workspacePath: workspace,
    });
    assert.equal(started.accepted, true);
    await started.completion;

    const task = store.getBackgroundTask(started.taskId);
    assert.equal(workerStarts, 1);
    assert.equal(task.status, 'interrupted');
    assert.equal(task.errorCode, 'dsh_task_timeout');
    assert.equal(task.toolCallCount, 1);
    assert.equal(task.eventStatus, 'delivered');
    assert.match(task.noemaResponse, /已停止/u);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('retries a failed Noema event summary without restarting the completed DSH worker', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('free-router');
  const sourceTurn = store.beginTurn({
    text: '合成编码任务已完成。',
    model: 'free-router',
  });
  store.appendAssistant({
    id: sourceTurn.id,
    attempt: 1,
    content: '任务已交给后台。',
  });
  store.completeTurn(sourceTurn.id, 1);
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-event-retry-'));
  const task = store.createBackgroundTask({
    id: 'completed-task-needs-summary',
    sourceTurnId: sourceTurn.id,
    workspacePath: workspace,
    model: 'auto:noema-free',
    prompt: '合成文件任务',
  });
  store.setBackgroundTaskSession(task.id, 'session-completed-test');
  store.finishBackgroundTask(task.id, {
    status: 'completed',
    resultText: '合成任务已完成。',
    sessionId: 'session-completed-test',
    toolCallCount: 2,
  });

  let modelCalls = 0;
  let dshStarts = 0;
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    ],
    async *streamChat() {
      modelCalls += 1;
      if (modelCalls === 1) {
        throw new ModelProviderError(
          'provider_unavailable',
          '合成测试：上游没有返回结果。',
        );
      }
      yield '我已检查保存的结果，任务完成。';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask() {
        dshStarts += 1;
        throw new Error('retrying the event must not restart DSH');
      },
    },
  });

  try {
    const initial = await agent.processPendingWorkerEvent();
    assert.equal(initial.accepted, true);
    assert.equal(initial.completed, false);
    assert.equal(store.getBackgroundTask(task.id).status, 'completed');
    assert.equal(store.getBackgroundTask(task.id).eventStatus, 'pending');
    assert.equal(
      store.getBackgroundTask(task.id).noemaResponseStatus,
      'failed',
    );

    const retried = await agent.retryBackgroundEvent(task.id);
    assert.equal(retried.accepted, true);
    assert.equal(retried.completed, true);
    assert.equal(store.getBackgroundTask(task.id).eventStatus, 'delivered');
    assert.equal(
      store.getBackgroundTask(task.id).noemaResponse,
      '我已检查保存的结果，任务完成。',
    );
    assert.equal(modelCalls, 2);
    assert.equal(dshStarts, 0);
  } finally {
    await agent.shutdown();
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('recovers and resumes a persisted worker in the same DSH session after restart', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-worker-resume-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const databasePath = path.join(directory, 'root.sqlite3');
  let store = new RootStore(databasePath);
  store.setSelectedModel('auto:noema-free');
  const turn = store.beginTurn({
    text: '请修正 README。',
    model: 'auto:noema-free',
  });
  store.appendAssistant({
    id: turn.id,
    attempt: turn.attempt,
    content: '已创建一个后台任务。',
  });
  store.completeTurn(turn.id, turn.attempt);
  const previous = store.createBackgroundTask({
    id: 'task-original',
    sourceTurnId: turn.id,
    workspacePath: workspace,
    model: 'auto:noema-free',
    prompt: '修正 README 的安装说明。',
  });
  store.setBackgroundTaskSession(previous.id, 'session-resume-test');
  store.close();
  store = new RootStore(databasePath);

  let resumeInput;
  const agent = new RootAgent({
    store,
    provider: {
      listModels: async () => [],
      async *streamChat() {},
    },
    secretStore: createSecretStore(),
    dshAdapter: {
      async startTask(input) {
        resumeInput = input;
        return {
          started: Promise.resolve({ sessionId: input.sessionId }),
          done: Promise.resolve({
            status: 'interrupted',
            sessionId: input.sessionId,
            result: '',
            errorCode: 'test_end',
            errorMessage: '测试结束',
            toolCallCount: 1,
          }),
          stop: () => true,
        };
      },
    },
  });

  try {
    const recovered = store.getBackgroundTask(previous.id);
    assert.equal(recovered.status, 'interrupted');
    assert.equal(recovered.eventStatus, 'pending');
    assert.equal(recovered.sessionId, 'session-resume-test');
    const result = await agent.resumeBackgroundTask(previous.id);
    assert.equal(result.accepted, true, JSON.stringify(result));
    assert.equal(resumeInput.sessionId, 'session-resume-test');
    assert.equal(resumeInput.workspacePath, workspace);
    assert.match(resumeInput.task, /不要重放已成功的文件改动/);
    assert.match(resumeInput.task, /修正 README 的安装说明/);
    assert.notEqual(result.taskId, previous.id);
    assert.equal(store.getBackgroundTask(result.taskId).sourceTurnId, turn.id);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('shutdown stops tracked DSH processes before finishing', async () => {
  const store = new RootStore(':memory:');
  let finishRun;
  const done = new Promise((resolve) => {
    finishRun = resolve;
  });
  let stopped = false;
  const agent = new RootAgent({
    store,
    provider: { listModels: async () => [], async *streamChat() {} },
    secretStore: createSecretStore(),
  });
  agent.workerRuns.set('task-shutdown', {
    stop() {
      stopped = true;
      finishRun({ status: 'interrupted' });
      return true;
    },
    done,
  });

  await agent.shutdown();
  assert.equal(stopped, true);
  assert.equal(agent.shuttingDown, true);
  assert.throws(() => agent.sendMessage({ text: '关闭后不能再启动任务' }));
  assert.equal(store.db.open, true);
  store.close();
});
