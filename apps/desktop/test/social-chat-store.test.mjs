import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';

function makeStores() {
  const db = new Database(':memory:');
  new RootStore(db);
  const social = new SocialChatStore(db);
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

test('social schema seeds stable identities and keeps one agent across independent rooms', () => {
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
      11,
    );
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
      11,
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
    const social = new SocialChatStore(db);
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
      /只有当用户明确切换到项目工作/u,
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
