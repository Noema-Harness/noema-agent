import crypto from 'node:crypto';

/**
 * Main-process owner for the journal-before-helper ACL transaction.
 *
 * The injected helper must expose `reconcileFilesystemRootAcls` and
 * `verifyFilesystemRootAcls`. Reconciliation may change ACLs; verification must be
 * read-only. Callers must keep command admission closed unless this service
 * returns `ready: true` and the separate sandbox setup gate also passes.
 */
export class WindowsRunnerAclTransactionService {
  /**
   * @param {{journalStore: any, helper: any, makeOperationId?: () => string, recordEvent?: (event: {operation: string, operationId: string, stage: string, reasonCode?: string, requestId?: string, executionId?: string, taskId?: string, toolCallId?: string}) => unknown}} options
   */
  constructor({
    journalStore,
    helper,
    makeOperationId,
    recordEvent = () => {},
  }) {
    if (
      !journalStore ||
      typeof journalStore.load !== 'function' ||
      typeof journalStore.begin !== 'function' ||
      typeof journalStore.markVerified !== 'function' ||
      typeof journalStore.refreshVerified !== 'function' ||
      typeof journalStore.complete !== 'function' ||
      !helper ||
      typeof helper.reconcileFilesystemRootAcls !== 'function' ||
      typeof helper.verifyFilesystemRootAcls !== 'function' ||
      (makeOperationId !== undefined &&
        typeof makeOperationId !== 'function') ||
      typeof recordEvent !== 'function'
    ) {
      throw aclTransactionError('acl_transaction_dependencies_invalid');
    }
    this.journal = journalStore;
    this.helper = helper;
    this.makeOperationId = makeOperationId ?? (() => crypto.randomUUID());
    this.recordEvent = recordEvent;
    this.queue = Promise.resolve();
  }

