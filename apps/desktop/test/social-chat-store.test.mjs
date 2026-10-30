import { createSocialTestStore } from '../test-support/social-team.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';

function makeStores() {
  const db = new Database(':memory:');
  new RootStore(db);
  const social = createSocialTestStore(db);
  return { db, social };
}

function insertLegacyMessage(db, { id, text, role = 'user' }) {
  const now = new Date().toISOString();
  const turnId = `turn-${id}`;
  const userMessageId = role === 'user' ? id : `user-${id}`;
  db.prepare(`
    INSERT INTO root_turns
      (id, conversation_id, user_message_id, status, created_at, updated_at)
    VALUES (?, 'root', ?, 'completed', ?, ?)
  `).run(turnId, userMessageId, now, now);
  db.prepare(`
    INSERT INTO root_messages
      (id, turn_id, role, content, status, attempt, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'complete', 1, 'test-model', ?, ?)
  `).run(id, turnId, role, text, now, now);
}

test('a fresh installation starts with only the real Noema conversation', () => {
  const db = new Database(':memory:');
  new RootStore(db);
  try {
    const store = new SocialChatStore(db);
    assert.deepEqual(
      store.listAgents().map((agent) => agent.id),
      ['noema'],
    );
    assert.deepEqual(
      store.listRooms().map((room) => room.id),
      ['room-noema'],
    );
    assert.deepEqual(store.getRoomSnapshot('room-noema').messages, []);
    const reopened = new SocialChatStore(db);
    assert.equal(reopened.listAgents().length, 1);
    assert.equal(reopened.listRooms().length, 1);
  } finally {
    db.close();
  }
});

test('legacy demo contacts and history survive without restoring revoked capabilities', () => {
  const { db, social } = makeStores();
  try {
    social.setAgentProjectWork('engineering-partner', false);
    const turn = social.beginTurn({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '升级时保留真实历史。',
      model: 'test-model',
    });
    social.appendAssistantDelta(turn.assistantMessageId, '这条记录应保留。');
    social.completeReply(turn.assistantMessageId);
    const reopened = new SocialChatStore(db);
    assert.deepEqual(reopened.getAgent('engineering-partner').capabilities, []);
    assert.ok(
      reopened
        .getRoomSnapshot('room-engineering-partner')
        .messages.some((message) => message.content === '这条记录应保留。'),
    );
    assert.equal(
      reopened.getRoomSnapshot('room-engineering-collaboration').members.length,
      2,
    );
  } finally {
    db.close();
  }
});

test('an explicit team fixture keeps one agent across independent rooms', () => {
  const { db, social } = makeStores();
  try {
    const { agents, rooms } = social.getSnapshot();
    assert.deepEqual(
      agents.map((agent) => agent.id),
      ['noema', 'engineering-partner'],
    );
    const friendRooms = rooms.filter((room) =>
      room.memberIds.includes('engineering-partner'),
    );
    assert.deepEqual(friendRooms.map((room) => room.id).sort(), [
      'room-engineering-collaboration',
      'room-engineering-partner',
    ]);
    assert.equal(social.getAgent('engineering-partner').kind, 'specialist');
    assert.deepEqual(social.getAgent('engineering-partner').capabilities, [
      'project-work',
    ]);
    assert.equal(
      db
        .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
        .get().version,
      26,
    );
  } finally {
    db.close();
  }
});

test('member-owned assets keep immutable revisions, provenance, and rollback', () => {
  const { db, social } = makeStores();
  try {
    const first = social.writeAgentAsset({
      agentId: 'engineering-partner',
      path: 'identity.md',
      content: '我擅长研究与工程协作。',
      reason: '两次项目经历都包含跨领域研究。',
      sourceTurnId: 'experience-turn-1',
      sourceProjectId: 'project-alpha',
    });
    assert.equal(first.revision, 1);
    assert.equal(first.sourceProjectId, 'project-alpha');
    assert.deepEqual(social.listAgentAssets('engineering-partner'), [
      {
        path: 'identity.md',
        revision: 1,
        characters: 11,
        reason: '两次项目经历都包含跨领域研究。',
        sourceTurnId: 'experience-turn-1',
        sourceProjectId: 'project-alpha',
        createdAt: first.createdAt,
      },
    ]);
    assert.match(
      social.getAgentAssetsForPrompt('engineering-partner'),
      /我擅长研究与工程协作/u,
    );

    const repeated = social.writeAgentAsset({
      agentId: 'engineering-partner',
      path: 'identity.md',
      content: '我擅长研究与工程协作。',
      reason: '两次项目经历都包含跨领域研究。',
      sourceTurnId: 'experience-turn-1',
      sourceProjectId: 'project-alpha',
    });
    assert.equal(repeated.id, first.id);

    const second = social.writeAgentAsset({
      agentId: 'engineering-partner',
      path: 'identity.md',
      content: '我以研究为主，也能协助工程验证。',
      reason: '近期经历补充了稳定的工程验证能力。',
      sourceTurnId: 'experience-turn-2',
      sourceProjectId: 'project-beta',
    });
    assert.equal(second.revision, 2);
    assert.throws(
      () =>
        social.restoreAgentAsset({
          agentId: 'engineering-partner',
          path: 'identity.md',
          revision: 1,
          expectedRevision: 1,
          reason: '不应覆盖更新版本。',
          sourceTurnId: 'rollback-stale',
        }),
      /版本已变化/u,
    );

    const restored = social.restoreAgentAsset({
      agentId: 'engineering-partner',
      path: 'identity.md',
      revision: 1,
      expectedRevision: 2,
      reason: '新描述尚未有足够证据。',
      sourceTurnId: 'rollback-turn',
    });
    assert.equal(restored.revision, 3);
    assert.equal(
      social.getAgentAsset('engineering-partner', 'identity.md').content,
      first.content,
    );
    assert.equal(
      social.listAgentAssetRevisions('engineering-partner', 'identity.md')
        .length,
      3,
    );
    const deleted = social.deleteAgentAsset({
      agentId: 'engineering-partner',
      path: 'identity.md',
      expectedRevision: 3,
      reason: '该定位已不再适用。',
      sourceTurnId: 'delete-turn',
    });
    assert.equal(deleted.revision, 4);
    assert.equal(
      social.getAgentAsset('engineering-partner', 'identity.md'),
      null,
    );
    const restoredDeleted = social.restoreAgentAsset({
      agentId: 'engineering-partner',
      path: 'identity.md',
      revision: 2,
      expectedRevision: 0,
      reason: '恢复仍适用的历史定位。',
      sourceTurnId: 'restore-deleted-turn',
    });
    assert.equal(restoredDeleted.revision, 5);
    assert.equal(
      social.listAgentAssetRevisions('engineering-partner', 'identity.md')[1]
        .isDeleted,
      1,
    );

    assert.throws(
      () =>
        social.writeAgentAsset({
          agentId: 'noema',
          path: 'memory.md',
          content: '不允许核心助手借此写成员资产。',
          reason: '权限边界测试。',
        }),
      /只有专业成员/u,
    );
    assert.throws(
      () => social.getAgentAsset('engineering-partner', '../memory.md'),
      /资产路径/u,
    );

    const reopened = new SocialChatStore(db);
    assert.equal(
      reopened.getAgentAsset('engineering-partner', 'identity.md').revision,
      5,
    );
  } finally {
    db.close();
  }
});

