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
      2,
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
      ALTER TABLE social_agents DROP COLUMN capabilities_json;
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
      2,
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

test('a reply can be retried after failure without duplicating its user turn', () => {
  const { db, social } = makeStores();
  try {
    const turn = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '重试标记：银杏',
      model: 'test-model',
    });
    social.failReply(turn.assistantMessageId, 'test_failure', '模型暂不可用');
    const retried = social.retryReply(turn.assistantMessageId, 'next-model');
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
  } finally {
    db.close();
  }
});
