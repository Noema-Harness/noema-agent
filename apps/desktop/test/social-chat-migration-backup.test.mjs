import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RootStore } from '../src/root-store.mjs';
import { backupBeforeSocialChatMigration } from '../src/social-chat-migration-backup.mjs';

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