test('member skill index loads compact metadata and leaves full skill on demand', () => {
  const { db, social } = makeStores();
  try {
    social.writeAgentAsset({
      agentId: 'engineering-partner',
      path: 'skills/research/SKILL.md',
      content:
        '---\nname: Research\ndescription: Compare evidence and identify uncertainty.\n---\n\nFull skill instructions.',
      reason: '两次来源核对任务都复用了该流程。',
      sourceTurnId: 'skill-turn',
    });
    const prompt = social.getAgentAssetsForPrompt('engineering-partner');
    assert.match(prompt, /Compare evidence and identify uncertainty/u);
    assert.doesNotMatch(prompt, /Full skill instructions/u);
    assert.match(
      social.getAgentAsset('engineering-partner', 'skills/research/SKILL.md')
        .content,
      /Full skill instructions/u,
    );
  } finally {
    db.close();
  }
});

test('Noema internal assignments are attributed and persist in the agent resident chat', () => {
  const { db, social } = makeStores();
  try {
    const roomId = social.getAgentResidentRoomId('engineering-partner');
    const turn = social.beginTurn({
      roomId,
      agentId: 'engineering-partner',
      senderAgentId: 'noema',
      text: '核对这个接口的边界。',
      model: 'test-model',
    });
    social.appendAssistantDelta(turn.assistantMessageId, '接口边界已整理。');
    social.completeReply(turn.assistantMessageId);

    const messages = social.getRoomSnapshot(roomId).messages;
    assert.equal(messages.at(-2).role, 'user');
    assert.equal(messages.at(-2).senderAgentId, 'noema');
    assert.equal(messages.at(-1).agentId, 'engineering-partner');
    assert.deepEqual(
      social.getContext(roomId).map(({ role, content }) => ({ role, content })),
      [
        { role: 'user', content: '[Noema] 核对这个接口的边界。' },
        { role: 'assistant', content: '[工程搭档] 接口边界已整理。' },
      ],
    );
    assert.deepEqual(
      social
        .getContext(roomId, { ownAgentId: 'engineering-partner' })
        .map(({ role, content }) => ({ role, content })),
      [
        { role: 'user', content: '[Noema] 核对这个接口的边界。' },
        { role: 'assistant', content: '接口边界已整理。' },
      ],
    );
    assert.equal(
      social.listRooms().find((room) => room.id === roomId).preview.sender,
      '工程搭档',
    );

    const reopened = new SocialChatStore(db);
    assert.equal(
      reopened.getRoomSnapshot(roomId).messages.at(-2).senderAgentId,
      'noema',
    );
    assert.match(reopened.getContext(roomId).at(-2).content, /^\[Noema\]/u);
  } finally {
    db.close();
  }
});

test('message search spans rooms, matches literal text and returns local navigation context', () => {
  const { db, social } = makeStores();
  try {
    const turn = social.beginTurn({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: 'GitHub 项目费用为10%，待复核。',
      model: 'test-model',
    });
    social.appendAssistantDelta(turn.assistantMessageId, '我会继续核对。');
    social.completeReply(turn.assistantMessageId);

    const results = social.searchMessages('GITHUB');
    assert.equal(results.length, 1);
    assert.deepEqual(results[0], {
      id: turn.userMessageId,
      roomId: 'room-engineering-partner',
      roomTitle: '工程搭档',
      role: 'user',
      sender: '你',
      content: 'GitHub 项目费用为10%，待复核。',
      forwarded: false,
      createdAt: results[0].createdAt,
    });
    assert.equal(social.searchMessages('%').length, 1);
    const long = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '前文'.repeat(1000) + 'TAIL-MATCH' + '后文'.repeat(1000),
      model: 'test-model',
    });
    social.completeReply(long.assistantMessageId);
    const excerpt = social.searchMessages('tail-match')[0];
    assert.equal(excerpt.id, long.userMessageId);
    assert.match(excerpt.content, /TAIL-MATCH/);
    assert.ok(excerpt.content.length < 210);
    assert.ok(excerpt.content.startsWith('…') && excerpt.content.endsWith('…'));
    assert.throws(() => social.searchMessages('   '), /不能为空/);
  } finally {
    db.close();
  }
});

test('Noema history recall searches only its private room lineage and deletes source links with the source', () => {
  const { db, social } = makeStores();
  try {
    const prior = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'Minecraft 模组的碰撞箱用体素化工具生成后更稳定；夜光石是当时的回归测试名称。',
      model: 'test-model',
    });
    social.appendAssistantDelta(
      prior.assistantMessageId,
      '先采样方块边界，再校准碰撞箱。',
    );
    social.completeReply(prior.assistantMessageId);
    const child = social.createContinuationThread({
      sourceRoomId: 'room-noema',
      sourceIds: [prior.userMessageId],
      title: 'Minecraft 碰撞箱',
    });
    const childTurn = social.beginTurn({
      roomId: child.room.id,
      agentId: 'noema',
      text: '这轮记录：夜光石是回归测试名称。',
      model: 'test-model',
    });
    social.appendAssistantDelta(
      childTurn.assistantMessageId,
      '我会按这个名称继续。',
    );
    social.completeReply(childTurn.assistantMessageId);

    const privateTurn = social.beginTurn({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '不应被 Noema 主聊取回的标记：紫罗兰晶体。',
      model: 'test-model',
    });
    social.appendAssistantDelta(privateTurn.assistantMessageId, '已记录。');
    social.completeReply(privateTurn.assistantMessageId);

    const current = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '你还记得我们之前讨论的夜光石回归测试名称吗？',
      model: 'test-model',
    });
    const results = social.searchNoemaHistory(
      '你还记得我们之前讨论的夜光石回归测试名称吗？',
      current.turnId,
      current.roomId,
    );
    assert.ok(results.some((source) => source.id === childTurn.userMessageId));
    assert.ok(results.some((source) => source.id === prior.userMessageId));
    assert.equal(
      results.some((source) => source.snippet.includes('紫罗兰晶体')),
      false,
    );

    social.setReplyHistorySources(current.assistantMessageId, 'found', results);
    assert.equal(
      social.markReplyHistorySourcesIncluded(current.assistantMessageId),
      true,
    );
    let assistant = social
      .getRoomSnapshot('room-noema')
      .messages.find((message) => message.id === current.assistantMessageId);
    assert.equal(assistant.historySearchStatus, 'found');
    assert.equal(assistant.historySourcesIncluded, true);
    assert.ok(assistant.historySources.length > 0);
    assert.ok(
      assistant.historySources.every((source) =>
        ['Noema', 'Minecraft 碰撞箱'].includes(source.roomTitle),
      ),
    );

    social.deleteContinuationThread(child.room.id);
    assistant = social
      .getRoomSnapshot('room-noema')
      .messages.find((message) => message.id === current.assistantMessageId);
    assert.equal(assistant.historySearchStatus, 'found');
    assert.equal(
      assistant.historySources.some(
        (source) => source.roomId === child.room.id,
      ),
      false,
    );
    assert.ok(
      assistant.historySources.some(
        (source) => source.id === prior.userMessageId,
      ),
    );
    social.appendAssistantDelta(
      current.assistantMessageId,
      '我找到相关旧对话。',
    );
    social.completeReply(current.assistantMessageId);

    const noMatchTurn = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '你记得之前说过 zqv-9981 吗？',
      model: 'test-model',
    });
    assert.deepEqual(
      social.searchNoemaHistory(
        '你记得之前说过 zqv-9981 吗？',
        noMatchTurn.turnId,
        noMatchTurn.roomId,
      ),
      [],
    );
    assert.throws(
      () =>
        social.searchNoemaHistory(
          '你记得之前说过什么吗？',
          current.turnId,
          'room-engineering-collaboration',
        ),
      /只对 Noema 主私聊/u,
    );
  } finally {
    db.close();
  }
});

