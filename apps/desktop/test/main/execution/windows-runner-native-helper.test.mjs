import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WindowsRunnerNativeHelper } from '../../../src/main/execution/windows-runner-native-helper.mjs';
import { WindowsRunnerAclJournalStore } from '../../../src/main/execution/windows-runner-acl-journal.mjs';
import { WindowsRunnerAclTransactionService } from '../../../src/main/execution/windows-runner-acl-transaction.mjs';

const operationId = 'native-helper-operation-01';
const traceIdentity = {
  executionId: 'execution-01',
  taskId: 'task-01',
  toolCallId: 'call-01',
};
const setupUserDataPath = 'C:\\Users\\fixture\\AppData\\Roaming\\Noema';
const packageSid = 'S-1-15-2-101-102-103-104-105-106-107';
const grant = {
  path: path.join(os.tmpdir(), 'noema-acl-workspace'),
  fileIdentity: { volumeSerialNumber: '42', fileIndex: '4200' },
  capabilityName:
    'Noema.Write.1111111111111111111111111111111111111111111111111111111111111111',
  access: 'write',
  isDirectory: true,
};
const evidence = {
  volumeSerialNumber: grant.fileIdentity.volumeSerialNumber,
  fileIndex: grant.fileIdentity.fileIndex,
  capabilityName: grant.capabilityName,
  access: grant.access,
  objectCount: 1,
  aclVerifiedCount: 1,
  treeDigest: 'a'.repeat(64),
  inheritanceVerified: true,
};

test('native helper transport drives the durable journal before reconcile and verifies before clearing', async (t) => {
  const userDataPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-acl-helper-'),
  );
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const journal = new WindowsRunnerAclJournalStore({ userDataPath });
  const operations = [];
  const helper = makeHelper(({ request, options }) => {
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'ignore']);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal('OPENAI_API_KEY' in options.env, false);
    assert.deepEqual(Object.keys(options.env).sort(), [
      'LOCALAPPDATA',
      'PATH',
      'SystemRoot',
    ]);
    assert.equal(request.requestId, operationId);
    assert.deepEqual(request.operation.grants, [
      {
        path: grant.path,
        fileIdentity: grant.fileIdentity,
        capabilityName: grant.capabilityName,
        access: grant.access,
        isDirectory: grant.isDirectory,
      },
    ]);
    const phase = journal.load().phase;
    if (request.operation.type === 'reconcile_filesystem_root_acls') {
      assert.equal(phase, 'applying');
      operations.push('reconcile');
    } else {
      assert.equal(request.operation.type, 'verify_filesystem_root_acls');
      assert.equal(phase, 'verified');
      operations.push('verify');
    }
    return {
      protocolVersion: 8,
      requestId: request.requestId,
      result: {
        type: 'acl_evidence',
        backendId: 'noema-codex-windows',
        backendVersion: '0.1.0',
        evidence: [evidence],
      },
    };
  });
  const service = new WindowsRunnerAclTransactionService({
    journalStore: journal,
    helper,
    makeOperationId: () => operationId,
  });

  assert.deepEqual(await service.ensureFilesystemRoots([grant]), {
    ready: true,
    recovered: false,
  });
  assert.deepEqual(operations, ['reconcile', 'verify']);
  assert.equal(journal.load().status, 'clean');
});

test('native helper rejects mismatched response identity and leaves the journal pending', async (t) => {
  const userDataPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-acl-helper-'),
  );
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const journal = new WindowsRunnerAclJournalStore({ userDataPath });
  const helper = makeHelper(() => ({
    protocolVersion: 8,
    requestId: 'different-request-id',
    result: {
      type: 'acl_evidence',
      backendId: 'noema-codex-windows',
      backendVersion: '0.1.0',
      evidence: [evidence],
    },
  }));
  const service = new WindowsRunnerAclTransactionService({
    journalStore: journal,
    helper,
    makeOperationId: () => operationId,
  });

  assert.deepEqual(await service.ensureFilesystemRoots([grant]), {
    ready: false,
    recovered: false,
    reason: 'runner_helper_response_invalid',
  });
  assert.equal(journal.load().status, 'repair_required');
  assert.equal(journal.load().phase, 'applying');
});