  /**
   * Recover a durable pending batch if present. Recovery never authorizes the
   * command that discovered the pending journal; that request must retry from
   * a clean journal so it cannot inherit the previous request's grants.
   */
  recoverPending(traceIdentity) {
    return this.#serialize(async () => {
      let state;
      try {
        state = this.journal.load();
      } catch (error) {
        return denied(safeCode(error, 'acl_journal_unavailable'));
      }
      if (state.status === 'clean') return { ready: true, recovered: false };
      const recovered = await this.#recover(state, traceIdentity);
      if (!recovered.ok) return denied(recovered.reason, true);
      return { ready: true, recovered: true };
    });
  }

  /**
   * Ensure the exact requested grants are fully verified. The durable
   * `repair_required/applying` record is committed before the helper can make
   * its first ACL change. All paths are serialized within this main process.
   */
  ensureFilesystemRoots(grants, traceIdentity) {
    return this.#serialize(async () => {
      let state;
      try {
        state = this.journal.load();
      } catch (error) {
        return denied(safeCode(error, 'acl_journal_unavailable'));
      }

      if (state.status !== 'clean') {
        const recovered = await this.#recover(state, traceIdentity);
        if (!recovered.ok) return denied(recovered.reason, true);
        return denied('acl_recovered_retry', true);
      }

      let operationId;
      try {
        operationId = this.makeOperationId();
      } catch (error) {
        return denied(safeCode(error, 'acl_operation_id_unavailable'));
      }
      try {
        // This durable transition MUST precede every mutating helper call.
        state = this.journal.begin(operationId, grants);
      } catch (error) {
        return denied(safeCode(error, 'acl_journal_persist_failed'));
      }
      return this.#reconcileAndVerify(state, false, traceIdentity);
    });
  }

  #serialize(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #recover(state, traceIdentity) {
    this.#emit(state.operationId, 'recovery_started', undefined, traceIdentity);
    try {
      if (state.phase === 'applying') {
        const result = await this.#reconcileAndVerify(
          state,
          false,
          traceIdentity,
        );
        if (!result.ready) return { ok: false, reason: result.reason };
      } else if (state.phase === 'verified') {
        let liveEvidence;
        try {
          liveEvidence = await this.#verify(state, traceIdentity);
        } catch (error) {
          if (error?.code !== 'acl_grant_missing') throw error;
          const repaired = await this.#reconcileAndVerify(
            state,
            true,
            traceIdentity,
          );
          if (!repaired.ready) return { ok: false, reason: repaired.reason };
          this.#emit(
            state.operationId,
            'recovery_completed',
            undefined,
            traceIdentity,
          );
          return { ok: true };
        }
        try {
          this.journal.complete(state.operationId, liveEvidence);
        } catch (error) {
          if (error?.code !== 'acl_live_verification_mismatch') throw error;
          const reconciled = await this.#reconcileAndVerify(
            state,
            true,
            traceIdentity,
          );
          if (!reconciled.ready) {
            return { ok: false, reason: reconciled.reason };
          }
        }
      } else {
        return { ok: false, reason: 'acl_journal_invalid' };
      }
      this.#emit(
        state.operationId,
        'recovery_completed',
        undefined,
        traceIdentity,
      );
      return { ok: true };
    } catch (error) {
      const reason = safeCode(error, 'acl_recovery_failed');
      this.#emit(state.operationId, 'recovery_failed', reason, traceIdentity);
      return { ok: false, reason };
    }
  }

  async #reconcileAndVerify(state, refreshVerified = false, traceIdentity) {
    const operationId = state.operationId;
    const grants = state.grants;
    try {
      this.#emit(
        operationId,
        'reconciliation_started',
        undefined,
        traceIdentity,
      );
      const appliedEvidence = await this.helper.reconcileFilesystemRootAcls({
        operationId,
        grants: nativeGrantView(grants),
      });
      if (refreshVerified) {
        this.journal.refreshVerified(operationId, appliedEvidence);
      } else {
        this.journal.markVerified(operationId, appliedEvidence);
      }
      this.#emit(
        operationId,
        'reconciliation_verified',
        undefined,
        traceIdentity,
      );

      // A second, read-only helper pass is mandatory after the durable
      // `verified` transition. A crash here leaves a recoverable journal.
      const liveEvidence = await this.#verify(state, traceIdentity);
      this.journal.complete(operationId, liveEvidence);
      this.#emit(
        operationId,
        'transaction_completed',
        undefined,
        traceIdentity,
      );
      return { ready: true, recovered: false };
    } catch (error) {
      const reason = safeCode(error, 'acl_transaction_failed');
      this.#emit(operationId, 'transaction_failed', reason, traceIdentity);
      return denied(reason);
    }
  }

  async #verify(state, traceIdentity) {
    this.#emit(
      state.operationId,
      'verification_started',
      undefined,
      traceIdentity,
    );
    const evidence = await this.helper.verifyFilesystemRootAcls({
      operationId: state.operationId,
      grants: nativeGrantView(state.grants),
    });
    this.#emit(
      state.operationId,
      'verification_completed',
      undefined,
      traceIdentity,
    );
    return evidence;
  }

  #emit(operationId, stage, reasonCode, traceIdentity) {
    try {
      const result = this.recordEvent({
        operation: 'windows_runner_acl',
        operationId,
        stage,
        ...(validTraceIdentity(traceIdentity) ? traceIdentity : {}),
        ...(reasonCode ? { reasonCode } : {}),
      });
      if (result && typeof result.catch === 'function') {
        void result.catch(() => {});
      }
    } catch {
      // Diagnostics must never alter the journal or ACL admission decision.
    }
  }
}

function nativeGrantView(grants) {
  return grants.map(
    ({ path, fileIdentity, capabilityName, access, isDirectory }) => ({
      path,
      fileIdentity: {
        volumeSerialNumber: fileIdentity.volumeSerialNumber,
        fileIndex: fileIdentity.fileIndex,
      },
      capabilityName,
      access,
      isDirectory,
    }),
  );
}

function validTraceIdentity(value) {
  return (
    value &&
    typeof value.requestId === 'string' &&
    /^[A-Za-z0-9_-]{16,128}$/u.test(value.requestId) &&
    ['executionId', 'taskId', 'toolCallId'].every(
      (key) =>
        typeof value[key] === 'string' &&
        /^[A-Za-z0-9_.:-]{1,160}$/u.test(value[key]),
    )
  );
}

function denied(reason, recovered = false) {
  return { ready: false, recovered, reason };
}

function safeCode(error, fallback) {
  return typeof error?.code === 'string' &&
    /^[a-z0-9_]{1,96}$/u.test(error.code)
    ? error.code
    : fallback;
}

function aclTransactionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
