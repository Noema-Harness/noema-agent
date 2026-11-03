import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runIsolatedWorkerE2E } from '../../test-support/electron/isolated-worker-e2e.mjs';

test('isolated worker runner records only a task inside its scratch workspace', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-e2e-runner-'));
  const workspace = path.join(directory, 'workspace');
  const resultPath = path.join(directory, 'result.json');
  const databasePath = path.join(directory, 'root.sqlite3');
  mkdirSync(workspace);
  writeFileSync(databasePath, 'synthetic isolated database placeholder');
  const task = {
    id: 'task-fixture',
    status: 'completed',
    errorCode: null,
    verificationStatus: 'verified',
    verificationResults: [
      {
        kind: 'file_exists',
        path: 'README.md',
        status: 'verified',
        reason: 'file_exists',
      },
    ],
    verificationAttempts: 0,
    interactionAdjustmentIds: ['adjustment-fixture'],
    toolActionCategories: ['list', 'write'],
    toolActionsTruncated: false,
    toolCallCount: 1,
    eventStatus: 'delivered',
    noemaResponseStatus: 'complete',
    noemaResponseError: null,
  };
  const store = {
    getWorkspaceDirectory: () => workspace,
    getSelectedModel: () => 'auto:noema-free',
    getTurn: () => ({ status: 'completed', errorCode: null }),
    getBackgroundTasks: () => [{ ...task, sourceTurnId: 'turn-fixture' }],
    getSnapshot: () => ({
      messages: [
        {
          turnId: 'turn-fixture',
          role: 'assistant',
          content: 'Synthetic worker response.',
          routedVia: ['blockrun/model-fixture'],
          routeMetadataStatus: 'reported',
        },
      ],
    }),
  };
  let receivedPrompt;
  const agent = {
    active: null,
    dshAdapter: {},
    dshRuntimeError: null,
    canDelegateToDsh: () => true,
    sendMessage({ text, model }) {
      receivedPrompt = { text, model };
      this.active = { turn: { id: 'turn-fixture' }, done: Promise.resolve() };
      return { turnId: 'turn-fixture' };
    },
  };

  try {
    const result = await runIsolatedWorkerE2E({
      agent,
      store,
      databasePath,
      resultPath,
      prompt: '[合成测试] 创建 README。',
      timeoutMs: 1_000,
    });

    assert.equal(receivedPrompt.model, 'auto:noema-free');
    assert.equal(receivedPrompt.text, '[合成测试] 创建 README。');
    assert.equal(result.outcome, 'worker_finished');
    assert.equal(result.task.verificationStatus, 'verified');
    assert.deepEqual(result.rootRouteMetadata, {
      status: 'reported',
      routedVia: ['blockrun/model-fixture'],
    });
    assert.deepEqual(result.task.interactionAdjustmentIds, [
      'adjustment-fixture',
    ]);
    assert.deepEqual(result.task.toolActionCategories, ['list', 'write']);
    assert.equal(result.task.toolActionsTruncated, false);
    assert.deepEqual(JSON.parse(readFileSync(resultPath, 'utf8')), result);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('isolated direct-worker mode bypasses root model calls but retains task verification', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-e2e-direct-worker-'),
  );
  const workspace = path.join(directory, 'workspace');
  const resultPath = path.join(directory, 'result.json');
  const databasePath = path.join(directory, 'root.sqlite3');
  mkdirSync(workspace);
  writeFileSync(databasePath, 'synthetic isolated database placeholder');
  const task = {
    id: 'direct-worker-fixture',
    sourceTurnId: 'direct-source-turn',
    status: 'completed',
    errorCode: null,
    verificationStatus: 'verified',
    verificationResults: [],
    verificationAttempts: 1,
    interactionAdjustmentIds: ['adjustment-owner'],
    toolActionCategories: ['write', 'read'],
    toolActionsTruncated: false,
    toolCallCount: 2,
    eventStatus: 'pending',
    noemaResponseStatus: 'none',
    noemaResponseError: null,
  };
  const store = {
    getWorkspaceDirectory: () => workspace,
    getSelectedModel: () => 'auto:noema-free',
    getTurn: () => ({ status: 'completed', errorCode: null }),
    getBackgroundTask: () => task,
    getSnapshot: () => ({ messages: [] }),
    beginTurn: () => ({ id: 'direct-source-turn', attempt: 1 }),
    appendAssistant() {},
    completeTurn() {},
  };
  let dispatched;
  let modelCalls = 0;
  const agent = {
    active: null,
    dshAdapter: {},
    dshRuntimeError: null,
    canDelegateToDsh: () => true,
    processPendingWorkerEvent() {
      modelCalls += 1;
    },
    async startBackgroundTask(input) {
      dispatched = input;
      return { accepted: true, taskId: task.id, completion: Promise.resolve() };
    },
  };

  try {
    const verificationChecks = [
      { kind: 'file_exists', path: 'src/slug.mjs' },
      { kind: 'file_exists', path: 'test/slug.test.mjs' },
      { kind: 'file_exists', path: 'README.md' },
    ];
    const result = await runIsolatedWorkerE2E({
      agent,
      store,
      databasePath,
      resultPath,
      prompt: '[NOEMA E2E] create three files',
      directWorker: true,
      verificationChecks,
      timeoutMs: 1_000,
    });

    assert.equal(result.outcome, 'worker_direct_finished');
    assert.equal(result.task.verificationStatus, 'verified');
    assert.equal(result.task.eventStatus, 'pending');
    assert.equal(dispatched.sourceTurnId, 'direct-source-turn');
    assert.deepEqual(dispatched.verificationChecks, verificationChecks);
    assert.equal(modelCalls, 0);
    assert.equal(agent.processPendingWorkerEvent !== undefined, true);
    assert.deepEqual(JSON.parse(readFileSync(resultPath, 'utf8')), result);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('isolated worker E2E captures an interaction correction before dispatching its task', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-e2e-preface-'));
  const workspace = path.join(directory, 'workspace');
  const resultPath = path.join(directory, 'result.json');
  const databasePath = path.join(directory, 'root.sqlite3');
  mkdirSync(workspace);
  writeFileSync(databasePath, 'synthetic isolated database placeholder');
  let prefaceCompleted = false;
  const task = {
    id: 'task-after-preface',
    sourceTurnId: 'turn-task',
    status: 'completed',
    errorCode: null,
    verificationStatus: 'verified',
    verificationResults: [],
    verificationAttempts: 0,
    interactionAdjustmentIds: ['adjustment-from-preface'],
    toolActionCategories: ['write'],
    toolActionsTruncated: false,
    toolCallCount: 1,
    eventStatus: 'delivered',
    noemaResponseStatus: 'complete',
    noemaResponseError: null,
  };
  const store = {
    getWorkspaceDirectory: () => workspace,
    getSelectedModel: () => 'free-router',
    getTurn: (id) =>
      id === 'turn-preface'
        ? {
            status: prefaceCompleted ? 'completed' : 'streaming',
            errorCode: null,
          }
        : { status: 'completed', errorCode: null },
    getBackgroundTasks: () => [task],
    getSnapshot: () => ({
      messages: [
        {
          turnId: 'turn-task',
          role: 'assistant',
          content: 'Synthetic worker response.',
          routedVia: [],
          routeMetadataStatus: 'unknown',
        },
      ],
    }),
  };
  const receivedPrompts = [];
  const agent = {
    active: null,
    dshAdapter: {},
    dshRuntimeError: null,
    canDelegateToDsh: () => true,
    sendMessage({ text, model }) {
      receivedPrompts.push({ text, model });
      const preface = receivedPrompts.length === 1;
      assert.equal(preface || prefaceCompleted, true);
      const turnId = preface ? 'turn-preface' : 'turn-task';
      this.active = {
        turn: { id: turnId },
        done: preface
          ? Promise.resolve().then(() => {
              prefaceCompleted = true;
            })
          : Promise.resolve(),
      };
      return { turnId };
    },
  };

  try {
    const prefacePrompt = '[NOEMA E2E PREFACE] 记录一个互动纠正。';
    const taskPrompt = '[NOEMA E2E] 在临时工作区创建 README。';
    const result = await runIsolatedWorkerE2E({
      agent,
      store,
      databasePath,
      prefacePrompt,
      prompt: taskPrompt,
      resultPath,
      timeoutMs: 1_000,
    });

    assert.deepEqual(receivedPrompts, [
      { text: prefacePrompt, model: 'free-router' },
      { text: taskPrompt, model: 'free-router' },
    ]);
    assert.deepEqual(result.preface, {
      status: 'completed',
      errorCode: null,
    });
    assert.equal(result.outcome, 'worker_finished');
    assert.deepEqual(result.task.interactionAdjustmentIds, [
      'adjustment-from-preface',
    ]);
    assert.deepEqual(JSON.parse(readFileSync(resultPath, 'utf8')), result);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('isolated worker runner records DSH preflight failure without spending a model call', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-e2e-preflight-'));
  const workspace = path.join(directory, 'workspace');
  const resultPath = path.join(directory, 'result.json');
  const databasePath = path.join(directory, 'root.sqlite3');
  mkdirSync(workspace);
  writeFileSync(databasePath, 'synthetic isolated database placeholder');
  let sent = false;
  const agent = {
    dshAdapter: null,
    dshRuntimeError: '没有找到 DSH CLI。',
    canDelegateToDsh: () => false,
    sendMessage() {
      sent = true;
      throw new Error('Preflight must happen before the model request.');
    },
  };
  const store = {
    getWorkspaceDirectory: () => workspace,
    getSelectedModel: () => 'auto:noema-free',
  };

  try {
    const result = await runIsolatedWorkerE2E({
      agent,
      store,
      databasePath,
      resultPath,
      prompt: '[NOEMA E2E] 创建 README。',
      timeoutMs: 1_000,
    });

    assert.equal(result.outcome, 'preflight_failed');
    assert.equal(result.turnStatus, 'not_started');
    assert.equal(result.dshAvailable, false);
    assert.equal(result.dshWorkerError, '没有找到 DSH CLI。');
    assert.equal(sent, false);
    assert.deepEqual(JSON.parse(readFileSync(resultPath, 'utf8')), result);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('root-only E2E checks a real chat without requiring DSH availability', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-e2e-root-only-'));
  const workspace = path.join(directory, 'workspace');
  const resultPath = path.join(directory, 'result.json');
  const databasePath = path.join(directory, 'root.sqlite3');
  mkdirSync(workspace);
  writeFileSync(databasePath, 'synthetic isolated database placeholder');
  const expected = 'NOEMA-ROOT-ONLY-SYNTHETIC';
  let receivedPrompt;
  const agent = {
    allowRootActions: true,
    dshAdapter: {
      startTask: () => assert.fail('root-only must not start DSH'),
    },
    dshRuntimeError: 'DSH is intentionally not part of this check.',
    sendMessage({ text, model }) {
      receivedPrompt = { text, model };
      this.active = { turn: { id: 'turn-root-only' }, done: Promise.resolve() };
      return { turnId: 'turn-root-only' };
    },
  };
  const store = {
    getWorkspaceDirectory: () => workspace,
    getSelectedModel: () => 'free-router',
    getTurn: () => ({ status: 'completed', errorCode: null }),
    getBackgroundTasks: () => [],
    getSnapshot: () => ({
      messages: [
        {
          turnId: 'turn-root-only',
          role: 'assistant',
          content: expected,
          routedVia: ['kilo/openrouter/free'],
          routeMetadataStatus: 'reported',
        },
      ],
    }),
  };

  try {
    const result = await runIsolatedWorkerE2E({
      agent,
      store,
      databasePath,
      resultPath,
      prompt: '[NOEMA E2E] Reply with the synthetic marker.',
      rootOnly: true,
      timeoutMs: 1_000,
    });

    assert.deepEqual(receivedPrompt, {
      text: '[NOEMA E2E] Reply with the synthetic marker.',
      model: 'free-router',
    });
    assert.equal(result.rootOnly, true);
    assert.equal(agent.allowRootActions, false);
    assert.equal(agent.dshAdapter, null);
    assert.equal(result.dshAvailable, false);
    assert.equal(result.outcome, 'no_worker_dispatched');
    assert.equal(result.turnStatus, 'completed');
    assert.equal(result.assistantText, expected);
    assert.deepEqual(result.rootRouteMetadata, {
      status: 'reported',
      routedVia: ['kilo/openrouter/free'],
    });
    assert.deepEqual(JSON.parse(readFileSync(resultPath, 'utf8')), result);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('isolated worker E2E distinguishes a completed task from failed Noema event response', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-e2e-event-failed-'));
  const workspace = path.join(directory, 'workspace');
  const resultPath = path.join(directory, 'result.json');
  const databasePath = path.join(directory, 'root.sqlite3');
  mkdirSync(workspace);
  writeFileSync(databasePath, 'synthetic isolated database placeholder');
  const task = {
    id: 'task-event-failed',
    sourceTurnId: 'turn-event-failed',
    status: 'completed',
    errorCode: null,
    verificationStatus: 'verified',
    verificationResults: [],
    verificationAttempts: 0,
    interactionAdjustmentIds: [],
    toolActionCategories: ['write', 'read'],
    toolActionsTruncated: false,
    toolCallCount: 2,
    eventStatus: 'pending',
    noemaResponseStatus: 'failed',
    noemaResponseError: 'Synthetic provider failure.',
  };
  const store = {
    getWorkspaceDirectory: () => workspace,
    getSelectedModel: () => 'auto:noema-free',
    getTurn: () => ({ status: 'completed', errorCode: null }),
    getBackgroundTasks: () => [task],
    getSnapshot: () => ({
      messages: [
        {
          turnId: 'turn-event-failed',
          role: 'assistant',
          content: '已发起后台任务。',
          routedVia: [],
          routeMetadataStatus: 'unknown',
        },
      ],
    }),
  };
  const agent = {
    dshAdapter: {},
    dshRuntimeError: null,
    sendMessage: () => ({ turnId: 'turn-event-failed' }),
  };

  try {
    const result = await runIsolatedWorkerE2E({
      agent,
      store,
      databasePath,
      resultPath,
      prompt: '[合成测试] 已核验文件，但结果事件接回失败。',
      timeoutMs: 1_000,
    });

    assert.equal(result.outcome, 'worker_event_response_failed');
    assert.equal(result.task.status, 'completed');
    assert.equal(result.task.verificationStatus, 'verified');
    assert.equal(result.task.eventStatus, 'pending');
    assert.equal(result.task.noemaResponseStatus, 'failed');
    assert.equal(result.task.noemaResponseError, 'Synthetic provider failure.');
    assert.deepEqual(result.task.toolActionCategories, ['write', 'read']);
    assert.deepEqual(JSON.parse(readFileSync(resultPath, 'utf8')), result);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('isolated worker runner rejects a workspace outside the E2E directory before sending', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-e2e-boundary-'));
  const databasePath = path.join(directory, 'root.sqlite3');
  writeFileSync(databasePath, 'synthetic isolated database placeholder');
  let sent = false;
  try {
    await assert.rejects(
      runIsolatedWorkerE2E({
        agent: {
          sendMessage() {
            sent = true;
          },
        },
        store: {
          getWorkspaceDirectory: () => tmpdir(),
          getSelectedModel: () => 'auto:noema-free',
        },
        databasePath: path.join(directory, 'root.sqlite3'),
        resultPath: path.join(directory, 'result.json'),
        prompt: '[合成测试] 创建 README。',
      }),
      /inside the isolated directory/i,
    );
    assert.equal(sent, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
