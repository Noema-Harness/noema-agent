import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { SocialWorkCommandMirrorRunner } from '../src/main/execution/social-work-command-runner.mjs';
import { WindowsRunnerAclJournalStore } from '../src/main/execution/windows-runner-acl-journal.mjs';
import { WindowsRunnerAclTransactionService } from '../src/main/execution/windows-runner-acl-transaction.mjs';
import { WindowsRunnerCapabilityNameStore } from '../src/main/execution/windows-runner-capability-name-store.mjs';
import { WindowsRunnerExecutionService } from '../src/main/execution/windows-runner-execution-service.mjs';
import { WindowsRunnerNativeHelper } from '../src/main/execution/windows-runner-native-helper.mjs';
import { captureWorkspaceIdentity } from '../src/main/platform/workspace-identity.mjs';
import { RootStore } from '../src/main/storage/root-store.mjs';
import { createSocialTestStore } from '../test-support/social-team.mjs';
import {
  createDevelopmentDirectory,
  removeDevelopmentDirectory,
} from '../test-support/development-workspace.mjs';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const runnerPath =
  process.env.NOEMA_WINDOWS_RUNNER_PATH ??
  path.join(
    projectRoot,
    'apps',
    'desktop',
    'native',
    'windows-runner',
    'target',
    'x86_64-pc-windows-msvc',
    'release',
    'noema-windows-runner.exe',
  );

if (process.platform !== 'win32') {
  throw new Error('windows_runner_live_acceptance_requires_windows');
}
if (!path.win32.isAbsolute(runnerPath) || !fs.existsSync(runnerPath)) {
  throw new Error('windows_runner_live_acceptance_binary_unavailable');
}

