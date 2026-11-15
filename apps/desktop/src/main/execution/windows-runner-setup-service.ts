import crypto from 'node:crypto';
import {
  advanceWindowsRunnerSetup,
  beginWindowsRunnerSetup,
  commitWindowsRunnerSetupReady,
  hasCompleteWindowsRunnerSetupEvidence,
  requireWindowsRunnerSetupRepair,
  isValidWindowsRunnerPackageSid,
  validateWindowsRunnerSetupState,
} from './windows-runner-setup-state.mjs';

type WindowsRunnerSetupEvent = {
  type: string;
  stage?: string;
  operationId?: string;
  code?: string;
};

type WindowsRunnerSetupState = ReturnType<
  import('./windows-runner-setup-state.mjs').WindowsRunnerSetupStateStore['load']
>;

const SETUP_STAGES = ['profile', 'verify'];
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

/**
 * Main-process owner for durable setup transitions. The helper performs OS
 * work; only this service can commit ready, and only after a fresh live probe.
 * The helper interface intentionally carries no credential or token material.
 */
export class WindowsRunnerSetupService {
  declare stateStore: import('./windows-runner-setup-state.mjs').WindowsRunnerSetupStateStore;
  declare userDataPath: string;
  declare helper: import('./windows-runner-native-helper.mjs').WindowsRunnerNativeHelper;
  declare operationIdFactory: () => string;
  declare onEvent: ((event: WindowsRunnerSetupEvent) => void) | undefined;

  #tail = Promise.resolve();

  constructor({
    stateStore,
    helper,
    operationIdFactory = () => `setup_${crypto.randomUUID()}`,
    onEvent,
  }: {
    stateStore: WindowsRunnerSetupService['stateStore'];
    helper: WindowsRunnerSetupService['helper'];
    operationIdFactory?: WindowsRunnerSetupService['operationIdFactory'];
    onEvent?: (event: WindowsRunnerSetupEvent) => void;
  }) {
    if (
      !stateStore ||
      typeof stateStore.load !== 'function' ||
      typeof stateStore.transact !== 'function' ||
      typeof stateStore.userDataPath !== 'string' ||
      !helper ||
      typeof helper.reconcileSandboxSetup !== 'function' ||
      typeof helper.probeSandboxSetup !== 'function' ||
      typeof operationIdFactory !== 'function' ||
      (onEvent !== undefined && typeof onEvent !== 'function')
    ) {
      throw setupServiceError('setup_service_configuration_invalid');
    }
    this.stateStore = stateStore;
    this.userDataPath = stateStore.userDataPath;
    this.helper = helper;
    this.operationIdFactory = operationIdFactory;
    this.onEvent = onEvent;
  }