test('native helper rejects a mismatched backend version and leaves the journal pending', async (t) => {
  const userDataPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-acl-helper-'),
  );
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const journal = new WindowsRunnerAclJournalStore({ userDataPath });
  const helper = makeHelper(({ request }) => ({
    protocolVersion: 8,
    requestId: request.requestId,
    result: {
      type: 'acl_evidence',
      backendId: 'noema-codex-windows',
      backendVersion: '0.9.0',
      evidence: [evidence],
    },
  }));
  const service = new WindowsRunnerAclTransactionService({
    journalStore: journal,
    helper,
    makeOperationId: () => operationId,
  });

  assert.deepEqual(await service.ensureFilesystemRoots([grant]), {
    ready: false,
    recovered: false,
    reason: 'runner_helper_response_invalid',
  });
  assert.equal(journal.load().status, 'repair_required');
  assert.equal(journal.load().phase, 'applying');
});

test('native helper terminates and reports a timed out bounded request', async () => {
  let terminated = false;
  const helper = new WindowsRunnerNativeHelper({
    executablePath: 'C:\\Noema\\native\\noema-windows-runner.exe',
    env: { SystemRoot: 'C:\\Windows' },
    timeoutMs: 1_000,
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {};
      child.kill = () => {
        terminated = true;
        child.emit('close', null, 'SIGTERM');
        return true;
      };
      return child;
    },
  });

  await assert.rejects(
    helper.verifyFilesystemRootAcls({ operationId, grants: [grant] }),
    { code: 'runner_helper_timeout' },
  );
  assert.equal(terminated, true);
});

test('native helper kills a child that exceeds the response byte limit', async () => {
  let terminated = false;
  const helper = new WindowsRunnerNativeHelper({
    executablePath: 'C:\\Noema\\native\\noema-windows-runner.exe',
    env: { SystemRoot: 'C:\\Windows' },
    maxMessageBytes: 1_024,
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        child.stdout.emit('data', Buffer.alloc(1_025));
      };
      child.kill = () => {
        terminated = true;
        child.emit('close', null, 'SIGTERM');
        return true;
      };
      return child;
    },
  });

  await assert.rejects(
    helper.verifyFilesystemRootAcls({ operationId, grants: [grant] }),
    { code: 'runner_helper_response_too_large' },
  );
  assert.equal(terminated, true);
});

test('native setup transport accepts only matching typed reconcile and probe evidence', async () => {
  const packageSid = 'S-1-15-2-100-200-300-400-500-600-700';
  const setupEvidence = {
    packageSid,
    profileValid: true,
  };
  const helper = makeHelper(({ request, options }) => {
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal('OPENAI_API_KEY' in options.env, false);
    assert.equal(request.requestId, operationId);
    assert.equal(request.operation.operationId, operationId);
    assert.equal(request.operation.userDataPath, setupUserDataPath);
    if (request.operation.type === 'reconcile_sandbox_setup') {
      assert.deepEqual(request.operation, {
        type: 'reconcile_sandbox_setup',
        operationId,
        userDataPath: setupUserDataPath,
      });
      return {
        protocolVersion: 8,
        requestId: operationId,
        result: {
          type: 'setup_reconciled',
          backendId: 'noema-codex-windows',
          backendVersion: '0.1.0',
          operationId,
          packageSid,
        },
      };
    }
    assert.deepEqual(request.operation, {
      type: 'probe_sandbox_setup',
      operationId,
      userDataPath: setupUserDataPath,
    });
    return {
      protocolVersion: 8,
      requestId: operationId,
      result: {
        type: 'setup_evidence',
        backendId: 'noema-codex-windows',
        backendVersion: '0.1.0',
        operationId,
        evidence: setupEvidence,
      },
    };
  });

  assert.deepEqual(
    await helper.reconcileSandboxSetup({
      operationId,
      userDataPath: setupUserDataPath,
    }),
    {
      operationId,
      packageSid,
    },
  );
  assert.deepEqual(
    await helper.probeSandboxSetup({
      operationId,
      userDataPath: setupUserDataPath,
    }),
    {
      operationId,
      evidence: setupEvidence,
    },
  );
});

