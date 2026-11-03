import path from 'node:path';
import { realpath as defaultRealpath } from 'node:fs/promises';
import { compileWindowsCommandPolicy } from './windows-command-policy.mjs';
import { captureWindowsPathIdentity } from './windows-path-identity.mjs';
import { createWindowsRunnerCapabilityGrants } from './windows-runner-capability-grants.mjs';

const TRACE_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,128}$/u;

/**
 * Trusted main-process admission owner for Windows workspace commands.
 * Renderer/model input supplies intent only; identities and backend capabilities
 * are recaptured or probed here before the durable ACL transaction and execute.
 */
export class WindowsRunnerExecutionService {
  /**
   * @param {{helper: any, setupService: any, aclTransaction: any, capabilityNameStore: any, userDataPath: string, runtimeReadRoots?: string[], realpathPath?: (path: string) => Promise<string>, captureIdentity?: Function, statPath?: Function, recordEvent?: (event: Record<string, unknown>) => unknown}} options
   */
  constructor({
    helper,
    setupService,
    aclTransaction,
    capabilityNameStore,
    userDataPath,
    runtimeReadRoots = [],
    realpathPath = defaultRealpath,
    captureIdentity = captureWindowsPathIdentity,
    statPath,
    recordEvent = () => {},
  }) {
    if (
      !helper ||
      typeof helper.probeCommandBackend !== 'function' ||
      typeof helper.executeSandboxCommand !== 'function' ||
      typeof setupService?.verifyReady !== 'function' ||
      typeof aclTransaction?.recoverPending !== 'function' ||
      typeof aclTransaction?.ensureFilesystemRoots !== 'function' ||
      typeof capabilityNameStore?.getOrCreate !== 'function' ||
      typeof userDataPath !== 'string' ||
      !path.win32.isAbsolute(userDataPath) ||
      !Array.isArray(runtimeReadRoots) ||
      runtimeReadRoots.length > 32 ||
      typeof realpathPath !== 'function' ||
      typeof captureIdentity !== 'function' ||
      (statPath !== undefined && typeof statPath !== 'function') ||
      typeof recordEvent !== 'function'
    ) {
      throw executionServiceError('command_service_configuration_invalid');
    }
    this.helper = helper;
    this.setupService = setupService;
    this.aclTransaction = aclTransaction;
    this.capabilityNameStore = capabilityNameStore;
    this.userDataPath = path.win32.normalize(userDataPath);
    this.runtimeReadRoots = [...runtimeReadRoots];
    this.realpathPath = realpathPath;
    this.captureIdentity = captureIdentity;
    this.statPath = statPath;
    this.recordEvent = recordEvent;
  }

