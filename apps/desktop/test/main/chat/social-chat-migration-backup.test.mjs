import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { SocialChatStore } from '../../../src/main/chat/social-chat-store.mjs';
import { backupBeforeSocialChatMigration } from '../../../src/main/chat/social-chat-migration-backup.ts';
import { SOCIAL_SCHEMA_VERSION } from '../../../src/main/chat/social-chat-schema.ts';

test('the first social migration creates one consistent local SQLite backup', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-social-backup-'),
  );
  const databasePath = path.join(directory, 'noema.sqlite3');
  const store = new RootStore(databasePath);
  try {
    store.setSelectedModel('before-migration');
    const backupPath = await backupBeforeSocialChatMigration({
      db: store.db,
      databasePath,
    });
    assert.equal(
      backupPath,
      path.join(directory, 'noema-before-social-chat-v1.sqlite3'),
    );
    const snapshot = new Database(backupPath, { readonly: true });
    try {
      assert.equal(
        snapshot
          .prepare(
            "SELECT value FROM app_settings WHERE key = 'selected_model'",
          )
          .get().value,
        'before-migration',
      );
    } finally {
      snapshot.close();
    }

    store.setSelectedModel('after-backup');
    assert.equal(
      await backupBeforeSocialChatMigration({ db: store.db, databasePath }),
      backupPath,
    );
    const preserved = new Database(backupPath, { readonly: true });
    try {
      assert.equal(
        preserved
          .prepare(
            "SELECT value FROM app_settings WHERE key = 'selected_model'",
          )
          .get().value,
        'before-migration',
      );
    } finally {
      preserved.close();
    }
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('in-memory databases do not create migration backup files', async () => {
  const store = new RootStore(':memory:');
  try {
    assert.equal(
      await backupBeforeSocialChatMigration({
        db: store.db,
        databasePath: ':memory:',
      }),
      null,
    );
  } finally {
    store.close();
  }
});

test('a later schema upgrade gets a verified snapshot without overwriting the first backup', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-upgrade-backup-'),
  );
  const databasePath = path.join(directory, 'noema.sqlite3');
  const root = new RootStore(databasePath);
  try {
    const first = await backupBeforeSocialChatMigration({
      db: root.db,
      databasePath,
    });
    new SocialChatStore(root.db);
    root.setSelectedModel('before-next-upgrade');
    assert.equal(
      await backupBeforeSocialChatMigration({ db: root.db, databasePath }),
      null,
    );
    const next = await backupBeforeSocialChatMigration({
      db: root.db,
      databasePath,
      targetVersion: SOCIAL_SCHEMA_VERSION + 1,
    });
    assert.equal(
      fs.readdirSync(directory).some((name) => name.includes('.partial-')),
      false,
    );
    assert.notEqual(next, first);
    const snapshot = new Database(next);
    try {
      assert.equal(
        snapshot
          .prepare(
            'SELECT MAX(version) AS version FROM social_schema_migrations',
          )
          .get().version,
        SOCIAL_SCHEMA_VERSION,
      );
      assert.equal(
        snapshot
          .prepare(
            "SELECT value FROM app_settings WHERE key = 'selected_model'",
          )
          .get().value,
        'before-next-upgrade',
      );
    } finally {
      snapshot.close();
    }
    assert.ok(fs.existsSync(first));
    assert.equal(
      await backupBeforeSocialChatMigration({
        db: root.db,
        databasePath,
        targetVersion: SOCIAL_SCHEMA_VERSION + 1,
      }),
      next,
    );
  } finally {
    root.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('social schema v27 upgrades to the current version without losing existing messages', () => {
  const root = new RootStore(':memory:');
  try {
    const store = new SocialChatStore(root.db);
    const before = store.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '保留已有主聊内容。',
      model: 'test-model',
    });
    store.db.exec(`
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
    `);

    new SocialChatStore(root.db);

    const version = root.db
      .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
      .get().version;
    const columns = root.db.pragma('table_info(social_messages)');
    assert.equal(version, SOCIAL_SCHEMA_VERSION);
    assert.ok(
      columns.some((column) => column.name === 'delegation_parent_message_id'),
    );
    assert.equal(
      root.db
        .prepare('SELECT content FROM social_messages WHERE id = ?')
        .get(before.userMessageId).content,
      '保留已有主聊内容。',
    );
  } finally {
    root.close();
  }
});

test('an incomplete existing backup is preserved and replaced by a valid snapshot', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-partial-backup-'),
  );
  const databasePath = path.join(directory, 'noema.sqlite3');
  const root = new RootStore(databasePath);
  try {
    const backupPath = path.join(
      directory,
      'noema-before-social-chat-v1.sqlite3',
    );
    fs.writeFileSync(backupPath, 'unfinished backup');
    assert.equal(
      await backupBeforeSocialChatMigration({ db: root.db, databasePath }),
      backupPath,
    );
    const preserved = fs
      .readdirSync(directory)
      .filter((name) => name.includes('.invalid-'));
    assert.equal(preserved.length, 1);
    assert.equal(
      fs.readFileSync(path.join(directory, preserved[0]), 'utf8'),
      'unfinished backup',
    );
    const snapshot = new Database(backupPath, { readonly: true });
    try {
      assert.equal(snapshot.pragma('quick_check', { simple: true }), 'ok');
    } finally {
      snapshot.close();
    }
  } finally {
    root.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a failed backup never publishes a partial recovery point or changes source data', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-failed-backup-'),
  );
  const databasePath = path.join(directory, 'noema.sqlite3');
  const root = new RootStore(databasePath);
  try {
    root.setSelectedModel('keep-original');
    const db = {
      prepare: root.db.prepare.bind(root.db),
      async backup(filename) {
        fs.writeFileSync(filename, 'partial output');
        throw new Error('simulated disk failure');
      },
    };
    await assert.rejects(
      backupBeforeSocialChatMigration({ db, databasePath }),
      /simulated disk failure/,
    );
    assert.equal(
      fs.existsSync(
        path.join(directory, 'noema-before-social-chat-v1.sqlite3'),
      ),
      false,
    );
    assert.equal(
      fs.readdirSync(directory).some((name) => name.includes('.partial-')),
      false,
    );
    assert.equal(
      root.db
        .prepare("SELECT value FROM app_settings WHERE key = 'selected_model'")
        .get().value,
      'keep-original',
    );
  } finally {
    root.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