test('native setup transport rejects credentials and mismatched identity fields', async () => {
  const helper = makeHelper(({ request }) => ({
    protocolVersion: 8,
    requestId: request.requestId,
    result: {
      type: 'setup_reconciled',
      backendId: 'noema-codex-windows',
      backendVersion: '0.1.0',
      operationId: request.operation.operationId,
      packageSid:
        'Noema.Read.1111111111111111111111111111111111111111111111111111111111111111',
      password: 'must-not-cross-setup-ipc',
    },
  }));
  await assert.rejects(
    helper.reconcileSandboxSetup({
      operationId,
      userDataPath: setupUserDataPath,
    }),
    { code: 'runner_helper_response_invalid' },
  );

  const mismatch = makeHelper(({ request }) => ({
    protocolVersion: 8,
    requestId: request.requestId,
    result: {
      type: 'setup_reconciled',
      backendId: 'noema-codex-windows',
      backendVersion: '0.1.0',
      operationId: 'another_setup_operation_01',
      packageSid:
        'Noema.Read.1111111111111111111111111111111111111111111111111111111111111111',
    },
  }));
  await assert.rejects(
    mismatch.reconcileSandboxSetup({
      operationId,
      userDataPath: setupUserDataPath,
    }),
    { code: 'runner_helper_response_invalid' },
  );
});

test('native setup transport rejects nonlocal or aliased userData paths', async () => {
  const helper = makeHelper(() => {
    throw new Error('helper must not start for an invalid setup root');
  });
  for (const userDataPath of [
    'relative\\Noema',
    '\\\\server\\share\\Noema',
    '\\\\?\\C:\\Users\\fixture\\Noema',
    'C:\\Users\\fixture\\..\\Noema',
  ]) {
    await assert.rejects(
      helper.probeSandboxSetup({ operationId, userDataPath }),
      { code: 'runner_helper_request_invalid' },
    );
  }
});

test('native setup transport preserves an explicit setup-unavailable denial', async () => {
  const helper = makeHelper(({ request }) => ({
    protocolVersion: 8,
    requestId: request.requestId,
    result: {
      type: 'denied',
      code: 'setup_operations_unavailable',
      stage: 'setup',
    },
  }));
  await assert.rejects(
    helper.reconcileSandboxSetup({
      operationId,
      userDataPath: setupUserDataPath,
    }),
    { code: 'setup_operations_unavailable' },
  );
});

test('native setup transport preserves stable profile setup failure reasons', async () => {
  const helper = makeHelper(({ request }) => ({
    protocolVersion: 8,
    requestId: request.requestId,
    result: {
      type: 'denied',
      code: 'appcontainer_profile_create_failed',
      stage: 'setup',
    },
  }));
  await assert.rejects(
    helper.reconcileSandboxSetup({
      operationId,
      userDataPath: setupUserDataPath,
    }),
    { code: 'appcontainer_profile_create_failed' },
  );
});

test('native capability probe returns a fail-closed typed report', async () => {
  const helper = makeHelper(({ request }) => {
    assert.deepEqual(request.operation, { type: 'probe' });
    return {
      protocolVersion: 8,
      requestId: request.requestId,
      result: {
        type: 'probe',
        backendId: 'noema-codex-windows',
        backendVersion: '0.1.0',
        policyVersion: 2,
        ready: true,
        blockers: [],
        setupStatus: 'ready',
        capabilities: {
          filesystemDefaultDeny: true,
          filesystemReadAllowlist: true,
          filesystemWriteAllowlist: true,
          pathIdentityValidation: true,
          workingDirectoryConfinement: true,
          environmentConfinement: true,
          networkDefaultDeny: true,
          identityBoundNetworkBroker: false,
          jobProcessTree: true,
          boundedStdio: false,
        },
        platform: {
          major: 10,
          minor: 0,
          build: 19045,
          ubr: 7_807,
          architecture: 'x86_64',
        },
      },
    };
  });
  const report = await helper.probeCommandBackend({ requestId: operationId });
  assert.equal(report.reportedReady, true);
  assert.equal(report.ready, false);
  assert.equal(report.capabilities.boundedStdio, false);
  assert.equal(report.platform.build, 19045);
});

