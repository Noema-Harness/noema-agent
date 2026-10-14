import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  normalizeWorkspaceVerificationChecks,
  verifyWorkspaceChecks,
} from '../src/workspace-verifier.mjs';

test('workspace verifier checks explicit file existence and content without returning file contents', () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-verifier-pass-'));
  try {
    writeFileSync(path.join(workspace, 'README.md'), 'NOEMA-VERIFY-7821\n');
    const result = verifyWorkspaceChecks(workspace, [
      { kind: 'file_exists', path: 'README.md' },
      { kind: 'file_contains', path: 'README.md', text: 'NOEMA-VERIFY-7821' },
    ]);

    assert.equal(result.status, 'verified');
    assert.equal(result.repairable, false);
    assert.deepEqual(
      result.checks.map((check) => check.status),
      ['verified', 'verified'],
    );
    assert.equal(JSON.stringify(result).includes('NOEMA-VERIFY-7821\n'), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('a missing file or content mismatch is a bounded repairable failure', () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-verifier-fail-'));
  try {
    writeFileSync(path.join(workspace, 'README.md'), 'wrong content');
    const result = verifyWorkspaceChecks(workspace, [
      { kind: 'file_contains', path: 'README.md', text: 'expected marker' },
      { kind: 'file_exists', path: 'missing.txt' },
    ]);

    assert.equal(result.status, 'failed');
    assert.equal(result.repairable, true);
    assert.deepEqual(
      result.checks.map((check) => check.reason),
      ['text_mismatch', 'file_missing'],
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('verification plans reject absolute and traversal paths before filesystem access', () => {
  assert.throws(
    () =>
      normalizeWorkspaceVerificationChecks([
        { kind: 'file_exists', path: '../outside.txt' },
      ]),
    /relative path|leave the workspace|离开工作区/i,
  );
  assert.throws(
    () =>
      normalizeWorkspaceVerificationChecks([
        {
          kind: 'file_contains',
          path: 'C:\\Users\\test\\secret.txt',
          text: 'x',
        },
      ]),
    /relative path|相对路径/,
  );
});
