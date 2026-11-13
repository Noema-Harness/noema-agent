import { createSocialTestStore } from '../../../test-support/social-team.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { SocialChatStore } from '../../../src/main/chat/social-chat-store.mjs';
import { DiagnosticsEventStore } from '../../../src/main/storage/diagnostics-event-store.mjs';
import { SOCIAL_SCHEMA_VERSION } from '../../../src/main/chat/social-chat-schema.mjs';
import { migrateSocialChatSchema } from '../../../src/main/chat/migrations.mjs';
import { MAX_COMMAND_CHANGE_PATHS } from '../../../src/main/execution/workspace-command-quotas.mjs';

function makeStores() {
  const db = new Database(':memory:');
  new RootStore(db);
  const social = createSocialTestStore(db);
  return { db, social };
}

function makeCommandStores() {
  const db = new Database(':memory:');
  new RootStore(db);
  const blobDirectory = mkdtempSync(
    path.join(tmpdir(), 'noema-command-blobs-'),
  );
  const social = createSocialTestStore(db, {
    workspaceChangeBlobDirectory: blobDirectory,
  });
  return { db, social, blobDirectory };
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

test('legacy first-meeting progress remains readable without write operations', () => {
  const { db, social } = makeStores();
  const legacy = {
    version: 1,
    stage: 'complete',
    introducedAt: '2026-10-27T00:00:00.000Z',
    enteredAt: '2026-10-27T00:00:01.000Z',
  };
  try {
    db.prepare(
      'INSERT INTO app_settings(key, value, updated_at) VALUES(?,?,?)',
    ).run('first_meeting', JSON.stringify(legacy), '2026-10-27T00:00:01.000Z');
    assert.deepEqual(social.getFirstMeetingState(), legacy);
    assert.equal(social.advanceFirstMeeting, undefined);
    assert.deepEqual(social.getSnapshot().firstMeeting, legacy);
  } finally {
    db.close();
  }
});

test('room message windows paginate by stable sequence and report stale targets', () => {
  const { db, social } = makeStores();
  try {
    const turns = Array.from({ length: 3 }, (_, index) => {
      const turn = social.beginTurn({
        roomId: 'room-noema',
        agentId: 'noema',
        text: `window-query-${index}`,
        model: 'test-model',
      });
      social.appendAssistantDelta(
        turn.assistantMessageId,
        `window-answer-${index}`,
      );
      social.completeReply(turn.assistantMessageId);
      return turn;
    });
    const otherRoom = social.createAgent({
      name: '范围测试成员',
      headline: '范围测试',
      description: '用于检查当前聊天搜索范围。',
    });
    social.beginTurn({
      roomId: otherRoom.room.id,
      agentId: otherRoom.members[0].id,
      text: 'window-query-0',
      model: 'test-model',
    });
    const latest = social.getRoomSnapshot('room-noema', { limit: 2 });
    assert.equal(latest.messages.length, 2);
    assert.equal(latest.messageWindow.hasEarlier, true);

    const earlier = social.getRoomSnapshot('room-noema', {
      limit: 2,
      beforeSequence: Number(latest.messageWindow.oldestSequence),
    });
    assert.equal(earlier.messages.length, 2);
    assert.equal(
      earlier.messages.some((message) =>
        latest.messages.some((newer) => newer.id === message.id),
      ),
      false,
    );

    const around = social.getRoomSnapshot('room-noema', {
      limit: 2,
      aroundMessageId: turns[0].userMessageId,
    });
    assert.equal(around.messageWindow.targetFound, true);
    assert.ok(
      around.messages.some((message) => message.id === turns[0].userMessageId),
    );
    assert.ok(
      social
        .searchRoomMessages('room-noema', 'window-query-0')
        .some((message) => message.id === turns[0].userMessageId),
    );
    assert.equal(
      social
        .searchRoomMessages('room-noema', 'window-query-0')
        .some((message) => message.roomId === otherRoom.room.id),
      false,
    );

    const missing = social.getRoomSnapshot('room-noema', {
      limit: 2,
      aroundMessageId: 'removed-source-message',
    });
    assert.equal(missing.messageWindow.targetFound, false);
    assert.deepEqual(missing.messages, []);
    assert.throws(
      () => social.getRoomSnapshot('room-noema', { limit: 201 }),
      /1–200/u,
    );
  } finally {
    db.close();
  }
});

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

test('provider runtime preserves gateway records and marks new turns generically', () => {
  const { db } = makeStores();
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO social_messages
        (id, room_id, turn_id, role, content, status, runtime, created_at, updated_at)
      VALUES ('legacy-gateway-message', 'room-noema', 'legacy-turn', 'user',
              '旧路由记录', 'complete', 'freellmapi', ?, ?)
    `).run(now, now);

    const store = new SocialChatStore(db);
    assert.equal(
      db
        .prepare(
          "SELECT runtime FROM social_messages WHERE id = 'legacy-gateway-message'",
        )
        .get().runtime,
      'freellmapi',
    );
    const turn = store.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '新模型服务下的对话',
      model: 'test-model',
    });
    assert.deepEqual(
      db
        .prepare(
          'SELECT DISTINCT runtime FROM social_messages WHERE turn_id = ?',
        )
        .all(turn.turnId),
      [{ runtime: 'provider' }],
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);
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
      SOCIAL_SCHEMA_VERSION,
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

test('unparsed DSML assistant output is kept in the transcript but omitted from future model context', () => {
  const { db, social } = makeStores();
  try {
    const roomId = social.getAgentResidentRoomId('engineering-partner');
    const turn = social.beginTurn({
      roomId,
      agentId: 'engineering-partner',
      text: '读取当前项目计划。',
      model: 'test-model',
    });
    social.appendAssistantDelta(
      turn.assistantMessageId,
      '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="manage_project_plan">',
    );
    social.completeReply(turn.assistantMessageId);

    assert.match(
      social.getRoomSnapshot(roomId).messages.at(-1).content,
      /<｜｜DSML｜｜ calls>/u,
    );
    const context = social.getContext(roomId, {
      ownAgentId: 'engineering-partner',
    });
    assert.equal(context.length, 1);
    assert.equal(context[0].role, 'user');
    assert.equal(context[0].content, '读取当前项目计划。');
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

test('unexpected process loss interrupts active work but preserves terminal outcomes', () => {
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

    const terminalFixtures = [
      {
        id: 'task-restart-completed',
        status: 'completed',
        resultText: '完成结果应保留。',
        errorCode: null,
      },
      {
        id: 'task-restart-failed',
        status: 'failed',
        resultText: '失败前已保存的部分结果。',
        errorCode: 'verification_failed',
      },
      {
        id: 'task-restart-interrupted',
        status: 'interrupted',
        resultText: '用户停止后的结果。',
        errorCode: 'worker_interrupted',
      },
    ];
    for (const fixture of terminalFixtures) {
      social.createSocialWorkTask({
        id: fixture.id,
        roomId: 'room-engineering-partner',
        agentId: 'engineering-partner',
        workspacePath: `C:\\scratch\\${fixture.id}`,
        workspaceKey: `c:\\scratch\\${fixture.id}`,
        taskPrompt: '重开 store 不得改写既有终态。',
        model: 'auto:noema-free',
      });
      social.finishSocialWorkTask(fixture.id, {
        status: fixture.status,
        resultText: fixture.resultText,
        errorCode: fixture.errorCode,
      });
    }

    const recoveredStore = new SocialChatStore(db);
    assert.deepEqual(recoveredStore.recoveredSocialWorkTaskIds, [
      'task-restart',
    ]);

    const task = social.getSocialWorkTask('task-restart');
    assert.equal(task.status, 'interrupted');
    assert.equal(task.runtimeSessionId, 'session-restart');
    assert.equal(task.errorCode, 'process_crash');
    for (const fixture of terminalFixtures) {
      const preserved = social.getSocialWorkTask(fixture.id);
      assert.equal(preserved.status, fixture.status);
      assert.equal(preserved.resultText, fixture.resultText);
      assert.equal(preserved.errorCode, fixture.errorCode);
    }
  } finally {
    db.close();
  }
});

test('a new process recovers active SocialWork without replaying an unknown side effect', () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-social-work-process-crash-'),
  );
  const databasePath = path.join(directory, 'noema.sqlite3');
  const resultPath = path.join(directory, 'recovery.json');
  let db = new Database(databasePath);
  try {
    new RootStore(db);
    const social = createSocialTestStore(db);
    const events = new DiagnosticsEventStore(db);
    social.createSocialWorkTask({
      id: 'task-process-crash',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\process-crash',
      workspaceKey: 'c:\\scratch\\process-crash',
      taskPrompt: '模拟进程意外结束时仍在运行的命令。',
      model: 'test-model',
    });
    social.setSocialWorkTaskSession(
      'task-process-crash',
      'session-process-crash',
    );
    social.startSocialWorkExecutionStep('task-process-crash', {
      id: 'step-process-crash',
      externalCallId: 'call-process-crash',
      toolName: 'run_command',
      category: 'command',
      hasSideEffect: true,
    });
    events.record({
      applicationExecutionId: 'process-before-crash',
      executionId: 'task-process-crash',
      taskId: 'task-process-crash',
      module: 'social.work',
      operation: 'task.started',
      status: 'running',
    });
    db.close();

    const childScript = fileURLToPath(
      new URL(
        '../../../test-support/social-work-crash-recovery-child.mjs',
        import.meta.url,
      ),
    );
    const child = spawnSync(
      process.execPath,
      [childScript, databasePath, resultPath],
      {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
      },
    );
    assert.equal(child.error, undefined, child.stderr || String(child.error));
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const childResult = JSON.parse(readFileSync(resultPath, 'utf8'));
    assert.deepEqual(childResult.recoveredTaskIds, ['task-process-crash']);
    assert.equal(childResult.status, 'interrupted');
    assert.equal(childResult.errorCode, 'process_crash');
    assert.equal(childResult.canResume, false);
    assert.deepEqual(childResult.executionSteps, [
      { status: 'outcome_unknown', effectStatus: 'unknown' },
    ]);

    db = new Database(databasePath);
    const recoveredStore = new SocialChatStore(db);
    const recoveredEvents = new DiagnosticsEventStore(db);
    assert.deepEqual(recoveredStore.recoveredSocialWorkTaskIds, []);
    const timeline = recoveredEvents.query({ taskId: 'task-process-crash' });
    assert.deepEqual(
      timeline.map((event) => event.operation),
      ['task.started', 'task.recovered'],
    );
    assert.equal(timeline[1].applicationExecutionId, 'process-after-crash');
    assert.equal(timeline[1].errorCode, 'process_crash');
    assert.equal(
      timeline.some((event) => event.operation === 'task.resumed'),
      false,
    );
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('persisted progress phases survive session binding and unknown phase writes normalize safely', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-progress-phase',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\project',
      workspaceKey: 'c:\\scratch\\project',
      taskPrompt: '阶段只由持久任务记录承载。',
      model: 'test-model',
    });
    social.updateSocialWorkTaskProgress('task-progress-phase', {
      phase: 'model_request',
    });
    social.setSocialWorkTaskSession('task-progress-phase', 'session-progress');
    assert.equal(
      social.getSocialWorkTask('task-progress-phase').phase,
      'model_request',
    );
    assert.equal(
      social
        .getRoomSnapshot('room-engineering-partner')
        .workTasks.find((task) => task.id === 'task-progress-phase').phase,
      'model_request',
    );
    social.updateSocialWorkTaskProgress('task-progress-phase', {
      phase: 'obsolete-private-phase-name',
    });
    assert.equal(
      social.getSocialWorkTask('task-progress-phase').phase,
      'unknown',
    );
    social.updateSocialWorkTaskProgress('task-progress-phase', {
      phase: 'working',
    });
    assert.equal(
      social.getSocialWorkTask('task-progress-phase').phase,
      'running',
    );
  } finally {
    db.close();
  }
});

test('system shutdown recovery preserves its reason and marks active effects unknown', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-system-shutdown',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\system-shutdown',
      workspaceKey: 'c:\\scratch\\system-shutdown',
      taskPrompt: '关机时不要自动重放命令。',
      model: 'auto:noema-free',
    });
    social.setSocialWorkTaskSession('task-system-shutdown', 'session-shutdown');
    social.startSocialWorkExecutionStep('task-system-shutdown', {
      id: 'step-system-command',
      toolName: 'run_command',
      category: 'command',
      hasSideEffect: true,
    });
    social.recordApplicationShutdownIntent('system_shutdown');

    const recoveredStore = new SocialChatStore(db);
    assert.deepEqual(recoveredStore.recoveredSocialWorkTaskIds, [
      'task-system-shutdown',
    ]);
    assert.equal(
      recoveredStore.recoveredSocialWorkTaskErrorCode,
      'system_shutdown_incomplete',
    );
    const task = recoveredStore.getSocialWorkTask('task-system-shutdown');
    assert.equal(task.status, 'interrupted');
    assert.equal(task.errorCode, 'system_shutdown_incomplete');
    assert.equal(task.canResume, false);
    assert.deepEqual(
      recoveredStore
        .listSocialWorkExecutionSteps('task-system-shutdown')
        .map(({ status, effectStatus }) => ({ status, effectStatus })),
      [{ status: 'outcome_unknown', effectStatus: 'unknown' }],
    );
    assert.equal(
      db
        .prepare('SELECT COUNT(*) AS count FROM application_shutdown_intent')
        .get().count,
      0,
    );

    recoveredStore.createSocialWorkTask({
      id: 'task-application-exit',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\application-exit',
      workspaceKey: 'c:\\scratch\\application-exit',
      taskPrompt: '应用退出未完成时保留退出原因。',
      model: 'auto:noema-free',
    });
    recoveredStore.setSocialWorkTaskSession(
      'task-application-exit',
      'session-application-exit',
    );
    recoveredStore.recordApplicationShutdownIntent('application_exit');
    const recoveredExit = new SocialChatStore(db);
    assert.equal(
      recoveredExit.getSocialWorkTask('task-application-exit').errorCode,
      'application_exit_incomplete',
    );
  } finally {
    db.close();
  }
});

test('a DSH task cannot resume through the Noema checkpoint state machine', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-dsh-noema-resume',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\legacy-dsh',
      workspaceKey: 'c:\\scratch\\legacy-dsh',
      taskPrompt: '旧 DSH task 不得假装拥有 Noema checkpoint。',
      model: 'auto:noema-free',
    });
    social.setSocialWorkTaskSession('task-dsh-noema-resume', 'session-dsh');
    social.saveSocialWorkRuntimeCheckpoint('task-dsh-noema-resume', {
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'task' },
      ],
      round: 0,
      toolCallCount: 0,
      phase: 'ready_for_model',
    });
    social.finishSocialWorkTask('task-dsh-noema-resume', {
      status: 'failed',
      errorCode: 'provider_unavailable',
      errorMessage: '服务不可用。',
    });

    const task = social.getSocialWorkTask('task-dsh-noema-resume');
    assert.equal(task.executionEngine, 'dsh');
    assert.equal(task.canResume, false);
    assert.throws(
      () => social.resumeSocialWorkTask(task.id),
      /当前不能从检查点继续/u,
    );
  } finally {
    db.close();
  }
});

test('project-result task metadata is persisted through SocialChatStore APIs', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-project-result-owner',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\project-result',
      workspaceKey: 'c:\\scratch\\project-result',
      taskPrompt: '验证项目结果状态写入归属。',
      model: 'auto:noema-free',
    });

    assert.equal(
      social.trackSocialWorkProjectResult({
        taskId: 'task-project-result-owner',
        roomId: 'room-engineering-partner',
        agentId: 'engineering-partner',
        planItemId: 'plan-item-1',
      }),
      1,
    );
    let row = db
      .prepare(`SELECT project_plan_item_id, project_result_pending
        FROM social_work_tasks WHERE id = ?`)
      .get('task-project-result-owner');
    assert.equal(row.project_plan_item_id, 'plan-item-1');
    assert.equal(row.project_result_pending, 1);

    social.finishSocialWorkTask('task-project-result-owner', {
      status: 'interrupted',
      errorCode: 'worker_interrupted',
    });
    assert.equal(social.clearInterruptedSocialWorkProjectResults(), 1);
    row = db
      .prepare(
        'SELECT project_result_pending FROM social_work_tasks WHERE id = ?',
      )
      .get('task-project-result-owner');
    assert.equal(row.project_result_pending, 0);
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
      workspaceIdentity: {
        version: 1,
        canonicalPath: 'C:\\scratch\\project',
        device: '7',
        fileIndex: '42',
      },
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

test('legacy resumable work without a workspace identity remains visible but blocked', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-legacy-workspace-identity',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\project',
      workspaceKey: 'c:\\scratch\\project',
      taskPrompt: '旧版本工作区任务。',
      model: 'test-model',
      executionEngine: 'noema',
    });
    social.setSocialWorkTaskSession(
      'task-legacy-workspace-identity',
      'session-legacy-workspace',
    );
    social.saveSocialWorkRuntimeCheckpoint('task-legacy-workspace-identity', {
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'task' },
      ],
      round: 0,
      toolCallCount: 0,
      phase: 'failed',
      resumePhase: 'ready_for_model',
    });
    social.finishSocialWorkTask('task-legacy-workspace-identity', {
      status: 'failed',
      errorCode: 'provider_unavailable',
      errorMessage: '暂时无法连接。',
      toolCallCount: 0,
    });

    const task = social.getSocialWorkTask('task-legacy-workspace-identity');
    assert.equal(task.status, 'failed');
    assert.equal(task.canResume, false);
    assert.match(task.resumeBlockReason, /没有工作区身份快照/u);
    assert.throws(
      () => social.resumeSocialWorkTask('task-legacy-workspace-identity'),
      /检查工作区后重新提交/u,
    );
  } finally {
    db.close();
  }
});

test('a legacy round-limit task resumes only from a complete saved tool boundary', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-legacy-round-limit',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\project',
      workspaceKey: 'c:\\scratch\\project',
      workspaceIdentity: {
        version: 1,
        canonicalPath: 'C:\\scratch\\project',
        device: '7',
        fileIndex: '42',
      },
      taskPrompt: '继续检查已完成的多步项目工作。',
      model: 'test-model',
      executionEngine: 'noema',
    });
    social.setSocialWorkTaskSession(
      'task-legacy-round-limit',
      'session-legacy-round-limit',
    );
    const messages = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'task' },
    ];
    for (let index = 0; index < 16; index += 1) {
      const callId = `legacy-call-${index}`;
      const stepId = `legacy-step-${index}`;
      const toolCall = {
        id: callId,
        type: 'function',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({ path: `part-${index}.txt` }),
        },
      };
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [toolCall],
      });
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content: JSON.stringify({ result: 'saved' }),
      });
      social.startSocialWorkExecutionStep('task-legacy-round-limit', {
        id: stepId,
        externalCallId: callId,
        arguments: toolCall.function.arguments,
        toolName: 'write_file',
        category: 'write',
        hasSideEffect: true,
      });
      social.finishSocialWorkExecutionStep('task-legacy-round-limit', stepId, {
        status: 'succeeded',
        effectStatus: 'applied',
        resultContent: JSON.stringify({ result: 'saved' }),
      });
    }
    social.saveSocialWorkRuntimeCheckpoint('task-legacy-round-limit', {
      messages,
      round: 16,
      toolCallCount: 16,
      phase: 'failed',
    });
    social.finishSocialWorkTask('task-legacy-round-limit', {
      status: 'failed',
      runtimeSessionId: 'session-legacy-round-limit',
      errorCode: 'tool_round_limit',
      errorMessage: '工具步骤达到旧版本上限。',
      toolCallCount: 16,
    });

    assert.equal(
      social.getSocialWorkTask('task-legacy-round-limit').canResume,
      true,
    );
    const resumed = social.resumeSocialWorkTask('task-legacy-round-limit');
    assert.equal(resumed.status, 'starting');
    assert.equal(
      social.getSocialWorkRuntimeCheckpoint('task-legacy-round-limit')
        .resumePhase,
      'ready_for_model',
    );
    assert.equal(resumed.executionSteps.length, 16);
  } finally {
    db.close();
  }
});

test('an oversized-response checkpoint cannot resume with an unresolved write', () => {
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
      errorCode: 'response_too_large',
      errorMessage: '模型回复超过安全读取上限。',
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

test('unknown command outcome cannot resume from a ready model checkpoint', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-command-outcome-unknown',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\project',
      workspaceKey: 'c:\\scratch\\project',
      taskPrompt: '不要自动重放结果未知的命令。',
      model: 'test-model',
      executionEngine: 'noema',
    });
    social.setSocialWorkTaskSession(
      'task-command-outcome-unknown',
      'session-command-outcome-unknown',
    );
    social.startSocialWorkExecutionStep('task-command-outcome-unknown', {
      id: 'unknown-command',
      externalCallId: 'command-call',
      arguments: JSON.stringify({ command: 'npm test' }),
      toolName: 'run_command',
      category: 'command',
      hasSideEffect: true,
    });
    social.finishSocialWorkExecutionStep(
      'task-command-outcome-unknown',
      'unknown-command',
      {
        status: 'failed',
        effectStatus: 'unknown',
        resultContent: JSON.stringify({ error: '命令结果未知。' }),
      },
    );
    social.saveSocialWorkRuntimeCheckpoint('task-command-outcome-unknown', {
      messages: [{ role: 'user', content: 'task' }],
      round: 1,
      toolCallCount: 1,
      phase: 'ready_for_model',
      resumePhase: 'ready_for_model',
    });
    social.finishSocialWorkTask('task-command-outcome-unknown', {
      status: 'failed',
      runtimeSessionId: 'session-command-outcome-unknown',
      errorCode: 'command_outcome_unknown',
      errorMessage: '命令结果未知。',
      toolCallCount: 1,
    });

    const task = social.getSocialWorkTask('task-command-outcome-unknown');
    assert.equal(task.canResume, false);
    assert.equal(task.executionSteps[0].status, 'failed');
    assert.equal(task.executionSteps[0].effectStatus, 'unknown');
    assert.throws(
      () => social.resumeSocialWorkTask('task-command-outcome-unknown'),
      /不能从检查点继续/u,
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
      'detail',
      'effectStatus',
      'externalCallId',
      'hasSideEffect',
      'id',
      'ordinal',
      'output',
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
      ALTER TABLE social_projects DROP COLUMN workspace_identity_json;
      ALTER TABLE social_projects DROP COLUMN workspace_path;
      ALTER TABLE social_work_tasks DROP COLUMN workspace_identity_json;
      DROP INDEX social_messages_delegation_parent;
      ALTER TABLE social_messages DROP COLUMN delegation_parent_message_id;
      DROP TABLE social_user_memories_fts;
      DROP INDEX social_user_memories_updated;
      DROP TABLE social_user_memories;
      DROP TABLE social_user_followups;
      DROP TABLE application_shutdown_intent;
      DROP TABLE social_work_file_change_operations;
      DROP TABLE social_work_file_changes;
      DROP TABLE IF EXISTS social_work_workspace_write_locks;
      DROP TABLE IF EXISTS social_work_command_batches;
      DROP TABLE IF EXISTS social_work_change_blobs;
      DELETE FROM social_schema_migrations WHERE version >= 28;
      ALTER TABLE social_work_tasks DROP COLUMN project_plan_item_id;
      ALTER TABLE social_work_tasks DROP COLUMN project_result_pending;
      DELETE FROM social_schema_migrations WHERE version = 27;
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
      SOCIAL_SCHEMA_VERSION,
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
      ALTER TABLE social_projects DROP COLUMN workspace_identity_json;
      ALTER TABLE social_projects DROP COLUMN workspace_path;
      ALTER TABLE social_work_tasks DROP COLUMN workspace_identity_json;
      DROP INDEX social_messages_delegation_parent;
      ALTER TABLE social_messages DROP COLUMN delegation_parent_message_id;
      DROP TABLE social_user_memories_fts;
      DROP INDEX social_user_memories_updated;
      DROP TABLE social_user_memories;
      DROP TABLE social_user_followups;
      DROP TABLE application_shutdown_intent;
      DROP TABLE social_work_file_change_operations;
      DROP TABLE social_work_file_changes;
      DROP TABLE IF EXISTS social_work_workspace_write_locks;
      DROP TABLE IF EXISTS social_work_command_batches;
      DROP TABLE IF EXISTS social_work_change_blobs;
      DELETE FROM social_schema_migrations WHERE version >= 28;
      ALTER TABLE social_work_tasks DROP COLUMN project_plan_item_id;
      ALTER TABLE social_work_tasks DROP COLUMN project_result_pending;
      DELETE FROM social_schema_migrations WHERE version = 27;
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

test('social schema v34 preserves v33 file-change ledger rows', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    new RootStore(db);
    migrateSocialChatSchema(db, { targetVersion: 33 });
    const now = '2026-11-07T00:00:00.000Z';
    const beforeHash = 'a'.repeat(64);
    const afterHash = 'b'.repeat(64);
    db.prepare(`
      INSERT INTO social_agents
        (id, name, kind, headline, description, system_prompt, created_at, updated_at)
      VALUES ('noema', 'Noema', 'core', '', '', '', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO social_rooms (id, kind, title, created_at, updated_at)
      VALUES ('room-noema', 'direct', 'Noema', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO social_work_tasks
        (id, room_id, agent_id, workspace_path, workspace_key, task_prompt,
         model, runtime, status, verification_status, created_at, updated_at)
      VALUES ('task-v34', 'room-noema', 'noema', 'C:/workspace', ?, 'work',
        'test-model', 'dsh', 'running', 'not_planned', ?, ?)
    `).run('c'.repeat(64), now, now);
    db.prepare(`
      INSERT INTO social_work_execution_steps
        (id, task_id, ordinal, tool_name, category, has_side_effect,
         status, effect_status, started_at)
      VALUES ('step-v34', 'task-v34', 1, 'write_file', 'write', 1,
        'succeeded', 'applied', ?)
    `).run(now);
    db.prepare(`
      INSERT INTO social_work_file_changes
        (id, task_id, relative_path, original_exists, original_bytes,
         original_hash, latest_hash, diff_text, state, created_at, updated_at)
      VALUES ('change-v34', 'task-v34', 'src/a.js', 1, ?, ?, ?, 'diff',
        'applied', ?, ?)
    `).run(Buffer.from('before'), beforeHash, afterHash, now, now);
    db.prepare(`
      INSERT INTO social_work_file_change_operations
        (id, change_id, task_id, step_id, ordinal, before_hash, after_hash,
         state, created_at)
      VALUES ('operation-v34', 'change-v34', 'task-v34', 'step-v34', 1, ?, ?,
        'applied', ?)
    `).run(beforeHash, afterHash, now);

    migrateSocialChatSchema(db);
    const change = db
      .prepare(`
      SELECT latest_exists AS latestExists, pending_after_exists AS pendingAfterExists,
             original_blob_hash AS originalBlobHash
      FROM social_work_file_changes WHERE id = 'change-v34'
    `)
      .get();
    assert.deepEqual(change, {
      latestExists: 1,
      pendingAfterExists: null,
      originalBlobHash: null,
    });
    const operation = db
      .prepare(`
      SELECT command_batch_id AS commandBatchId, before_hash AS beforeHash,
             after_hash AS afterHash
      FROM social_work_file_change_operations WHERE id = 'operation-v34'
    `)
      .get();
    assert.deepEqual(operation, {
      commandBatchId: null,
      beforeHash,
      afterHash,
    });
    assert.equal(
      db
        .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
        .get().version,
      SOCIAL_SCHEMA_VERSION,
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.doesNotThrow(() => migrateSocialChatSchema(db));
  } finally {
    db.close();
  }
});

test('a command batch owns one workspace, stores recovery blobs and releases cleanly', () => {
  const { db, social, blobDirectory } = makeCommandStores();
  const identity = {
    version: 1,
    canonicalPath: 'C:\\workspace',
    device: '1',
    fileIndex: '2',
  };
  try {
    social.createSocialWorkTask({
      id: 'task-command',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: identity.canonicalPath,
      workspaceKey: 'workspace-command',
      workspaceIdentity: identity,
      taskPrompt: '运行命令并记录普通文件变更。',
      model: 'test-model',
    });
    social.setSocialWorkTaskSession('task-command', 'session-command');
    social.startSocialWorkExecutionStep('task-command', {
      id: 'step-command',
      category: 'command',
      toolName: 'run_command',
      hasSideEffect: true,
    });
    const batch = social.beginSocialWorkCommandBatch({
      taskId: 'task-command',
      stepId: 'step-command',
    });
    assert.equal(batch.status, 'preparing');
    assert.equal(batch.workspaceIdentity.canonicalPath, identity.canonicalPath);

    const base = social.putSocialWorkCommandManifest({
      taskId: 'task-command',
      batchId: batch.id,
      kind: 'base',
      bytes: Buffer.from('base-manifest'),
    });
    assert.ok(base.baseManifestHash);
    assert.deepEqual(
      social.readSocialWorkCommandBlob({
        taskId: 'task-command',
        batchId: batch.id,
        hash: base.baseManifestHash,
      }),
      Buffer.from('base-manifest'),
    );

    social.createSocialWorkTask({
      id: 'task-command-2',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: identity.canonicalPath,
      workspaceKey: 'workspace-command-2',
      workspaceIdentity: identity,
      taskPrompt: '同一工作区的第二批命令。',
      model: 'test-model',
    });
    social.setSocialWorkTaskSession('task-command-2', 'session-command-2');
    social.startSocialWorkExecutionStep('task-command-2', {
      id: 'step-command-2',
      category: 'command',
      toolName: 'run_command',
      hasSideEffect: true,
    });
    assert.throws(
      () =>
        social.beginSocialWorkCommandBatch({
          taskId: 'task-command-2',
          stepId: 'step-command-2',
        }),
      /此工作区有一批文件变更/u,
    );

    social.transitionSocialWorkCommandBatch({
      taskId: 'task-command',
      batchId: batch.id,
      status: 'running',
    });
    social.transitionSocialWorkCommandBatch({
      taskId: 'task-command',
      batchId: batch.id,
      status: 'collecting',
    });
    const prepared = social.prepareSocialWorkCommandChanges({
      taskId: 'task-command',
      batchId: batch.id,
      stepId: 'step-command',
      changes: [
        {
          relativePath: 'src/a.js',
          beforeBytes: Buffer.from('before'),
          afterBytes: Buffer.from('after'),
          diffText: '-before\n+after',
          diffTruncated: false,
        },
        {
          relativePath: 'src/deleted.js',
          beforeBytes: Buffer.from('old'),
          afterBytes: null,
          diffText: '-old',
          diffTruncated: false,
        },
        {
          relativePath: 'src/created.bin',
          beforeBytes: null,
          afterBytes: Buffer.from([0, 1, 2]),
          diffText: 'binary',
          diffTruncated: true,
        },
        {
          relativePath: 'src/same.js',
          beforeBytes: Buffer.from('same'),
          afterBytes: Buffer.from('same'),
          diffText: '',
          diffTruncated: false,
        },
      ],
    });
    assert.equal(prepared.length, 3);
    const listed = social.listSocialWorkCommandBatchChanges(
      'task-command',
      batch.id,
    );
    assert.equal(listed.length, 3);
    const created = listed.find(
      (change) => change.relativePath === 'src/created.bin',
    );
    assert.ok(created.afterBlobHash);
    assert.deepEqual(
      social.readSocialWorkCommandBlob({
        taskId: 'task-command',
        batchId: batch.id,
        hash: created.afterBlobHash,
      }),
      Buffer.from([0, 1, 2]),
    );

    const final = social.putSocialWorkCommandManifest({
      taskId: 'task-command',
      batchId: batch.id,
      kind: 'final',
      bytes: Buffer.from('final-manifest'),
    });
    assert.ok(final.finalManifestHash);
    social.transitionSocialWorkCommandBatch({
      taskId: 'task-command',
      batchId: batch.id,
      status: 'syncing',
    });
    const completed = social.transitionSocialWorkCommandBatch({
      taskId: 'task-command',
      batchId: batch.id,
      status: 'completed',
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.baseManifestHash, null);
    assert.equal(completed.finalManifestHash, null);
    const integrity = social.verifyReferencedWorkspaceChangeBlobs();
    assert.ok(integrity.verified >= 2);
    assert.ok(integrity.orphanFilesRemoved >= 3);
    const firstA = prepared.find((entry) => entry.relativePath === 'src/a.js');
    assert.ok(firstA);
    social.completeSocialWorkFileChange({
      taskId: 'task-command',
      stepId: 'step-command',
      changeId: firstA.changeId,
      operationId: firstA.operationId,
      actualHash: firstA.afterHash,
    });

    social.startSocialWorkExecutionStep('task-command', {
      id: 'step-command-repeat',
      category: 'command',
      toolName: 'run_command',
      hasSideEffect: true,
    });
    const repeated = social.beginSocialWorkCommandBatch({
      taskId: 'task-command',
      stepId: 'step-command-repeat',
    });
    social.transitionSocialWorkCommandBatch({
      taskId: 'task-command',
      batchId: repeated.id,
      status: 'running',
    });
    social.transitionSocialWorkCommandBatch({
      taskId: 'task-command',
      batchId: repeated.id,
      status: 'collecting',
    });
    social.prepareSocialWorkCommandChanges({
      taskId: 'task-command',
      batchId: repeated.id,
      stepId: 'step-command-repeat',
      changes: [
        {
          relativePath: 'src/a.js',
          beforeBytes: Buffer.from('after'),
          afterBytes: Buffer.from('again'),
          diffText: '-after\n+again',
          diffTruncated: false,
        },
      ],
    });
    const repeatedChanges = social.listSocialWorkCommandBatchChanges(
      'task-command',
      repeated.id,
    );
    assert.equal(repeatedChanges.length, 1);
    assert.equal(repeatedChanges[0].ordinal, 2);
    social.transitionSocialWorkCommandBatch({
      taskId: 'task-command',
      batchId: repeated.id,
      status: 'not_applied',
    });

    const second = social.beginSocialWorkCommandBatch({
      taskId: 'task-command-2',
      stepId: 'step-command-2',
    });
    assert.equal(second.status, 'preparing');
    const notApplied = social.transitionSocialWorkCommandBatch({
      taskId: 'task-command-2',
      batchId: second.id,
      status: 'not_applied',
    });
    assert.equal(notApplied.status, 'not_applied');
  } finally {
    db.close();
    rmSync(blobDirectory, { recursive: true, force: true });
  }
});

test('startup reconciliation closes preparing batches and quarantines uncertain batches', () => {
  const { db, social, blobDirectory } = makeCommandStores();
  const identityFor = (suffix) => ({
    version: 1,
    canonicalPath: `C:\\workspace-startup-${suffix}`,
    device: '5',
    fileIndex: '6',
  });
  const createBatch = (
    suffix,
    start = true,
    identity = identityFor(suffix),
  ) => {
    const taskId = `task-startup-${suffix}`;
    const stepId = `step-startup-${suffix}`;
    social.createSocialWorkTask({
      id: taskId,
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: identity.canonicalPath,
      workspaceKey: `workspace-startup-${suffix}`,
      workspaceIdentity: identity,
      taskPrompt: '启动恢复测试。',
      model: 'test-model',
    });
    social.setSocialWorkTaskSession(taskId, `session-startup-${suffix}`);
    social.startSocialWorkExecutionStep(taskId, {
      id: stepId,
      category: 'command',
      toolName: 'run_command',
      hasSideEffect: true,
    });
    return {
      taskId,
      stepId,
      batch: start
        ? social.beginSocialWorkCommandBatch({ taskId, stepId })
        : null,
    };
  };
  try {
    const preparing = createBatch('preparing');
    social.putSocialWorkCommandManifest({
      taskId: preparing.taskId,
      batchId: preparing.batch.id,
      kind: 'base',
      bytes: Buffer.from('startup-base'),
    });
    const running = createBatch('running');
    social.transitionSocialWorkCommandBatch({
      taskId: running.taskId,
      batchId: running.batch.id,
      status: 'running',
    });

    const recovered = social.recoverInterruptedCommandBatches();
    assert.deepEqual(
      new Set(recovered),
      new Set([preparing.batch.id, running.batch.id]),
    );

    const preparingAfter = social.getSocialWorkCommandBatch(
      preparing.taskId,
      preparing.batch.id,
    );
    assert.equal(preparingAfter.status, 'not_applied');
    assert.equal(preparingAfter.reasonCode, 'app_restarted');
    assert.equal(preparingAfter.baseManifestHash, null);
    assert.equal(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM social_work_workspace_write_locks WHERE task_id = ?',
        )
        .get(preparing.taskId).count,
      0,
    );

    const runningAfter = social.getSocialWorkCommandBatch(
      running.taskId,
      running.batch.id,
    );
    assert.equal(runningAfter.status, 'unknown');
    assert.equal(runningAfter.reasonCode, 'app_restarted');
    assert.equal(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM social_work_workspace_write_locks WHERE task_id = ?',
        )
        .get(running.taskId).count,
      1,
    );

    const blocked = createBatch('blocked', false, identityFor('running'));
    assert.throws(
      () =>
        social.beginSocialWorkCommandBatch({
          taskId: blocked.taskId,
          stepId: blocked.stepId,
        }),
      /此工作区有一批文件变更/u,
    );
    const settled = social.transitionSocialWorkCommandBatch({
      taskId: running.taskId,
      batchId: running.batch.id,
      status: 'not_applied',
    });
    assert.equal(settled.status, 'not_applied');
    assert.equal(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM social_work_workspace_write_locks WHERE task_id = ?',
        )
        .get(running.taskId).count,
      0,
    );
  } finally {
    db.close();
    rmSync(blobDirectory, { recursive: true, force: true });
  }
});

test('a command batch rejects invalid transitions and preserves locks across recovery', () => {
  const { db, social, blobDirectory } = makeCommandStores();
  const identity = {
    version: 1,
    canonicalPath: 'C:\\workspace-recovery',
    device: '3',
    fileIndex: '4',
  };
  const createBatch = (suffix) => {
    const taskId = `task-recovery-${suffix}`;
    const stepId = `step-recovery-${suffix}`;
    social.createSocialWorkTask({
      id: taskId,
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: identity.canonicalPath,
      workspaceKey: `workspace-recovery-${suffix}`,
      workspaceIdentity: identity,
      taskPrompt: '恢复路径测试。',
      model: 'test-model',
    });
    social.setSocialWorkTaskSession(taskId, `session-recovery-${suffix}`);
    social.startSocialWorkExecutionStep(taskId, {
      id: stepId,
      category: 'command',
      toolName: 'run_command',
      hasSideEffect: true,
    });
    return {
      taskId,
      stepId,
      batch: social.beginSocialWorkCommandBatch({ taskId, stepId }),
    };
  };
  try {
    const first = createBatch('one');
    assert.throws(
      () =>
        social.transitionSocialWorkCommandBatch({
          taskId: first.taskId,
          batchId: first.batch.id,
          status: 'completed',
        }),
      (error) =>
        error.code === 'workspace_command_batch_transition_invalid' &&
        error.message.includes('恢复记录已保留'),
    );
    social.transitionSocialWorkCommandBatch({
      taskId: first.taskId,
      batchId: first.batch.id,
      status: 'running',
    });
    social.transitionSocialWorkCommandBatch({
      taskId: first.taskId,
      batchId: first.batch.id,
      status: 'collecting',
    });
    assert.throws(
      () =>
        social.prepareSocialWorkCommandChanges({
          taskId: first.taskId,
          batchId: first.batch.id,
          stepId: first.stepId,
          changes: [
            {
              relativePath: 'src/duplicate.js',
              beforeBytes: null,
              afterBytes: Buffer.from('one'),
              diffText: '+one',
              diffTruncated: false,
            },
            {
              relativePath: 'src/duplicate.js',
              beforeBytes: null,
              afterBytes: Buffer.from('two'),
              diffText: '+two',
              diffTruncated: false,
            },
          ],
        }),
      (error) => error.code === 'workspace_command_changes_duplicate_path',
    );
    assert.equal(
      social.listSocialWorkCommandBatchChanges(first.taskId, first.batch.id)
        .length,
      0,
    );
    assert.ok(social.collectUnreferencedWorkspaceChangeBlobs().removed >= 1);
    social.transitionSocialWorkCommandBatch({
      taskId: first.taskId,
      batchId: first.batch.id,
      status: 'conflict',
      reasonCode: 'copy_race',
    });
    assert.equal(
      social.getSocialWorkCommandBatch(first.taskId, first.batch.id).status,
      'conflict',
    );
    assert.throws(() => createBatch('blocked'), /此工作区有一批文件变更/u);
    social.transitionSocialWorkCommandBatch({
      taskId: first.taskId,
      batchId: first.batch.id,
      status: 'syncing',
    });
    social.transitionSocialWorkCommandBatch({
      taskId: first.taskId,
      batchId: first.batch.id,
      status: 'partial',
    });
    const completed = social.transitionSocialWorkCommandBatch({
      taskId: first.taskId,
      batchId: first.batch.id,
      status: 'completed',
    });
    assert.equal(completed.status, 'completed');
    const afterRecovery = createBatch('after');
    assert.equal(afterRecovery.batch.status, 'preparing');
    social.transitionSocialWorkCommandBatch({
      taskId: afterRecovery.taskId,
      batchId: afterRecovery.batch.id,
      status: 'unknown',
      reasonCode: 'process_state_unprovable',
    });
    const cleaned = social.transitionSocialWorkCommandBatch({
      taskId: afterRecovery.taskId,
      batchId: afterRecovery.batch.id,
      status: 'not_applied',
      reasonCode: 'reviewed_not_applied',
    });
    assert.equal(cleaned.status, 'not_applied');
  } finally {
    db.close();
    rmSync(blobDirectory, { recursive: true, force: true });
  }
});

test('a command batch enforces path and recovery storage limits before recording', () => {
  const { db, social, blobDirectory } = makeCommandStores();
  const identity = {
    version: 1,
    canonicalPath: 'C:\\workspace-limits',
    device: '5',
    fileIndex: '6',
  };
  const taskId = 'task-limits';
  const stepId = 'step-limits';
  try {
    social.createSocialWorkTask({
      id: taskId,
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: identity.canonicalPath,
      workspaceKey: 'workspace-limits',
      workspaceIdentity: identity,
      taskPrompt: '边界测试。',
      model: 'test-model',
    });
    social.setSocialWorkTaskSession(taskId, 'session-limits');
    social.startSocialWorkExecutionStep(taskId, {
      id: stepId,
      category: 'command',
      toolName: 'run_command',
      hasSideEffect: true,
    });
    const batch = social.beginSocialWorkCommandBatch({ taskId, stepId });
    const now = new Date().toISOString();
    const seededHash = 'b'.repeat(64);
    db.prepare(`
      INSERT INTO social_work_change_blobs(hash, size_bytes, created_at)
      VALUES (?, ?, ?)
    `).run(seededHash, 2 * 1024 * 1024 * 1024, now);
    db.prepare(`
      INSERT INTO social_work_file_changes (
        id, task_id, relative_path, original_exists, original_bytes,
        original_hash, original_blob_hash, original_blob_size, latest_hash,
        latest_exists, diff_text, diff_truncated, state, last_step_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, 1, NULL, ?, ?, ?, ?, 1, '', 0, 'applied', ?, ?, ?)
    `).run(
      'change-seeded-huge',
      taskId,
      'src/huge.bin',
      seededHash,
      seededHash,
      2 * 1024 * 1024 * 1024,
      seededHash,
      stepId,
      now,
      now,
    );
    assert.throws(
      () =>
        social.putSocialWorkCommandManifest({
          taskId,
          batchId: batch.id,
          kind: 'base',
          bytes: Buffer.from('manifest'),
        }),
      (error) => error.code === 'workspace_change_blob_quota_exceeded',
    );

    social.transitionSocialWorkCommandBatch({
      taskId,
      batchId: batch.id,
      status: 'running',
    });
    social.transitionSocialWorkCommandBatch({
      taskId,
      batchId: batch.id,
      status: 'collecting',
    });
    assert.throws(
      () =>
        social.prepareSocialWorkCommandChanges({
          taskId,
          batchId: batch.id,
          stepId,
          changes: Array.from(
            { length: MAX_COMMAND_CHANGE_PATHS + 1 },
            (_, index) => ({
              relativePath: `src/path-${index}.js`,
              beforeBytes: null,
              afterBytes: Buffer.from(String(index)),
              diffText: '',
              diffTruncated: false,
            }),
          ),
        }),
      (error) => error.code === 'workspace_command_changes_invalid',
    );
    social.transitionSocialWorkCommandBatch({
      taskId,
      batchId: batch.id,
      status: 'not_applied',
    });
  } finally {
    db.close();
    rmSync(blobDirectory, { recursive: true, force: true });
  }
});

test('a failed startup integrity scan blocks new command batches', () => {
  const { db, social, blobDirectory } = makeCommandStores();
  const identity = {
    version: 1,
    canonicalPath: 'C:\\workspace',
    device: '1',
    fileIndex: '2',
  };
  try {
    social.createSocialWorkTask({
      id: 'task-integrity',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: identity.canonicalPath,
      workspaceKey: 'workspace-integrity',
      workspaceIdentity: identity,
      taskPrompt: '验证恢复资料完整性阻断。',
      model: 'test-model',
    });
    social.setSocialWorkTaskSession('task-integrity', 'session-integrity');
    social.startSocialWorkExecutionStep('task-integrity', {
      id: 'step-integrity',
      category: 'command',
      toolName: 'run_command',
      hasSideEffect: true,
    });
    const batch = social.beginSocialWorkCommandBatch({
      taskId: 'task-integrity',
      stepId: 'step-integrity',
    });
    const base = social.putSocialWorkCommandManifest({
      taskId: 'task-integrity',
      batchId: batch.id,
      kind: 'base',
      bytes: Buffer.from('base-manifest'),
    });
    writeFileSync(
      path.join(blobDirectory, `${base.baseManifestHash}.blob`),
      Buffer.from('tampered-data'),
    );
    assert.throws(
      () => social.verifyReferencedWorkspaceChangeBlobs(),
      (error) => error.code === 'workspace_change_blob_corrupt',
    );

    social.createSocialWorkTask({
      id: 'task-integrity-2',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: identity.canonicalPath,
      workspaceKey: 'workspace-integrity-2',
      workspaceIdentity: identity,
      taskPrompt: '完整性失败后不能启动新批次。',
      model: 'test-model',
    });
    social.setSocialWorkTaskSession('task-integrity-2', 'session-integrity-2');
    social.startSocialWorkExecutionStep('task-integrity-2', {
      id: 'step-integrity-2',
      category: 'command',
      toolName: 'run_command',
      hasSideEffect: true,
    });
    assert.throws(
      () =>
        social.beginSocialWorkCommandBatch({
          taskId: 'task-integrity-2',
          stepId: 'step-integrity-2',
        }),
      (error) => error.code === 'workspace_change_blob_integrity_failed',
    );
  } finally {
    db.close();
    rmSync(blobDirectory, { recursive: true, force: true });
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
    assert.match(projectWorkEnabled.systemPrompt, /你具备项目文件任务能力/u);
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
    assert.throws(
      () =>
        social.createAgent({
          name: '新闻观察者',
          headline: '另一个方向',
          description: '不能创建同名联系人。',
        }),
      /已有联系人使用这个名称/u,
    );
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

test('execution step detail exposes arguments and result for one step', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-step-detail',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\step-detail',
      workspaceKey: 'c:\\scratch\\step-detail',
      taskPrompt: '查看步骤详情。',
      model: 'auto:noema-free',
    });
    social.startSocialWorkExecutionStep('task-step-detail', {
      id: 'step-detail',
      toolName: 'read_file',
      category: 'read',
      hasSideEffect: false,
      arguments: '{"path":"a.txt"}',
    });
    social.finishSocialWorkExecutionStep('task-step-detail', 'step-detail', {
      status: 'succeeded',
      effectStatus: 'none',
      resultContent: '{"content":"hello"}',
    });

    const detail = social.getSocialWorkExecutionStepDetail(
      'task-step-detail',
      'step-detail',
    );
    assert.equal(detail?.toolName, 'read_file');
    assert.match(detail?.argumentsText ?? '', /"path": "a\.txt"/);
    assert.match(detail?.resultText ?? '', /"content": "hello"/);
    assert.equal(
      social.getSocialWorkExecutionStepDetail('task-step-detail', 'missing'),
      null,
    );
  } finally {
    db.close();
  }
});

test('touched files include write and edit paths only', () => {
  const { db, social } = makeStores();
  try {
    social.createSocialWorkTask({
      id: 'task-touched-files',
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      workspacePath: 'C:\\scratch\\touched-files',
      workspaceKey: 'c:\\scratch\\touched-files',
      taskPrompt: '列出改动文件。',
      model: 'auto:noema-free',
    });
    const steps = [
      ['step-write-a', 'write', '{"path":"src/a.js","content":"a"}'],
      ['step-write-a-again', 'write', '{"path":"src/a.js","content":"b"}'],
      ['step-edit-b', 'edit', '{"path":"src\\\\b.js","old":"a","new":"b"}'],
      ['step-read-c', 'read', '{"path":"src/c.js"}'],
      ['step-absolute', 'write', '{"path":"C:\\\\outside.txt","content":"x"}'],
      ['step-traversal', 'write', '{"path":"../outside.txt","content":"x"}'],
    ];
    for (const [id, toolName, args] of steps) {
      social.startSocialWorkExecutionStep('task-touched-files', {
        id,
        toolName,
        category: toolName === 'read' ? 'read' : 'write',
        hasSideEffect: toolName !== 'read',
        arguments: args,
      });
    }
    assert.deepEqual(social.listSocialWorkTouchedFiles('task-touched-files'), [
      { path: 'src/a.js', toolName: 'write', ordinal: 1 },
      { path: 'src/b.js', toolName: 'edit', ordinal: 3 },
    ]);
  } finally {
    db.close();
  }
});

test('assistant messages can be edited in place without changing the timeline', () => {
  const { db, social } = makeStores();
  try {
    const turn = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'edit target',
      model: 'test-model',
    });
    social.appendAssistantDelta(turn.assistantMessageId, 'original answer');
    social.completeReply(turn.assistantMessageId);
    const before = social.getRoomSnapshot('room-noema').messages;

    const edited = social.editAssistantMessage(
      'room-noema',
      turn.assistantMessageId,
      'edited answer',
    );
    assert.equal(edited.updated, 1);
    assert.ok(edited.archiveId);

    const after = social.getRoomSnapshot('room-noema').messages;
    assert.equal(after.length, before.length);
    assert.deepEqual(
      after.map((message) => message.id),
      before.map((message) => message.id),
    );
    assert.equal(
      after.find((message) => message.id === turn.assistantMessageId)?.content,
      'edited answer',
    );
    const restored = social.restoreConversationArchive(edited.archiveId);
    assert.equal(restored.messages, before.length);
    assert.equal(
      social
        .getRoomSnapshot('room-noema')
        .messages.find((message) => message.id === turn.assistantMessageId)
        ?.content,
      'original answer',
    );
    assert.throws(
      () =>
        social.editAssistantMessage(
          'room-noema',
          turn.userMessageId,
          'not allowed',
        ),
      /只能修改 Noema 的回复/,
    );
  } finally {
    db.close();
  }
});

test('conversation threads expose titles and rewind only the active thread', () => {
  const { db, social } = makeStores();
  try {
    const first = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'first question',
      model: 'test-model',
    });
    social.appendAssistantDelta(first.assistantMessageId, 'first answer');
    social.completeReply(first.assistantMessageId);
    social.createConversationBoundary();
    const second = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'second question',
      model: 'test-model',
    });
    social.appendAssistantDelta(second.assistantMessageId, 'second answer');
    social.completeReply(second.assistantMessageId);

    const threads = social.listConversationThreads('room-noema');
    assert.equal(threads.length, 2);
    assert.equal(threads[1].title, 'second question');
    assert.equal(threads[1].messageCount, 2);
    assert.ok(threads[1].updatedAt);
    assert.throws(
      () =>
        social.rewindConversationToMessage('room-noema', first.userMessageId),
      /历史会话只读/,
    );
    const rewound = social.rewindConversationToMessage(
      'room-noema',
      second.userMessageId,
    );
    assert.equal(rewound.removed, 2);
    assert.ok(rewound.archiveId);
    const messages = social.getRoomSnapshot('room-noema').messages;
    assert.equal(
      messages.some((message) => message.id === second.userMessageId),
      false,
    );
    assert.equal(
      messages.some((message) => message.id === first.userMessageId),
      true,
    );
    const restored = social.restoreConversationArchive(rewound.archiveId);
    assert.equal(restored.messages, 5);
    const restoredMessages = social.getRoomSnapshot('room-noema').messages;
    assert.equal(
      restoredMessages.some((message) => message.id === second.userMessageId),
      true,
    );
  } finally {
    db.close();
  }
});

test('job templates seed lineage and template updates do not rewrite individuals', () => {
  const { db, social } = makeStores();
  try {
    const template = social.getJobTemplate('frontend-engineer');
    assert.equal(template.version, 1);
    const created = social.createAgent({
      name: '模板前端',
      jobTemplateId: template.id,
    });
    const agentId = created.members[0].id;
    const lineage = db
      .prepare(
        'SELECT job_template_id, job_template_version FROM social_agents WHERE id = ?',
      )
      .get(agentId);
    assert.equal(lineage.job_template_id, 'frontend-engineer');
    assert.equal(lineage.job_template_version, 1);

    const updated = social.updateJobTemplate({
      jobTemplateId: 'frontend-engineer',
      title: '前端工程师',
      headline: 'Web 前端实现与静态交付（新版本）',
      description: '模板更新后的职责说明。',
    });
    assert.equal(updated.version, 2);
    const after = db
      .prepare(
        'SELECT headline, job_template_version FROM social_agents WHERE id = ?',
      )
      .get(agentId);
    assert.equal(after.job_template_version, 1);
    assert.equal(after.headline, template.headline);
  } finally {
    db.close();
  }
});