test('deny-only readiness does not require the unimplemented network broker', async () => {
  const helper = makeHelper(({ request }) => ({
    protocolVersion: 8,
    requestId: request.requestId,
    result: {
      type: 'probe',
      backendId: 'noema-codex-windows',
      backendVersion: '0.1.0',
      policyVersion: 2,
      ready: true,
      blockers: [],
      setupStatus: 'ready',
      capabilities: {
        filesystemDefaultDeny: true,
        filesystemReadAllowlist: true,
        filesystemWriteAllowlist: true,
        pathIdentityValidation: true,
        workingDirectoryConfinement: true,
        environmentConfinement: true,
        networkDefaultDeny: true,
        identityBoundNetworkBroker: false,
        jobProcessTree: true,
        boundedStdio: true,
      },
      platform: {
        major: 10,
        minor: 0,
        build: 19045,
        ubr: 7_807,
        architecture: 'x86_64',
      },
    },
  }));
  const report = await helper.probeCommandBackend({ requestId: operationId });
  assert.equal(report.ready, true);
  assert.equal(report.capabilities.identityBoundNetworkBroker, false);
  assert.equal(report.backend.capabilities.networkDefaultDeny, true);
});

test('native capability probe rejects unknown fields and mismatched identity', async () => {
  const helper = makeHelper(({ request }) => ({
    protocolVersion: 8,
    requestId: request.requestId,
    result: {
      type: 'probe',
      backendId: 'noema-codex-windows',
      backendVersion: '0.1.0',
      policyVersion: 2,
      ready: false,
      blockers: ['sandbox_setup_unavailable'],
      setupStatus: 'incomplete',
      capabilities: {
        filesystemDefaultDeny: false,
        filesystemReadAllowlist: false,
        filesystemWriteAllowlist: false,
        pathIdentityValidation: false,
        workingDirectoryConfinement: false,
        environmentConfinement: false,
        networkDefaultDeny: false,
        identityBoundNetworkBroker: false,
        jobProcessTree: false,
        boundedStdio: false,
      },
      platform: {
        major: 10,
        minor: 0,
        build: 19045,
        ubr: 6_093,
        architecture: 'x86_64',
      },
      unexpected: true,
    },
  }));
  await assert.rejects(helper.probeCommandBackend({ requestId: operationId }), {
    code: 'runner_helper_response_invalid',
  });
});

