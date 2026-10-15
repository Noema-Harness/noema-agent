import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FreeLLMAPIError } from '../src/freellmapi-client.mjs';
import { RootAgent } from '../src/root-agent.mjs';
import { RootStore } from '../src/root-store.mjs';

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

test('first connection defaults to the reviewed Noema free chain when available', async () => {
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

  assert.equal(state.selectedModel, 'auto:noema-free');
  assert.equal(store.getSelectedModel(), 'auto:noema-free');
  store.close();
});

test('first connection falls back to the first verified free route if no named chain exists', async () => {
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
          { once: true },
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
        new FreeLLMAPIError(
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
    assert.equal(task.verificationStatus, 'verified');
    assert.equal(task.verificationAttempts, 1);
    assert.equal(task.verificationResults[0].status, 'verified');
    assert.equal(dshInputs.length, 2);
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
        throw new FreeLLMAPIError(
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

test('continues an interrupted worker in the same DSH session and original workspace', async () => {
  const store = new RootStore(':memory:');
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-worker-resume-'));
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
  store.finishBackgroundTask(previous.id, {
    status: 'interrupted',
    resultText: '已读取 README。',
    sessionId: 'session-resume-test',
    toolCallCount: 1,
  });

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
    rmSync(workspace, { recursive: true, force: true });
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