const root = createDevelopmentDirectory('Noema-Windows-Runner-Mirror-');
const db = new Database(path.join(root, 'noema.sqlite3'));
try {
  const userDataPath = path.join(root, 'user-data');
  const sourcePath = path.join(root, 'source');
  const mirrorRoot = path.join(root, 'mirrors');
  fs.mkdirSync(userDataPath);
  fs.mkdirSync(path.join(sourcePath, 'src'), { recursive: true });
  fs.mkdirSync(path.join(sourcePath, '.git'), { recursive: true });
  fs.writeFileSync(path.join(sourcePath, '.git', 'config'), 'git-config');
  fs.writeFileSync(path.join(sourcePath, '.git', 'index'), 'git-index');
  fs.writeFileSync(path.join(sourcePath, 'src', 'a.txt'), 'before');
  fs.writeFileSync(path.join(sourcePath, 'source-only.txt'), 'unchanged');
  const sourceCapture = captureWorkspaceIdentity(sourcePath);
  if (!sourceCapture.ok || !sourceCapture.identity) {
    throw new Error('windows_runner_live_workspace_identity_unavailable');
  }

  new RootStore(db);
  const store = createSocialTestStore(db, {
    workspaceChangeBlobDirectory: path.join(root, 'blobs'),
  });
  store.createSocialWorkTask({
    id: 'live-mirror-task',
    roomId: 'room-engineering-partner',
    agentId: 'engineering-partner',
    workspacePath: sourcePath,
    workspaceKey: 'live-mirror-workspace',
    workspaceIdentity: sourceCapture.identity,
    taskPrompt: 'Live mirror acceptance.',
    model: 'test-model',
  });
  store.setSocialWorkTaskSession('live-mirror-task', 'live-mirror-session');
  store.startSocialWorkExecutionStep('live-mirror-task', {
    id: 'live-mirror-step',
    category: 'command',
    toolName: 'run_command',
    hasSideEffect: true,
  });

  const helper = new WindowsRunnerNativeHelper({ executablePath: runnerPath });
  const setupOperationId = crypto.randomUUID();
  const [backend, setup] = await Promise.all([
    helper.probeCommandBackend({ requestId: setupOperationId }),
    helper.probeSandboxSetup({
      operationId: setupOperationId,
      userDataPath,
    }),
  ]);
  assert.equal(backend.ready, true, 'native backend must report ready');
  assert.equal(
    setup.evidence.profileValid,
    true,
    'AppContainer profile must exist',
  );

  const executionEvents = [];
  const aclEvents = [];
  const aclTransaction = new WindowsRunnerAclTransactionService({
    journalStore: new WindowsRunnerAclJournalStore({ userDataPath }),
    helper,
    recordEvent: (event) => aclEvents.push(event),
  });
  const service = new WindowsRunnerExecutionService({
    helper,
    setupService: {
      async verifyReady() {
        return { ready: true, packageSid: setup.evidence.packageSid };
      },
    },
    aclTransaction,
    capabilityNameStore: new WindowsRunnerCapabilityNameStore({ userDataPath }),
    userDataPath,
    recordEvent: (event) => executionEvents.push(event),
  });
  const nativeRunner = {
    async run(request) {
      const result = await service.run(request);
      return {
        output: `exit ${result.exitCode}\n${result.output}`,
        timedOut: result.timedOut,
        effectStatus: result.effectStatus,
      };
    },
  };
  const commandRunner = new SocialWorkCommandMirrorRunner({
    store,
    runner: nativeRunner,
    mirrorRoot,
  });

  const result = await commandRunner.run({
    taskId: 'live-mirror-task',
    requestId: 'live-mirror-step',
    executionId: 'live-mirror-execution',
    toolCallId: 'live-mirror-command',
    workspacePath: sourcePath,
    expectedWorkspaceIdentity: sourceCapture.identity,
    command:
      'echo changed> "src\\a.txt" & echo created> "created.txt" & mkdir "dir" & echo nested> "dir\\nested.txt" & echo corrupt> "%GIT_DIR%\\config"',
    timeoutMs: 10_000,
  });
  assert.equal(result.commandBatchStatus, 'completed');
  assert.equal(
    fs.readFileSync(path.join(sourcePath, 'src', 'a.txt'), 'utf8').trim(),
    'changed',
  );
  assert.equal(
    fs.readFileSync(path.join(sourcePath, 'created.txt'), 'utf8').trim(),
    'created',
  );
  assert.equal(
    fs.readFileSync(path.join(sourcePath, 'dir', 'nested.txt'), 'utf8').trim(),
    'nested',
  );
  assert.equal(
    fs.readFileSync(path.join(sourcePath, 'source-only.txt'), 'utf8'),
    'unchanged',
  );
  assert.equal(
    fs.readFileSync(path.join(sourcePath, '.git', 'config'), 'utf8'),
    'git-config',
  );
  assert.equal(
    fs.readFileSync(path.join(sourcePath, '.git', 'index'), 'utf8'),
    'git-index',
  );
  const [batch] = store.listSocialWorkCommandBatches('live-mirror-task');
  assert.equal(batch.status, 'completed');
  assert.equal(batch.baseManifestHash, null);
  assert.equal(batch.finalManifestHash, null);
  assert.equal(
    fs.existsSync(path.join(mirrorRoot, batch.mirrorKey)),
    false,
    'completed mirror must be removed',
  );
  assert.equal(
    store
      .getSocialWorkTask('live-mirror-task')
      .fileChanges.every((change) => change.origin === 'command'),
    true,
  );
  assert.equal(
    executionEvents.some((event) => event.operation === 'command_finished'),
    true,
  );
  assert.equal(
    JSON.stringify([...executionEvents, ...aclEvents]).includes(sourcePath),
    false,
  );

  console.log(
    JSON.stringify({
      acceptance: 'windows_runner_mirror_social_work_service_to_native',
      backendPolicyVersion: backend.backend.policyVersion,
      sourceWrite: 'mirror-only',
      writeback: 'completed',
      mirrorRemoved: true,
      gitMetadataProtected: true,
      diagnosticPathLeak: false,
    }),
  );
} finally {
  db.close();
  try {
    removeDevelopmentDirectory(root);
  } catch {
    // Keep the original acceptance failure visible; the root stays under .work/runs.
    if (!process.exitCode) process.exitCode = 1;
  }
}
