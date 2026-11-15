import { spawn } from 'node:child_process';
import path from 'node:path';
import { isValidWindowsRunnerPackageSid } from './windows-runner-setup-state.mjs';
import {
  WINDOWS_RUNNER_BACKEND_ID,
  WINDOWS_RUNNER_BACKEND_VERSION,
  WINDOWS_RUNNER_POLICY_VERSION,
  WINDOWS_RUNNER_PROTOCOL_VERSION,
} from './windows-runner-package-contract.ts';

export {
  WINDOWS_RUNNER_BACKEND_ID,
  WINDOWS_RUNNER_BACKEND_VERSION,
  WINDOWS_RUNNER_POLICY_VERSION,
  WINDOWS_RUNNER_PROTOCOL_VERSION,
};
export const WINDOWS_RUNNER_MAX_IPC_BYTES = 2 * 1024 * 1024;
const MAX_GRANTS = 37;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_COMMAND_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 20_000;
const RUNNER_STARTUP_TIMEOUT_MS = 15_000;
const MAX_RUNNER_OUTPUT_BYTES = 128 * 1024;
const ENVIRONMENT_ALLOWLIST = [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'LOCALAPPDATA',
];
const SETUP_EVIDENCE_FLAGS = ['profileValid'];

/**
 * One-shot, bounded stdin/stdout transport for the native Windows helper.
 * The caller is responsible for committing the durable ACL journal before it
 * requests reconciliation. Helper failures carry only a stable reason code.
 */
export class WindowsRunnerNativeHelper {
  constructor({
    executablePath,
    spawnImpl = spawn,
    env = process.env,
    timeoutMs = 120_000,
    maxMessageBytes = WINDOWS_RUNNER_MAX_IPC_BYTES,
    expectedBackendVersion = WINDOWS_RUNNER_BACKEND_VERSION,
  }) {
    if (
      typeof executablePath !== 'string' ||
      !path.win32.isAbsolute(executablePath) ||
      executablePath.startsWith('\\\\') ||
      executablePath.startsWith('\\\\?\\') ||
      executablePath.startsWith('\\\\.\\') ||
      typeof spawnImpl !== 'function' ||
      !env ||
      typeof env !== 'object' ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1_000 ||
      timeoutMs > MAX_TIMEOUT_MS ||
      !Number.isSafeInteger(maxMessageBytes) ||
      maxMessageBytes < 1_024 ||
      maxMessageBytes > WINDOWS_RUNNER_MAX_IPC_BYTES ||
      typeof expectedBackendVersion !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(expectedBackendVersion)
    ) {
      throw helperError('runner_helper_configuration_invalid');
    }
    this.executablePath = path.win32.normalize(executablePath);
    this.spawnImpl = spawnImpl;
    this.environment = filteredEnvironment(env);
    this.timeoutMs = timeoutMs;
    this.maxMessageBytes = maxMessageBytes;
    this.expectedBackendVersion = expectedBackendVersion;
  }

  reconcileFilesystemRootAcls({ operationId, grants }) {
    return this.#request('reconcile_filesystem_root_acls', operationId, grants);
  }

  verifyFilesystemRootAcls({ operationId, grants }) {
    return this.#request('verify_filesystem_root_acls', operationId, grants);
  }

