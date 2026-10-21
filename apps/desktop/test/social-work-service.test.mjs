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
    assert.equal(
      noemaRoom.workTasks[0].sourceMessageId,
      source.userMessageId,
    );
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

test('project tasks include only active coding adjustments and persist the exact input snapshot', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-social-adjustments-'),
  );
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const { db, store } = makeStore();
  const seen = [];
  const adjustments = [
    {
      id: 'coding-adjustment',
      sourceSurface: 'social',
      sourceRoomId: 'room-noema',
      sourceTurnId: 'turn-coding',
      scope: 'coding',
      situation: '任务阶段性结束但仍可推进',
      behavior: '继续到验收完成，只有阻塞或用户决策才停。',
      sourceQuote: '继续到验收完成',
      status: 'active',
      userEdited: false,
      editedAt: null,
    },
    {
      id: 'conversation-adjustment',
      sourceSurface: 'social',
      sourceRoomId: 'room-noema',
      sourceTurnId: 'turn-chat',
      scope: 'conversation',
      situation: '用户分享不愉快经历',
      behavior: '先回应当下，再问细节。',
      sourceQuote: '先回应当下',
      status: 'active',
      userEdited: false,
      editedAt: null,
    },
    {
      id: 'withdrawn-adjustment',
      sourceSurface: 'root',
      sourceRoomId: null,
      sourceTurnId: 'turn-withdrawn',
      scope: 'both',
      situation: '已撤回',
      behavior: '不得发送。',
      sourceQuote: '已撤回',
      status: 'withdrawn',
      userEdited: false,
      editedAt: null,
    },
  ];
  const service = new SocialWorkService({
    store,
    adapter: makeAdapter({ onStart: (input) => seen.push(input) }),
    secretStore: { isConfigured: () => true },
    getCodingInteractionAdjustments: () => adjustments,
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
    assert.deepEqual(task.interactionAdjustmentIds, ['coding-adjustment']);
    assert.deepEqual(
      task.interactionAdjustmentSnapshots.map((item) => item.id),
      ['coding-adjustment'],
    );
    assert.match(seen[0].task, /继续到验收完成/);
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
