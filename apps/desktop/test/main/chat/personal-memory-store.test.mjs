import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { SocialChatStore } from '../../../src/main/chat/social-chat-store.mjs';
import { SOCIAL_SCHEMA_VERSION } from '../../../src/main/chat/social-chat-schema.mjs';

function makeStore() {
  const db = new Database(':memory:');
  new RootStore(db);
  const chat = new SocialChatStore(db);
  return { db, chat, memories: chat.personalMemories };
}

function addMainMessage(chat, text = '我每周五下班后推进价格追踪项目。') {
  const turn = chat.beginTurn({
    roomId: 'room-noema',
    agentId: 'noema',
    text,
    model: 'test-model',
  });
  chat.appendAssistantDelta(turn.assistantMessageId, '收到。');
  chat.completeReply(turn.assistantMessageId);
  return turn.userMessageId;
}

test('personal memories are explicit, searchable, bounded, and independently deletable', () => {
  const { db, chat, memories } = makeStore();
  try {
    const sourceMessageId = addMainMessage(chat);
    const item = memories.add({
      content: '我每周五下班后推进价格追踪项目。',
      sourceRoomId: 'room-noema',
      sourceMessageId,
    });

    assert.equal(item.sourceKind, 'message');
    assert.equal(item.sourceMessageId, sourceMessageId);
    assert.equal(memories.search('价格追踪')[0].id, item.id);
    assert.equal(memories.search('周五')[0].id, item.id);
    assert.deepEqual(memories.search('短'), []);

    memories.setEnabled(false);
    assert.equal(memories.list().items.length, 1);
    assert.deepEqual(memories.search('价格追踪'), []);
    memories.setEnabled(true);

    assert.equal(memories.delete(item.id), true);
    assert.equal(memories.get(item.id), null);
    assert.deepEqual(memories.search('价格追踪'), []);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM social_user_memories_fts').get()
        .count,
      0,
    );
  } finally {
    db.close();
  }
});

test('manual edits replace source attribution and stale message references are nulled', () => {
  const { db, chat, memories } = makeStore();
  try {
    const sourceMessageId = addMainMessage(chat);
    const item = memories.add({
      content: '原始内容',
      sourceRoomId: 'room-noema',
      sourceMessageId,
    });
    const edited = memories.update({
      id: item.id,
      content: '手动修正后的内容',
    });
    assert.equal(edited.sourceKind, 'manual');
    assert.equal(edited.sourceMessageId, null);
    assert.equal(memories.search('手动修正')[0].id, item.id);

    const sourcedAgain = memories.update({
      id: item.id,
      content: '再次由当前主聊消息修订的内容',
      sourceRoomId: 'room-noema',
      sourceMessageId: addMainMessage(chat, '将这条事实更新为新的说法。'),
    });
    assert.equal(sourcedAgain.sourceKind, 'message');
    db.prepare('DELETE FROM social_messages WHERE id = ?').run(
      sourcedAgain.sourceMessageId,
    );
    const retained = memories.get(item.id);
    assert.equal(retained.content, '再次由当前主聊消息修订的内容');
    assert.equal(retained.sourceMessageId, null);
    assert.equal(retained.sourceRoomId, 'room-noema');
  } finally {
    db.close();
  }
});

test('only completed user messages in the Noema main conversation can be a source', () => {
  const { db, chat, memories } = makeStore();
  try {
    const created = chat.createAgent({
      name: '研究员',
      headline: '研究',
      description: '研究资料。',
      projectWork: false,
    });
    const specialist = created.members[0];
    const specialistMessage = chat.beginTurn({
      roomId: created.room.id,
      agentId: specialist.id,
      text: '成员消息不应成为个人资料来源。',
      model: 'test-model',
    }).userMessageId;
    assert.throws(
      () =>
        memories.add({
          content: '不应保存',
          sourceRoomId: created.room.id,
          sourceMessageId: specialistMessage,
        }),
      /Noema 主聊/u,
    );
    assert.throws(
      () =>
        memories.add({
          content: '不应保存',
          sourceRoomId: 'room-noema',
          sourceMessageId: specialistMessage,
        }),
      /Noema 主聊/u,
    );
  } finally {
    db.close();
  }
});

test('schema v28 upgrades to personal memory without changing older data', () => {
  const { db, chat, memories } = makeStore();
  try {
    addMainMessage(chat, '已有聊天仍然保留。');
    const beforeCount = db
      .prepare('SELECT COUNT(*) AS count FROM social_messages')
      .get().count;
    db.exec(`
      ALTER TABLE social_projects DROP COLUMN workspace_identity_json;
      ALTER TABLE social_projects DROP COLUMN workspace_path;
      ALTER TABLE social_work_tasks DROP COLUMN workspace_identity_json;
      DROP TABLE social_work_file_change_operations;
      DROP TABLE social_work_file_changes;
      DROP TABLE IF EXISTS social_work_workspace_write_locks;
      DROP TABLE IF EXISTS social_work_command_batches;
      DROP TABLE IF EXISTS social_work_change_blobs;
      DROP TABLE social_user_memories_fts;
      DROP INDEX social_user_memories_updated;
      DROP TABLE social_user_memories;
      DROP TABLE social_user_followups;
      DROP TABLE application_shutdown_intent;
      DELETE FROM social_schema_migrations WHERE version >= 29;
    `);
    chat.migrate();
    assert.equal(
      db
        .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
        .get().version,
      SOCIAL_SCHEMA_VERSION,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM social_messages').get().count,
      beforeCount,
    );
    const item = memories.add({ content: '升级后可新增记忆。' });
    assert.equal(item.sourceMessageId, null);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});
