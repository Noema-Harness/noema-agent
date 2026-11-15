import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WindowsRunnerAclJournalStore } from '../src/main/execution/windows-runner-acl-journal.mjs';
import { WindowsRunnerAclTransactionService } from '../src/main/execution/windows-runner-acl-transaction.ts';
import { WindowsRunnerCapabilityNameStore } from '../src/main/execution/windows-runner-capability-name-store.ts';
import { WindowsRunnerExecutionService } from '../src/main/execution/windows-runner-execution-service.mjs';
import { WindowsRunnerNativeHelper } from '../src/main/execution/windows-runner-native-helper.mjs';
import {
  WINDOWS_RUNNER_POLICY_VERSION,
  WINDOWS_RUNNER_PROTOCOL_VERSION,
} from '../src/main/execution/windows-runner-package-contract.ts';
import { captureWorkspaceIdentity } from '../src/main/platform/workspace-identity.ts';
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

const root = createDevelopmentDirectory('Noema-Windows-Runner-Write-');
try {
  const userDataPath = path.join(root, 'user-data');
  const sourcePath = path.join(root, 'source');
  const mirrorPath = path.join(root, 'mirror');
  fs.mkdirSync(userDataPath);
  fs.mkdirSync(sourcePath);
  fs.mkdirSync(mirrorPath);
  fs.writeFileSync(path.join(sourcePath, 'source.txt'), 'source-original');
  fs.writeFileSync(path.join(mirrorPath, 'source.txt'), 'source-original');

  const sourceCapture = captureWorkspaceIdentity(sourcePath);
  const mirrorCapture = captureWorkspaceIdentity(mirrorPath);
  if (
    !sourceCapture.ok ||
    !sourceCapture.identity ||
    !mirrorCapture.ok ||
    !mirrorCapture.identity
  ) {
    throw new Error('windows_runner_live_workspace_identity_unavailable');
  }

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
  const journalStore = new WindowsRunnerAclJournalStore({ userDataPath });
  const aclTransaction = new WindowsRunnerAclTransactionService({
    journalStore,
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

  const writeResult = await service.run({
    requestId: crypto.randomUUID(),
    executionId: 'write-live-execution',
    taskId: 'write-live-task',
    toolCallId: 'write-live-mirror',
    command:
      'echo mirror-write> "written.txt" & echo changed> "source.txt" & mkdir "created-dir" & echo nested> "created-dir\\nested.txt"',
    workspacePath: mirrorPath,
    expectedWorkspaceIdentity: mirrorCapture.identity,
    filesystemMode: 'read-write',
    timeoutMs: 5_000,
  });
  assert.equal(writeResult.timedOut, false);
  assert.equal(writeResult.exitCode, 0);
  assert.equal(
    fs.readFileSync(path.join(mirrorPath, 'written.txt'), 'utf8').trim(),
    'mirror-write',
  );
  assert.equal(
    fs.readFileSync(path.join(mirrorPath, 'source.txt'), 'utf8').trim(),
    'changed',
  );
  assert.equal(
    fs
      .readFileSync(path.join(mirrorPath, 'created-dir', 'nested.txt'), 'utf8')
      .trim(),
    'nested',
  );
  assert.equal(
    fs.readFileSync(path.join(sourcePath, 'source.txt'), 'utf8'),
    'source-original',
  );
  assert.equal(fs.existsSync(path.join(sourcePath, 'written.txt')), false);

  const outsidePath = path.join(root, 'outside-write.txt');
  const outsideResult = await service.run({
    requestId: crypto.randomUUID(),
    executionId: 'write-live-execution',
    taskId: 'write-live-task',
    toolCallId: 'write-live-outside',
    command: `echo outside> "${outsidePath}"`,
    workspacePath: mirrorPath,
    expectedWorkspaceIdentity: mirrorCapture.identity,
    filesystemMode: 'read-write',
    timeoutMs: 5_000,
  });
  assert.equal(outsideResult.timedOut, false);
  assert.equal(fs.existsSync(outsidePath), false);
  assert.equal(journalStore.load().status, 'clean');
  assert.ok(
    executionEvents.some((event) => event.operation === 'command_finished'),
  );
  const serialized = JSON.stringify([...executionEvents, ...aclEvents]);
  assert.equal(serialized.includes(mirrorPath), false);
  assert.equal(serialized.includes(sourcePath), false);

  console.log(
    JSON.stringify({
      acceptance: 'windows_runner_write_service_to_native',
      backendPolicyVersion: backend.backend.policyVersion,
      expectedPolicyVersion: WINDOWS_RUNNER_POLICY_VERSION,
      transportVersion: WINDOWS_RUNNER_PROTOCOL_VERSION,
      mirrorWrite: 'allowed',
      mirrorCreate: 'allowed',
      sourceWrite: 'unchanged',
      outsideWrite: 'denied',
      aclTransactions: 4,
      journal: 'clean',
      diagnosticPathLeak: false,
    }),
  );
} finally {
  try {
    removeDevelopmentDirectory(root);
  } catch {
    // Keep the original acceptance failure visible; the root stays under .work/runs.
    if (!process.exitCode) process.exitCode = 1;
  }
}