  reconcileSandboxSetup({ operationId, userDataPath }) {
    return this.#setupRequest(
      'reconcile_sandbox_setup',
      operationId,
      userDataPath,
    );
  }

  probeSandboxSetup({ operationId, userDataPath }) {
    return this.#setupRequest('probe_sandbox_setup', operationId, userDataPath);
  }

  async probeCommandBackend({ requestId }) {
    if (
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/u.test(requestId)
    ) {
      throw helperError('runner_helper_request_invalid');
    }
    const input = Buffer.from(
      `${JSON.stringify({
        protocolVersion: WINDOWS_RUNNER_PROTOCOL_VERSION,
        requestId,
        operation: { type: 'probe' },
      })}\n`,
      'utf8',
    );
    const stdout = await this.#run(input, { timeoutMs: PROBE_TIMEOUT_MS });
    return parseProbeResponse(stdout, requestId, this.expectedBackendVersion);
  }

  async executeSandboxCommand({
    requestId,
    executionId,
    taskId,
    toolCallId,
    userDataPath,
    packageSid,
    policy,
    grants,
    command,
    timeoutMs,
    signal,
    onChild,
  }) {
    if (
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/u.test(requestId) ||
      !isValidTraceIdentity(executionId) ||
      !isValidTraceIdentity(taskId) ||
      !isValidTraceIdentity(toolCallId) ||
      typeof userDataPath !== 'string' ||
      !path.win32.isAbsolute(userDataPath) ||
      userDataPath.length > 1_024 ||
      userDataPath.startsWith('\\\\') ||
      userDataPath.startsWith('\\\\?\\') ||
      userDataPath.startsWith('\\\\.\\') ||
      userDataPath.includes('\0') ||
      !/^[A-Za-z]:\\/u.test(userDataPath) ||
      userDataPath
        .split(/[\\/]+/u)
        .some((part) => part === '.' || part === '..') ||
      !isValidWindowsRunnerPackageSid(packageSid) ||
      !isRecord(policy) ||
      policy.requestId !== requestId ||
      policy.version !== WINDOWS_RUNNER_POLICY_VERSION ||
      !isRecord(policy.backend) ||
      policy.backend.id !== WINDOWS_RUNNER_BACKEND_ID ||
      policy.backend.version !== this.expectedBackendVersion ||
      typeof command !== 'string' ||
      command.trim().length === 0 ||
      command.length > 8_000 ||
      command.includes('\0') ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > MAX_COMMAND_TIMEOUT_MS
    ) {
      throw helperError('runner_helper_request_invalid');
    }
    validateRequest(requestId, grants);
    const wireGrants = grants.map(
      ({
        path: grantPath,
        fileIdentity,
        capabilityName,
        access,
        isDirectory,
      }) => ({
        path: grantPath,
        fileIdentity: {
          volumeSerialNumber: fileIdentity.volumeSerialNumber,
          fileIndex: fileIdentity.fileIndex,
        },
        capabilityName,
        access,
        isDirectory,
      }),
    );
    const input = Buffer.from(
      `${JSON.stringify({
        protocolVersion: WINDOWS_RUNNER_PROTOCOL_VERSION,
        requestId,
        operation: {
          type: 'execute',
          executionId,
          taskId,
          toolCallId,
          userDataPath,
          packageSid,
          policy,
          grants: wireGrants,
          command,
          timeoutMs,
        },
      })}\n`,
      'utf8',
    );
    if (input.byteLength > this.maxMessageBytes) {
      throw helperError('runner_helper_request_too_large');
    }
    if (signal?.aborted) {
      const error = helperError('runner_helper_aborted');
      error.effectStatus = 'not_applied';
      throw error;
    }
    const readiness = await this.probeCommandBackend({ requestId });
    if (!readiness.ready) {
      return {
        type: 'denied',
        code: readiness.code,
        stage: 'readiness',
        effectStatus: 'not_applied',
      };
    }
    if (signal?.aborted) {
      const error = helperError('runner_helper_aborted');
      error.effectStatus = 'not_applied';
      throw error;
    }
    const transportTimeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      timeoutMs + RUNNER_STARTUP_TIMEOUT_MS + 10_000,
    );
    let stdout;
    try {
      stdout = await this.#run(input, {
        timeoutMs: transportTimeoutMs,
        signal,
        onChild,
      });
    } catch (error) {
      if (error?.code === 'runner_helper_timeout') {
        error.effectStatus = 'unknown';
      } else if (
        error?.code === 'runner_helper_aborted' &&
        error.effectStatus !== 'not_applied'
      ) {
        error.effectStatus = 'unknown';
      }
      throw error;
    }
    return parseExecuteResponse(
      stdout,
      requestId,
      timeoutMs,
      this.expectedBackendVersion,
    );
  }

  async #request(type, operationId, grants) {
    validateRequest(operationId, grants);
    const wireGrants = grants.map(
      ({
        path: grantPath,
        fileIdentity,
        capabilityName,
        access,
        isDirectory,
      }) => ({
        path: grantPath,
        fileIdentity: {
          volumeSerialNumber: fileIdentity.volumeSerialNumber,
          fileIndex: fileIdentity.fileIndex,
        },
        capabilityName,
        access,
        isDirectory,
      }),
    );
    const input = Buffer.from(
      `${JSON.stringify({
        protocolVersion: WINDOWS_RUNNER_PROTOCOL_VERSION,
        requestId: operationId,
        operation: { type, grants: wireGrants },
      })}\n`,
      'utf8',
    );
    if (input.byteLength > this.maxMessageBytes) {
      throw helperError('runner_helper_request_too_large');
    }

    const stdout = await this.#run(input);
    const response = parseResponse(
      stdout,
      operationId,
      grants,
      this.expectedBackendVersion,
    );
    if (response.type === 'denied') {
      throw helperError(response.code);
    }
    return response.evidence;
  }

  async #setupRequest(type, operationId, userDataPath) {
    if (
      typeof operationId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/u.test(operationId) ||
      typeof userDataPath !== 'string' ||
      !path.win32.isAbsolute(userDataPath) ||
      userDataPath.length > 1024 ||
      userDataPath.startsWith('\\\\') ||
      userDataPath.startsWith('\\\\?\\') ||
      userDataPath.startsWith('\\\\.\\') ||
      userDataPath.includes('\0') ||
      !/^[A-Za-z]:\\/u.test(userDataPath) ||
      userDataPath
        .split(/[\\/]+/u)
        .some((part) => part === '.' || part === '..')
    ) {
      throw helperError('runner_helper_request_invalid');
    }
    const input = Buffer.from(
      `${JSON.stringify({
        protocolVersion: WINDOWS_RUNNER_PROTOCOL_VERSION,
        requestId: operationId,
        operation: { type, operationId, userDataPath },
      })}\n`,
      'utf8',
    );
    if (input.byteLength > this.maxMessageBytes) {
      throw helperError('runner_helper_request_too_large');
    }

    const stdout = await this.#run(input);
    const result = parseSetupResponse(
      stdout,
      operationId,
      this.expectedBackendVersion,
    );
    if (result.type === 'denied') throw helperError(result.code);
    return result.value;
  }

  #run(input, { timeoutMs = this.timeoutMs, signal, onChild } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const error = helperError('runner_helper_aborted');
        error.effectStatus = 'not_applied';
        reject(error);
        return;
      }
      let child;
      try {
        child = this.spawnImpl(this.executablePath, [], {
          cwd: path.win32.dirname(this.executablePath),
          env: this.environment,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch {
        reject(helperError('runner_helper_spawn_failed'));
        return;
      }

      if (!child?.stdin || !child.stdout || typeof child.once !== 'function') {
        try {
          child?.kill?.();
        } catch {}
        reject(helperError('runner_helper_spawn_failed'));
        return;
      }

      const chunks = [];
      let outputBytes = 0;
      let terminalCode;
      let settled = false;
      let timer;
      let childReported = false;
      const terminate = (code) => {
        terminalCode ??= code;
        try {
          child.kill();
        } catch {}
      };
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (childReported) {
          childReported = false;
          try {
            onChild?.(null);
          } catch {}
        }
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => terminate('runner_helper_aborted');

      child.stdout.on('data', (chunk) => {
        if (terminalCode) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        outputBytes += bytes.byteLength;
        if (outputBytes > this.maxMessageBytes) {
          terminate('runner_helper_response_too_large');
          return;
        }
        chunks.push(bytes);
      });
      child.stdin.on('error', () =>
        terminate('runner_helper_request_write_failed'),
      );
      child.once('error', () =>
        finish(helperError('runner_helper_spawn_failed')),
      );
      child.once('close', (exitCode) => {
        if (terminalCode) {
          finish(helperError(terminalCode));
          return;
        }
        if (exitCode !== 0) {
          finish(helperError('runner_helper_exit_failed'));
          return;
        }
        finish(undefined, Buffer.concat(chunks, outputBytes));
      });

      timer = setTimeout(() => terminate('runner_helper_timeout'), timeoutMs);
      if (typeof onChild === 'function') {
        childReported = true;
        try {
          onChild(child);
        } catch {}
      }
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      try {
        child.stdin.end(input);
      } catch {
        terminate('runner_helper_request_write_failed');
      }
    });
  }
}

