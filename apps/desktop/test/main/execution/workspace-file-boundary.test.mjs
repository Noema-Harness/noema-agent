import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MAX_WORKSPACE_FILE_SCAN_ENTRIES,
  MAX_WORKSPACE_FILE_SCAN_DEPTH,
  scanWorkspaceFileBoundary,
} from '../../../src/main/execution/workspace-file-boundary.ts';
import { captureWorkspaceIdentity } from '../../../src/main/platform/workspace-identity.ts';

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'noema-file-boundary-'));
}

test('workspace file scan accepts an ordinary directory and regular files', async () => {
  const root = temporaryDirectory();
  fs.writeFileSync(path.join(root, 'note.txt'), 'safe');
  try {
    const result = await scanWorkspaceFileBoundary(root);
    assert.equal(result.ok, true);
    assert.equal(result.entryCount, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace file scan rejects a hard link to an outside alias', async () => {
  const parent = temporaryDirectory();
  const root = path.join(parent, 'workspace');
  fs.mkdirSync(root);
  const outside = path.join(parent, 'outside.txt');
  fs.writeFileSync(outside, 'outside content');
  fs.linkSync(outside, path.join(root, 'alias.txt'));
  try {
    const result = await scanWorkspaceFileBoundary(root);
    assert.deepEqual(result, {
      ok: false,
      code: 'workspace_hard_link_detected',
    });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('workspace file scan rejects directory reparse points', async () => {
  const parent = temporaryDirectory();
  const root = path.join(parent, 'workspace');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(root, 'linked'), 'junction');
  try {
    const result = await scanWorkspaceFileBoundary(root);
    assert.deepEqual(result, {
      ok: false,
      code: 'workspace_reparse_point_detected',
    });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('workspace file scan fails closed on scan limits and metadata errors', async () => {
  const root = temporaryDirectory();
  fs.writeFileSync(path.join(root, 'one.txt'), 'one');
  const identity = captureWorkspaceIdentity(root);
  try {
    const limited = await scanWorkspaceFileBoundary(root, { maxEntries: 1 });
    assert.equal(limited.code, 'workspace_scan_limit');

    const unavailable = await scanWorkspaceFileBoundary(root, {
      identityCapture: () => identity,
      lstat: async () => {
        throw new Error('permission denied');
      },
    });
    assert.equal(unavailable.code, 'workspace_scan_metadata_unavailable');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace file scan rejects changed identity and cancellation', async () => {
  const root = temporaryDirectory();
  const initial = captureWorkspaceIdentity(root);
  const changed = {
    ok: true,
    identity: {
      ...initial.identity,
      fileIndex: (BigInt(initial.identity.fileIndex) + 1n).toString(),
    },
  };
  try {
    const identityMismatch = await scanWorkspaceFileBoundary(root, {
      expectedIdentity: changed.identity,
    });
    assert.equal(identityMismatch.code, 'workspace_identity_changed');

    const controller = new AbortController();
    controller.abort();
    const cancelled = await scanWorkspaceFileBoundary(root, {
      signal: controller.signal,
    });
    assert.equal(cancelled.code, 'workspace_scan_cancelled');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace file scan exports the same bounded tree limits as the runner', () => {
  assert.equal(MAX_WORKSPACE_FILE_SCAN_ENTRIES, 1_000_000);
  assert.equal(MAX_WORKSPACE_FILE_SCAN_DEPTH, 256);
});