  reconcile() {
    const run = this.#tail.then(
      () => this.#reconcile(),
      () => this.#reconcile(),
    );
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  verifyReady() {
    const run = this.#tail.then(
      () => this.#verifyReady(),
      () => this.#verifyReady(),
    );
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #verifyReady() {
    let state;
    try {
      state = validateWindowsRunnerSetupState(this.stateStore.load());
    } catch {
      return { ready: false, reason: 'setup_state_unavailable' };
    }
    if (state.status !== 'ready') {
      return { ready: false, reason: 'sandbox_setup_unavailable' };
    }
    try {
      const probe = await this.#probe(state.operationId, 'verify');
      if (
        !hasCompleteWindowsRunnerSetupEvidence(probe.evidence, state.packageSid)
      ) {
        return { ready: false, reason: 'sandbox_setup_unavailable' };
      }
      return {
        ready: true,
        operationId: state.operationId,
        packageSid: state.packageSid,
      };
    } catch (error) {
      return { ready: false, reason: stableReasonCode(error) };
    }
  }

  async #reconcile() {
    let state;
    try {
      state = validateWindowsRunnerSetupState(this.stateStore.load());
    } catch {
      this.#emit({
        type: 'setup_failed',
        stage: 'load',
        code: 'setup_state_unavailable',
      });
      throw setupServiceError('setup_state_unavailable');
    }

    if (state.status === 'ready') {
      let liveEvidence;
      try {
        const probe = await this.#probe(state.operationId, 'verify');
        liveEvidence = hasCompleteWindowsRunnerSetupEvidence(
          probe.evidence,
          state.packageSid,
        );
      } catch {
        liveEvidence = false;
      }
      if (liveEvidence) {
        this.#emit({
          type: 'setup_ready',
          stage: 'verify',
          operationId: state.operationId,
        });
        return state;
      }
      const operationId = this.#newOperationId();
      state = await this.#persistRepair((current) =>
        beginWindowsRunnerSetup(current, operationId),
      );
    } else if (state.status === 'unconfigured') {
      const operationId = this.#newOperationId();
      state = await this.#persistRepair((current) =>
        beginWindowsRunnerSetup(current, operationId),
      );
    }

    const operationId = state.operationId;
    let stage = state.stage;
    this.#emit({ type: 'setup_started', stage: state.stage, operationId });
    try {
      const reconcileResult = await this.helper.reconcileSandboxSetup({
        operationId,
        userDataPath: this.userDataPath,
      });
      validateReconcileResult(reconcileResult, operationId);

      state = await this.#advanceToVerify(operationId);
      stage = 'verify';
      this.#emit({ type: 'setup_probe_started', stage: 'verify', operationId });
      const probe = await this.#probe(operationId, 'verify');
      if (
        !hasCompleteWindowsRunnerSetupEvidence(
          probe.evidence,
          reconcileResult.packageSid,
        )
      ) {
        throw setupServiceError('setup_state_live_verification_incomplete');
      }

      const ready = await this.stateStore.transact(
        (current: WindowsRunnerSetupState) =>
          commitWindowsRunnerSetupReady(
            current,
            operationId,
            reconcileResult.packageSid,
            probe.evidence,
          ),
      );
      this.#emit({ type: 'setup_ready', stage: 'verify', operationId });
      return ready;
    } catch (error) {
      const code = stableReasonCode(error);
      try {
        await this.#persistRepair((current) =>
          requireWindowsRunnerSetupRepair(current, code),
        );
      } catch {
        // The pre-operation repair_required record remains the fail-closed
        // durable state if a later repair-state write itself fails.
      }
      this.#emit({ type: 'setup_failed', stage, operationId, code });
      throw setupServiceError(code);
    }
  }

  async #probe(operationId: string, stage: string) {
    try {
      const result = await this.helper.probeSandboxSetup({
        operationId,
        userDataPath: this.userDataPath,
      });
      validateProbeResult(result, operationId);
      return result;
    } catch (error) {
      this.#emit({
        type: 'setup_probe_failed',
        stage,
        operationId,
        code: stableReasonCode(error),
      });
      throw setupServiceError(stableReasonCode(error));
    }
  }

  async #advanceToVerify(operationId: string) {
    let state = validateWindowsRunnerSetupState(this.stateStore.load());
    while (state.status === 'repair_required' && state.stage !== 'verify') {
      const nextStage = SETUP_STAGES[SETUP_STAGES.indexOf(state.stage) + 1];
      state = await this.stateStore.transact(
        (current: WindowsRunnerSetupState) =>
          advanceWindowsRunnerSetup(current, operationId, nextStage),
      );
    }
    if (
      state.status !== 'repair_required' ||
      state.operationId !== operationId
    ) {
      throw setupServiceError('setup_state_transition_invalid');
    }
    return state;
  }

  #persistRepair(transition: (current: WindowsRunnerSetupState) => unknown) {
    return this.stateStore.transact(transition);
  }

  #newOperationId() {
    const operationId = this.operationIdFactory();
    if (
      typeof operationId !== 'string' ||
      !OPERATION_ID_PATTERN.test(operationId)
    ) {
      throw setupServiceError('setup_operation_id_invalid');
    }
    return operationId;
  }

  #emit(event: WindowsRunnerSetupEvent) {
    try {
      this.onEvent?.(event);
    } catch {
      // Diagnostics must not alter setup or readiness outcomes.
    }
  }
}

function validateReconcileResult(value: unknown, operationId: string) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['operationId', 'packageSid']) ||
    value.operationId !== operationId ||
    !isValidIdentitySid(value.packageSid)
  ) {
    throw setupServiceError('setup_helper_response_invalid');
  }
}

function validateProbeResult(value: unknown, operationId: string) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['operationId', 'evidence']) ||
    value.operationId !== operationId ||
    !isRecord(value.evidence)
  ) {
    throw setupServiceError('setup_helper_response_invalid');
  }
}

function isValidIdentitySid(value: unknown) {
  return isValidWindowsRunnerPackageSid(value);
}

function stableReasonCode(error: unknown): string {
  return typeof (error as { code?: unknown } | null)?.code === 'string' &&
    /^[a-z0-9_]{1,96}$/u.test((error as { code: string }).code)
    ? (error as { code: string }).code
    : 'setup_helper_failed';
}

function hasExactKeys(value: object, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function setupServiceError(code: string) {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}