function validateRequest(operationId, grants) {
  if (
    typeof operationId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(operationId) ||
    !Array.isArray(grants) ||
    grants.length === 0 ||
    grants.length > MAX_GRANTS
  ) {
    throw helperError('runner_helper_request_invalid');
  }
  const paths = new Set();
  const identities = new Set();
  const sids = new Set();
  for (const grant of grants) {
    if (
      !isRecord(grant) ||
      typeof grant.path !== 'string' ||
      grant.path.length === 0 ||
      grant.path.length > 1_000 ||
      !path.win32.isAbsolute(grant.path) ||
      !isRecord(grant.fileIdentity) ||
      !isBoundedDecimal(
        grant.fileIdentity.volumeSerialNumber,
        4_294_967_295n,
      ) ||
      !isBoundedDecimal(
        grant.fileIdentity.fileIndex,
        18_446_744_073_709_551_615n,
      ) ||
      typeof grant.capabilityName !== 'string' ||
      !isWindowsRunnerCapabilityName(grant.capabilityName) ||
      !['read', 'write'].includes(grant.access) ||
      !grant.capabilityName.startsWith(
        `Noema.${grant.access === 'read' ? 'Read' : 'Write'}.`,
      ) ||
      typeof grant.isDirectory !== 'boolean'
    ) {
      throw helperError('runner_helper_request_invalid');
    }
    const pathKey = path.win32.normalize(grant.path).toLowerCase();
    const identityKey = `${grant.fileIdentity.volumeSerialNumber}:${grant.fileIdentity.fileIndex}`;
    if (
      paths.has(pathKey) ||
      identities.has(identityKey) ||
      sids.has(grant.capabilityName)
    ) {
      throw helperError('runner_helper_request_invalid');
    }
    paths.add(pathKey);
    identities.add(identityKey);
    sids.add(grant.capabilityName);
  }
}

