import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureWorkspaceIdentity,
  compareWorkspaceIdentities,
  isWorkspaceIdentity,
  workspacePathKey,
} from '../../../src/main/platform/workspace-identity.ts';

function directoryStat({ directory = true, dev = 7n, ino = 42n } = {}) {
  return {
    dev,
    ino,
    isDirectory: () => directory,
  };
}

test('captures versioned canonical directory identity and stable workspace key', () => {
  const result = captureWorkspaceIdentity('chosen', {
    realpathSync: () => 'C:\\Work\\Noema',
    statSync: () => directoryStat(),
    platform: 'win32',
  });

  assert.deepEqual(result, {
    ok: true,
    identity: {
      version: 1,
      canonicalPath: 'C:\\Work\\Noema',
      device: '7',
      fileIndex: '42',
    },
    workspaceKey: 'v1:7:42',
  });
  assert.equal(isWorkspaceIdentity(result.identity), true);
});

test('rejects missing, non-directory, or unavailable filesystem identity', () => {
  assert.equal(captureWorkspaceIdentity(null).ok, false);
  assert.deepEqual(
    captureWorkspaceIdentity('file', {
      realpathSync: () => 'file',
      statSync: () => directoryStat({ directory: false }),
    }),
    { ok: false, code: 'workspace_not_directory' },
  );
  assert.deepEqual(
    captureWorkspaceIdentity('directory', {
      realpathSync: () => 'directory',
      statSync: () => directoryStat({ ino: 0n }),
    }),
    { ok: false, code: 'workspace_identity_unavailable' },
  );
  assert.deepEqual(
    captureWorkspaceIdentity('missing', {
      realpathSync: () => {
        throw new Error('private path detail');
      },
    }),
    { ok: false, code: 'workspace_identity_unavailable' },
  );
});

test('identity comparison includes both canonical path and filesystem object', () => {
  const left = {
    version: 1,
    canonicalPath: 'C:\\Work\\Noema',
    device: '7',
    fileIndex: '42',
  };
  assert.equal(compareWorkspaceIdentities(left, { ...left }, 'win32'), true);
  assert.equal(
    compareWorkspaceIdentities(left, { ...left, fileIndex: '43' }, 'win32'),
    false,
  );
  assert.equal(
    compareWorkspaceIdentities(
      left,
      { ...left, canonicalPath: 'C:\\Other' },
      'win32',
    ),
    false,
  );
  assert.equal(
    compareWorkspaceIdentities(
      left,
      { ...left, canonicalPath: 'c:\\work\\noema' },
      'win32',
    ),
    true,
  );
  assert.equal(
    compareWorkspaceIdentities(left, { ...left, version: 99 }, 'win32'),
    false,
  );
});

test('workspace path key folds case only on Windows', () => {
  const identity = { canonicalPath: 'C:\\Work\\Noema' };
  assert.equal(workspacePathKey(identity, 'win32'), 'c:\\work\\noema');
  const posix = { canonicalPath: '/Users/Me/Noema' };
  assert.equal(workspacePathKey(posix, 'darwin'), '/Users/Me/Noema');
  assert.equal(workspacePathKey(posix, 'linux'), '/Users/Me/Noema');
  assert.notEqual(
    workspacePathKey({ canonicalPath: '/users/me/noema' }, 'darwin'),
    workspacePathKey(posix, 'darwin'),
  );
});