test('an app restart interrupts a running social project task without replaying it', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-restart',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\project',
      workspaceKey: 'c:\\scratch\\project',
      taskPrompt: '重启时不应自动重跑。',
      model: 'auto:noema-free',
    });
    social.setSocialWorkTaskSession('task-restart', 'session-restart');
    assert.equal(social.getSocialWorkTask('task-restart').status, 'running');

    new SocialChatStore(db);

    const task = social.getSocialWorkTask('task-restart');
    assert.equal(task.status, 'interrupted');
    assert.equal(task.runtimeSessionId, 'session-restart');
    assert.equal(task.errorCode, 'app_restarted');
  } finally {
    db.close();
  }
});

test('only a model-boundary Noema checkpoint can be explicitly resumed', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-safe-resume',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\project',
      workspaceKey: 'c:\\scratch\\project',
      taskPrompt: '继续已保存的模型轮次。',
      model: 'auto:noema-free',
      executionEngine: 'noema',
    });
    social.setSocialWorkTaskSession('task-safe-resume', 'session-safe');
    social.saveSocialWorkRuntimeCheckpoint('task-safe-resume', {
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'task' },
      ],
      round: 0,
      toolCallCount: 0,
      phase: 'ready_for_model',
    });

    new SocialChatStore(db);
    const interrupted = social.getSocialWorkTask('task-safe-resume');
    assert.equal(interrupted.status, 'interrupted');
    assert.equal(interrupted.canResume, true);

    const resumed = social.resumeSocialWorkTask('task-safe-resume');
    assert.equal(resumed.status, 'starting');
    assert.equal(resumed.canResume, false);
    assert.throws(
      () => social.resumeSocialWorkTask('task-safe-resume'),
      /不能从检查点继续/u,
    );
  } finally {
    db.close();
  }
});

test('a provider-failure checkpoint cannot resume with an unresolved write', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-provider-failure-unknown-write',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\project',
      workspaceKey: 'c:\\scratch\\project',
      taskPrompt: '不要重放结果未知的写入。',
      model: 'test-model',
      executionEngine: 'noema',
    });
    social.setSocialWorkTaskSession(
      'task-provider-failure-unknown-write',
      'session-provider-failure',
    );
    social.startSocialWorkExecutionStep('task-provider-failure-unknown-write', {
      id: 'unknown-write',
      externalCallId: 'write-call',
      arguments: JSON.stringify({ path: 'out.txt', content: 'maybe written' }),
      toolName: 'write_file',
      category: 'write',
      hasSideEffect: true,
    });
    social.saveSocialWorkRuntimeCheckpoint(
      'task-provider-failure-unknown-write',
      {
        messages: [{ role: 'user', content: 'task' }],
        round: 1,
        toolCallCount: 1,
        phase: 'failed',
        resumePhase: 'ready_for_model',
      },
    );
    social.finishSocialWorkTask('task-provider-failure-unknown-write', {
      status: 'failed',
      runtimeSessionId: 'session-provider-failure',
      errorCode: 'provider_unavailable',
      errorMessage: '模型供应商不可用。',
      toolCallCount: 1,
    });

    const task = social.getSocialWorkTask(
      'task-provider-failure-unknown-write',
    );
    assert.equal(task.canResume, false);
    assert.throws(
      () => social.resumeSocialWorkTask('task-provider-failure-unknown-write'),
      /不满足安全续接条件/u,
    );
  } finally {
    db.close();
  }
});

test('project work records safe tool outcomes and marks in-flight writes unknown after restart', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-step-recovery',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\project',
      workspaceKey: 'c:\\scratch\\project',
      taskPrompt: '记录工具状态，但不要重放未确认的写入。',
      model: 'auto:noema-free',
    });
    social.setSocialWorkTaskSession('task-step-recovery', 'session-step');
    assert.throws(
      () =>
        social.saveSocialWorkRuntimeCheckpoint('task-step-recovery', {
          messages: [{ role: 'user', content: 'x'.repeat(1_000_001) }],
        }),
      /1 MB/u,
    );
    social.startSocialWorkExecutionStep('task-step-recovery', {
      id: 'step-read',
      externalCallId: 'call-read',
      arguments: JSON.stringify({ path: 'notes.md' }),
      toolName: 'read_file',
      category: 'read',
      hasSideEffect: false,
    });
    social.finishSocialWorkExecutionStep('task-step-recovery', 'step-read', {
      status: 'succeeded',
      effectStatus: 'none',
      resultContent: JSON.stringify({ result: 'persisted note contents' }),
    });
    social.saveSocialWorkRuntimeCheckpoint('task-step-recovery', {
      messages: [
        { role: 'system', content: 'bounded system context' },
        { role: 'user', content: 'read notes.md' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-read',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ path: 'notes.md' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call-read',
          content: JSON.stringify({ result: 'persisted note contents' }),
        },
      ],
      round: 1,
      toolCallCount: 1,
      phase: 'ready_for_model',
    });
    social.startSocialWorkExecutionStep('task-step-recovery', {
      id: 'step-write',
      externalCallId: 'call-write',
      arguments: JSON.stringify({ path: 'out.txt', content: 'pending' }),
      toolName: 'write',
      category: 'write',
      hasSideEffect: true,
    });

    new SocialChatStore(db);

    const task = social.getSocialWorkTask('task-step-recovery');
    assert.equal(task.status, 'interrupted');
    assert.equal(task.canResume, false);
    assert.deepEqual(
      task.executionSteps.map(({ category, status, effectStatus }) => ({
        category,
        status,
        effectStatus,
      })),
      [
        { category: 'read', status: 'succeeded', effectStatus: 'none' },
        {
          category: 'write',
          status: 'outcome_unknown',
          effectStatus: 'unknown',
        },
      ],
    );
    assert.deepEqual(Object.keys(task.executionSteps[1]).sort(), [
      'category',
      'completedAt',
      'effectStatus',
      'externalCallId',
      'hasSideEffect',
      'id',
      'ordinal',
      'startedAt',
      'status',
      'taskId',
      'toolName',
    ]);
    const checkpoint =
      social.getSocialWorkRuntimeCheckpoint('task-step-recovery');
    assert.equal(checkpoint.phase, 'interrupted');
    assert.equal(checkpoint.resumePhase, 'ready_for_model');
    assert.equal(checkpoint.round, 1);
    assert.deepEqual(checkpoint.messages.at(-1), {
      role: 'tool',
      tool_call_id: 'call-read',
      content: JSON.stringify({ result: 'persisted note contents' }),
    });
    assert.equal(
      db
        .prepare(
          'SELECT result_json FROM social_work_execution_steps WHERE id = ?',
        )
        .get('step-read').result_json,
      JSON.stringify({ result: 'persisted note contents' }),
    );
    assert.deepEqual(
      social.getRoomSnapshot('room-engineering-partner').workTasks[0]
        .executionSteps,
      task.executionSteps,
    );
  } finally {
    db.close();
  }
});