function parseResponse(
  bytes,
  expectedRequestId,
  grants,
  expectedBackendVersion,
) {
  let response;
  try {
    const text = bytes.toString('utf8');
    if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) {
      throw new Error('frame');
    }
    response = JSON.parse(text.slice(0, -1));
  } catch {
    throw helperError('runner_helper_response_invalid');
  }
  if (
    !isRecord(response) ||
    !hasExactKeys(response, ['protocolVersion', 'requestId', 'result']) ||
    response.protocolVersion !== WINDOWS_RUNNER_PROTOCOL_VERSION ||
    response.requestId !== expectedRequestId ||
    !isRecord(response.result)
  ) {
    throw helperError('runner_helper_response_invalid');
  }
  const result = response.result;
  if (result.type === 'denied') {
    if (
      !hasExactKeys(result, ['type', 'code', 'stage']) ||
      typeof result.code !== 'string' ||
      !/^[a-z0-9_]{1,96}$/u.test(result.code) ||
      !['acl', 'protocol'].includes(result.stage)
    ) {
      throw helperError('runner_helper_response_invalid');
    }
    return result;
  }
  if (
    result.type !== 'acl_evidence' ||
    !hasExactKeys(result, [
      'type',
      'backendId',
      'backendVersion',
      'evidence',
    ]) ||
    result.backendId !== WINDOWS_RUNNER_BACKEND_ID ||
    result.backendVersion !== expectedBackendVersion ||
    !Array.isArray(result.evidence) ||
    result.evidence.length !== grants.length
  ) {
    throw helperError('runner_helper_response_invalid');
  }
  const expected = new Map(
    grants.map((grant) => [
      `${grant.fileIdentity.volumeSerialNumber}:${grant.fileIdentity.fileIndex}`,
      grant,
    ]),
  );
  const seen = new Set();
  for (const evidence of result.evidence) {
    if (
      !isRecord(evidence) ||
      !hasExactKeys(evidence, [
        'volumeSerialNumber',
        'fileIndex',
        'capabilityName',
        'access',
        'objectCount',
        'aclVerifiedCount',
        'treeDigest',
        'inheritanceVerified',
      ]) ||
      !isBoundedDecimal(evidence.volumeSerialNumber, 4_294_967_295n) ||
      !isBoundedDecimal(evidence.fileIndex, 18_446_744_073_709_551_615n) ||
      typeof evidence.capabilityName !== 'string' ||
      !isWindowsRunnerCapabilityName(evidence.capabilityName) ||
      !Number.isSafeInteger(evidence.objectCount) ||
      evidence.objectCount < 1 ||
      evidence.objectCount > 1_000_001 ||
      evidence.aclVerifiedCount !== evidence.objectCount ||
      typeof evidence.treeDigest !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(evidence.treeDigest) ||
      typeof evidence.inheritanceVerified !== 'boolean'
    ) {
      throw helperError('runner_helper_response_invalid');
    }
    const key = `${evidence.volumeSerialNumber}:${evidence.fileIndex}`;
    const grant = expected.get(key);
    if (
      !grant ||
      seen.has(key) ||
      evidence.capabilityName !== grant.capabilityName ||
      evidence.access !== grant.access ||
      evidence.inheritanceVerified !== grant.isDirectory
    ) {
      throw helperError('runner_helper_response_invalid');
    }
    seen.add(key);
  }
  return { type: result.type, evidence: result.evidence };
}

