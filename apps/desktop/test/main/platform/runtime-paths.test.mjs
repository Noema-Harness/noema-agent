import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  resolveNoemaDatabasePath,
  resolveNoemaDshUserDataPath,
} from '../../../src/main/platform/runtime-paths.ts';
import { windowsOnly } from '../../support/platform-cases.mjs';

// Fixtures are spelled the way this OS spells absolute paths.
const ROOT = path.parse(process.cwd()).root;
const USER_DATA = path.join(ROOT, 'Users', 'test', 'AppData', 'Noema');
const SCRATCH = path.join(ROOT, 'scratch');

test('only unpackaged E2E runs can redirect the root database', () => {
  const testDatabasePath = path.join(SCRATCH, 'noema-e2e.sqlite3');
  assert.equal(
    resolveNoemaDatabasePath({
      userDataPath: USER_DATA,
      isPackaged: false,
      testDatabasePath,
    }),
    testDatabasePath,
  );
  assert.equal(
    resolveNoemaDatabasePath({
      userDataPath: USER_DATA,
      isPackaged: true,
      testDatabasePath,
    }),
    path.join(USER_DATA, 'noema.sqlite3'),
  );
  assert.equal(
    resolveNoemaDatabasePath({ userDataPath: USER_DATA, isPackaged: false }),
    path.join(USER_DATA, 'noema.sqlite3'),
  );
});

test(
  'a forward-slash drive-letter database path resolves to its native form',
  windowsOnly('drive-letter paths are relative on POSIX'),
  () => {
    assert.equal(
      resolveNoemaDatabasePath({
        userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\Noema',
        isPackaged: false,
        testDatabasePath: 'D:/scratch/noema-e2e.sqlite3',
      }),
      'D:\\scratch\\noema-e2e.sqlite3',
    );
  },
);

test('only an unpackaged isolated database can redirect DSH worker state', () => {
  const testDatabasePath = path.join(SCRATCH, 'root.sqlite3');
  const testDshUserDataPath = path.join(SCRATCH, 'dsh-user-data');
  assert.equal(
    resolveNoemaDshUserDataPath({
      userDataPath: USER_DATA,
      isPackaged: false,
      testDatabasePath,
      testDshUserDataPath,
    }),
    testDshUserDataPath,
  );
  assert.equal(
    resolveNoemaDshUserDataPath({
      userDataPath: USER_DATA,
      isPackaged: false,
      testDshUserDataPath,
    }),
    USER_DATA,
  );
  assert.equal(
    resolveNoemaDshUserDataPath({
      userDataPath: USER_DATA,
      isPackaged: true,
      testDatabasePath,
      testDshUserDataPath,
    }),
    USER_DATA,
  );
});