test('tool outcome and resumable checkpoint commit atomically', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-atomic-checkpoint',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\project',
      workspaceKey: 'c:\\scratch\\project',
      taskPrompt: '工具结果与恢复状态必须一起保存。',
      model: 'test-model',
    });
    social.setSocialWorkTaskSession('task-atomic-checkpoint', 'session-atomic');
    social.startSocialWorkExecutionStep('task-atomic-checkpoint', {
      id: 'step-atomic',
      externalCallId: 'call-atomic',
      arguments: '{}',
      toolName: 'read_file',
      category: 'read',
      hasSideEffect: false,
    });

    const outcome = {
      status: 'succeeded',
      effectStatus: 'none',
      resultContent: '{"result":"read"}',
    };
    assert.throws(
      () =>
        social.finishSocialWorkExecutionStepWithCheckpoint(
          'task-atomic-checkpoint',
          'step-atomic',
          outcome,
          { messages: 'invalid' },
        ),
      /1 MB/u,
    );
    assert.equal(
      social.listSocialWorkExecutionSteps('task-atomic-checkpoint')[0].status,
      'running',
    );
    assert.equal(
      social.getSocialWorkRuntimeCheckpoint('task-atomic-checkpoint'),
      null,
    );

    social.finishSocialWorkExecutionStepWithCheckpoint(
      'task-atomic-checkpoint',
      'step-atomic',
      outcome,
      {
        messages: [
          { role: 'user', content: 'read file' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call-atomic' }],
          },
          {
            role: 'tool',
            tool_call_id: 'call-atomic',
            content: '{"result":"read"}',
          },
        ],
        round: 1,
        toolCallCount: 1,
        phase: 'ready_for_model',
      },
    );
    assert.equal(
      social.listSocialWorkExecutionSteps('task-atomic-checkpoint')[0].status,
      'succeeded',
    );
    assert.equal(
      social.getSocialWorkRuntimeCheckpoint('task-atomic-checkpoint').phase,
      'ready_for_model',
    );
  } finally {
    db.close();
  }
});

test('social chat schema v1 upgrades additively to project-work state', () => {
  const { db, social } = makeStores();
  try {
    const message = social.beginTurn({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '保留的私聊标记：银杏',
      model: 'test-model',
    });
    social.appendAssistantDelta(message.assistantMessageId, '已保存。');
    social.completeReply(message.assistantMessageId);
    db.exec(`
      ALTER TABLE social_work_tasks DROP COLUMN project_plan_item_id;
      ALTER TABLE social_work_tasks DROP COLUMN project_result_pending;
      DELETE FROM social_schema_migrations WHERE version = 26; DELETE FROM social_schema_migrations WHERE version = 25;
      ALTER TABLE social_project_growth_batches DROP COLUMN finalized_at;
      DROP TABLE social_project_growth_members;
      DROP TABLE social_project_growth_batches;
      DELETE FROM social_schema_migrations WHERE version = 24;
      DELETE FROM social_schema_migrations WHERE version = 23;
      DROP TABLE IF EXISTS social_project_dispatch_log;
      DROP TABLE IF EXISTS social_project_publications;
      DROP TABLE IF EXISTS social_project_read_cursors;
      DELETE FROM social_schema_migrations WHERE version = 22;
      DROP TABLE social_project_plan_revisions;
      DELETE FROM social_schema_migrations WHERE version = 21;
      DROP TABLE social_agent_asset_revisions;
      DELETE FROM social_schema_migrations WHERE version = 20;
      DROP TABLE social_project_group_inbox;
      DROP TABLE social_project_reports;
      DELETE FROM social_schema_migrations WHERE version = 19;
      DELETE FROM social_schema_migrations WHERE version = 18;
      DROP TABLE social_work_runtime_checkpoints;
      DELETE FROM social_schema_migrations WHERE version = 17;
      ALTER TABLE social_messages DROP COLUMN sender_agent_id;
      DELETE FROM social_schema_migrations WHERE version = 16;
      DROP TABLE social_project_reviews;
      DELETE FROM social_schema_migrations WHERE version = 15;
      DROP TABLE social_project_sessions;
      DROP TABLE social_projects;
      DELETE FROM social_schema_migrations WHERE version = 12;
      DROP TABLE social_work_execution_steps;
      DELETE FROM social_schema_migrations WHERE version = 14;
      DELETE FROM social_schema_migrations WHERE version = 13;
      ALTER TABLE social_work_tasks DROP COLUMN execution_engine;
      DROP TABLE social_work_tasks;
      DELETE FROM social_schema_migrations WHERE version = 2;
      DELETE FROM social_schema_migrations WHERE version = 3;
      DELETE FROM social_schema_migrations WHERE version = 4;
      DELETE FROM social_schema_migrations WHERE version = 5;
      DELETE FROM social_schema_migrations WHERE version = 6;
      DELETE FROM social_schema_migrations WHERE version = 7;
      DELETE FROM social_schema_migrations WHERE version = 8;
      ALTER TABLE social_agents DROP COLUMN capabilities_json;
      ALTER TABLE social_agents DROP COLUMN archived_at;
      ALTER TABLE social_messages DROP COLUMN forwarded_sources_json;
      ALTER TABLE social_messages DROP COLUMN reply_to_message_id;
      ALTER TABLE social_messages DROP COLUMN reply_to_json;
      ALTER TABLE social_messages DROP COLUMN interaction_adjustment_ids_json;
      ALTER TABLE social_messages DROP COLUMN interaction_adjustment_snapshots_json;
      ALTER TABLE social_messages DROP COLUMN interaction_adjustment_attempts_json;
      DROP INDEX social_rooms_parent_order;
      ALTER TABLE social_rooms DROP COLUMN parent_room_id;
      ALTER TABLE social_rooms DROP COLUMN origin_message_id;
      ALTER TABLE social_rooms DROP COLUMN closed_at;
      DELETE FROM social_schema_migrations WHERE version = 9;
      DELETE FROM social_schema_migrations WHERE version = 10;
      DELETE FROM social_schema_migrations WHERE version = 11;
      DROP TABLE social_message_history_sources;
      ALTER TABLE social_messages DROP COLUMN history_search_status;
      ALTER TABLE social_messages DROP COLUMN history_sources_included;
    `);

    const upgraded = new SocialChatStore(db);
    const room = upgraded.getRoomSnapshot('room-engineering-partner');
    assert.equal(
      room.messages.some((item) => item.content.includes('银杏')),
      true,
    );
    assert.deepEqual(upgraded.getAgent('engineering-partner').capabilities, [
      'project-work',
    ]);
    assert.equal(
      db
        .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
        .get().version,
      26,
    );
    assert.equal(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'social_work_tasks'",
        )
        .get() !== undefined,
      true,
    );
  } finally {
    db.close();
  }
});

