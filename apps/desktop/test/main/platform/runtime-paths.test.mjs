import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveNoemaDatabasePath,
  resolveNoemaDshUserDataPath,
} from '../../../src/main/platform/runtime-paths.mjs';

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

test('only an unpackaged isolated database can redirect DSH worker state', () => {
  assert.equal(
    resolveNoemaDshUserDataPath({
      userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\Noema',
      isPackaged: false,
      testDatabasePath: 'D:/scratch/root.sqlite3',
      testDshUserDataPath: 'D:/scratch/dsh-user-data',
    }),
    'D:\\scratch\\dsh-user-data',
  );
  assert.equal(
    resolveNoemaDshUserDataPath({
      userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\Noema',
      isPackaged: false,
      testDshUserDataPath: 'D:/scratch/dsh-user-data',
    }),
    'C:\\Users\\test\\AppData\\Roaming\\Noema',
  );
  assert.equal(
    resolveNoemaDshUserDataPath({
      userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\Noema',
      isPackaged: true,
      testDatabasePath: 'D:/scratch/root.sqlite3',
      testDshUserDataPath: 'D:/scratch/dsh-user-data',
    }),
    'C:\\Users\\test\\AppData\\Roaming\\Noema',
  );
});
