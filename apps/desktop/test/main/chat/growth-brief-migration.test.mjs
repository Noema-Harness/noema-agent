import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { migrateSocialChatSchema } from '../../../src/main/chat/migrations.mjs';
import { SOCIAL_SCHEMA_VERSION } from '../../../src/main/chat/social-chat-schema.mjs';

const now = '2026-11-14T14:00:00.000Z';

function createSchema42Database() {
  const db = new Database(':memory:');
  new RootStore(db);
  migrateSocialChatSchema(db, { targetVersion: 42 });
  db.prepare(
    `INSERT INTO social_agents
       (id, name, kind, headline, description, system_prompt, created_at, updated_at)
     VALUES ('agent-1', '复盘成员', 'specialist', '核验', '核验交付。',
             '你是复盘成员。', ?, ?)`,
  ).run(now, now);
  for (const [id, kind, title] of [
    ['room-noema', 'direct', 'Noema'],
    ['room-project', 'group', '项目群'],
  ]) {
    db.prepare(
      `INSERT INTO social_rooms (id, kind, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, kind, title, now, now);
  }
  db.prepare(
    `INSERT INTO social_projects
       (id, title, brief, group_room_id, created_at, updated_at)
     VALUES ('project-1', '价格追踪', '追踪价格。', 'room-project', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO social_project_growth_batches
       (id, project_id, plan_revision, status, created_at, updated_at, completed_at)
     VALUES ('batch-1', 'project-1', 1, 'completed', ?, ?, ?)`,
  ).run(now, now, now);
  db.prepare(
    `INSERT INTO social_project_growth_members
       (batch_id, agent_id, session_room_id, status, turn_id, brief,
        created_at, updated_at, completed_at)
     VALUES ('batch-1', 'agent-1', 'room-project', 'no_change', 'turn-1',
             '我先看看资产。<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="manage_member_assets">',
             ?, ?, ?)`,
  ).run(now, now, now);
  return db;
}

test('migration 43 clears the text of reviews that changed nothing', () => {
  const db = createSchema42Database();
  try {
    migrateSocialChatSchema(db);
    const version = db
      .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
      .get().version;
    assert.equal(version, SOCIAL_SCHEMA_VERSION);
    assert.equal(SOCIAL_SCHEMA_VERSION, 43);

    const member = db
      .prepare(
        `SELECT status, brief FROM social_project_growth_members
         WHERE batch_id = 'batch-1' AND agent_id = 'agent-1'`,
      )
      .get();
    assert.equal(member.status, 'no_change');
    assert.equal(
      member.brief,
      null,
      'a no-change review must not keep tool-call text as experience',
    );

    db.prepare(
      `UPDATE social_project_growth_members
       SET status = 'completed', turn_id = 'turn-2', brief = ?,
           updated_at = ?, completed_at = ?
       WHERE batch_id = 'batch-1' AND agent_id = 'agent-1'`,
    ).run('本次核验方法已记录为经历。', now, now);
    const completed = db
      .prepare(
        `SELECT status, brief FROM social_project_growth_members
         WHERE batch_id = 'batch-1' AND agent_id = 'agent-1'`,
      )
      .get();
    assert.equal(completed.status, 'completed');
    assert.equal(completed.brief, '本次核验方法已记录为经历。');
  } finally {
    db.close();
  }
});
