import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WindowsRunnerAclJournalStore } from '../src/main/execution/windows-runner-acl-journal.mjs';
import { WindowsRunnerAclTransactionService } from '../src/main/execution/windows-runner-acl-transaction.mjs';
import { WindowsRunnerCapabilityNameStore } from '../src/main/execution/windows-runner-capability-name-store.mjs';
import { WindowsRunnerExecutionService } from '../src/main/execution/windows-runner-execution-service.mjs';
import { WindowsRunnerNativeHelper } from '../src/main/execution/windows-runner-native-helper.mjs';
import {
  WINDOWS_RUNNER_POLICY_VERSION,
  WINDOWS_RUNNER_PROTOCOL_VERSION,
} from '../src/main/execution/windows-runner-package-contract.mjs';
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

const root = createDevelopmentDirectory('Noema-Windows-Runner-Readonly-');
try {
  const userDataPath = path.join(root, 'user-data');
  const workspacePath = path.join(root, 'workspace');
  fs.mkdirSync(userDataPath);
  fs.mkdirSync(workspacePath);
  const workspaceCapture = captureWorkspaceIdentity(workspacePath);
  if (!workspaceCapture.ok || !workspaceCapture.identity) {
    throw new Error('windows_runner_live_workspace_identity_unavailable');
  }
  const expectedWorkspaceIdentity = workspaceCapture.identity;
  const readablePath = path.join(workspacePath, 'readable.txt');
  const workspaceWritePath = path.join(workspacePath, 'must-not-exist.txt');
  const outsideSentinelPath = path.join(root, 'outside-sentinel.txt');
  const outsideWritePath = path.join(root, 'must-not-exist-outside.txt');
  fs.writeFileSync(readablePath, 'readonly-integration-proof');
  fs.writeFileSync(outsideSentinelPath, 'unchanged');

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

  const readResult = await service.run({
    requestId: crypto.randomUUID(),
    executionId: 'readonly-live-execution',
    taskId: 'readonly-live-task',
    toolCallId: 'readonly-live-read',
    command: `type "${readablePath}"`,
    workspacePath,
    expectedWorkspaceIdentity,
    timeoutMs: 5_000,
  });
  assert.equal(readResult.exitCode, 0);
  assert.match(readResult.output, /readonly-integration-proof/u);

  const writeResult = await service.run({
    requestId: crypto.randomUUID(),
    executionId: 'readonly-live-execution',
    taskId: 'readonly-live-task',
    toolCallId: 'readonly-live-write-attempt',
    command: `echo denied > "${workspaceWritePath}" & echo denied > "${outsideWritePath}"`,
    workspacePath,
    expectedWorkspaceIdentity,
    timeoutMs: 5_000,
  });
  assert.equal(writeResult.timedOut, false);
  assert.equal(fs.existsSync(workspaceWritePath), false);
  assert.equal(fs.existsSync(outsideWritePath), false);
  assert.equal(fs.readFileSync(outsideSentinelPath, 'utf8'), 'unchanged');
  assert.equal(journalStore.load().status, 'clean');
  assert.equal(
    aclEvents.filter((event) => event.stage === 'transaction_completed').length,
    2,
  );
  assert.ok(
    executionEvents.some((event) => event.operation === 'command_finished'),
  );
  assert.equal(
    JSON.stringify([...executionEvents, ...aclEvents]).includes(workspacePath),
    false,
  );

  console.log(
    JSON.stringify({
      acceptance: 'windows_runner_readonly_service_to_native',
      backendPolicyVersion: backend.backend.policyVersion,
      expectedPolicyVersion: WINDOWS_RUNNER_POLICY_VERSION,
      transportVersion: WINDOWS_RUNNER_PROTOCOL_VERSION,
      read: 'allowed',
      workspaceWrite: 'denied',
      outsideWrite: 'denied',
      aclTransactions: 2,
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
