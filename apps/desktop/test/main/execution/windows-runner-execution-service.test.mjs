import assert from 'node:assert/strict';
import test from 'node:test';
import { WindowsRunnerExecutionService } from '../../../src/main/execution/windows-runner-execution-service.mjs';

const identity = {
  requestId: 'request-identity-0001',
  executionId: 'execution-01',
  taskId: 'task-01',
  toolCallId: 'call-01',
};
const packageSid = 'S-1-15-2-101-102-103-104-105-106-107';

const inputs = {
  ...identity,
  command: 'npm test',
  workspacePath: 'C:\\Work\\workspace',
  timeoutMs: 30_000,
};

test('Windows runner admission binds authorized roots and all task identities before execute', async () => {
  const calls = [];
  const events = [];
  const service = makeService({ calls, events });

  const result = await service.run({
    ...inputs,
    additionalAccess: [
      { path: 'C:\\Work\\docs', access: 'read', reason: 'Read references' },
    ],
    authorizeAdditionalAccess: async (request) => {
      assert.equal(request.path, 'C:\\Work\\docs');
      return true;
    },
  });

  assert.equal(result.output, 'ok');
  assert.equal(result.exitCode, 0);
  const grants = calls.find(([name]) => name === 'acl')?.[1];
  assert.deepEqual(calls.find(([name]) => name === 'acl')?.[2], identity);
  assert.deepEqual(
    grants.map(({ path, access }) => [path, access]),
    [
      ['C:\\Work\\docs', 'read'],
      ['C:\\Work\\node', 'read'],
      ['C:\\Work\\workspace', 'write'],
    ],
  );
  const execute = calls.find(([name]) => name === 'execute')?.[1];
  assert.deepEqual(
    {
      requestId: execute.requestId,
      executionId: execute.executionId,
      taskId: execute.taskId,
      toolCallId: execute.toolCallId,
    },
    identity,
  );
  assert.equal(execute.policy.network.mode, 'deny');
  assert.equal(execute.packageSid, packageSid);
  assert.equal(events[0].operation, 'admission_started');
  assert.ok(
    events.some((event) => event.operation === 'native_helper_started'),
  );
  assert.ok(
    events.some((event) => event.operation === 'sandbox_child_started'),
  );
  const outputEvent = events.find(
    (event) => event.operation === 'command_output_collected',
  );
  assert.deepEqual(outputEvent.details, {
    phase: 'output',
    stdoutBytes: 2,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
  });
  const terminalEvent = events.find(
    (event) => event.operation === 'command_finished',
  );
  assert.deepEqual(terminalEvent.details, {
    phase: 'command',
    exitCode: 0,
    durationMs: 17,
    timedOut: false,
    effectStatus: 'applied',
    cleanupConfirmed: true,
  });
  const recorded = JSON.stringify(events);
  assert.equal(recorded.includes(inputs.command), false);
  assert.equal(recorded.includes(inputs.workspacePath), false);
});

test('Windows runner admission stops before setup and ACL work when readiness is false', async () => {
  const calls = [];
  const service = makeService({
    calls,
    readiness: { ready: false, code: 'runner_not_ready' },
  });

  await assert.rejects(service.run(inputs), {
    code: 'runner_not_ready',
    effectStatus: 'not_applied',
  });
  assert.deepEqual(
    calls.map(([name]) => name),
    ['probe'],
  );
});

test('Windows runner admission recovers a pending ACL journal and requires retry', async () => {
  const calls = [];
  const service = makeService({
    calls,
    recovery: { ready: true, recovered: true },
  });

  await assert.rejects(service.run(inputs), {
    code: 'acl_recovered_retry',
    effectStatus: 'not_applied',
  });
  assert.deepEqual(
    calls.map(([name]) => name),
    ['probe', 'setup', 'recover'],
  );
});

test('Windows runner admission does not widen scope when extra access is denied', async () => {
  const calls = [];
  const service = makeService({ calls });

  await assert.rejects(
    service.run({
      ...inputs,
      additionalAccess: [
        { path: 'C:\\Work\\docs', access: 'write', reason: 'Edit docs' },
      ],
      authorizeAdditionalAccess: async () => false,
    }),
    { code: 'external_access_denied', effectStatus: 'not_applied' },
  );
  assert.deepEqual(
    calls.map(([name]) => name),
    ['probe', 'setup'],
  );
});

function makeService({
  calls = [],
  events = [],
  readiness = readyProbe(),
  recovery = { ready: true, recovered: false },
} = {}) {
  const paths = new Map([
    ['C:\\Work\\workspace', '11'],
    ['C:\\Work\\docs', '12'],
    ['C:\\Work\\node', '13'],
  ]);
  return new WindowsRunnerExecutionService({
    helper: {
      async probeCommandBackend() {
        calls.push(['probe']);
        return readiness;
      },
      async executeSandboxCommand(request) {
        calls.push(['execute', request]);
        request.onChild?.({ pid: 42 });
        request.onChild?.(null);
        return {
          type: 'complete',
          childStarted: true,
          stdout: Buffer.from('ok'),
          stderr: Buffer.alloc(0),
          exitCode: 0,
          durationMs: 17,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          effectStatus: 'applied',
        };
      },
    },
    setupService: {
      async verifyReady() {
        calls.push(['setup']);
        return { ready: true, packageSid };
      },
    },
    aclTransaction: {
      async recoverPending(traceIdentity) {
        calls.push(['recover', traceIdentity]);
        return recovery;
      },
      async ensureFilesystemRoots(grants, traceIdentity) {
        calls.push(['acl', grants, traceIdentity]);
        return { ready: true, packageSid };
      },
    },
    capabilityNameStore: {
      getOrCreate(fileIdentity, access) {
        const mode = access === 'write' ? 'Write' : 'Read';
        return `Noema.${mode}.${String(fileIdentity.fileIndex).padStart(64, '0')}`;
      },
    },
    userDataPath: 'C:\\Users\\fixture\\AppData\\Roaming\\Noema',
    runtimeReadRoots: ['C:\\Work\\node'],
    realpathPath: async (value) => value,
    captureIdentity: async (value, { expectedType }) => ({
      ok: true,
      root: {
        path: value,
        fileIdentity: { volumeSerialNumber: '1', fileIndex: paths.get(value) },
        expectedType,
      },
    }),
    statPath: async (value) => {
      const fileIndex = paths.get(value);
      return {
        dev: 1n,
        ino: BigInt(fileIndex),
        isDirectory: () => true,
        isFile: () => false,
      };
    },
    recordEvent: (event) => events.push(event),
  });
}

function readyProbe() {
  return {
    ready: true,
    backend: {
      id: 'noema-codex-windows',
      version: '0.1.0',
      policyVersion: 2,
      capabilities: {
        filesystemDefaultDeny: true,
        filesystemReadAllowlist: true,
        filesystemWriteAllowlist: true,
        pathIdentityValidation: true,
        workingDirectoryConfinement: true,
        environmentConfinement: true,
        networkDefaultDeny: true,
        identityBoundNetworkBroker: false,
      },
    },
  };
}
