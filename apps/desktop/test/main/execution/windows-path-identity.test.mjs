import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  captureWindowsDirectoryIdentity,
  captureWindowsPathIdentity,
} from '../../../src/main/execution/windows-path-identity.ts';

function directoryStats({ dev = 7n, ino = 13n, directory = true } = {}) {
  return {
    dev,
    ino,
    isDirectory: () => directory,
    isFile: () => !directory,
  };
}

test('captures canonical native directory identity from bigint stats', async () => {
  const result = await captureWindowsDirectoryIdentity('C:\\project', {
    statPath: async (value, options) => {
      assert.equal(value, 'C:\\project');
      assert.deepEqual(options, { bigint: true });
      return directoryStats();
    },
  });
  assert.deepEqual(result, {
    ok: true,
    root: {
      path: 'C:\\project',
      fileIdentity: { volumeSerialNumber: '7', fileIndex: '13' },
    },
  });
});

test('rejects unknown, non-directory and out-of-range identities', async () => {
  for (const stats of [
    directoryStats({ dev: 0n }),
    directoryStats({ ino: 0n }),
    directoryStats({ dev: 4_294_967_296n }),
    directoryStats({ ino: 18_446_744_073_709_551_616n }),
    directoryStats({ directory: false }),
    { dev: 7, ino: 13, isDirectory: () => true },
  ]) {
    assert.deepEqual(
      await captureWindowsDirectoryIdentity('C:\\project', {
        statPath: async () => stats,
      }),
      { ok: false, code: 'path_identity_unavailable' },
    );
  }
});

test('captures file roots while directory identity remains directory-only', async () => {
  const fileStats = directoryStats({ directory: false, dev: 19n, ino: 23n });
  const options = { statPath: async () => fileStats };
  assert.deepEqual(
    await captureWindowsPathIdentity('D:\\external\\notes.txt', options),
    {
      ok: true,
      root: {
        path: 'D:\\external\\notes.txt',
        fileIdentity: { volumeSerialNumber: '19', fileIndex: '23' },
      },
    },
  );
  assert.deepEqual(
    await captureWindowsDirectoryIdentity('D:\\external\\notes.txt', options),
    { ok: false, code: 'path_identity_unavailable' },
  );
});

test('maps a real Windows directory identity to the native policy shape', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows file identity contract');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'noema-path-identity-'));
  try {
    const result = await captureWindowsDirectoryIdentity(root);
    assert.equal(result.ok, true);
    assert.equal(result.root.path, root);
    assert.match(result.root.fileIdentity.volumeSerialNumber, /^[1-9][0-9]*$/u);
    assert.match(result.root.fileIdentity.fileIndex, /^[1-9][0-9]*$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
