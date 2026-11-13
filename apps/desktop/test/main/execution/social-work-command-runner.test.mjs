import assert from 'node:assert/strict';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  createCommandMirror,
  readCommandMirrorManifest,
} from '../../../src/main/execution/workspace-command-mirror.mjs';
import { SocialWorkCommandMirrorRunner } from '../../../src/main/execution/social-work-command-runner.mjs';
import { captureWorkspaceIdentity } from '../../../src/main/platform/workspace-identity.mjs';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { createSocialTestStore } from '../../../test-support/social-team.mjs';

function createHarness() {
  const root = mkdtempSync(path.join(tmpdir(), 'noema-command-mirror-'));
  const sourcePath = path.join(root, 'source');
  const mirrorRoot = path.join(root, 'mirrors');
  mkdirSync(path.join(sourcePath, 'src'), { recursive: true });
  writeFileSync(path.join(sourcePath, 'src', 'a.js'), 'before');
  writeFileSync(path.join(sourcePath, 'src', 'deleted.js'), 'remove me');
  writeFileSync(path.join(sourcePath, 'src', 'old-name.txt'), 'renamed');
  mkdirSync(path.join(sourcePath, 'obsolete'), { recursive: true });
  writeFileSync(path.join(sourcePath, 'obsolete', 'only.txt'), 'remove dir');
  mkdirSync(path.join(sourcePath, 'empty-dir'));
  const identity = captureWorkspaceIdentity(sourcePath);
  assert.equal(identity.ok, true);
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db, {
    workspaceChangeBlobDirectory: path.join(root, 'blobs'),
  });
  store.createSocialWorkTask({
    id: 'task-command-mirror',
    roomId: 'room-engineering-partner',
    agentId: 'engineering-partner',
    workspacePath: sourcePath,
    workspaceKey: 'workspace-command-mirror',
    workspaceIdentity: identity.identity,
    taskPrompt: '在隔离副本里运行命令。',
    model: 'test-model',
  });
  store.setSocialWorkTaskSession(
    'task-command-mirror',
    'session-command-mirror',
  );
  store.startSocialWorkExecutionStep('task-command-mirror', {
    id: 'step-command-mirror',
    category: 'command',
    toolName: 'run_command',
    hasSideEffect: true,
  });
  return {
    root,
    sourcePath,
    mirrorRoot,
    identity: identity.identity,
    db,
    store,
  };
}

