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
import { runIsolatedWorkerE2E } from '../src/isolated-worker-e2e.mjs';

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
    toolCallCount: 1,
    eventStatus: 'delivered',
    noemaResponseStatus: 'complete',
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