test('social schema v7 adds retry snapshots without rewriting the last known attempt', () => {
  const { db, social } = makeStores();
  try {
    const turn = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'E2E 旧尝试标记',
      model: 'test-model',
      interactionAdjustmentSnapshots: [
        {
          id: 'v7-adjustment',
          scope: 'conversation',
          sourceSurface: 'social',
          sourceRoomId: 'room-noema',
          situation: '用户分享近况',
          behavior: '先自然接话。',
          sourceQuote: '自然接话',
          userEdited: false,
          editedAt: null,
        },
      ],
    });
    social.failReply(turn.assistantMessageId, 'test_failure', '重试前失败');
    db.exec(`
      ALTER TABLE social_work_tasks DROP COLUMN project_plan_item_id;
      ALTER TABLE social_work_tasks DROP COLUMN project_result_pending;
      DELETE FROM social_schema_migrations WHERE version = 26; DELETE FROM social_schema_migrations WHERE version = 25;
      ALTER TABLE social_project_growth_batches DROP COLUMN finalized_at;
      DROP TABLE social_project_growth_members;
      DROP TABLE social_project_growth_batches;
      DELETE FROM social_schema_migrations WHERE version = 24;
      DELETE FROM social_schema_migrations WHERE version = 23;
      DROP TABLE IF EXISTS social_project_dispatch_log;
      DROP TABLE IF EXISTS social_project_publications;
      DROP TABLE IF EXISTS social_project_read_cursors;
      DELETE FROM social_schema_migrations WHERE version = 22;
      DROP TABLE IF EXISTS social_project_plan_revisions;
      DELETE FROM social_schema_migrations WHERE version = 21;
      DROP TABLE social_agent_asset_revisions;
      DELETE FROM social_schema_migrations WHERE version = 20;
      DROP TABLE social_project_group_inbox;
      DROP TABLE social_project_reports;
      DELETE FROM social_schema_migrations WHERE version = 19;
      DELETE FROM social_schema_migrations WHERE version = 18;
      DROP TABLE social_work_runtime_checkpoints;
      DELETE FROM social_schema_migrations WHERE version = 17;
      ALTER TABLE social_messages DROP COLUMN sender_agent_id;
      DELETE FROM social_schema_migrations WHERE version = 16;
      DROP TABLE social_work_execution_steps;
      DELETE FROM social_schema_migrations WHERE version = 14;
      DELETE FROM social_schema_migrations WHERE version = 13;
      ALTER TABLE social_work_tasks DROP COLUMN execution_engine;
      DROP TABLE social_project_reviews;
      DELETE FROM social_schema_migrations WHERE version = 15;
      DROP TABLE social_project_sessions;
      DROP TABLE social_projects;
      DELETE FROM social_schema_migrations WHERE version = 12;
      ALTER TABLE social_messages DROP COLUMN interaction_adjustment_attempts_json;
      DROP INDEX social_work_tasks_source_message;
      ALTER TABLE social_work_tasks DROP COLUMN source_message_id;
      DELETE FROM social_schema_migrations WHERE version = 8;
      DROP INDEX social_rooms_parent_order;
      ALTER TABLE social_rooms DROP COLUMN parent_room_id;
      ALTER TABLE social_rooms DROP COLUMN origin_message_id;
      ALTER TABLE social_rooms DROP COLUMN closed_at;
      DELETE FROM social_schema_migrations WHERE version = 9;
      DELETE FROM social_schema_migrations WHERE version = 10;
      DELETE FROM social_schema_migrations WHERE version = 11;
      DROP TABLE social_message_history_sources;
      ALTER TABLE social_messages DROP COLUMN history_search_status;
      ALTER TABLE social_messages DROP COLUMN history_sources_included;
    `);

    const upgraded = new SocialChatStore(db);
    const failed = upgraded
      .getRoomSnapshot('room-noema')
      .messages.find((message) => message.id === turn.assistantMessageId);
    assert.equal(failed?.attempt, 1);
    assert.equal(
      failed?.interactionAdjustmentSnapshots[0]?.id,
      'v7-adjustment',
    );

    const retried = upgraded.retryReply(
      turn.assistantMessageId,
      'next-model',
      [],
    );
    assert.deepEqual(
      retried.interactionAdjustmentAttempts.map((attempt) => ({
        attempt: attempt.attempt,
        ids: attempt.interactionAdjustmentIds,
      })),
      [
        { attempt: 1, ids: ['v7-adjustment'] },
        { attempt: 2, ids: [] },
      ],
    );
  } finally {
    db.close();
  }
});

test('legacy root messages are copied once into Noema DM without changing source rows', () => {
  const db = new Database(':memory:');
  try {
    new RootStore(db);
    insertLegacyMessage(db, {
      id: 'legacy-user-1',
      text: '旧对话标记：山茶花',
    });
    insertLegacyMessage(db, {
      id: 'legacy-assistant-1',
      text: '我看到了山茶花。',
      role: 'assistant',
    });
    const before = db
      .prepare('SELECT COUNT(*) AS count FROM root_messages')
      .get().count;
    const social = createSocialTestStore(db);
    const noemaRoom = social.getRoomSnapshot('room-noema');
    assert.equal(noemaRoom.messages.length, 2);
    assert.equal(noemaRoom.messages[0].content, '旧对话标记：山茶花');
    assert.equal(noemaRoom.messages[1].agentId, 'noema');
    assert.equal(noemaRoom.messages[1].legacySourceId, 'legacy-assistant-1');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM root_messages').get().count,
      before,
    );

    new SocialChatStore(db);
    assert.equal(social.getRoomSnapshot('room-noema').messages.length, 2);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM root_messages').get().count,
      before,
    );
  } finally {
    db.close();
  }
});

test('model context is room-scoped and preserves whitespace in streamed deltas', () => {
  const { db, social } = makeStores();
  try {
    const turn = social.beginTurn({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '只在私聊里的标记：紫罗兰',
      model: 'test-model',
    });
    social.appendAssistantDelta(turn.assistantMessageId, '答复开头 ');
    social.appendAssistantDelta(turn.assistantMessageId, '与结尾\n');
    social.completeReply(turn.assistantMessageId);

    const directContext = social.getContext('room-engineering-partner');
    const groupContext = social.getContext('room-engineering-collaboration');
    assert.match(directContext[0].content, /紫罗兰/u);
    assert.match(directContext[1].content, /答复开头 与结尾\n/u);
    assert.equal(
      groupContext.some((message) => message.content.includes('紫罗兰')),
      false,
    );
    assert.equal(
      social.getAgent('engineering-partner').systemPrompt.includes('工程搭档'),
      true,
    );
  } finally {
    db.close();
  }
});