function parseSetupResponse(bytes, expectedRequestId, expectedBackendVersion) {
  let response;
  try {
    const text = bytes.toString('utf8');
    if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) {
      throw new Error('frame');
    }
    response = JSON.parse(text.slice(0, -1));
  } catch {
    throw helperError('runner_helper_response_invalid');
  }
  if (
    !isRecord(response) ||
    !hasExactKeys(response, ['protocolVersion', 'requestId', 'result']) ||
    response.protocolVersion !== WINDOWS_RUNNER_PROTOCOL_VERSION ||
    response.requestId !== expectedRequestId ||
    !isRecord(response.result)
  ) {
    throw helperError('runner_helper_response_invalid');
  }

  const result = response.result;
  if (result.type === 'denied') {
    if (
      !hasExactKeys(result, ['type', 'code', 'stage']) ||
      typeof result.code !== 'string' ||
      !/^[a-z0-9_]{1,96}$/u.test(result.code) ||
      !['setup', 'protocol'].includes(result.stage)
    ) {
      throw helperError('runner_helper_response_invalid');
    }
    return result;
  }

  if (result.type === 'setup_reconciled') {
    if (
      !hasExactKeys(result, [
        'type',
        'backendId',
        'backendVersion',
        'operationId',
        'packageSid',
      ]) ||
      result.backendId !== WINDOWS_RUNNER_BACKEND_ID ||
      result.backendVersion !== expectedBackendVersion ||
      result.operationId !== expectedRequestId ||
      !isValidWindowsRunnerPackageSid(result.packageSid)
    ) {
      throw helperError('runner_helper_response_invalid');
    }
    return {
      type: result.type,
      value: {
        operationId: result.operationId,
        packageSid: result.packageSid,
      },
    };
  }

  if (
    result.type !== 'setup_evidence' ||
    !hasExactKeys(result, [
      'type',
      'backendId',
      'backendVersion',
      'operationId',
      'evidence',
    ]) ||
    result.backendId !== WINDOWS_RUNNER_BACKEND_ID ||
    result.backendVersion !== expectedBackendVersion ||
    result.operationId !== expectedRequestId ||
    !isRecord(result.evidence) ||
    !hasExactKeys(result.evidence, ['packageSid', ...SETUP_EVIDENCE_FLAGS]) ||
    !isValidWindowsRunnerPackageSid(result.evidence.packageSid) ||
    SETUP_EVIDENCE_FLAGS.some(
      (key) => typeof result.evidence[key] !== 'boolean',
    )
  ) {
    throw helperError('runner_helper_response_invalid');
  }
  return {
    type: result.type,
    value: {
      operationId: result.operationId,
      evidence: result.evidence,
    },
  };
}

