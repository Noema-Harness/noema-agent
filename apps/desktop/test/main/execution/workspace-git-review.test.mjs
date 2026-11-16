import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureWorkspaceIdentity } from '../../../src/main/platform/workspace-identity.ts';
import { reviewWorkspaceGitState } from '../../../src/main/execution/workspace-git-review.ts';
import { resolveGitExecutable } from '../../../../../scripts/git-exec.mjs';

const gitExecutable = resolveGitExecutable();
process.env.PATH = `${path.dirname(gitExecutable)}${path.delimiter}${process.env.PATH ?? ''}`;

function runGit(cwd, args) {
  execFileSync(gitExecutable, args, {
    cwd,
    stdio: 'ignore',
    windowsHide: true,
  });
}

function makeRepository() {
  const workspace = mkdtempSync(path.join(tmpdir(), 'noema-git-review-'));
  runGit(workspace, ['init', '-b', 'main']);
  runGit(workspace, ['config', 'user.name', 'Noema Test']);
  runGit(workspace, ['config', 'user.email', 'noema-test@example.invalid']);
  writeFileSync(path.join(workspace, 'tracked.txt'), 'before\n');
  runGit(workspace, ['add', 'tracked.txt']);
  runGit(workspace, ['commit', '-m', 'initial']);
  return workspace;
}

test('Git review presents tracked and untracked diffs without modifying the index', async () => {
  const workspace = makeRepository();
  try {
    writeFileSync(path.join(workspace, 'tracked.txt'), 'after\n');
    writeFileSync(path.join(workspace, 'new.txt'), 'untracked\n');
    const identity = captureWorkspaceIdentity(workspace).identity;
    const before = execFileSync(
      gitExecutable,
      ['status', '--porcelain=v1', '-z'],
      {
        cwd: workspace,
      },
    );
    const review = await reviewWorkspaceGitState({
      workspacePath: workspace,
      expectedIdentity: identity,
    });
    const after = execFileSync(
      gitExecutable,
      ['status', '--porcelain=v1', '-z'],
      {
        cwd: workspace,
      },
    );
    assert.equal(review.available, true);
    assert.equal(review.source, 'current_workspace');
    assert.deepEqual(review.files.map((file) => file.relativePath).sort(), [
      'new.txt',
      'tracked.txt',
    ]);
    assert.match(
      review.files.find((file) => file.relativePath === 'tracked.txt').diffText,
      /-before/u,
    );
    assert.match(
      review.files.find((file) => file.relativePath === 'tracked.txt').diffText,
      /\+after/u,
    );
    assert.match(
      review.files.find((file) => file.relativePath === 'new.txt').diffText,
      /\+untracked/u,
    );
    assert.deepEqual(after, before);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('Git review disables repository-defined external diff helpers', async () => {
  const workspace = makeRepository();
  try {
    const marker = path.join(workspace, 'external-diff-ran.txt');
    writeFileSync(
      path.join(workspace, '.gitattributes'),
      'tracked.txt diff=sentinel\n',
    );
    runGit(workspace, [
      'config',
      'diff.sentinel.command',
      `cmd.exe /c echo ran > "${marker}"`,
    ]);
    writeFileSync(path.join(workspace, 'tracked.txt'), 'after\n');
    const identity = captureWorkspaceIdentity(workspace).identity;
    const review = await reviewWorkspaceGitState({
      workspacePath: workspace,
      expectedIdentity: identity,
    });
    assert.equal(review.available, true);
    assert.equal(
      review.files.some((file) => file.relativePath === 'tracked.txt'),
      true,
    );
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('Git review reports non-repositories and changed workspace identities as unavailable', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-not-git-'));
  const other = mkdtempSync(path.join(tmpdir(), 'noema-other-git-'));
  try {
    const nonRepository = await reviewWorkspaceGitState({
      workspacePath: directory,
      expectedIdentity: captureWorkspaceIdentity(directory).identity,
    });
    assert.equal(nonRepository.available, false);
    assert.equal(nonRepository.reason, 'not_a_repository');
    const mismatch = await reviewWorkspaceGitState({
      workspacePath: other,
      expectedIdentity: captureWorkspaceIdentity(directory).identity,
    });
    assert.equal(mismatch.available, false);
    assert.equal(mismatch.reason, 'workspace_boundary');
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('Git review fails visibly on timeout and oversized status output', async () => {
  const workspacePath = path.join(tmpdir(), 'workspace');
  const workspaceFileBoundaryScanner = async () => ({ ok: true });
  const timedOut = await reviewWorkspaceGitState({
    workspacePath,
    workspaceFileBoundaryScanner,
    spawnSyncImpl: () => ({ error: { code: 'ETIMEDOUT' }, status: null }),
  });
  assert.equal(timedOut.available, false);
  assert.equal(timedOut.reason, 'git_timeout');

  let calls = 0;
  const oversized = await reviewWorkspaceGitState({
    workspacePath,
    workspaceFileBoundaryScanner,
    spawnSyncImpl: () => {
      calls += 1;
      return calls === 1
        ? { status: 0, stdout: Buffer.from('true\n') }
        : { status: 0, stdout: Buffer.alloc(1024 * 1024 + 1) };
    },
  });
  assert.equal(oversized.available, false);
  assert.equal(oversized.reason, 'git_status_limit');
});