test('message forwarding snapshots only selected complete messages from the source room', () => {
  const { db, social } = makeStores();
  try {
    const created = social.createAgent({
      name: '版本观察员',
      headline: '长期跟踪 AI 模型发布',
      description: '核对来源后再回答。',
    });
    const agentId = created.members[0].id;
    const sourceTurn = social.beginTurn({
      roomId: created.room.id,
      agentId,
      text: '以后关注模型更新时请优先看 OpenAI 官方发布说明。',
      model: 'test-model',
    });
    social.appendAssistantDelta(
      sourceTurn.assistantMessageId,
      '我会先检查 OpenAI 官方发布说明。',
    );
    social.completeReply(sourceTurn.assistantMessageId);
    const secondSourceTurn = social.beginTurn({
      roomId: created.room.id,
      agentId,
      text: 'OpenAI 官方发布页面是模型版本信息的一手来源。',
      model: 'test-model',
    });
    social.appendAssistantDelta(
      secondSourceTurn.assistantMessageId,
      '这次也会优先核对 OpenAI 官方发布页面。',
    );
    social.completeReply(secondSourceTurn.assistantMessageId);
    const incompleteTurn = social.beginTurn({
      roomId: created.room.id,
      agentId,
      text: 'OpenAI 官方发布中断消息不能被转发。',
      model: 'test-model',
    });
    social.failReply(
      incompleteTurn.assistantMessageId,
      'test_failed',
      '未完成的 assistant 回合',
    );
    const systemMessageId = 'test-system-history-result';
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO social_messages
        (id, room_id, turn_id, role, content, status, runtime, created_at, updated_at)
      VALUES (?, ?, ?, 'system', ?, 'complete', 'system', ?, ?)
    `).run(
      systemMessageId,
      created.room.id,
      'test-system-history-turn',
      'OpenAI 官方发布 system event 不可转发。',
      now,
      now,
    );

    const noemaTurn = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'OpenAI 官方发布资料只在 Noema 私聊中。',
      model: 'test-model',
    });
    social.appendAssistantDelta(noemaTurn.assistantMessageId, '收到。');
    social.completeReply(noemaTurn.assistantMessageId);

    const group = social.createGroup({
      title: '模型观察',
      agentIds: ['noema', agentId],
    });
    const sourceIds = [
      sourceTurn.userMessageId,
      secondSourceTurn.assistantMessageId,
    ];
    const forwarded = social.resolveForwardSources({
      sourceRoomId: created.room.id,
      targetRoomId: group.room.id,
      sourceIds,
    });
    assert.equal(forwarded.length, 2);
    assert.deepEqual(
      forwarded.map((source) => source.id),
      sourceIds,
    );
    assert.equal(
      forwarded.every((source) => source.roomTitle === '版本观察员'),
      true,
    );
    assert.equal(forwarded[0].sender, '你');
    assert.equal(forwarded[1].sender, '版本观察员');
    assert.match(forwarded[0].content, /OpenAI 官方发布说明/u);
    assert.equal(
      forwarded.some(
        (source) => source.id === incompleteTurn.assistantMessageId,
      ),
      false,
    );
    assert.throws(
      () =>
        social.resolveForwardSources({
          sourceRoomId: created.room.id,
          targetRoomId: group.room.id,
          sourceIds: [systemMessageId],
        }),
      /不可转发/u,
    );
    assert.throws(
      () =>
        social.resolveForwardSources({
          sourceRoomId: created.room.id,
          targetRoomId: created.room.id,
          sourceIds: [sourceTurn.userMessageId],
        }),
      /另一间聊天/u,
    );
    assert.throws(
      () =>
        social.resolveForwardSources({
          sourceRoomId: created.room.id,
          targetRoomId: group.room.id,
          sourceIds: [sourceTurn.userMessageId, sourceTurn.userMessageId],
        }),
      /不能重复/u,
    );
  } finally {
    db.close();
  }
});

test('continuation threads preserve visible source context and room lineage', () => {
  const { db, social } = makeStores();
  try {
    const sourceTurn = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '几天后继续比较各平台 AI 订阅价格。',
      model: 'test-model',
    });
    social.appendAssistantDelta(
      sourceTurn.assistantMessageId,
      '先确定要跟踪的平台和计费周期。',
    );
    social.completeReply(sourceTurn.assistantMessageId);

    const thread = social.createContinuationThread({
      sourceRoomId: 'room-noema',
      sourceIds: [sourceTurn.userMessageId, sourceTurn.assistantMessageId],
      title: 'AI 订阅价格',
    });
    assert.equal(thread.room.parentRoomId, 'room-noema');
    assert.equal(thread.room.originMessageId, sourceTurn.userMessageId);
    assert.equal(thread.room.closedAt, null);
    assert.deepEqual(
      thread.members.map((member) => member.id),
      ['noema'],
    );
    assert.deepEqual(
      thread.messages[0].forwardedSources.map((source) => source.id),
      [sourceTurn.userMessageId, sourceTurn.assistantMessageId],
    );
    const roomListEntry = social
      .listRooms()
      .find((room) => room.id === thread.room.id);
    assert.equal(roomListEntry.parentRoomId, 'room-noema');
    assert.equal(
      social
        .getContext(thread.room.id)
        .some((message) => message.content.includes('比较各平台 AI 订阅价格')),
      true,
    );
    assert.throws(
      () =>
        social.createContinuationThread({
          sourceRoomId: 'room-engineering-partner',
          sourceIds: [sourceTurn.userMessageId],
          title: '无效来源',
        }),
      /Noema 的主聊天/u,
    );
  } finally {
    db.close();
  }
});

test('continuation threads keep their origin in the bounded context and can close and reopen', () => {
  const { db, social } = makeStores();
  try {
    const sourceTurn = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '持续跟踪某类产品的变化。',
      model: 'test-model',
    });
    social.appendAssistantDelta(sourceTurn.assistantMessageId, '可以继续。');
    social.completeReply(sourceTurn.assistantMessageId);
    const thread = social.createContinuationThread({
      sourceRoomId: 'room-noema',
      sourceIds: [sourceTurn.userMessageId, sourceTurn.assistantMessageId],
      title: '产品变化跟踪',
    });

    for (let index = 0; index < 22; index += 1) {
      const turn = social.beginTurn({
        roomId: thread.room.id,
        agentId: 'noema',
        text: `后续交流 ${index}`,
        model: 'test-model',
      });
      social.appendAssistantDelta(turn.assistantMessageId, `回复 ${index}`);
      social.completeReply(turn.assistantMessageId);
    }
    const context = social.getContext(thread.room.id);
    assert.equal(context.length, 40);
    assert.equal(
      context.some((message) =>
        message.content.includes('持续跟踪某类产品的变化'),
      ),
      true,
    );

    const closed = social.setContinuationThreadClosed(thread.room.id, true);
    assert.ok(closed.room.closedAt);
    assert.throws(
      () =>
        social.beginTurn({
          roomId: thread.room.id,
          agentId: 'noema',
          text: '已结束线程不能继续发送',
          model: 'test-model',
        }),
      /主题已结束/u,
    );
    assert.throws(
      () =>
        social.appendForwardedMessage({
          sourceRoomId: thread.room.id,
          sourceIds: [thread.messages[0].id],
          targetRoomId: 'room-engineering-partner',
        }),
      /主题已结束/u,
    );
    const reopened = social.setContinuationThreadClosed(thread.room.id, false);
    assert.equal(reopened.room.closedAt, null);
    const resumed = social.beginTurn({
      roomId: thread.room.id,
      agentId: 'noema',
      text: '重新打开后继续',
      model: 'test-model',
    });
    social.appendAssistantDelta(resumed.assistantMessageId, '继续中。');
    social.completeReply(resumed.assistantMessageId);

    db.prepare('DELETE FROM social_rooms WHERE id = ?').run('room-noema');
    assert.equal(
      db.prepare('SELECT 1 FROM social_rooms WHERE id = ?').get(thread.room.id),
      undefined,
    );
  } finally {
    db.close();
  }
});

test('social context budgets whole recent turns while retaining the thread origin and latest request', () => {
  const { db, social } = makeStores();
  try {
    const source = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '保留主题起点。',
      model: 'test-model',
    });
    social.appendAssistantDelta(source.assistantMessageId, '主题已建立。');
    social.completeReply(source.assistantMessageId);
    const thread = social.createContinuationThread({
      sourceRoomId: 'room-noema',
      sourceIds: [source.userMessageId, source.assistantMessageId],
      title: '上下文预算检查',
    });

    for (const [text, reply] of [
      ['旧'.repeat(4_000), '旧答'.repeat(2_000)],
      ['近'.repeat(4_000), '近答'.repeat(2_000)],
      ['当前请求需要完整保留。', '已完成。'],
    ]) {
      const turn = social.beginTurn({
        roomId: thread.room.id,
        agentId: 'noema',
        text,
        model: 'test-model',
      });
      social.appendAssistantDelta(turn.assistantMessageId, reply);
      social.completeReply(turn.assistantMessageId);
    }

    const context = social.getContext(thread.room.id);
    const content = context.map((message) => message.content).join('\n');
    assert.match(content, /保留主题起点/u);
    assert.match(content, /当前请求需要完整保留/u);
    assert.match(content, /近答/u);
    assert.doesNotMatch(content, /旧答/u);
    assert.ok(content.length < 13_000);
    assert.equal(
      social
        .getRoomSnapshot(thread.room.id)
        .messages.some((message) => message.content.includes('旧答')),
      true,
    );
  } finally {
    db.close();
  }
});

test('deleting a continuation thread removes only that branch', () => {
  const { db, social } = makeStores();
  try {
    const turn = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '为之后的工作留下一个独立脉络。',
      model: 'test-model',
    });
    social.appendAssistantDelta(turn.assistantMessageId, '好的。');
    social.completeReply(turn.assistantMessageId);
    const thread = social.createContinuationThread({
      sourceRoomId: 'room-noema',
      sourceIds: [turn.assistantMessageId, turn.userMessageId],
      title: '独立脉络',
    });
    assert.equal(thread.room.originMessageId, turn.userMessageId);
    const result = social.deleteContinuationThread(thread.room.id);
    assert.equal(result.parentRoomId, 'room-noema');
    assert.equal(
      db.prepare('SELECT 1 FROM social_rooms WHERE id = ?').get(thread.room.id),
      undefined,
    );
    assert.ok(
      db.prepare('SELECT 1 FROM social_rooms WHERE id = ?').get('room-noema'),
    );
    assert.ok(
      db
        .prepare('SELECT 1 FROM social_messages WHERE id = ?')
        .get(turn.userMessageId),
    );
  } finally {
    db.close();
  }
});

test('only completed independently verified cases are available across rooms', () => {
  const { db, social } = makeStores();
  const workspaceKey = 'c:\\scratch\\same-project';
  db.prepare('UPDATE social_agents SET capabilities_json = ? WHERE id = ?').run(
    JSON.stringify(['project-work']),
    'noema',
  );
  const createTask = ({
    id,
    roomId = 'room-engineering-partner',
    agentId = 'engineering-partner',
    key = workspaceKey,
    status = 'completed',
    verificationStatus = 'verified',
  }) => {
    social.createSocialWorkTask({
      id,
      roomId,
      agentId,
      workspacePath: key,
      workspaceKey: key,
      taskPrompt: `任务 ${id}`,
      model: 'test-model',
      verificationChecks: [{ kind: 'file_exists', path: 'README.md' }],
    });
    social.finishSocialWorkTask(id, {
      status,
      resultText: `结果 ${id}`,
      verificationStatus,
      verificationResults: [
        {
          kind: 'file_exists',
          path: 'README.md',
          status: verificationStatus,
          reason: 'test',
        },
      ],
    });
  };

  try {
    createTask({ id: 'older-verified' });
    createTask({ id: 'newer-failed', status: 'failed' });
    createTask({ id: 'not-verified', verificationStatus: 'unavailable' });
    createTask({ id: 'other-room', roomId: 'room-engineering-collaboration' });
    createTask({
      id: 'other-agent',
      agentId: 'noema',
      roomId: 'room-engineering-collaboration',
    });
    createTask({ id: 'other-workspace', key: 'c:\\scratch\\other-project' });

    let candidate = social.findReusableCase({
      agentId: 'engineering-partner',
      workspaceKey,
      excludeRoomId: 'room-engineering-collaboration',
    });
    assert.equal(candidate?.taskId, 'older-verified');
    assert.equal(candidate?.roomId, 'room-engineering-partner');

    social.setSocialWorkTaskCaseEligible('older-verified', false);
    candidate = social.findReusableCase({
      agentId: 'engineering-partner',
      workspaceKey,
      excludeRoomId: 'room-engineering-collaboration',
    });
    assert.equal(candidate, null);
    assert.equal(
      social.getSocialWorkTask('older-verified').caseEligible,
      false,
    );
  } finally {
    db.close();
  }
});

test('group creation requires a valid participant and adds isolated room membership', () => {
  const { db, social } = makeStores();
  try {
    const created = social.createGroup({
      title: '产品讨论',
      agentIds: ['noema', 'engineering-partner'],
    });
    assert.equal(created.room.kind, 'group');
    assert.deepEqual(
      created.members.map((member) => member.id),
      ['noema', 'engineering-partner'],
    );
    assert.throws(
      () => social.createGroup({ title: '空群', agentIds: [] }),
      /至少选择一位联系人/u,
    );
  } finally {
    db.close();
  }
});

test('a user-created specialist keeps one identity across a fresh DM, group, and reversible archive', () => {
  const { db, social } = makeStores();
  try {
    const created = social.createAgent({
      name: '图形观察员',
      headline: '长期观察游戏视觉与交互',
      description: '先和我厘清体验，再讨论如何验证。',
    });
    const agent = created.members[0];
    const agentId = agent.id;
    const directRoomId = created.room.id;
    assert.match(agentId, /^agent-/u);
    assert.equal(created.room.kind, 'direct');
    assert.deepEqual(agent.capabilities, []);
    assert.equal(agent.archivedAt, null);
    assert.equal(created.messages.length, 1);
    assert.equal(created.messages[0].role, 'system');
    assert.match(
      agent.systemPrompt ?? social.getAgent(agentId).systemPrompt,
      /不证明你已经具备对应领域的专家水平/u,
    );
    assert.equal(created.messages[0].content.includes('已成为联系人'), true);
    assert.match(social.getAgent(agentId).systemPrompt, /当前只有聊天能力/u);
    const projectWorkEnabled = social.setAgentProjectWork(agentId, true);
    assert.deepEqual(projectWorkEnabled.capabilities, ['project-work']);
    assert.match(
      projectWorkEnabled.systemPrompt,
      /你具备项目文件任务能力/u,
    );
    const projectWorkDisabled = social.setAgentProjectWork(agentId, false);
    assert.deepEqual(projectWorkDisabled.capabilities, []);
    assert.match(projectWorkDisabled.systemPrompt, /当前只有聊天能力/u);

    const dmTurn = social.beginTurn({
      roomId: directRoomId,
      agentId,
      text: '只在新联系人私聊中的标记：琥珀',
      model: 'test-model',
    });
    social.appendAssistantDelta(
      dmTurn.assistantMessageId,
      '我会在当前私聊里继续。',
    );
    social.completeReply(dmTurn.assistantMessageId);
    const group = social.createGroup({
      title: '图形研究',
      agentIds: ['noema', agentId],
    });
    assert.equal(
      group.members.some((member) => member.id === agentId),
      true,
    );
    assert.equal(
      group.messages.some((message) => message.content.includes('琥珀')),
      false,
    );

    const archived = social.setAgentArchived(agentId, true);
    assert.equal(typeof archived.archivedAt, 'string');
    assert.equal(
      social
        .getRoomSnapshot(directRoomId)
        .messages.some((message) => message.content.includes('琥珀')),
      true,
    );
    assert.throws(
      () =>
        social.beginTurn({
          roomId: directRoomId,
          agentId,
          text: '归档期间不能回复',
          model: 'test-model',
        }),
      /已归档/u,
    );
    assert.throws(
      () =>
        social.createGroup({
          title: '不应邀请归档联系人',
          agentIds: [agentId],
        }),
      /已归档/u,
    );

    const restored = social.setAgentArchived(agentId, false);
    assert.equal(restored.archivedAt, null);
    assert.equal(social.getRoomSnapshot(directRoomId).messages.length, 7);
    assert.equal(
      social.createGroup({ title: '恢复后可邀请', agentIds: [agentId] })
        .members[0].id,
      agentId,
    );
  } finally {
    db.close();
  }
});

test('editing a specialist updates future identity across rooms without changing its id, capabilities, or history', () => {
  const { db, social } = makeStores();
  try {
    const created = social.createAgent({
      name: '新闻观察者',
      headline: '跟踪人工智能新闻',
      description: '先核对来源，再整理重要变化。',
      projectWork: true,
    });
    const agentId = created.members[0].id;
    const roomId = created.room.id;
    const firstMessage = created.messages[0].id;
    const group = social.createGroup({
      title: '跨平台订阅研究',
      agentIds: ['noema', agentId],
    });
    const beforeGroupTitle = group.room.title;

    const updated = social.updateAgentProfile({
      agentId,
      name: 'AI 产业观察员',
      headline: '跟踪 AI 平台产品、价格与政策变化',
      description: '核对一手来源，标出不确定性，并把变化放进持续跟踪的背景中。',
    });

    assert.equal(updated.id, agentId);
    assert.equal(updated.name, 'AI 产业观察员');
    assert.match(updated.systemPrompt, /AI 平台产品、价格与政策变化/u);
    assert.match(updated.systemPrompt, /标出不确定性/u);
    assert.match(updated.systemPrompt, /你具备项目文件任务能力/u);
    assert.deepEqual(updated.capabilities, ['project-work']);
    assert.equal(social.getRoomSnapshot(roomId).room.title, 'AI 产业观察员');
    assert.equal(social.getRoomSnapshot(roomId).messages[0].id, firstMessage);
    assert.equal(social.getRoomSnapshot(roomId).messages.length, 1);
    assert.equal(
      social.getRoomSnapshot(group.room.id).room.title,
      beforeGroupTitle,
    );
    assert.equal(
      social
        .getRoomSnapshot(group.room.id)
        .members.find((member) => member.id === agentId).name,
      'AI 产业观察员',
    );
    assert.throws(
      () =>
        social.updateAgentProfile({
          agentId,
          name: 'Noema',
          headline: '合法长度',
          description: '合法描述',
        }),
      /已有联系人使用这个名称/u,
    );
    assert.throws(
      () =>
        social.updateAgentProfile({
          agentId: 'noema',
          name: '另一个名字',
          headline: '合法长度',
          description: '合法描述',
        }),
      /核心联系人资料/u,
    );
  } finally {
    db.close();
  }
});

test('a reply can be retried after failure without duplicating its user turn', () => {
  const { db, social } = makeStores();
  try {
    const turn = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '重试标记：银杏',
      model: 'test-model',
      interactionAdjustmentSnapshots: [
        {
          id: 'retry-adjustment',
          scope: 'conversation',
          sourceSurface: 'social',
          sourceRoomId: 'room-noema',
          situation: '用户分享近况',
          behavior: '先自然接话，再判断是否需要建议。',
          sourceQuote: '先自然接话',
          userEdited: false,
          editedAt: null,
        },
      ],
    });
    social.failReply(turn.assistantMessageId, 'test_failure', '模型暂不可用');
    const retried = social.retryReply(
      turn.assistantMessageId,
      'next-model',
      [],
    );
    assert.equal(retried.attempt, 2);
    const snapshot = social.getRoomSnapshot('room-noema');
    assert.equal(
      snapshot.messages.filter((message) => message.role === 'user').length,
      1,
    );
    const reply = snapshot.messages.find(
      (message) => message.id === turn.assistantMessageId,
    );
    assert.equal(reply?.status, 'streaming');
    assert.equal(reply?.model, 'next-model');
    assert.deepEqual(
      reply?.interactionAdjustmentAttempts.map((attempt) => ({
        attempt: attempt.attempt,
        ids: attempt.interactionAdjustmentIds,
      })),
      [
        { attempt: 1, ids: ['retry-adjustment'] },
        { attempt: 2, ids: [] },
      ],
    );
    assert.equal(reply?.interactionAdjustmentSnapshots.length, 0);
  } finally {
    db.close();
  }
});
