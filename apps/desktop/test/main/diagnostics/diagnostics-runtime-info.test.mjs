import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { collectDiagnosticsRuntimeInfo } from '../../../src/main/diagnostics/diagnostics-runtime-info.ts';
import { DiagnosticsEventStore } from '../../../src/main/storage/diagnostics-event-store.mjs';

test('runtime manifest includes only bounded host fields and applied migration versions', () => {
  const db = new Database(':memory:');
  new DiagnosticsEventStore(db);
  db.exec(`
    CREATE TABLE social_schema_migrations (
      version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
    );
    INSERT INTO social_schema_migrations VALUES (33, 'fixture');
  `);
  try {
    assert.deepEqual(
      collectDiagnosticsRuntimeInfo({
        db,
        applicationVersion: '0.1.0',
        electronVersion: '44.9.3',
        nodeVersion: '24.21.0',
        osVersion: '10.0.19045',
        platform: 'win32',
        architecture: 'x64',
        isPackaged: true,
        workspacePath: 'C:\\PRIVATE_PATH_SENTINEL',
      }),
      {
        applicationVersion: '0.1.0',
        electronVersion: '44.9.3',
        nodeVersion: '24.21.0',
        osVersion: '10.0.19045',
        platform: 'win32',
        architecture: 'x64',
        isPackaged: true,
        socialSchemaVersion: 33,
        diagnosticsSchemaVersion: 1,
      },
    );
  } finally {
    db.close();
  }
});

test('unavailable migration ledgers return unknown without failing diagnostics', () => {
  const db = new Database(':memory:');
  try {
    assert.equal(
      collectDiagnosticsRuntimeInfo({
        db,
        applicationVersion: 'x'.repeat(81),
        electronVersion: '44.9.3',
        nodeVersion: '24.21.0',
        osVersion: '10.0.19045',
        platform: 'win32',
        architecture: 'x64',
        isPackaged: false,
      }).socialSchemaVersion,
      null,
    );
    const runtime = collectDiagnosticsRuntimeInfo({
      db,
      applicationVersion: 'x'.repeat(81),
      electronVersion: '44.9.3',
      nodeVersion: '24.21.0',
      osVersion: '10.0.19045',
      platform: 'win32',
      architecture: 'x64',
      isPackaged: false,
    });
    assert.equal(runtime.diagnosticsSchemaVersion, null);
    assert.equal(runtime.applicationVersion, null);
    assert.equal(runtime.isPackaged, false);
  } finally {
    db.close();
  }
});
