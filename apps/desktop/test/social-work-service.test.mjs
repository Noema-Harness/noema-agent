import { createSocialTestStore } from '../test-support/social-team.mjs';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialWorkService } from '../src/social-work-service.mjs';
import { SocialChatService } from '../src/social-chat-service.mjs';
import { SocialProjectStore } from '../src/social-project-store.mjs';
import { NoemaProjectExecutor } from '../src/noema-project-executor.mjs';
import { MAX_SOCIAL_WORK_TOOL_ROUNDS } from '../src/social-work-limits.mjs';

function makeStore() {
  const db = new Database(':memory:');
  new RootStore(db);
  return { db, store: createSocialTestStore(db) };
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
      const stepId = `${input.taskId}-step-1`;
      input.onEvent({
        type: 'tool-call',
        count: 1,
        tool: 'write',
        stepId,
        externalCallId: 'call-write',
        category: 'write',
        hasSideEffect: true,
      });
      input.onEvent({
        type: 'tool-result',
        stepId,
        status: 'completed',
        effectStatus: 'applied',
      });
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

test('a project paused while its workspace picker is open cannot start file work', async () => {
  const { db, store } = makeStore();
  let paused = false;
  const launches = [];
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter({ onStart: (input) => launches.push(input) }),
    secretStore: { isConfigured: () => true },
    assertWorkAllowed: () => {
      if (paused) throw new Error('项目等待用户评审');
    },
    chooseWorkspace: async () => {
      paused = true;
      return tmpdir();
    },
  });
  try {
    await assert.rejects(
      service.startTask({
        roomId: 'room-engineering-partner',
        agentId: 'engineering-partner',
        prompt: '修改说明。',
      }),
      /等待用户评审/,
    );
    assert.equal(launches.length, 0);
    assert.equal(store.listRoomWorkTasks('room-engineering-partner').length, 0);
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('an ordinary specialist message reaches the real work lifecycle without a separate execution mode', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-natural-work-'));
  const { db, store } = makeStore();
  const launches = [];
  const work = new SocialWorkService({
    store,
    adapter: makeAdapter({ onStart: (input) => launches.push(input) }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => directory,
  });
  const chat = new SocialChatService({
    store,
    provider: {
      async *streamChat(input) {
        input.onToolCalls([
          {
            id: 'call-work',
            function: {
              name: 'start_project_work',
              arguments: JSON.stringify({
                agent_id: 'engineering-partner',
                task: '检查项目依赖并报告问题。',
              }),
            },
          },
        ]);
        yield* [];
      },
    },
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
    getProjectWorkReadiness: () => work.getReadiness(),
    startProjectWork: (input, signal) => work.startTask({ ...input, signal }),
  });
  try {
    const sent = chat.sendMessage({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '帮我检查这个项目的依赖。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await chat.active.get('room-engineering-partner')?.done;
    const [task] = store.listRoomWorkTasks('room-engineering-partner');
    assert.ok(task);
    await work.waitForTask(task.id);
    assert.equal(task.agentId, 'engineering-partner');
    assert.equal(task.taskPrompt, '检查项目依赖并报告问题。');
    assert.equal(store.getSocialMessage(task.sourceMessageId).role, 'user');
    assert.equal(task.caseReuseRequested, false);
    assert.equal(launches.length, 1);
    assert.equal(store.getSocialMessage(sent.messageId).status, 'complete');
  } finally {
    await chat.shutdown();
    await work.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stopping a conversation while choosing its workspace prevents a late file task from starting', async () => {
  const { db, store } = makeStore();
  const controller = new AbortController();
  let releasePicker;
  const launches = [];
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter({ onStart: (input) => launches.push(input) }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: () =>
      new Promise((resolve) => {
        releasePicker = resolve;
      }),
  });
  try {
    const pending = service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '检查项目依赖。',
      signal: controller.signal,
    });
    controller.abort();
    releasePicker(tmpdir());
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(launches.length, 0);
    assert.equal(store.listRoomWorkTasks('room-engineering-partner').length, 0);
  } finally {
    await service.shutdown();
    db.close();
  }
});

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
    getSelectedModel: () => 'free-router',
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
    assert.equal(task.executionEngine, 'noema');
    assert.equal(task.runtimeSessionId, 'session-room-task');
    assert.equal(task.verificationStatus, 'verified');
    assert.equal(task.resultText, '任务结果。');
    assert.deepEqual(task.toolActionCategories, ['write']);
    assert.deepEqual(
      task.executionSteps.map(({ category, status, effectStatus }) => ({
        category,
        status,
        effectStatus,
      })),
      [{ category: 'write', status: 'succeeded', effectStatus: 'applied' }],
    );
    assert.match(seen[0].task, /群标记-海盐/);
    assert.match(seen[0].task, /面向用户的最终说明使用简体中文/);
    assert.doesNotMatch(seen[0].task, /私有标记-松果/);
    assert.equal(seen[0].model, 'free-router');
    assert.equal(task.model, 'free-router');
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

test('legacy DSH project execution keeps its pinned route when another model is selected', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-dsh-route-contract-'),
  );
  const { db, store } = makeStore();
  const adapter = Object.assign(makeAdapter(), { executionEngine: 'dsh' });
  const service = new SocialWorkService({
    store,
    adapter,
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'free-router',
    chooseWorkspace: async () => directory,
  });
  try {
    const accepted = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '使用现有 DSH 兼容路由。',
    });
    const task = await service.waitForTask(accepted.taskId);
    assert.equal(task.status, 'completed');
    assert.equal(task.model, 'auto:noema-free');
    assert.equal(task.executionEngine, 'dsh');
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Noema internal dispatch stores project work in the source room with a capable executor', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-internal-work-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const authorizationPrompts = [];
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter(),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async ({ prompt }) => {
      authorizationPrompts.push(prompt);
      return workspace;
    },
  });

  try {
    const source = store.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请检查并修复项目配置。',
      model: 'test-model',
    });
    const accepted = await service.startTaskFromNoema({
      roomId: 'room-noema',
      agentId: 'engineering-partner',
      prompt: '检查并修复项目配置。',
      sourceMessageId: source.userMessageId,
    });
    assert.equal(accepted.accepted, true);
    await new Promise((resolve) => setImmediate(resolve));

    const task = store.getSocialWorkTask(accepted.taskId);
    assert.equal(task.roomId, 'room-noema');
    assert.equal(task.agentId, 'engineering-partner');
    assert.equal(task.sourceMessageId, source.userMessageId);
    assert.deepEqual(authorizationPrompts, ['检查并修复项目配置。']);
    const noemaRoom = store.getRoomSnapshot('room-noema');
    assert.equal(noemaRoom.workTasks.length, 1);
    assert.equal(noemaRoom.workTasks[0].sourceMessageId, source.userMessageId);
    await assert.rejects(
      service.startTask({
        roomId: 'room-noema',
        agentId: 'engineering-partner',
        prompt: '尝试绕过 Noema 内部路由。',
      }),
      /不在当前聊天空间/u,
    );
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Noema can dispatch a real work record from an active project group to one of its capable members', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-group-work-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const projectStore = new SocialProjectStore({ db, socialChatStore: store });
  let launchCount = 0;
  const service = new SocialWorkService({
    store,
    projectStore,
    adapter: makeAdapter({ onStart: () => launchCount++ }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => workspace,
  });

  try {
    const origin = store.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '建立一个需要实现的项目。',
      model: 'test-model',
    });
    const researcher = store.createAgent({
      name: '价格研究员',
      headline: '价格来源研究',
      description: '核对官方来源与计价口径。',
    }).members[0].id;
    const project = projectStore.formProjectTeam({
      title: '价格追踪应用',
      brief: '实现可核验的价格追踪能力。',
      originRoomId: 'room-noema',
      sourceMessageId: origin.userMessageId,
      members: [
        {
          agentId: 'engineering-partner',
          task: '实现价格数据存储与变更检测。',
        },
        { agentId: researcher, task: '核对价格来源与计价口径。' },
      ],
    }).project;
    const request = store.beginTurn({
      roomId: project.groupRoomId,
      agentId: 'noema',
      text: '@Noema 请开始 w3 的实际实现。',
      model: 'test-model',
    });
    const accepted = await service.startTaskFromNoema({
      roomId: project.groupRoomId,
      projectId: project.id,
      agentId: 'engineering-partner',
      prompt: '实现价格快照与变化检测。',
      sourceMessageId: request.userMessageId,
    });
    assert.equal(accepted.accepted, true);
    const task = store.getSocialWorkTask(accepted.taskId);
    assert.equal(task.roomId, project.groupRoomId);
    assert.equal(task.agentId, 'engineering-partner');
    assert.equal(task.sourceMessageId, request.userMessageId);
    assert.equal(task.status, 'running');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(launchCount, 1);
    await service.waitForTask(accepted.taskId);
    assert.equal(store.getSocialWorkTask(accepted.taskId).status, 'completed');

    const noProjectMember = store.createAgent({
      name: '非项目工程师',
      headline: '执行',
      description: '不属于当前项目。',
      projectWork: true,
    }).members[0].id;
    await assert.rejects(
      service.startTaskFromNoema({
        roomId: project.groupRoomId,
        projectId: project.id,
        agentId: noProjectMember,
        prompt: '越权加入任务。',
        sourceMessageId: request.userMessageId,
      }),
      /活跃成员/u,
    );
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Noema project dispatch requires an explicit active capable executor before asking for a workspace', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-internal-worker-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const authorizationPrompts = [];
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter(),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => {
      authorizationPrompts.push('opened');
      return workspace;
    },
  });

  try {
    const source = store.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请修改项目。',
      model: 'test-model',
    });
    await assert.rejects(
      service.startTaskFromNoema({
        roomId: 'room-noema',
        prompt: '修改项目。',
        sourceMessageId: source.userMessageId,
      }),
      /必须明确选择一位/u,
    );

    store.setAgentProjectWork('engineering-partner', false);
    await assert.rejects(
      service.startTaskFromNoema({
        roomId: 'room-noema',
        agentId: 'engineering-partner',
        prompt: '修改项目。',
        sourceMessageId: source.userMessageId,
      }),
      /没有项目工作能力/u,
    );

    store.setAgentProjectWork('engineering-partner', true);
    store.setAgentArchived('engineering-partner', true);
    await assert.rejects(
      service.startTaskFromNoema({
        roomId: 'room-noema',
        agentId: 'engineering-partner',
        prompt: '修改项目。',
        sourceMessageId: source.userMessageId,
      }),
      /已归档/u,
    );
    assert.deepEqual(authorizationPrompts, []);
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a workspace admits only one active project execution across chats', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-workspace-lock-'));
  const { db, store } = makeStore();
  let finishExecution;
  const pendingExecution = new Promise((resolve) => {
    finishExecution = resolve;
  });
  const launches = [];
  const service = new SocialWorkService({
    store,
    adapter: {
      async startTask(input) {
        launches.push(input);
        return {
          started: Promise.resolve({ sessionId: 'workspace-lock-session' }),
          done: pendingExecution,
          stop: () => true,
        };
      },
    },
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => directory,
  });

  try {
    const first = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '第一项工作。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
      service.startTask({
        roomId: 'room-engineering-collaboration',
        agentId: 'engineering-partner',
        prompt: '同时启动的第二项工作。',
      }),
      /项目已有一项工作在运行/u,
    );
    assert.equal(launches.length, 1);
    assert.equal(store.getSocialWorkTask(first.taskId).status, 'running');
  } finally {
    finishExecution({
      status: 'interrupted',
      errorCode: 'worker_interrupted',
      errorMessage: '测试结束。',
      sessionId: 'workspace-lock-session',
      result: '',
      toolCallCount: 0,
    });
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('project tasks include only active coding adjustments and persist the exact input snapshot', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-social-adjustments-'),
  );
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const seen = [];
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter({ onStart: (input) => seen.push(input) }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => workspace,
  });

  try {
    const accepted = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '创建一个结果文件。',
      verificationChecks: [],
    });
    assert.equal(accepted.accepted, true);
    await service.runs.get(accepted.taskId)?.completion;

    const task = store.getSocialWorkTask(accepted.taskId);
    assert.deepEqual(task.interactionAdjustmentIds, []);
    assert.deepEqual(task.interactionAdjustmentSnapshots, []);
    assert.doesNotMatch(seen[0].task, /互动约定/);
    assert.doesNotMatch(seen[0].task, /先回应当下/);
    assert.doesNotMatch(seen[0].task, /不得发送/);
    assert.doesNotMatch(seen[0].task, /引用标记/);
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

