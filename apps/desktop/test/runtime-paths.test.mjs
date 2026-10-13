import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNoemaDatabasePath } from '../src/runtime-paths.mjs';

test('only unpackaged E2E runs can redirect the root database', () => {
  assert.equal(
    resolveNoemaDatabasePath({
      userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\Noema',
      isPackaged: false,
      testDatabasePath: 'D:/scratch/noema-e2e.sqlite3',
    }),
    'D:\\scratch\\noema-e2e.sqlite3',
  );
  assert.equal(
    resolveNoemaDatabasePath({
      userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\Noema',
      isPackaged: true,
      testDatabasePath: 'D:/scratch/noema-e2e.sqlite3',
    }),
    'C:\\Users\\test\\AppData\\Roaming\\Noema\\noema.sqlite3',
  );
  assert.equal(
    resolveNoemaDatabasePath({
      userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\Noema',
      isPackaged: false,
    }),
    'C:\\Users\\test\\AppData\\Roaming\\Noema\\noema.sqlite3',
  );
});
