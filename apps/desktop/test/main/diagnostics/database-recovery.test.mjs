import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  openNoemaDataDirectory,
  readDatabaseHealth,
  showDatabaseStartupFailure,
} from '../../../src/main/diagnostics/database-recovery.mjs';

test('database health runs only the read-only quick check and returns bounded states', () => {
  const calls = [];
  assert.equal(
    readDatabaseHealth({
      open: true,
      pragma: (...args) => {
        calls.push(args);
        return 'ok';
      },
    }),
    'healthy',
  );
  assert.deepEqual(calls, [['quick_check', { simple: true }]]);
  assert.equal(
    readDatabaseHealth({
      open: true,
      pragma: () => 'malformed database file at C:\\private',
    }),
    'problem',
  );
  assert.equal(
    readDatabaseHealth({
      open: true,
      pragma: () => {
        throw new Error('private database path');
      },
    }),
    'unavailable',
  );
  assert.equal(readDatabaseHealth({ open: false }), 'unavailable');
  assert.equal(readDatabaseHealth(null), 'unavailable');
});

test('data-directory action opens only the fixed main-process path and returns no path', async () => {
  const userDataPath = path.resolve('noema-user-data');
  const opened = [];
  assert.deepEqual(
    await openNoemaDataDirectory({
      userDataPath,
      shell: {
        openPath: async (value) => {
          opened.push(value);
          return '';
        },
      },
    }),
    { opened: true, errorCode: null },
  );
  assert.deepEqual(opened, [userDataPath]);
  assert.deepEqual(
    await openNoemaDataDirectory({
      userDataPath: 'relative\\path',
      shell: { openPath: async () => '' },
    }),
    { opened: false, errorCode: 'data_directory_unavailable' },
  );
  assert.deepEqual(
    await openNoemaDataDirectory({
      userDataPath,
      shell: { openPath: async () => 'access denied at C:\\private' },
    }),
    { opened: false, errorCode: 'data_directory_open_failed' },
  );
});

test('startup database dialog opens the data folder only after explicit selection', async () => {
  const messages = [];
  const opened = [];
  await showDatabaseStartupFailure({
    userDataPath: path.resolve('noema-user-data'),
    message: 'Noema database could not be opened.',
    shell: {
      openPath: async (value) => {
        opened.push(value);
        return '';
      },
    },
    dialog: {
      showMessageBox: async (options) => {
        messages.push(options);
        return { response: 1 };
      },
    },
  });
  assert.deepEqual(opened, []);
  assert.deepEqual(messages[0].buttons, ['打开数据目录', '退出']);
  assert.equal(messages[0].defaultId, 1);
});

test('startup database recovery opens the fixed folder only after the user asks', async () => {
  const userDataPath = path.resolve('noema-user-data');
  const messages = [];
  const opened = [];
  const result = await showDatabaseStartupFailure({
    userDataPath,
    message: 'Noema database could not be opened.',
    shell: {
      openPath: async (value) => {
        opened.push(value);
        return '';
      },
    },
    dialog: {
      showMessageBox: async (options) => {
        messages.push(options);
        return { response: 0 };
      },
    },
  });
  assert.deepEqual(result, { opened: true, errorCode: null });
  assert.deepEqual(opened, [userDataPath]);
  assert.equal(messages.length, 1);
  assert.match(messages[0].detail, /请先退出 Noema/);
});

test('startup folder opening failure is reported generically', async () => {
  const messages = [];
  const result = await showDatabaseStartupFailure({
    userDataPath: path.resolve('noema-user-data'),
    message: 'Noema database could not be opened.',
    shell: { openPath: async () => 'private path failure' },
    dialog: {
      showMessageBox: async (options) => {
        messages.push(options);
        return { response: messages.length === 1 ? 0 : 0 };
      },
    },
  });
  assert.deepEqual(result, {
    opened: false,
    errorCode: 'data_directory_open_failed',
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].message, '请检查 Noema 数据目录权限后重试。');
  assert.equal(
    JSON.stringify(messages).includes('private path failure'),
    false,
  );
});