test('a verified case transfer can propose, trial, and revoke one bounded practice', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-social-practice-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const seen = [];
  const proposalRequests = [];
  const practiceConfirmations = [];
  let practiceDecision = 'trial';
  let launchCount = 0;
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter({
      onStart(input) {
        launchCount += 1;
        seen.push(input);
        const resultName = `result-${launchCount}.txt`;
        writeFileSync(
          path.join(input.workspacePath, resultName),
          'practice-proof',
        );
      },
    }),
    secretStore: { isConfigured: () => true },
    confirmPracticeCandidate: async (input) => {
      practiceConfirmations.push(input);
      return practiceDecision;
    },
    practiceProvider: {
      async *streamChat(input) {
        proposalRequests.push(input);
        input.onToolCalls([
          {
            id: 'practice-proposal-1',
            type: 'function',
            function: {
              name: 'propose_practice',
              arguments: JSON.stringify({
                trigger: '新增文件且用户给出精确内容验收条件。',
                action: '按相对路径写入后，再独立读取并核对指定标记。',
                limits: '仅适用于明确路径和文本条件的单文件任务。',
              }),
            },
          },
        ]);
        yield '';
      },
    },
    chooseWorkspace: async () => workspace,
  });
  const checksFor = (name) => [
    { kind: 'file_contains', path: name, text: 'practice-proof' },
  ];
  const waitForPracticeStatus = async (taskId, expected) => {
    for (let index = 0; index < 50; index += 1) {
      const task = store.getSocialWorkTask(taskId);
      if (task.practiceCandidateStatus === expected) return task;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error(`practice candidate did not reach ${expected}`);
  };

  try {
    const first = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: 'room A：新增第一份验收文件。',
      verificationChecks: checksFor('result-1.txt'),
    });
    await service.waitForTask(first.taskId);
    assert.equal(
      store.getSocialWorkTask(first.taskId).verificationStatus,
      'verified',
    );

    const second = await service.startTask({
      roomId: 'room-engineering-collaboration',
      agentId: 'engineering-partner',
      prompt: 'room B：参考同项目经验，新增第二份验收文件。',
      verificationChecks: checksFor('result-2.txt'),
      reuseCase: true,
    });
    await service.waitForTask(second.taskId);
    const candidateSource = await waitForPracticeStatus(
      second.taskId,
      'available',
    );
    assert.equal(candidateSource.caseSnapshot?.taskId, first.taskId);
    assert.equal(candidateSource.practiceCandidate?.basisTaskId, first.taskId);
    assert.equal(
      candidateSource.practiceCandidate?.trigger,
      '新增文件且用户给出精确内容验收条件。',
    );
    assert.equal(proposalRequests.length, 1);
    assert.equal(proposalRequests[0].model, 'auto:noema-free');
    assert.equal(proposalRequests[0].maxTokens, 512);
    const proposalInput = proposalRequests[0].messages
      .map((message) => message.content)
      .join('\n');
    assert.match(proposalInput, /room A：新增第一份验收文件/u);
    assert.match(proposalInput, /room B：参考同项目经验/u);

    const thirdRoom = store.createGroup({
      title: '实践试用群',
      agentIds: ['noema', 'engineering-partner'],
    });
    practiceDecision = 'case';
    const caseOnly = await service.startTask({
      roomId: thirdRoom.room.id,
      agentId: 'engineering-partner',
      prompt: 'room C：只参考原案例，不采用候选做法。',
      verificationChecks: checksFor('result-3.txt'),
      reuseCase: true,
    });
    const caseOnlyTask = store.getSocialWorkTask(caseOnly.taskId);
    assert.equal(caseOnlyTask.practiceSnapshot, null);
    assert.equal(caseOnlyTask.caseSnapshot?.taskId, second.taskId);
    assert.equal(
      store.getSocialWorkTask(second.taskId).practiceCandidateStatus,
      'available',
    );
    await service.waitForTask(caseOnly.taskId);

    practiceDecision = 'cancel';
    const taskCountBeforeCancel = store.listRoomWorkTasks(
      thirdRoom.room.id,
    ).length;
    const launchesBeforeCancel = launchCount;
    const canceled = await service.startTask({
      roomId: thirdRoom.room.id,
      agentId: 'engineering-partner',
      prompt: 'room C：取消候选审阅后不应启动任务。',
      verificationChecks: checksFor('result-canceled.txt'),
      reuseCase: true,
    });
    assert.equal(canceled.accepted, false);
    assert.equal(launchCount, launchesBeforeCancel);
    assert.equal(
      store.listRoomWorkTasks(thirdRoom.room.id).length,
      taskCountBeforeCancel,
    );

    practiceDecision = 'trial';
    const third = await service.startTask({
      roomId: thirdRoom.room.id,
      agentId: 'engineering-partner',
      prompt: 'room C：在同一项目中新增第四份验收文件。',
      verificationChecks: checksFor('result-4.txt'),
      reuseCase: true,
    });
    const trialStart = store.getSocialWorkTask(third.taskId);
    assert.equal(trialStart.practiceSnapshot?.sourceTaskId, second.taskId);
    assert.equal(trialStart.practiceSnapshot?.basisTaskId, first.taskId);
    assert.equal(trialStart.caseSnapshot, null);
    const projectedTrial = store
      .getRoomSnapshot(thirdRoom.room.id)
      .workTasks.find((task) => task.id === third.taskId);
    assert.equal(projectedTrial?.practiceSnapshot?.sourceTaskId, second.taskId);
    assert.equal(projectedTrial?.practiceSnapshot?.basisTaskId, first.taskId);
    assert.match(seen[3].task, /候选做法（一次试用）/u);
    assert.match(seen[3].task, /新增文件且用户给出精确内容验收条件/u);
    assert.equal(practiceConfirmations.length, 3);
    assert.equal(
      practiceConfirmations[0].candidate.action,
      '按相对路径写入后，再独立读取并核对指定标记。',
    );
    assert.equal(
      practiceConfirmations[1].taskPrompt,
      'room C：取消候选审阅后不应启动任务。',
    );
    await service.waitForTask(third.taskId);
    const trialed = store.getSocialWorkTask(second.taskId);
    assert.equal(trialed.practiceCandidateStatus, 'trialed');
    assert.equal(trialed.practiceTrialTaskId, third.taskId);
    assert.equal(trialed.practiceTrialVerificationStatus, 'verified');

    const revoked = service.revokePracticeCandidate(second.taskId);
    assert.equal(revoked.practiceCandidateStatus, 'revoked');
    const fourth = await service.startTask({
      roomId: 'room-engineering-collaboration',
      agentId: 'engineering-partner',
      prompt: 'room B：候选撤回后，再新增一份验收文件。',
      verificationChecks: checksFor('result-5.txt'),
      reuseCase: true,
    });
    assert.equal(store.getSocialWorkTask(fourth.taskId).practiceSnapshot, null);
    assert.doesNotMatch(seen[4].task, /候选做法（一次试用）/u);
    await service.waitForTask(fourth.taskId);
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