  async run({
    requestId,
    executionId,
    taskId,
    toolCallId,
    command,
    workspacePath,
    timeoutMs,
    additionalAccess = [],
    authorizeAdditionalAccess = async () => false,
    signal,
    onChild,
  }) {
    const identity = { requestId, executionId, taskId, toolCallId };
    if (
      !REQUEST_ID.test(requestId ?? '') ||
      !TRACE_ID.test(executionId ?? '') ||
      !TRACE_ID.test(taskId ?? '') ||
      !TRACE_ID.test(toolCallId ?? '') ||
      typeof command !== 'string' ||
      !command.trim() ||
      command.length > 8_000 ||
      command.includes('\0') ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 180_000 ||
      !Array.isArray(additionalAccess) ||
      additionalAccess.length > 4 ||
      typeof authorizeAdditionalAccess !== 'function' ||
      (onChild !== undefined && typeof onChild !== 'function')
    ) {
      throw executionServiceError('command_request_invalid', identity);
    }
    if (signal?.aborted) {
      throw executionServiceError('command_aborted', identity, 'not_applied');
    }

    this.#emit(identity, 'admission_started', 'started');
    const readiness = await this.#probe(requestId, identity);
    this.#emit(
      identity,
      'backend_probe',
      readiness.ready ? 'ready' : 'unavailable',
      readiness.code,
      { phase: 'readiness' },
    );
    if (!readiness.ready) {
      return this.#deny(
        readiness.code ?? 'runner_not_ready',
        'readiness',
        identity,
      );
    }

    const setup = await this.#guard(
      () => this.setupService.verifyReady(),
      'sandbox_setup_unavailable',
      identity,
    );
    this.#emit(
      identity,
      'setup_verify',
      setup.ready ? 'ready' : 'unavailable',
      setup.reason,
      { phase: 'setup' },
    );
    if (!setup.ready) {
      return this.#deny(
        setup.reason ?? 'sandbox_setup_unavailable',
        'setup',
        identity,
      );
    }

    const workspace = await this.#captureRoot(
      workspacePath,
      'directory',
      identity,
    );
    if (!workspace) {
      return this.#deny('path_identity_unavailable', 'path', identity);
    }
    const externalAccess = [];
    for (const request of additionalAccess) {
      if (
        !request ||
        typeof request !== 'object' ||
        !['read', 'write'].includes(request.access) ||
        typeof request.reason !== 'string' ||
        !request.reason.trim() ||
        request.reason.length > 500
      ) {
        return this.#deny('invalid_external_grants', 'authorization', identity);
      }
      const root = await this.#captureRoot(request.path, 'either', identity);
      if (!root) {
        return this.#deny('path_identity_unavailable', 'path', identity);
      }
      let approved = false;
      try {
        approved =
          (await authorizeAdditionalAccess({
            command,
            path: root.path,
            access: request.access,
            reason: request.reason,
          })) === true;
      } catch {
        return this.#deny(
          'external_access_authorization_failed',
          'authorization',
          identity,
        );
      }
      if (!approved) {
        return this.#deny('external_access_denied', 'authorization', identity);
      }
      externalAccess.push({ ...root, access: request.access });
    }

    const runtimeRoots = [];
    for (const rootPath of this.runtimeReadRoots) {
      const root = await this.#captureRoot(rootPath, 'either', identity);
      if (!root) {
        return this.#deny(
          'path_identity_unavailable',
          'runtime_roots',
          identity,
        );
      }
      runtimeRoots.push(root);
    }

    const compiled = compileWindowsCommandPolicy({
      backend: readiness.backend,
      requestId,
      workspace,
      externalAccess,
      runtimeReadRoots: runtimeRoots,
      cwd: workspace,
      network: { mode: 'deny' },
    });
    if (!compiled.ok) {
      return this.#deny(compiled.code, 'policy', identity);
    }
    this.#emit(identity, 'policy_compiled', 'complete', undefined, {
      phase: 'policy',
    });
    const planned = await createWindowsRunnerCapabilityGrants(compiled.policy, {
      capabilityNameStore: this.capabilityNameStore,
      ...(this.statPath ? { statPath: this.statPath } : {}),
    });
    if (!planned.ok) {
      return this.#deny(planned.code, 'grants', identity);
    }
    if (signal?.aborted) {
      throw executionServiceError('command_aborted', identity, 'not_applied');
    }

    const recovery = await this.#guard(
      () => this.aclTransaction.recoverPending(identity),
      'acl_recovery_failed',
      identity,
    );
    if (!recovery.ready) {
      return this.#deny(
        recovery.reason ?? 'acl_recovery_failed',
        'acl_recovery',
        identity,
      );
    }
    if (recovery.recovered) {
      return this.#deny('acl_recovered_retry', 'acl_recovery', identity);
    }
    const acl = await this.#guard(
      () => this.aclTransaction.ensureFilesystemRoots(planned.grants, identity),
      'acl_reconciliation_failed',
      identity,
    );
    if (!acl.ready) {
      return this.#deny(
        acl.reason ?? 'acl_reconciliation_failed',
        'acl',
        identity,
      );
    }
    if (signal?.aborted) {
      throw executionServiceError('command_aborted', identity, 'not_applied');
    }

    const setupAfterAcl = await this.#guard(
      () => this.setupService.verifyReady(),
      'sandbox_setup_unavailable',
      identity,
    );
    this.#emit(
      identity,
      'setup_verify_after_acl',
      setupAfterAcl.ready ? 'ready' : 'unavailable',
      setupAfterAcl.reason,
      { phase: 'setup' },
    );
    if (!setupAfterAcl.ready || setupAfterAcl.packageSid !== setup.packageSid) {
      return this.#deny(
        setupAfterAcl.reason ?? 'sandbox_setup_unavailable',
        'setup',
        identity,
      );
    }

    let result;
    this.#emit(identity, 'native_execute_started', 'started', undefined, {
      phase: 'native_execute',
    });
    try {
      result = await this.helper.executeSandboxCommand({
        ...identity,
        userDataPath: this.userDataPath,
        packageSid: setup.packageSid,
        policy: compiled.policy,
        grants: planned.grants,
        command,
        timeoutMs,
        signal,
        onChild: (child) => {
          try {
            onChild?.(child);
          } finally {
            this.#emit(
              identity,
              child ? 'native_helper_started' : 'native_helper_closed',
              child ? 'started' : 'closed',
              undefined,
              { phase: 'helper' },
            );
          }
        },
      });
    } catch (error) {
      const cancelled = error?.code === 'runner_helper_aborted';
      const timedOut = error?.code === 'runner_helper_timeout';
      const status =
        error?.effectStatus === 'unknown' ? 'unknown' : 'not_applied';
      this.#emit(
        identity,
        cancelled
          ? 'command_cancelled'
          : timedOut
            ? 'command_timed_out'
            : 'command_finished',
        status,
        error?.code,
        {
          phase: 'native_execute',
          effectStatus: error?.effectStatus ?? 'not_applied',
          cleanupConfirmed: error?.effectStatus !== 'unknown',
          timedOut,
        },
      );
      if (error?.effectStatus === 'unknown') {
        this.#emit(identity, 'child_tree_cleanup', 'unknown', error?.code, {
          phase: 'cleanup',
          cleanupConfirmed: false,
          effectStatus: 'unknown',
        });
      }
      throw executionServiceError(
        safeCode(error, 'runner_execution_failed'),
        identity,
        error?.effectStatus === 'unknown' ? 'unknown' : 'not_applied',
      );
    }
    if (result.type === 'denied') {
      return this.#deny(result.code, result.stage ?? 'native', identity);
    }
    if (result.type === 'outcome_unknown') {
      if (result.childStarted) {
        this.#emit(identity, 'sandbox_child_started', 'confirmed', undefined, {
          phase: 'child',
        });
      }
      this.#recordCommandOutput(identity, result);
      this.#emit(identity, 'command_finished', 'unknown', result.code, {
        phase: 'command',
        effectStatus: 'unknown',
        cleanupConfirmed: result.cleanupConfirmed,
      });
      this.#emit(
        identity,
        'child_tree_cleanup',
        result.cleanupConfirmed ? 'confirmed' : 'unknown',
        result.cleanupConfirmed ? undefined : result.code,
        {
          phase: 'cleanup',
          cleanupConfirmed: result.cleanupConfirmed,
          effectStatus: 'unknown',
        },
      );
      const error = executionServiceError(result.code, identity, 'unknown');
      error.output = decodeCommandOutput(result.stdout, result.stderr);
      error.stdoutTruncated = result.stdoutTruncated;
      error.stderrTruncated = result.stderrTruncated;
      error.cleanupConfirmed = result.cleanupConfirmed;
      throw error;
    }
    if (result.type !== 'complete') {
      throw executionServiceError(
        'runner_response_invalid',
        identity,
        'unknown',
      );
    }
    this.#emit(identity, 'sandbox_child_started', 'confirmed', undefined, {
      phase: 'child',
    });
    this.#recordCommandOutput(identity, result);
    this.#emit(
      identity,
      result.timedOut ? 'command_timed_out' : 'command_finished',
      result.timedOut ? 'timeout' : 'complete',
      undefined,
      {
        phase: 'command',
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        effectStatus: result.effectStatus,
        cleanupConfirmed: true,
      },
    );
    this.#emit(identity, 'child_tree_cleanup', 'confirmed', undefined, {
      phase: 'cleanup',
      cleanupConfirmed: true,
      timedOut: result.timedOut,
      effectStatus: result.effectStatus,
    });
    return {
      output: decodeCommandOutput(result.stdout, result.stderr),
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      effectStatus: result.effectStatus,
    };
  }

  async #probe(requestId, identity) {
    try {
      return await this.helper.probeCommandBackend({ requestId });
    } catch (error) {
      this.#emit(
        identity,
        'readiness_probe',
        'error',
        safeCode(error, 'runner_not_ready'),
      );
      return { ready: false, code: safeCode(error, 'runner_not_ready') };
    }
  }

  async #captureRoot(inputPath, expectedType, identity) {
    if (
      typeof inputPath !== 'string' ||
      inputPath.length === 0 ||
      inputPath.length > 1_000 ||
      !path.win32.isAbsolute(inputPath) ||
      inputPath.startsWith('\\\\') ||
      inputPath.startsWith('\\\\?\\') ||
      inputPath.startsWith('\\\\.\\')
    ) {
      return undefined;
    }
    try {
      const canonical = await this.realpathPath(inputPath);
      if (
        typeof canonical !== 'string' ||
        !path.win32.isAbsolute(canonical) ||
        canonical.startsWith('\\\\')
      ) {
        return undefined;
      }
      const captured = await this.captureIdentity(canonical, { expectedType });
      if (!captured.ok) return undefined;
      return captured.root;
    } catch {
      this.#emit(
        identity,
        'path_identity',
        'error',
        'path_identity_unavailable',
      );
      return undefined;
    }
  }

  async #guard(operation, fallback, identity) {
    try {
      return await operation();
    } catch (error) {
      this.#emit(
        identity,
        'admission_gate',
        'error',
        safeCode(error, fallback),
      );
      return { ready: false, reason: safeCode(error, fallback) };
    }
  }

  #deny(code, stage, identity) {
    const reason = safeCode({ code }, 'command_denied');
    this.#emit(identity, `admission_${stage}`, 'denied', reason);
    throw executionServiceError(reason, identity, 'not_applied');
  }

  #recordCommandOutput(identity, result) {
    this.#emit(identity, 'command_output_collected', 'complete', undefined, {
      phase: 'output',
      stdoutBytes: Buffer.isBuffer(result.stdout) ? result.stdout.length : 0,
      stderrBytes: Buffer.isBuffer(result.stderr) ? result.stderr.length : 0,
      stdoutTruncated: result.stdoutTruncated === true,
      stderrTruncated: result.stderrTruncated === true,
    });
  }

  #emit(identity, operation, status, errorCode, details) {
    try {
      this.recordEvent({
        ...identity,
        module: 'windows_runner',
        operation,
        status,
        ...(errorCode
          ? { errorCode: safeCode({ code: errorCode }, 'unknown') }
          : {}),
        ...(details ? { details } : {}),
      });
    } catch {}
  }
}

function executionServiceError(code, identity, effectStatus = 'not_applied') {
  const error = new Error(code);
  error.code = code;
  error.effectStatus = effectStatus;
  Object.assign(error, identity);
  return error;
}

function safeCode(error, fallback) {
  return typeof error?.code === 'string' &&
    /^[a-z0-9_]{1,96}$/u.test(error.code)
    ? error.code
    : fallback;
}

function decodeCommandOutput(stdout, stderr) {
  const out = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : '';
  const err = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : '';
  if (!out) return err;
  if (!err) return out;
  return `${out}${out.endsWith('\n') ? '' : '\n'}${err}`;
}
