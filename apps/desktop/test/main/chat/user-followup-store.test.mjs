import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { SocialChatStore } from '../../../src/main/chat/social-chat-store.mjs';

function makeStore() {
  const db = new Database(':memory:');
  new RootStore(db);
  const chat = new SocialChatStore(db);
  let now = Date.parse('2026-11-01T00:00:00.000Z');
  chat.userFollowups.now = () => now;
  return {
    db,
    chat,
    followups: chat.userFollowups,
    advance(ms) {
      now += ms;
    },
  };
}

function addMainMessage(chat, text = '周五下班后再聊价格追踪。') {
  const turn = chat.beginTurn({
    roomId: 'room-noema',
    agentId: 'noema',
    text,
    model: 'test-model',
  });
  chat.appendAssistantDelta(turn.assistantMessageId, '好。');
  chat.completeReply(turn.assistantMessageId);
  return turn.userMessageId;
}

function makeFollowup(followups, overrides = {}) {
  return followups.add({
    title: '再聊价格追踪',
    body: '看看项目最近有什么进展。',
    dueAt: '2026-11-01T00:02:00.000Z',
    ...overrides,
  });
}

test('creates reminders only with bounded, timezone-qualified input and Noema source messages', () => {
  const { db, chat, followups } = makeStore();
  try {
    const sourceMessageId = addMainMessage(chat);
    const item = makeFollowup(followups, {
      sourceRoomId: 'room-noema',
      sourceMessageId,
    });

    assert.equal(item.status, 'pending');
    assert.equal(item.sourceMessageId, sourceMessageId);
    assert.equal(followups.list().enabled, true);
    assert.throws(
      () => makeFollowup(followups, { dueAt: '2026-11-01T00:02:00' }),
      /时区/,
    );
    assert.throws(
      () => makeFollowup(followups, { dueAt: '2026-11-01T00:00:30.000Z' }),
      /1 分钟/,
    );
    assert.throws(
      () => makeFollowup(followups, { sourceRoomId: 'room-noema' }),
      /来源消息/,
    );

    db.prepare('DELETE FROM social_messages WHERE id = ?').run(sourceMessageId);
    const retained = followups.get(item.id);
    assert.equal(retained.sourceRoomId, 'room-noema');
    assert.equal(retained.sourceMessageId, null);
  } finally {
    db.close();
  }
});

test('pause preserves due items; re-enable claims once and records delivery', () => {
  const { db, followups, advance } = makeStore();
  try {
    const item = makeFollowup(followups);
    advance(2 * 60_000);
    followups.setEnabled(false);
    assert.deepEqual(followups.claimDue(), []);
    assert.equal(followups.get(item.id).status, 'pending');

    followups.setEnabled(true);
    const [claimed] = followups.claimDue();
    assert.equal(claimed.id, item.id);
    assert.equal(claimed.status, 'delivering');
    assert.equal(followups.markDelivered(item.id), true);
    assert.equal(followups.markDelivered(item.id), false);
    assert.equal(followups.get(item.id).status, 'delivered');
    assert.ok(followups.get(item.id).deliveredAt);
  } finally {
    db.close();
  }
});

test('expired delivery lease is reclaimed after a crash; failed notifications return to pending', () => {
  const { db, followups, advance } = makeStore();
  try {
    const item = makeFollowup(followups);
    advance(2 * 60_000);
    assert.equal(followups.claimDue()[0].id, item.id);
    assert.deepEqual(followups.claimDue(), []);

    advance(60_001);
    assert.equal(followups.claimDue()[0].id, item.id);
    assert.equal(followups.release(item.id, '通知接口不可用'), true);
    assert.equal(followups.get(item.id).status, 'pending');
    assert.equal(followups.get(item.id).lastError, '通知接口不可用');
  } finally {
    db.close();
  }
});

test('only pending reminders can be edited or canceled; active reminder count is bounded', () => {
  const { db, followups } = makeStore();
  try {
    const item = makeFollowup(followups);
    assert.equal(
      followups.update({
        id: item.id,
        title: '已调整',
        body: '改到稍后再看。',
        dueAt: '2026-11-01T00:03:00.000Z',
      }).title,
      '已调整',
    );
    assert.equal(followups.cancel(item.id), true);
    assert.equal(followups.cancel(item.id), false);
    assert.deepEqual(
      followups.claimDue({ now: Date.parse('2026-11-01T00:04:00.000Z') }),
      [],
    );
    assert.throws(
      () =>
        followups.update({
          id: item.id,
          title: '已取消',
          body: '不可修改',
          dueAt: '2026-11-01T00:03:00.000Z',
        }),
      /待处理/,
    );

    for (let index = 0; index < 30; index++) makeFollowup(followups);
    assert.throws(() => makeFollowup(followups), /最多同时保留/);
  } finally {
    db.close();
  }
});

test('schema v29 upgrades to follow-ups without changing the existing transcript', () => {
  const { db, chat, followups } = makeStore();
  try {
    const sourceMessageId = addMainMessage(chat, '旧主聊内容应保留。');
    const beforeCount = db
      .prepare('SELECT COUNT(*) AS count FROM social_messages')
      .get().count;
    db.exec(`
      DROP INDEX social_user_followups_history;
      DROP INDEX social_user_followups_due;
      DROP TABLE social_user_followups;
      DELETE FROM app_settings WHERE key = 'user_followups_enabled';
      DELETE FROM social_schema_migrations WHERE version = 30;
    `);

    chat.migrate();

    assert.equal(
      db
        .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
        .get().version,
      30,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM social_messages').get().count,
      beforeCount,
    );
    assert.equal(followups.isEnabled(), true);
    assert.equal(
      makeFollowup(followups, {
        sourceRoomId: 'room-noema',
        sourceMessageId,
      }).sourceMessageId,
      sourceMessageId,
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});