test('a restarted Noema task resumes from durable model-boundary messages', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-explicit-resume-'));
  const { db, store } = makeStore();
  try {
    store.createSocialWorkTask({
      id: 'resume-project-task',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: directory,
      workspaceKey: directory.toLowerCase(),
      taskPrompt: '继续原有项目任务。',
      model: 'test-model',
      executionEngine: 'noema',
    });
    store.setSocialWorkTaskSession(
      'resume-project-task',
      'noema-resume-project-task',
    );
    store.startSocialWorkExecutionStep('resume-project-task', {
      id: 'completed-write',
      externalCallId: 'write-once',
      arguments: JSON.stringify({
        path: 'result.txt',
        content: 'written once',
      }),
      toolName: 'write_file',
      category: 'write',
      hasSideEffect: true,
    });
    store.finishSocialWorkExecutionStep(
      'resume-project-task',
      'completed-write',
      {
        status: 'succeeded',
        effectStatus: 'applied',
        resultContent: JSON.stringify({ result: '已写入 result.txt。' }),
      },
    );
    store.saveSocialWorkRuntimeCheckpoint('resume-project-task', {
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '完整执行请求和上下文' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'write-once',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({
                  path: 'result.txt',
                  content: 'written once',
                }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'write-once',
          content: JSON.stringify({ result: '已写入 result.txt。' }),
        },
      ],
      round: 1,
      toolCallCount: 1,
      phase: 'ready_for_model',
    });
    new store.constructor(db);

    let receivedMessages;
    const provider = {
      async *streamChat({ messages }) {
        receivedMessages = messages;
        yield '已检查已有结果，任务继续完成。';
      },
    };
    const service = new SocialWorkService({
      store,
      adapter: new NoemaProjectExecutor({ provider }),
      secretStore: { isConfigured: () => true },
      chooseWorkspace: async () => directory,
    });
    try {
      const resumed = await service.resumeTask('resume-project-task');
      assert.equal(resumed.accepted, true);
      const task = await service.waitForTask('resume-project-task');
      assert.equal(task.status, 'completed');
      assert.equal(task.toolCallCount, 1);
      assert.equal(task.resultText, '已检查已有结果，任务继续完成。');
      assert.deepEqual(receivedMessages.at(-2), {
        role: 'tool',
        tool_call_id: 'write-once',
        content: JSON.stringify({ result: '已写入 result.txt。' }),
      });
    } finally {
      await service.shutdown();
    }
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an unavailable provider can be resumed explicitly without replaying tools', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-provider-resume-'));
  const { db, store } = makeStore();
  let providerCalls = 0;
  let resumedMessages;
  const provider = {
    async *streamChat({ messages, onToolCalls }) {
      providerCalls += 1;
      if (providerCalls === 1) {
        onToolCalls([
          {
            id: 'read-before-provider-failure',
            type: 'function',
            function: {
              name: 'list_files',
              arguments: JSON.stringify({ path: '.' }),
            },
          },
        ]);
        return;
      }
      if (providerCalls === 2) {
        const error = new Error('route temporarily unavailable');
        error.code = 'provider_unavailable';
        throw error;
      }
      resumedMessages = messages;
      yield '已沿用已完成的读取继续任务。';
    },
  };
  const service = new SocialWorkService({
    store,
    adapter: new NoemaProjectExecutor({ provider }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => directory,
  });
  try {
    const accepted = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '先检查项目目录，再继续处理。',
    });
    const failed = await service.waitForTask(accepted.taskId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'provider_unavailable');
    assert.equal(failed.canResume, true);
    assert.equal(failed.executionSteps.length, 1);
    assert.equal(failed.executionSteps[0].status, 'succeeded');
    assert.equal(failed.executionSteps[0].effectStatus, 'none');

    const checkpoint = store.getSocialWorkRuntimeCheckpoint(accepted.taskId);
    assert.equal(checkpoint.phase, 'failed');
    assert.equal(checkpoint.resumePhase, 'ready_for_model');

    assert.equal((await service.resumeTask(accepted.taskId)).accepted, true);
    const completed = await service.waitForTask(accepted.taskId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.canResume, false);
    assert.equal(completed.toolCallCount, 1);
    assert.equal(completed.executionSteps.length, 1);
    assert.equal(providerCalls, 3);
    assert.equal(resumedMessages.at(-2).role, 'tool');
    assert.equal(
      resumedMessages.at(-2).tool_call_id,
      'read-before-provider-failure',
    );
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a long task stopped at the round cap resumes to its final report without replaying writes', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-round-cap-resume-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  let providerCalls = 0;
  let writeCalls = 0;
  const provider = {
    async *streamChat({ onToolCalls }) {
      providerCalls += 1;
      if (providerCalls <= 16) {
        writeCalls += 1;
        onToolCalls([
          {
            id: `write-${writeCalls}`,
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: `result-${writeCalls}.txt`,
                content: `saved ${writeCalls}`,
              }),
            },
          },
        ]);
        return;
      }
      yield '16 个结果文件已经写入，当前任务已收尾。';
    },
  };
  const executor = new NoemaProjectExecutor({ provider, maxToolRounds: 16 });
  const service = new SocialWorkService({
    store,
    adapter: executor,
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => workspace,
  });
  try {
    const accepted = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '依次写入 16 个结果文件，最后核对并汇报。',
    });
    const failed = await service.waitForTask(accepted.taskId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'tool_round_limit');
    assert.equal(failed.canResume, true);
    assert.equal(failed.executionSteps.length, 16);
    assert.equal(writeCalls, 16);

    const checkpoint = store.getSocialWorkRuntimeCheckpoint(accepted.taskId);
    assert.equal(checkpoint.phase, 'failed');
    assert.equal(checkpoint.resumePhase, null);
    assert.equal(checkpoint.toolCallCount, 16);

    executor.maxToolRounds = MAX_SOCIAL_WORK_TOOL_ROUNDS;
    assert.equal((await service.resumeTask(accepted.taskId)).accepted, true);
    assert.equal(
      store.getSocialWorkRuntimeCheckpoint(accepted.taskId).resumePhase,
      'ready_for_model',
    );
    const completed = await service.waitForTask(accepted.taskId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.toolCallCount, 16);
    assert.equal(completed.executionSteps.length, 16);
    assert.equal(providerCalls, 17);
    assert.equal(writeCalls, 16);
    assert.equal(
      completed.resultText,
      '16 个结果文件已经写入，当前任务已收尾。',
    );
    assert.equal(
      readFileSync(path.join(workspace, 'result-16.txt'), 'utf8'),
      'saved 16',
    );
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a rate-limited provider can be resumed without replaying tools', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-rate-limit-resume-'),
  );
  const { db, store } = makeStore();
  let providerCalls = 0;
  let resumedMessages;
  const provider = {
    async *streamChat({ messages, onToolCalls }) {
      providerCalls += 1;
      if (providerCalls === 1) {
        onToolCalls([
          {
            id: 'read-before-rate-limit',
            type: 'function',
            function: {
              name: 'list_files',
              arguments: JSON.stringify({ path: '.' }),
            },
          },
        ]);
        return;
      }
      if (providerCalls === 2) {
        const error = new Error('provider is rate limited');
        error.code = 'rate_limited';
        throw error;
      }
      resumedMessages = messages;
      yield '已沿用已完成的读取继续任务。';
    },
  };
  const service = new SocialWorkService({
    store,
    adapter: new NoemaProjectExecutor({ provider }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => directory,
  });
  try {
    const accepted = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '先检查项目目录，再继续处理。',
    });
    const failed = await service.waitForTask(accepted.taskId);
    assert.equal(failed.errorCode, 'rate_limited');
    assert.equal(failed.canResume, true);
    assert.equal(
      store.getSocialWorkRuntimeCheckpoint(accepted.taskId).resumePhase,
      'ready_for_model',
    );

    await service.resumeTask(accepted.taskId);
    const completed = await service.waitForTask(accepted.taskId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.toolCallCount, 1);
    assert.equal(completed.executionSteps.length, 1);
    assert.equal(providerCalls, 3);
    assert.equal(resumedMessages.at(-2).role, 'tool');
    assert.equal(resumedMessages.at(-2).tool_call_id, 'read-before-rate-limit');
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a provider Retry-After resumes once from its saved checkpoint', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-rate-limit-auto-'));
  const { db, store } = makeStore();
  const waits = [];
  let providerCalls = 0;
  let resumedMessages;
  const provider = {
    async *streamChat({ messages, onToolCalls }) {
      providerCalls += 1;
      if (providerCalls === 1) {
        onToolCalls([
          {
            id: 'write-before-rate-limit',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'RESULT.md',
                content: 'verified-result',
              }),
            },
          },
        ]);
        return;
      }
      if (providerCalls === 2) {
        const error = new Error('provider cooldown');
        error.code = 'rate_limited';
        error.retryAfterSeconds = 1;
        throw error;
      }
      resumedMessages = messages;
      yield '结果已写入并通过核验。';
    },
  };
  const service = new SocialWorkService({
    store,
    adapter: new NoemaProjectExecutor({
      provider,
      commandSupport: { supported: false },
    }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => directory,
    delayImpl: async (milliseconds) => {
      waits.push(milliseconds);
      return true;
    },
  });
  try {
    const accepted = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '写入 RESULT.md 并完成核验。',
      verificationChecks: [
        { kind: 'file_contains', path: 'RESULT.md', text: 'verified-result' },
      ],
    });
    const completed = await service.waitForTask(accepted.taskId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.verificationStatus, 'verified');
    assert.equal(completed.verificationAttempts, 1);
    assert.equal(completed.toolCallCount, 1);
    assert.equal(completed.executionSteps.length, 1);
    assert.equal(completed.executionSteps[0].status, 'succeeded');
    assert.equal(completed.executionSteps[0].effectStatus, 'applied');
    assert.equal(providerCalls, 3);
    assert.deepEqual(waits, [1_000]);
    assert.equal(resumedMessages.at(-2).role, 'tool');
    assert.equal(
      resumedMessages.at(-2).tool_call_id,
      'write-before-rate-limit',
    );
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('output budget failure is persisted as non-resumable with no attempted write', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-output-budget-task-'),
  );
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, 'first.txt'), 'x'.repeat(24_000));
  writeFileSync(path.join(workspace, 'second.txt'), 'y'.repeat(24_000));
  const targetPath = path.join(workspace, 'must-not-write.txt');
  const { db, store } = makeStore();
  const provider = {
    async *streamChat({ onToolCalls }) {
      onToolCalls([
        {
          id: 'service-budget-read-1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: 'first.txt' }),
          },
        },
        {
          id: 'service-budget-read-2',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: 'second.txt' }),
          },
        },
        {
          id: 'service-budget-write',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({
              path: 'must-not-write.txt',
              content: 'not executed',
            }),
          },
        },
      ]);
      yield* [];
    },
  };
  const service = new SocialWorkService({
    store,
    adapter: new NoemaProjectExecutor({ provider }),
    secretStore: { isConfigured: () => true },
    chooseWorkspace: async () => workspace,
  });
  try {
    const accepted = await service.startTask({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      prompt: '读取资料并安全处理结果。',
    });
    const task = await service.waitForTask(accepted.taskId);
    assert.equal(task.status, 'failed');
    assert.equal(task.errorCode, 'tool_output_budget');
    assert.equal(task.canResume, false);
    assert.equal(existsSync(targetPath), false);
    assert.deepEqual(
      task.executionSteps.map((step) => [step.status, step.effectStatus]),
      [
        ['succeeded', 'none'],
        ['succeeded', 'none'],
        ['failed', 'not_applied'],
      ],
    );
    const checkpoint = store.getSocialWorkRuntimeCheckpoint(accepted.taskId);
    assert.equal(checkpoint.phase, 'failed');
    assert.equal(checkpoint.resumePhase, null);
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

test('project work is unavailable without an executor or FreeLLMAPI and does not open a folder picker', async () => {
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
      /Noema 项目执行器/,
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
    assert.match(starts[0].task, /你具备项目文件任务能力/u);
  } finally {
    await service.shutdown();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