function parseExecuteResponse(
  bytes,
  expectedRequestId,
  timeoutMs,
  expectedBackendVersion,
) {
  let response;
  try {
    const text = bytes.toString('utf8');
    if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) {
      throw new Error('frame');
    }
    response = JSON.parse(text.slice(0, -1));
  } catch {
    throw helperError('runner_helper_response_invalid');
  }
  if (
    !isRecord(response) ||
    !hasExactKeys(response, ['protocolVersion', 'requestId', 'result']) ||
    response.protocolVersion !== WINDOWS_RUNNER_PROTOCOL_VERSION ||
    response.requestId !== expectedRequestId ||
    !isRecord(response.result)
  ) {
    throw helperError('runner_helper_response_invalid');
  }
  const result = response.result;
  if (result.type === 'denied') {
    if (
      !hasExactKeys(result, ['type', 'code', 'stage']) ||
      typeof result.code !== 'string' ||
      !/^[a-z0-9_]{1,96}$/u.test(result.code) ||
      typeof result.stage !== 'string' ||
      !/^[a-z0-9_]{1,64}$/u.test(result.stage)
    ) {
      throw helperError('runner_helper_response_invalid');
    }
    return {
      type: 'denied',
      code: result.code,
      stage: result.stage,
      effectStatus: 'not_applied',
    };
  }
  if (result.type === 'command_complete') {
    if (
      !hasExactKeys(result, [
        'type',
        'backendId',
        'backendVersion',
        'childStarted',
        'exitCode',
        'durationMs',
        'timedOut',
        'stdout',
        'stderr',
        'stdoutTruncated',
        'stderrTruncated',
      ]) ||
      result.backendId !== WINDOWS_RUNNER_BACKEND_ID ||
      result.backendVersion !== expectedBackendVersion ||
      result.childStarted !== true ||
      !Number.isSafeInteger(result.exitCode) ||
      result.exitCode < -2_147_483_648 ||
      result.exitCode > 2_147_483_647 ||
      !Number.isSafeInteger(result.durationMs) ||
      result.durationMs < 0 ||
      result.durationMs > timeoutMs + RUNNER_STARTUP_TIMEOUT_MS + 10_000 ||
      typeof result.timedOut !== 'boolean' ||
      typeof result.stdoutTruncated !== 'boolean' ||
      typeof result.stderrTruncated !== 'boolean'
    ) {
      throw helperError('runner_helper_response_invalid');
    }
    const stdout = parseByteArray(result.stdout);
    const stderr = parseByteArray(result.stderr);
    return {
      type: 'complete',
      childStarted: result.childStarted,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      stdout,
      stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      effectStatus: result.timedOut ? 'unknown' : 'applied',
    };
  }
  if (result.type === 'command_outcome_unknown') {
    if (
      !hasExactKeys(result, [
        'type',
        'backendId',
        'backendVersion',
        'childStarted',
        'code',
        'cleanupConfirmed',
        'stdout',
        'stderr',
        'stdoutTruncated',
        'stderrTruncated',
      ]) ||
      result.backendId !== WINDOWS_RUNNER_BACKEND_ID ||
      result.backendVersion !== expectedBackendVersion ||
      typeof result.childStarted !== 'boolean' ||
      typeof result.code !== 'string' ||
      !/^[a-z0-9_]{1,96}$/u.test(result.code) ||
      typeof result.cleanupConfirmed !== 'boolean' ||
      typeof result.stdoutTruncated !== 'boolean' ||
      typeof result.stderrTruncated !== 'boolean'
    ) {
      throw helperError('runner_helper_response_invalid');
    }
    return {
      type: 'outcome_unknown',
      code: result.code,
      childStarted: result.childStarted,
      cleanupConfirmed: result.cleanupConfirmed,
      stdout: parseByteArray(result.stdout),
      stderr: parseByteArray(result.stderr),
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      effectStatus: 'unknown',
    };
  }
  throw helperError('runner_helper_response_invalid');
}