test('native execute transport binds the request, policy, grants and bounded command result', async () => {
  const root = {
    path: grant.path,
    fileIdentity: grant.fileIdentity,
  };
  const policy = {
    version: 2,
    backend: { id: 'noema-codex-windows', version: '0.1.0' },
    requestId: operationId,
    workspaceRoot: root,
    filesystem: {
      readRoots: [root],
      writeRoots: [root],
      defaultDeny: true,
    },
    workingDirectory: root,
    environment: {
      inherit: false,
      allowNames: [
        'SystemRoot',
        'WINDIR',
        'TEMP',
        'TMP',
        'PATH',
        'LOCALAPPDATA',
      ],
    },
    network: { mode: 'deny', identity: operationId },
  };
  const helper = makeHelper(({ request, options }) => {
    if (request.operation.type === 'probe') {
      return readyProbeResponse(request.requestId);
    }
    assert.equal(request.operation.type, 'execute');
    assert.equal(request.requestId, operationId);
    assert.equal(request.operation.executionId, traceIdentity.executionId);
    assert.equal(request.operation.taskId, traceIdentity.taskId);
    assert.equal(request.operation.toolCallId, traceIdentity.toolCallId);
    assert.equal(request.operation.userDataPath, setupUserDataPath);
    assert.equal(request.operation.command, 'git status --short');
    assert.equal(request.operation.timeoutMs, 5_000);
    assert.equal(request.operation.policy.requestId, operationId);
    assert.deepEqual(request.operation.grants, [
      {
        path: grant.path,
        fileIdentity: grant.fileIdentity,
        capabilityName: grant.capabilityName,
        access: grant.access,
        isDirectory: grant.isDirectory,
      },
    ]);
    assert.equal('OPENAI_API_KEY' in options.env, false);
    return {
      protocolVersion: 8,
      requestId: operationId,
      result: {
        type: 'command_complete',
        backendId: 'noema-codex-windows',
        backendVersion: '0.1.0',
        childStarted: true,
        exitCode: 0,
        durationMs: 43,
        timedOut: false,
        stdout: [111, 107],
        stderr: [],
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    };
  });

  const result = await helper.executeSandboxCommand({
    requestId: operationId,
    ...traceIdentity,
    userDataPath: setupUserDataPath,
    packageSid,
    policy,
    grants: [grant],
    command: 'git status --short',
    timeoutMs: 5_000,
  });
  assert.deepEqual(result, {
    type: 'complete',
    childStarted: true,
    exitCode: 0,
    durationMs: 43,
    timedOut: false,
    stdout: Buffer.from('ok'),
    stderr: Buffer.alloc(0),
    stdoutTruncated: false,
    stderrTruncated: false,
    effectStatus: 'applied',
  });
});

test('native execute transport keeps timeout effects unknown even after cleanup', async () => {
  const helper = makeHelper(({ request }) =>
    request.operation.type === 'probe'
      ? readyProbeResponse(request.requestId)
      : {
          protocolVersion: 8,
          requestId: request.requestId,
          result: {
            type: 'command_complete',
            backendId: 'noema-codex-windows',
            backendVersion: '0.1.0',
            childStarted: true,
            exitCode: 1,
            durationMs: 5_000,
            timedOut: true,
            stdout: [112],
            stderr: [],
            stdoutTruncated: false,
            stderrTruncated: false,
          },
        },
  );
  const result = await helper.executeSandboxCommand({
    requestId: operationId,
    ...traceIdentity,
    userDataPath: setupUserDataPath,
    packageSid,
    policy: validExecutePolicy(),
    grants: [grant],
    command: 'sleep 10',
    timeoutMs: 5_000,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.effectStatus, 'unknown');
  assert.deepEqual(result.stdout, Buffer.from('p'));
});

test('native execute transport marks a runner cleanup failure as unknown', async () => {
  const helper = makeHelper(({ request }) =>
    request.operation.type === 'probe'
      ? readyProbeResponse(request.requestId)
      : {
          protocolVersion: 8,
          requestId: request.requestId,
          result: {
            type: 'command_outcome_unknown',
            backendId: 'noema-codex-windows',
            backendVersion: '0.1.0',
            childStarted: true,
            code: 'runner_child_cleanup_unknown',
            cleanupConfirmed: false,
            stdout: [120],
            stderr: [101, 114, 114],
            stdoutTruncated: false,
            stderrTruncated: true,
          },
        },
  );
  const result = await helper.executeSandboxCommand({
    requestId: operationId,
    ...traceIdentity,
    userDataPath: setupUserDataPath,
    packageSid,
    policy: validExecutePolicy(),
    grants: [grant],
    command: 'echo x',
    timeoutMs: 5_000,
  });
  assert.equal(result.type, 'outcome_unknown');
  assert.equal(result.cleanupConfirmed, false);
  assert.equal(result.effectStatus, 'unknown');
  assert.deepEqual(result.stderr, Buffer.from('err'));
  assert.equal(result.stderrTruncated, true);
});

test('native execute transport rejects malformed results and invalid request bounds', async () => {
  let started = 0;
  const helper = new WindowsRunnerNativeHelper({
    executablePath: 'C:\\Noema\\native\\noema-windows-runner.exe',
    env: { SystemRoot: 'C:\\Windows' },
    spawnImpl(_executablePath, _args, options) {
      started += 1;
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = (input) => {
        const request = JSON.parse(input.toString('utf8').trim());
        const response =
          request.operation.type === 'probe'
            ? readyProbeResponse(request.requestId)
            : {
                protocolVersion: 8,
                requestId: request.requestId,
                result: {
                  type: 'command_complete',
                  backendId: 'noema-codex-windows',
                  backendVersion: '0.1.0',
                  childStarted: true,
                  exitCode: 0,
                  durationMs: 1,
                  timedOut: false,
                  stdout: [256],
                  stderr: [],
                  stdoutTruncated: false,
                  stderrTruncated: false,
                },
              };
        child.stdout.emit('data', Buffer.from(`${JSON.stringify(response)}\n`));
        child.emit('close', 0, null);
      };
      child.kill = () => true;
      assert.equal(options.shell, false);
      return child;
    },
  });
  await assert.rejects(
    helper.executeSandboxCommand({
      requestId: operationId,
      ...traceIdentity,
      userDataPath: setupUserDataPath,
      packageSid,
      policy: validExecutePolicy(),
      grants: [grant],
      command: 'echo x',
      timeoutMs: 5_000,
    }),
    { code: 'runner_helper_response_invalid' },
  );
  await assert.rejects(
    helper.executeSandboxCommand({
      requestId: operationId,
      ...traceIdentity,
      userDataPath: '\\\\server\\share\\Noema',
      packageSid,
      policy: validExecutePolicy(),
      grants: [grant],
      command: 'echo x',
      timeoutMs: 5_000,
    }),
    { code: 'runner_helper_request_invalid' },
  );
  assert.equal(started, 2);
});

test('native execute does not submit a command when the Windows platform is unsupported', async () => {
  const operations = [];
  const helper = makeHelper(({ request }) => {
    operations.push(request.operation.type);
    return {
      protocolVersion: 8,
      requestId: request.requestId,
      result: {
        ...readyProbeResponse(request.requestId).result,
        platform: {
          major: 10,
          minor: 0,
          build: 19044,
          ubr: 6093,
          architecture: 'x86_64',
        },
      },
    };
  });
  const result = await helper.executeSandboxCommand({
    requestId: operationId,
    ...traceIdentity,
    userDataPath: setupUserDataPath,
    packageSid,
    policy: validExecutePolicy(),
    grants: [grant],
    command: 'echo x',
    timeoutMs: 5_000,
  });
  assert.deepEqual(result, {
    type: 'denied',
    code: 'os_baseline_unsupported',
    stage: 'readiness',
    effectStatus: 'not_applied',
  });
  assert.deepEqual(operations, ['probe']);
});

test('native readiness accepts Windows 10 22H2 below the former UBR floor', async () => {
  const operations = [];
  const helper = makeHelper(({ request }) => {
    operations.push(request.operation.type);
    return {
      protocolVersion: 8,
      requestId: request.requestId,
      result: {
        ...readyProbeResponse(request.requestId).result,
        platform: {
          major: 10,
          minor: 0,
          build: 19045,
          ubr: 6093,
          architecture: 'x86_64',
        },
      },
    };
  });
  const report = await helper.probeCommandBackend({ requestId: operationId });
  assert.equal(report.ready, true);
  assert.equal(report.platform.ubr, 6093);
  assert.deepEqual(operations, ['probe']);
});

test('native readiness does not require the diagnostic UBR value', async () => {
  const helper = makeHelper(({ request }) => ({
    protocolVersion: 8,
    requestId: request.requestId,
    result: {
      ...readyProbeResponse(request.requestId).result,
      platform: {
        major: 10,
        minor: 0,
        build: 19_045,
        ubr: 0,
        architecture: 'x86_64',
      },
    },
  }));
  const report = await helper.probeCommandBackend({ requestId: operationId });
  assert.equal(report.ready, true);
  assert.equal(report.platform.ubr, 0);
});

test('native execute abort before admission does not spawn the helper', async () => {
  let started = 0;
  const helper = new WindowsRunnerNativeHelper({
    executablePath: 'C:\\Noema\\native\\noema-windows-runner.exe',
    env: { SystemRoot: 'C:\\Windows' },
    spawnImpl() {
      started += 1;
      throw new Error('must_not_spawn');
    },
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    helper.executeSandboxCommand({
      requestId: operationId,
      ...traceIdentity,
      userDataPath: setupUserDataPath,
      packageSid,
      policy: validExecutePolicy(),
      grants: [grant],
      command: 'echo x',
      timeoutMs: 5_000,
      signal: controller.signal,
    }),
    (error) =>
      error.code === 'runner_helper_aborted' &&
      error.effectStatus === 'not_applied',
  );
  assert.equal(started, 0);
});

test('native execute abort after spawn reports an unknown effect and releases child tracking', async () => {
  const controller = new AbortController();
  const operations = [];
  const childStates = [];
  let commandChild;
  const helper = new WindowsRunnerNativeHelper({
    executablePath: 'C:\\Noema\\native\\noema-windows-runner.exe',
    env: { SystemRoot: 'C:\\Windows' },
    spawnImpl(_executablePath, _args, options) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = (input) => {
        const request = JSON.parse(input.toString('utf8').trim());
        operations.push(request.operation.type);
        if (request.operation.type === 'probe') {
          child.stdout.emit(
            'data',
            Buffer.from(
              `${JSON.stringify(readyProbeResponse(request.requestId))}\n`,
            ),
          );
          child.emit('close', 0, null);
        } else {
          commandChild = child;
          assert.equal(options.shell, false);
        }
      };
      child.kill = () => true;
      return child;
    },
  });

  const execution = helper.executeSandboxCommand({
    requestId: operationId,
    ...traceIdentity,
    userDataPath: setupUserDataPath,
    packageSid,
    policy: validExecutePolicy(),
    grants: [grant],
    command: 'echo x',
    timeoutMs: 5_000,
    signal: controller.signal,
    onChild: (child) => childStates.push(child),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(commandChild);
  controller.abort();
  commandChild.emit('close', null, 'SIGTERM');

  await assert.rejects(
    execution,
    (error) =>
      error.code === 'runner_helper_aborted' &&
      error.effectStatus === 'unknown',
  );
  assert.deepEqual(operations, ['probe', 'execute']);
  assert.equal(childStates.length, 2);
  assert.ok(childStates[0]);
  assert.equal(childStates[1], null);
});

function validExecutePolicy() {
  const root = { path: grant.path, fileIdentity: grant.fileIdentity };
  return {
    version: 2,
    backend: { id: 'noema-codex-windows', version: '0.1.0' },
    requestId: operationId,
    workspaceRoot: root,
    filesystem: {
      readRoots: [root],
      writeRoots: [root],
      defaultDeny: true,
    },
    workingDirectory: root,
    environment: {
      inherit: false,
      allowNames: [
        'SystemRoot',
        'WINDIR',
        'TEMP',
        'TMP',
        'PATH',
        'LOCALAPPDATA',
      ],
    },
    network: { mode: 'deny', identity: operationId },
  };
}

function readyProbeResponse(requestId) {
  return {
    protocolVersion: 8,
    requestId,
    result: {
      type: 'probe',
      backendId: 'noema-codex-windows',
      backendVersion: '0.1.0',
      policyVersion: 2,
      ready: true,
      blockers: [],
      setupStatus: 'ready',
      capabilities: {
        filesystemDefaultDeny: true,
        filesystemReadAllowlist: true,
        filesystemWriteAllowlist: true,
        pathIdentityValidation: true,
        workingDirectoryConfinement: true,
        environmentConfinement: true,
        networkDefaultDeny: true,
        identityBoundNetworkBroker: true,
        jobProcessTree: true,
        boundedStdio: true,
      },
      platform: {
        major: 10,
        minor: 0,
        build: 19045,
        ubr: 6093,
        architecture: 'x86_64',
      },
    },
  };
}

function makeHelper(respond) {
  return new WindowsRunnerNativeHelper({
    executablePath: 'C:\\Noema\\native\\noema-windows-runner.exe',
    env: {
      SystemRoot: 'C:\\Windows',
      LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local',
      PATH: 'C:\\Windows\\System32',
      OPENAI_API_KEY: 'must-not-inherit',
    },
    spawnImpl(_executablePath, args, options) {
      assert.deepEqual(args, []);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = (input) => {
        const request = JSON.parse(input.toString('utf8').trim());
        const response = respond({ request, options });
        child.stdout.emit('data', Buffer.from(`${JSON.stringify(response)}\n`));
        child.emit('close', 0, null);
      };
      child.kill = () => true;
      return child;
    },
  });
}
