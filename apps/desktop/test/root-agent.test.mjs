import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
    /先自然回应，并询问用户当时最在意的部分/,
  );
  assert.equal(
    modelInputs[1].messages.at(-1).content,
    '朋友临时取消了约定，我有点失落。',
  );
  store.close();
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
    assert.equal(dispatched.status, 'running', JSON.stringify(dispatched));
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
      toolCallCount: 2,
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