function parseProbeResponse(bytes, expectedRequestId, expectedBackendVersion) {
  let response;
  try {
    const text = bytes.toString('utf8');
    if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) {
      throw new Error('frame');
    }
    response = JSON.parse(text.slice(0, -1));
  } catch {
    throw helperError('runner_helper_response_invalid');
  }
  if (
    !isRecord(response) ||
    !hasExactKeys(response, ['protocolVersion', 'requestId', 'result']) ||
    response.protocolVersion !== WINDOWS_RUNNER_PROTOCOL_VERSION ||
    response.requestId !== expectedRequestId ||
    !isRecord(response.result)
  ) {
    throw helperError('runner_helper_response_invalid');
  }
  const result = response.result;
  if (
    result.type === 'probe' &&
    Number.isSafeInteger(result.policyVersion) &&
    result.policyVersion !== WINDOWS_RUNNER_POLICY_VERSION
  ) {
    throw helperError('policy_version_unsupported');
  }
  if (result.type === 'probe_unavailable') {
    if (
      !hasExactKeys(result, ['type', 'code']) ||
      typeof result.code !== 'string' ||
      !/^[a-z0-9_]{1,96}$/u.test(result.code)
    ) {
      throw helperError('runner_helper_response_invalid');
    }
    return { ready: false, code: result.code };
  }
  const capabilityNames = [
    'filesystemDefaultDeny',
    'filesystemReadAllowlist',
    'filesystemWriteAllowlist',
    'pathIdentityValidation',
    'workingDirectoryConfinement',
    'environmentConfinement',
    'networkDefaultDeny',
    'identityBoundNetworkBroker',
    'jobProcessTree',
    'boundedStdio',
  ];
  // The current policy only allows network denial. An identity-bound broker
  // is required only by prompt-per-destination networking, which the policy
  // compiler rejects until that capability is implemented.
  const requiredCapabilityNames = capabilityNames.filter(
    (name) => name !== 'identityBoundNetworkBroker',
  );
  const blockers = new Set([
    'runner_implementation_incomplete',
    'sandbox_setup_unavailable',
    'os_baseline_unsupported',
    'helper_resource_invalid',
    'required_capability_missing',
  ]);
  if (
    result.type !== 'probe' ||
    !hasExactKeys(result, [
      'type',
      'backendId',
      'backendVersion',
      'policyVersion',
      'ready',
      'blockers',
      'setupStatus',
      'capabilities',
      'platform',
    ]) ||
    result.backendId !== WINDOWS_RUNNER_BACKEND_ID ||
    result.backendVersion !== expectedBackendVersion ||
    result.policyVersion !== WINDOWS_RUNNER_POLICY_VERSION ||
    typeof result.ready !== 'boolean' ||
    !Array.isArray(result.blockers) ||
    result.blockers.length > blockers.size ||
    result.blockers.some((blocker) => !blockers.has(blocker)) ||
    new Set(result.blockers).size !== result.blockers.length ||
    ![
      'not_implemented',
      'not_configured',
      'incomplete',
      'ready',
      'unknown',
    ].includes(result.setupStatus) ||
    !isRecord(result.capabilities) ||
    !hasExactKeys(result.capabilities, capabilityNames) ||
    capabilityNames.some(
      (name) => typeof result.capabilities[name] !== 'boolean',
    ) ||
    !isRecord(result.platform) ||
    !hasExactKeys(result.platform, [
      'major',
      'minor',
      'build',
      'ubr',
      'architecture',
    ]) ||
    ['major', 'minor', 'build', 'ubr'].some(
      (name) =>
        !Number.isSafeInteger(result.platform[name]) ||
        result.platform[name] < 0 ||
        result.platform[name] > 4_294_967_295,
    ) ||
    !['x86_64', 'x86', 'aarch64'].includes(result.platform.architecture)
  ) {
    throw helperError('runner_helper_response_invalid');
  }
  const capabilities = Object.freeze({ ...result.capabilities });
  const platform = { ...result.platform };
  const platformSupported =
    platform.major === 10 &&
    platform.minor === 0 &&
    platform.architecture === 'x86_64' &&
    platform.build >= 19_045;
  const readinessBlockers = [...result.blockers];
  if (
    !platformSupported &&
    !readinessBlockers.includes('os_baseline_unsupported')
  ) {
    readinessBlockers.push('os_baseline_unsupported');
  }
  const actualReady =
    result.ready &&
    readinessBlockers.length === 0 &&
    result.setupStatus === 'ready' &&
    platformSupported &&
    requiredCapabilityNames.every((name) => capabilities[name]);
  return {
    ready: actualReady,
    reportedReady: result.ready,
    blockers: readinessBlockers,
    code: actualReady
      ? undefined
      : (readinessBlockers[0] ?? 'runner_not_ready'),
    backend: {
      id: result.backendId,
      version: result.backendVersion,
      policyVersion: result.policyVersion,
      capabilities,
    },
    setupStatus: result.setupStatus,
    capabilities,
    platform,
  };
}

function parseByteArray(value) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_RUNNER_OUTPUT_BYTES ||
    value.some((byte) => !Number.isSafeInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw helperError('runner_helper_response_invalid');
  }
  return Buffer.from(value);
}

function filteredEnvironment(source) {
  const environment = {};
  for (const name of ENVIRONMENT_ALLOWLIST) {
    const key = Object.keys(source).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    );
    const value = key ? source[key] : undefined;
    if (typeof value === 'string' && value.length <= 32_768) {
      environment[name] = value;
    }
  }
  return environment;
}

function isBoundedDecimal(value, maximum) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value))
    return false;
  try {
    return BigInt(value) <= maximum;
  } catch {
    return false;
  }
}

function hasExactKeys(value, expected) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidTraceIdentity(value) {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 160 &&
    /^[A-Za-z0-9_.:-]+$/u.test(value)
  );
}

function isWindowsRunnerCapabilityName(value) {
  return (
    typeof value === 'string' &&
    /^Noema\.(?:Read|Write)\.[a-f0-9]{64}$/u.test(value)
  );
}

function helperError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