test('a command runs only in its mirror and writes back per path', async () => {
  const harness = createHarness();
  const runner = {
    async run(input) {
      assert.equal(input.filesystemMode, 'read-write');
      assert.notEqual(
        path.resolve(input.workspacePath),
        path.resolve(harness.sourcePath),
      );
      assert.equal(
        readFileSync(path.join(harness.sourcePath, 'src', 'a.js'), 'utf8'),
        'before',
      );
      writeFileSync(path.join(input.workspacePath, 'src', 'a.js'), 'after');
      rmSync(path.join(input.workspacePath, 'src', 'deleted.js'));
      writeFileSync(
        path.join(input.workspacePath, 'src', 'created.txt'),
        'created',
      );
      writeFileSync(
        path.join(input.workspacePath, 'src', 'new-name.txt'),
        readFileSync(path.join(input.workspacePath, 'src', 'old-name.txt')),
      );
      rmSync(path.join(input.workspacePath, 'src', 'old-name.txt'));
      mkdirSync(path.join(input.workspacePath, 'nested', 'deep'), {
        recursive: true,
      });
      writeFileSync(
        path.join(input.workspacePath, 'nested', 'deep', 'new.txt'),
        'nested',
      );
      rmSync(path.join(input.workspacePath, 'obsolete'), { recursive: true });
      rmSync(path.join(input.workspacePath, 'empty-dir'), { recursive: true });
      return {
        output: 'ok',
        exitCode: 0,
        timedOut: false,
        effectStatus: 'applied',
      };
    },
  };
  const commandRunner = new SocialWorkCommandMirrorRunner({
    store: harness.store,
    runner,
    mirrorRoot: harness.mirrorRoot,
    freeSpace: () => 64 * 1024 * 1024 * 1024,
  });
  try {
    const result = await commandRunner.run({
      taskId: 'task-command-mirror',
      requestId: 'step-command-mirror',
      workspacePath: harness.sourcePath,
      expectedWorkspaceIdentity: harness.identity,
      command: 'node script.js',
      signal: undefined,
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /\[Noema 命令副本\] 项目工作区：/u);
    assert.ok(result.output.includes(harness.sourcePath));
    assert.equal(
      readFileSync(path.join(harness.sourcePath, 'src', 'a.js'), 'utf8'),
      'after',
    );
    assert.equal(
      readFileSync(path.join(harness.sourcePath, 'src', 'created.txt'), 'utf8'),
      'created',
    );
    assert.equal(
      readFileSync(
        path.join(harness.sourcePath, 'src', 'new-name.txt'),
        'utf8',
      ),
      'renamed',
    );
    assert.throws(
      () => readFileSync(path.join(harness.sourcePath, 'src', 'old-name.txt')),
      /ENOENT/u,
    );
    assert.throws(
      () => readFileSync(path.join(harness.sourcePath, 'src', 'deleted.js')),
      /ENOENT/u,
    );
    assert.equal(
      readFileSync(
        path.join(harness.sourcePath, 'nested', 'deep', 'new.txt'),
        'utf8',
      ),
      'nested',
    );
    assert.equal(existsSync(path.join(harness.sourcePath, 'obsolete')), false);
    assert.equal(existsSync(path.join(harness.sourcePath, 'empty-dir')), false);
    const [batch] = harness.store.listSocialWorkCommandBatches(
      'task-command-mirror',
    );
    assert.equal(batch.status, 'completed');
    assert.equal(batch.baseManifestHash, null);
    assert.equal(batch.finalManifestHash, null);
    assert.equal(batch.reasonCode, null);
    assert.equal(
      existsSync(path.join(harness.mirrorRoot, batch.mirrorKey)),
      false,
    );
    const task = harness.store.getSocialWorkTask('task-command-mirror');
    assert.equal(task.commandBatches.length, 1);
    assert.equal(task.commandBatches[0].status, 'completed');
    assert.equal(task.commandBatches[0].mirrorKey, undefined);
    assert.ok(task.fileChanges.every((change) => change.origin === 'command'));
  } finally {
    harness.db.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('Git metadata is read-only, excluded from the mirror, and bound by environment', async () => {
  const harness = createHarness();
  mkdirSync(path.join(harness.sourcePath, '.git'), { recursive: true });
  writeFileSync(path.join(harness.sourcePath, '.git', 'config'), '[core]\n');
  let observed = null;
  const runner = {
    async run(input) {
      observed = input;
      assert.equal(existsSync(path.join(input.workspacePath, '.git')), false);
      assert.match(input.command, /^cd \/d "/u);
      assert.match(input.command, /&& set "GIT_DIR=/u);
      assert.match(input.command, /GIT_WORK_TREE=/u);
      assert.match(input.command, /GIT_OPTIONAL_LOCKS=0/u);
      assert.equal(input.additionalAccess.length, 1);
      assert.equal(input.additionalAccess[0].access, 'read');
      assert.equal(
        path.resolve(input.additionalAccess[0].path),
        path.resolve(harness.sourcePath, '.git'),
      );
      return {
        output: 'ok',
        exitCode: 0,
        timedOut: false,
        effectStatus: 'applied',
      };
    },
  };
  const commandRunner = new SocialWorkCommandMirrorRunner({
    store: harness.store,
    runner,
    mirrorRoot: harness.mirrorRoot,
    freeSpace: () => 64 * 1024 * 1024 * 1024,
  });
  try {
    await commandRunner.run({
      taskId: 'task-command-mirror',
      requestId: 'step-command-mirror',
      workspacePath: harness.sourcePath,
      expectedWorkspaceIdentity: harness.identity,
      command: 'git status --short',
      signal: undefined,
    });
    assert.ok(observed);
    assert.equal(
      readFileSync(path.join(harness.sourcePath, 'src', 'a.js'), 'utf8'),
      'before',
    );
  } finally {
    harness.db.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('a linked Git worktree exposes its git dir and common dir read-only', async () => {
  const harness = createHarness();
  const gitDir = path.join(harness.root, 'git', 'worktrees', 'linked');
  const commonDir = path.join(harness.root, 'git');
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(path.join(gitDir, 'commondir'), '..\\..\n');
  writeFileSync(path.join(harness.sourcePath, '.git'), `gitdir: ${gitDir}\n`);
  let observed = null;
  const runner = {
    async run(input) {
      observed = input;
      assert.equal(existsSync(path.join(input.workspacePath, '.git')), false);
      assert.equal(input.additionalAccess.length, 2);
      const roots = input.additionalAccess.map((entry) =>
        path.resolve(entry.path),
      );
      assert.deepEqual(
        roots.sort(),
        [path.resolve(gitDir), path.resolve(commonDir)].sort(),
      );
      assert.match(input.command, /^cd \/d "/u);
      assert.match(input.command, /&& set "GIT_DIR=/u);
      return {
        output: 'ok',
        exitCode: 0,
        timedOut: false,
        effectStatus: 'applied',
      };
    },
  };
  const commandRunner = new SocialWorkCommandMirrorRunner({
    store: harness.store,
    runner,
    mirrorRoot: harness.mirrorRoot,
    freeSpace: () => 64 * 1024 * 1024 * 1024,
  });
  try {
    await commandRunner.run({
      taskId: 'task-command-mirror',
      requestId: 'step-command-mirror',
      workspacePath: harness.sourcePath,
      expectedWorkspaceIdentity: harness.identity,
      command: 'git status --short',
      signal: undefined,
    });
    assert.ok(observed);
    assert.equal(
      readFileSync(path.join(harness.sourcePath, 'src', 'a.js'), 'utf8'),
      'before',
    );
  } finally {
    harness.db.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('a mirror preflight refusal never starts the command', async () => {
  const harness = createHarness();
  let called = false;
  const commandRunner = new SocialWorkCommandMirrorRunner({
    store: harness.store,
    runner: {
      async run() {
        called = true;
        throw new Error('must not run');
      },
    },
    mirrorRoot: harness.mirrorRoot,
    freeSpace: () => 0,
  });
  try {
    await assert.rejects(
      commandRunner.run({
        taskId: 'task-command-mirror',
        requestId: 'step-command-mirror',
        workspacePath: harness.sourcePath,
        expectedWorkspaceIdentity: harness.identity,
        command: 'node script.js',
        signal: undefined,
      }),
      /free-space reserve/u,
    );
    assert.equal(called, false);
    const [batch] = harness.store.listSocialWorkCommandBatches(
      'task-command-mirror',
    );
    assert.equal(batch.status, 'not_applied');
    assert.equal(
      batch.reasonCode,
      'workspace_command_mirror_free_space_exceeded',
    );
  } finally {
    harness.db.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('a per-path writeback conflict preserves applied files and records partial', async () => {
  const harness = createHarness();
  const runner = {
    async run(input) {
      writeFileSync(
        path.join(input.workspacePath, 'src', 'a.js'),
        'command edit',
      );
      writeFileSync(
        path.join(input.workspacePath, 'src', 'created.txt'),
        'created',
      );
      return {
        output: 'ok',
        exitCode: 0,
        timedOut: false,
        effectStatus: 'applied',
      };
    },
  };
  const originalPutManifest = harness.store.putSocialWorkCommandManifest.bind(
    harness.store,
  );
  let changedAfterCollect = false;
  harness.store.putSocialWorkCommandManifest = (input) => {
    const result = originalPutManifest(input);
    if (input.kind === 'final' && !changedAfterCollect) {
      changedAfterCollect = true;
      writeFileSync(
        path.join(harness.sourcePath, 'src', 'a.js'),
        'user edit after collect',
      );
    }
    return result;
  };
  const commandRunner = new SocialWorkCommandMirrorRunner({
    store: harness.store,
    runner,
    mirrorRoot: harness.mirrorRoot,
    freeSpace: () => 64 * 1024 * 1024 * 1024,
  });
  try {
    await commandRunner.run({
      taskId: 'task-command-mirror',
      requestId: 'step-command-mirror',
      workspacePath: harness.sourcePath,
      expectedWorkspaceIdentity: harness.identity,
      command: 'node script.js',
      signal: undefined,
    });
    assert.equal(changedAfterCollect, true);
    assert.equal(
      readFileSync(path.join(harness.sourcePath, 'src', 'a.js'), 'utf8'),
      'user edit after collect',
    );
    assert.equal(
      readFileSync(path.join(harness.sourcePath, 'src', 'created.txt'), 'utf8'),
      'created',
    );
    const [batch] = harness.store.listSocialWorkCommandBatches(
      'task-command-mirror',
    );
    assert.equal(batch.status, 'partial');
    assert.equal(batch.reasonCode, 'writeback_partial');
    assert.equal(
      existsSync(path.join(harness.mirrorRoot, batch.mirrorKey)),
      true,
    );
  } finally {
    harness.db.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('a source edit during the command blocks writeback and retains the mirror', async () => {
  const harness = createHarness();
  let mirrorPath = null;
  const runner = {
    async run(input) {
      mirrorPath = input.workspacePath;
      writeFileSync(path.join(harness.sourcePath, 'src', 'a.js'), 'user edit');
      writeFileSync(
        path.join(input.workspacePath, 'src', 'a.js'),
        'command edit',
      );
      return {
        output: 'ok',
        exitCode: 0,
        timedOut: false,
        effectStatus: 'applied',
      };
    },
  };
  const commandRunner = new SocialWorkCommandMirrorRunner({
    store: harness.store,
    runner,
    mirrorRoot: harness.mirrorRoot,
    freeSpace: () => 64 * 1024 * 1024 * 1024,
  });
  try {
    await assert.rejects(
      commandRunner.run({
        taskId: 'task-command-mirror',
        requestId: 'step-command-mirror',
        workspacePath: harness.sourcePath,
        expectedWorkspaceIdentity: harness.identity,
        command: 'node script.js',
        signal: undefined,
      }),
      /项目工作区在命令运行期间发生变化/u,
    );
    assert.equal(
      readFileSync(path.join(harness.sourcePath, 'src', 'a.js'), 'utf8'),
      'user edit',
    );
    const [batch] = harness.store.listSocialWorkCommandBatches(
      'task-command-mirror',
    );
    assert.equal(batch.status, 'conflict');
    assert.equal(
      batch.reasonCode,
      'workspace_command_source_concurrent_change',
    );
    assert.ok(mirrorPath);
    assert.equal(
      existsSync(path.join(harness.mirrorRoot, batch.mirrorKey)),
      true,
    );
  } finally {
    harness.db.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('a mirror includes ignored, untracked and dirty files but no Git metadata', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'noema-command-mirror-tree-'));
  try {
    mkdirSync(path.join(root, '.git', 'objects'), { recursive: true });
    writeFileSync(path.join(root, '.git', 'index'), 'git-index');
    writeFileSync(path.join(root, '.gitignore'), 'ignored.log\n');
    writeFileSync(path.join(root, 'tracked.txt'), 'tracked');
    writeFileSync(path.join(root, 'dirty.txt'), 'dirty');
    writeFileSync(path.join(root, 'untracked.txt'), 'untracked');
    writeFileSync(path.join(root, 'ignored.log'), 'ignored');
    const identity = captureWorkspaceIdentity(root);
    assert.equal(identity.ok, true);
    const mirrorPath = path.join(root, 'mirror');
    const result = await createCommandMirror({
      sourcePath: root,
      mirrorPath,
      expectedIdentity: identity.identity,
    });
    try {
      const manifest = await readCommandMirrorManifest(mirrorPath);
      const paths = manifest.files.map((file) => file.path);
      assert.ok(paths.includes('tracked.txt'));
      assert.ok(paths.includes('dirty.txt'));
      assert.ok(paths.includes('untracked.txt'));
      assert.ok(paths.includes('ignored.log'));
      assert.ok(
        !paths.some((entry) => entry === '.git' || entry.startsWith('.git/')),
      );
      assert.equal(result.gitMetadataSkipped, true);
    } finally {
      rmSync(mirrorPath, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a mirror rejects hardlinks and directory reparse points', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'noema-command-mirror-alias-'));
  try {
    writeFileSync(path.join(root, 'original.txt'), 'alias');
    linkSync(path.join(root, 'original.txt'), path.join(root, 'hardlink.txt'));
    const identity = captureWorkspaceIdentity(root);
    assert.equal(identity.ok, true);
    await assert.rejects(
      createCommandMirror({
        sourcePath: root,
        mirrorPath: path.join(root, 'mirror-hardlink'),
        expectedIdentity: identity.identity,
      }),
      (error) => error?.code === 'workspace_command_mirror_hardlink_rejected',
    );
    rmSync(path.join(root, 'hardlink.txt'));

    let junctionCreated = false;
    try {
      symlinkSync(root, path.join(root, 'junction'), 'junction');
      junctionCreated = true;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    }
    if (junctionCreated) {
      await assert.rejects(
        createCommandMirror({
          sourcePath: root,
          mirrorPath: path.join(root, 'mirror-junction'),
          expectedIdentity: identity.identity,
        }),
        (error) =>
          error?.code === 'workspace_command_mirror_reparse_rejected' ||
          error?.code === 'workspace_command_mirror_source_invalid',
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a timed-out command keeps its mirror and quarantines the batch', async () => {
  const harness = createHarness();
  const commandRunner = new SocialWorkCommandMirrorRunner({
    store: harness.store,
    runner: {
      async run(input) {
        writeFileSync(path.join(input.workspacePath, 'src', 'a.js'), 'changed');
        return {
          output: '',
          exitCode: null,
          timedOut: true,
          effectStatus: 'unknown',
        };
      },
    },
    mirrorRoot: harness.mirrorRoot,
    freeSpace: () => 64 * 1024 * 1024 * 1024,
  });
  try {
    const result = await commandRunner.run({
      taskId: 'task-command-mirror',
      requestId: 'step-command-mirror',
      workspacePath: harness.sourcePath,
      expectedWorkspaceIdentity: harness.identity,
      command: 'node slow.js',
      signal: undefined,
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.commandBatchStatus, 'unknown');
    assert.equal(
      readFileSync(path.join(harness.sourcePath, 'src', 'a.js'), 'utf8'),
      'before',
    );
    const [batch] = harness.store.listSocialWorkCommandBatches(
      'task-command-mirror',
    );
    assert.equal(batch.status, 'unknown');
    assert.equal(batch.reasonCode, 'command_outcome_unknown');
    assert.equal(
      existsSync(path.join(harness.mirrorRoot, batch.mirrorKey)),
      true,
    );
  } finally {
    harness.db.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});
