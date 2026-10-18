import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';
import { SocialWorkService } from '../src/social-work-service.mjs';

function makeStore() {
  const db = new Database(':memory:');
  new RootStore(db);
  return { db, store: new SocialChatStore(db) };
}

function addCompletedMessage(store, { roomId, agentId, text }) {
  const turn = store.beginTurn({
    roomId,
    agentId,
    text,
    model: 'test-model',
  });
  store.appendAssistantDelta(turn.assistantMessageId, `答复：${text}`);
  store.completeReply(turn.assistantMessageId);
}

function makeAdapter({
  onStart = () => {},
  result = '任务结果。',
  status = 'completed',
} = {}) {
  return {
    async startTask(input) {
      onStart(input);
      input.onEvent({ type: 'status', phase: 'turn_start' });
      input.onEvent({ type: 'tool-call', count: 1, tool: 'write' });
      return {
        started: Promise.resolve({ sessionId: 'session-room-task' }),
        done: Promise.resolve({
          status,
          sessionId: 'session-room-task',
          result,
          toolCallCount: 1,
          errorCode: status === 'failed' ? 'dsh_process_failed' : null,
          errorMessage: status === 'failed' ? 'synthetic failure' : null,
        }),
        stop: () => true,
      };
    },
  };
}

test('social work keeps the stable friend and only includes the issuing room context', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-social-work-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const seen = [];
  const events = [];
  addCompletedMessage(store, {
    roomId: 'room-engineering-partner',
    agentId: 'engineering-partner',
    text: '只在私聊里的背景：私有标记-松果',
  });
  addCompletedMessage(store, {
    roomId: 'room-engineering-collaboration',
    agentId: 'noema',
    text: '群聊任务背景：群标记-海盐',
  });
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter({
      onStart(input) {
        seen.push(input);
        writeFileSync(
          path.join(input.workspacePath, 'result.txt'),
          'handoff-proof',
        );
      },
    }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => workspace,
    emit: (event) => events.push(event),
  });

  try {
    const accepted = await service.startTask({
      roomId: 'room-engineering-collaboration',
      agentId: 'engineering-partner',
      prompt: '在项目里创建结果文件。',
      verificationChecks: [
        { kind: 'file_contains', path: 'result.txt', text: 'handoff-proof' },
      ],
    });
    assert.equal(accepted.accepted, true);
    await new Promise((resolve) => setImmediate(resolve));

    const task = store.getSocialWorkTask(accepted.taskId);
    assert.equal(task.status, 'completed');
    assert.equal(task.agentId, 'engineering-partner');
    assert.equal(task.roomId, 'room-engineering-collaboration');
    assert.equal(task.runtime, 'dsh');
    assert.equal(task.runtimeSessionId, 'session-room-task');
    assert.equal(task.verificationStatus, 'verified');
    assert.equal(task.resultText, '任务结果。');
    assert.deepEqual(task.toolActionCategories, ['write']);
    assert.match(seen[0].task, /群标记-海盐/);
    assert.match(seen[0].task, /面向用户的最终说明使用简体中文/);
    assert.doesNotMatch(seen[0].task, /私有标记-松果/);
    assert.equal(seen[0].model, 'auto:noema-free');
    assert.equal(seen[0].sessionId, null);
    assert.equal(
      events.some((event) => event.type === 'project-work-updated'),
      true,
    );
    const continuingContext = store.getContext(
      'room-engineering-collaboration',
    );
    assert.equal(
      continuingContext.some((message) =>
        message.content.includes('任务结果。'),
      ),
      true,
    );
    assert.equal(
      continuingContext.some((message) =>
        message.content.includes('私有标记-松果'),
      ),
      false,
    );
    const room = store.getRoomSnapshot('room-engineering-collaboration');
    assert.equal(room.workTasks.length, 1);
    assert.equal(room.workTasks[0].runtimeSessionId, undefined);
    assert.equal(room.workTasks[0].workspacePath, workspace);
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a cross-room task receives only one bounded, redacted, verified case when explicitly enabled', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-social-case-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const seen = [];
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter({
      result: '完成。历史输出里出现过 sk-abcdefghijklmnop123456。',
      onStart(input) {
        seen.push(input);
        const name = input.task.includes('room B') ? 'second.txt' : 'first.txt';
        writeFileSync(path.join(input.workspacePath, name), 'verified');
      },
    }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => workspace,
  });

  try {
    const first = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: 'room A：生成可核验的项目结果。',
      verificationChecks: [{ kind: 'file_exists', path: 'first.txt' }],
    });
    await service.waitForTask(first.taskId);
    const source = store.getSocialWorkTask(first.taskId);
    assert.equal(source.status, 'completed');
    assert.equal(source.verificationStatus, 'verified');
    assert.equal(source.caseEligible, true);

    const second = await service.startTask({
      roomId: 'room-engineering-collaboration',
      agentId: 'engineering-partner',
      prompt: 'room B：延续同一个项目的相关工作。',
      verificationChecks: [{ kind: 'file_exists', path: 'second.txt' }],
      reuseCase: true,
    });
    assert.equal(second.accepted, true);
    const secondTask = store.getSocialWorkTask(second.taskId);
    assert.equal(secondTask.caseReuseRequested, true);
    assert.equal(secondTask.caseSnapshot?.taskId, first.taskId);
    assert.equal(secondTask.caseSnapshot?.roomId, 'room-engineering-partner');
    assert.match(seen[1].task, /room A：生成可核验的项目结果/u);
    assert.match(seen[1].task, /历史输出里出现过 \[已隐藏疑似凭据\]/u);
    assert.doesNotMatch(seen[1].task, /sk-abcdefghijklmnop123456/u);
    assert.doesNotMatch(seen[1].task, /只在私聊里的背景|原房间原文/u);

    await service.waitForTask(second.taskId);
    const room = store.getRoomSnapshot('room-engineering-collaboration');
    assert.equal(room.workTasks[0].caseSnapshot?.taskId, first.taskId);
    assert.equal(room.workTasks[0].caseReuseRequested, true);
    assert.equal(room.workTasks[0].runtimeSessionId, undefined);

    await service.setCaseEligible(first.taskId, false);
    assert.equal(store.getSocialWorkTask(first.taskId).caseEligible, false);
    assert.equal(
      store.getSocialWorkTask(second.taskId).caseSnapshot?.taskId,
      first.taskId,
    );
    const third = await service.startTask({
      roomId: 'room-engineering-collaboration',
      agentId: 'engineering-partner',
      prompt: 'room B：不应继续引用已撤回案例。',
      verificationChecks: [{ kind: 'file_exists', path: 'second.txt' }],
      reuseCase: true,
    });
    assert.equal(store.getSocialWorkTask(third.taskId).caseSnapshot, null);
    await service.waitForTask(third.taskId);
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('canceling the workspace picker starts no DSH task and writes no task record', async () => {
  const { db, store } = makeStore();
  let launches = 0;
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter({ onStart: () => launches++ }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => null,
  });
  try {
    const result = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '不要开始，因为用户取消了文件夹选择。',
    });
    assert.deepEqual(result, {
      accepted: false,
      reason: '已取消选择项目文件夹。',
    });
    assert.equal(launches, 0);
    assert.equal(store.listRoomWorkTasks('room-engineering-partner').length, 0);
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('a failed DSH run is never upgraded by a passing file check', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-social-work-failed-'),
  );
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter({
      status: 'failed',
      onStart(input) {
        writeFileSync(path.join(input.workspacePath, 'result.txt'), 'partial');
      },
    }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => workspace,
  });
  try {
    const accepted = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '做一个可能会部分完成的工作。',
      verificationChecks: [{ kind: 'file_exists', path: 'result.txt' }],
    });
    await new Promise((resolve) => setImmediate(resolve));
    const task = store.getSocialWorkTask(accepted.taskId);
    assert.equal(task.status, 'failed');
    assert.equal(task.errorCode, 'dsh_process_failed');
    assert.equal(task.verificationStatus, 'verified');
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a DSH final without Noema file checks is not labeled independently verified', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-social-work-unverified-'),
  );
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter({ result: '已完成，但没有机器核验条件。' }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => workspace,
  });
  try {
    const accepted = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '执行一个无法用文件条件自动核验的项目任务。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    const task = store.getSocialWorkTask(accepted.taskId);
    assert.equal(task.status, 'completed');
    assert.equal(task.verificationStatus, 'not_planned');
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stopping project work records interruption without claiming rollback', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-social-work-stop-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  let finishRun;
  const service = new SocialWorkService({
    store,
    adapter: {
      async startTask() {
        return {
          started: Promise.resolve({ sessionId: 'session-stopped-work' }),
          done: new Promise((resolve) => {
            finishRun = resolve;
          }),
          stop() {
            finishRun({
              status: 'interrupted',
              sessionId: 'session-stopped-work',
              result: '尚未完成的部分结果。',
              toolCallCount: 1,
              errorCode: 'worker_interrupted',
              errorMessage: 'stopped',
            });
            return true;
          },
        };
      },
    },
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => workspace,
  });
  try {
    const accepted = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '启动后等待停止。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(service.stopTask(accepted.taskId), true);
    await new Promise((resolve) => setImmediate(resolve));
    const task = store.getSocialWorkTask(accepted.taskId);
    assert.equal(task.status, 'interrupted');
    assert.equal(task.runtimeSessionId, 'session-stopped-work');
    assert.equal(task.resultText, '尚未完成的部分结果。');
    assert.equal(
      task.errorMessage,
      '任务已停止；停止前已产生的项目文件修改不会自动回滚。',
    );
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a rate-limited task resumes once in the same DSH session only after its file check passes', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-social-work-resume-'),
  );
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const launches = [];
  const waits = [];
  const service = new SocialWorkService({
    store,
    adapter: {
      async startTask(input) {
        launches.push(input);
        if (launches.length === 1) {
          writeFileSync(path.join(workspace, 'result.txt'), 'resume-marker');
          return {
            started: Promise.resolve({ sessionId: 'session-rate-limited' }),
            done: Promise.resolve({
              status: 'failed',
              sessionId: 'session-rate-limited',
              result: '',
              toolCallCount: 2,
              errorCode: 'dsh_rate_limited',
              errorMessage: 'rate limited',
              retryAfterSeconds: 12,
            }),
            stop: () => true,
          };
        }
        return {
          started: Promise.resolve({ sessionId: 'session-rate-limited' }),
          done: Promise.resolve({
            status: 'completed',
            sessionId: 'session-rate-limited',
            result: 'Noema 已确认项目文件，任务完成。',
            toolCallCount: 1,
          }),
          stop: () => true,
        };
      },
    },
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => workspace,
    delayImpl: async (milliseconds) => {
      waits.push(milliseconds);
      return true;
    },
  });
  try {
    const started = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '完成 result.txt 中指定的标记任务。',
      verificationChecks: [
        { kind: 'file_contains', path: 'result.txt', text: 'resume-marker' },
      ],
    });
    await new Promise((resolve) => setImmediate(resolve));
    const task = store.getSocialWorkTask(started.taskId);
    assert.equal(task.status, 'completed');
    assert.equal(task.verificationStatus, 'verified');
    assert.equal(task.verificationAttempts, 1);
    assert.equal(task.toolCallCount, 3);
    assert.equal(launches.length, 2);
    assert.equal(launches[0].sessionId, null);
    assert.equal(launches[1].sessionId, 'session-rate-limited');
    assert.match(launches[1].task, /不要重复已成功的文件改动/);
    assert.deepEqual(waits, [13_000]);
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project work is unavailable without DSH or FreeLLMAPI and does not open a folder picker', async () => {
  const { db, store } = makeStore();
  let picked = false;
  const service = new SocialWorkService({
    store,
    adapter: null,
    secretStore: { isConfigured: () => false },
    chooseWorkspace: async () => {
      picked = true;
      return null;
    },
  });
  try {
    assert.equal(service.getReadiness().available, false);
    await assert.rejects(
      service.startTask({
        roomId: 'room-engineering-partner',
        agentId: 'engineering-partner',
        prompt: '不能绕过运行环境预检。',
      }),
      /DSH Headless/,
    );
    assert.equal(picked, false);
    assert.equal(store.listRoomWorkTasks('room-engineering-partner').length, 0);
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('archived specialists cannot start project work or open the workspace picker', async () => {
  const { db, store } = makeStore();
  store.setAgentArchived('engineering-partner', true);
  let pickedWorkspace = false;
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter(),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => {
      pickedWorkspace = true;
      return null;
    },
  });
  try {
    await assert.rejects(
      service.startTask({
        roomId: 'room-engineering-partner',
        agentId: 'engineering-partner',
        prompt: '归档联系人不应收到新工作。',
      }),
      /已归档/u,
    );
    assert.equal(pickedWorkspace, false);
    assert.equal(store.listRoomWorkTasks('room-engineering-partner').length, 0);
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('a user-created specialist with explicit project-work capability uses the existing room-scoped verifier path', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-social-custom-work-'),
  );
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const created = store.createAgent({
    name: '游戏工程观察员',
    headline: '长期研究游戏项目结构与迭代验证',
    description: '先厘清目标，再用小步验证。',
    projectWork: true,
  });
  const starts = [];
  const service = new SocialWorkService({
    store,
    adapter: {
      async startTask(input) {
        starts.push(input);
        writeFileSync(
          path.join(input.workspacePath, 'custom-proof.txt'),
          'passed',
        );
        return {
          started: Promise.resolve({
            sessionId: 'custom-agent-project-session',
          }),
          done: Promise.resolve({
            status: 'completed',
            sessionId: 'custom-agent-project-session',
            result: '按用户指定的文件条件完成。',
            toolCallCount: 1,
          }),
          stop: () => true,
        };
      },
    },
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => workspace,
  });
  try {
    const started = await service.startTask({
      roomId: created.room.id,
      agentId: created.members[0].id,
      prompt: '在项目里创建验收文件。',
      verificationChecks: [
        { kind: 'file_contains', path: 'custom-proof.txt', text: 'passed' },
      ],
    });
    const task = await service.waitForTask(started.taskId);
    assert.equal(task.status, 'completed');
    assert.equal(task.verificationStatus, 'verified');
    assert.equal(task.agentId, created.members[0].id);
    assert.equal(starts.length, 1);
    assert.match(starts[0].task, /长期研究游戏项目结构与迭代验证/u);
    assert.match(starts[0].task, /只有当用户明确切换到项目工作/u);
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
