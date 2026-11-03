import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const WINDOWS_RUNNER_SETUP_STATE_VERSION = 3;
const MAX_STATE_BYTES = 64 * 1024;
const SETUP_STAGES = ['profile', 'verify'];
const REQUIRED_LIVE_EVIDENCE = [
  'packageSid',
  'profileValid',
  'networkFiltersValid',
];

export function unconfiguredWindowsRunnerSetupState() {
  return {
    version: WINDOWS_RUNNER_SETUP_STATE_VERSION,
    revision: 0,
    status: 'unconfigured',
  };
}

export function beginWindowsRunnerSetup(state, operationId) {
  validateWindowsRunnerSetupState(state);
  validateOperationId(operationId);
  if (state.status === 'repair_required') {
    throw setupStateError('setup_recovery_required');
  }
  return {
    version: WINDOWS_RUNNER_SETUP_STATE_VERSION,
    revision: nextRevision(state.revision),
    status: 'repair_required',
    operationId,
    stage: 'profile',
    reasonCode: null,
  };
}

export function advanceWindowsRunnerSetup(state, operationId, nextStage) {
  validateWindowsRunnerSetupState(state);
  if (
    state.status !== 'repair_required' ||
    state.operationId !== operationId ||
    !SETUP_STAGES.includes(nextStage) ||
    SETUP_STAGES.indexOf(nextStage) !== SETUP_STAGES.indexOf(state.stage) + 1
  ) {
    throw setupStateError('setup_state_transition_invalid');
  }
  return {
    ...state,
    revision: nextRevision(state.revision),
    stage: nextStage,
  };
}

export function commitWindowsRunnerSetupReady(
  state,
  operationId,
  packageSid,
  evidence,
) {
  validateWindowsRunnerSetupState(state);
  if (
    state.status !== 'repair_required' ||
    state.operationId !== operationId ||
    state.stage !== 'verify'
  ) {
    throw setupStateError('setup_state_transition_invalid');
  }
  if (!isValidWindowsRunnerPackageSid(packageSid)) {
    throw setupStateError('setup_identity_invalid');
  }
  if (!hasCompleteWindowsRunnerSetupEvidence(evidence, packageSid)) {
    throw setupStateError('setup_state_live_verification_incomplete');
  }
  return {
    version: WINDOWS_RUNNER_SETUP_STATE_VERSION,
    revision: nextRevision(state.revision),
    status: 'ready',
    operationId,
    packageSid,
  };
}

export function requireWindowsRunnerSetupRepair(state, reasonCode) {
  validateWindowsRunnerSetupState(state);
  if (
    typeof reasonCode !== 'string' ||
    !/^[a-z0-9_]{1,96}$/u.test(reasonCode) ||
    state.status === 'unconfigured'
  ) {
    throw setupStateError(
      state.status === 'unconfigured'
        ? 'setup_state_transition_invalid'
        : 'setup_reason_invalid',
    );
  }
  const operationId = state.operationId;
  return {
    version: WINDOWS_RUNNER_SETUP_STATE_VERSION,
    revision: nextRevision(state.revision),
    status: 'repair_required',
    operationId,
    stage: state.status === 'ready' ? 'verify' : state.stage,
    reasonCode,
  };
}

export function hasCompleteWindowsRunnerSetupEvidence(
  evidence,
  expectedPackageSid,
) {
  return (
    isRecord(evidence) &&
    hasExactKeys(evidence, REQUIRED_LIVE_EVIDENCE) &&
    isValidWindowsRunnerPackageSid(expectedPackageSid) &&
    evidence.packageSid === expectedPackageSid &&
    evidence.profileValid === true &&
    evidence.networkFiltersValid === true
  );
}

export function admitsWindowsRunnerSetup(state, liveEvidence) {
  try {
    validateWindowsRunnerSetupState(state);
  } catch {
    return false;
  }
  return (
    state.status === 'ready' &&
    hasCompleteWindowsRunnerSetupEvidence(liveEvidence, state.packageSid)
  );
}

export function validateWindowsRunnerSetupState(value) {
  if (
    !isRecord(value) ||
    value.version !== WINDOWS_RUNNER_SETUP_STATE_VERSION
  ) {
    throw setupStateError('setup_state_version_unsupported');
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw setupStateError('setup_state_invalid');
  }

  if (value.status === 'unconfigured') {
    assertExactKeys(value, ['version', 'revision', 'status']);
    if (value.revision !== 0) throw setupStateError('setup_state_invalid');
    return value;
  }

  if (value.status === 'repair_required') {
    assertExactKeys(value, [
      'version',
      'revision',
      'status',
      'operationId',
      'stage',
      'reasonCode',
    ]);
    validateOperationId(value.operationId);
    if (
      value.revision === 0 ||
      !SETUP_STAGES.includes(value.stage) ||
      (value.reasonCode !== null &&
        (typeof value.reasonCode !== 'string' ||
          !/^[a-z0-9_]{1,96}$/u.test(value.reasonCode)))
    ) {
      throw setupStateError('setup_state_invalid');
    }
    return value;
  }

  if (value.status === 'ready') {
    assertExactKeys(value, [
      'version',
      'revision',
      'status',
      'operationId',
      'packageSid',
    ]);
    validateOperationId(value.operationId);
    if (
      value.revision === 0 ||
      !isValidWindowsRunnerPackageSid(value.packageSid)
    ) {
      throw setupStateError('setup_state_invalid');
    }
    return value;
  }

  throw setupStateError('setup_state_invalid');
}

/**
 * The main process is the only durable state owner. This sidecar contains no
 * credentials; the native helper only performs OS mutations and reports
 * typed evidence. `transact` serializes all in-process state transitions.
 */
export class WindowsRunnerSetupStateStore {
  #tail = Promise.resolve();

  constructor({ userDataPath, fsImpl = fs, pathImpl = path }) {
    if (
      typeof userDataPath !== 'string' ||
      !pathImpl.isAbsolute(userDataPath)
    ) {
      throw setupStateError('setup_state_path_invalid');
    }
    this.fs = fsImpl;
    this.path = pathImpl;
    this.userDataPath = pathImpl.resolve(userDataPath);
    this.directoryPath = pathImpl.join(this.userDataPath, 'windows-runner');
    this.statePath = pathImpl.join(this.directoryPath, 'setup-state.json');
  }

  load() {
    if (!this.#directoryExistsSafely(this.userDataPath)) {
      return unconfiguredWindowsRunnerSetupState();
    }
    if (!this.#directoryExistsSafely(this.directoryPath)) {
      return unconfiguredWindowsRunnerSetupState();
    }

    let stateInfo;
    try {
      stateInfo = this.fs.lstatSync(this.statePath, { bigint: true });
    } catch (error) {
      if (error?.code === 'ENOENT')
        return unconfiguredWindowsRunnerSetupState();
      throw error;
    }
    if (
      !stateInfo.isFile() ||
      stateInfo.isSymbolicLink() ||
      stateInfo.nlink !== 1n ||
      stateInfo.size > BigInt(MAX_STATE_BYTES)
    ) {
      throw setupStateError('setup_state_file_untrusted');
    }

    const bytes = this.fs.readFileSync(this.statePath);
    if (bytes.byteLength > MAX_STATE_BYTES) {
      throw setupStateError('setup_state_invalid');
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw setupStateError('setup_state_invalid');
    }
    if (isLegacySetupState(parsed)) {
      // Old account/token readiness cannot stand in for an AppContainer
      // profile. Reset only the app-owned readiness record; never delete OS
      // accounts or infer that the new isolation path is ready.
      return unconfiguredWindowsRunnerSetupState();
    }
    return validateWindowsRunnerSetupState(parsed);
  }

  transact(transition) {
    if (typeof transition !== 'function') {
      return Promise.reject(setupStateError('setup_state_transition_invalid'));
    }
    const run = this.#tail.then(
      () => this.#runTransaction(transition),
      () => this.#runTransaction(transition),
    );
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #runTransaction(transition) {
    const current = this.load();
    const next = validateWindowsRunnerSetupState(transition(current));
    if (next.revision !== current.revision + 1) {
      throw setupStateError('setup_state_revision_invalid');
    }
    this.#writeAtomic(next);
    return next;
  }

  #writeAtomic(state) {
    validateWindowsRunnerSetupState(state);
    this.fs.mkdirSync(this.userDataPath, { recursive: true });
    if (!this.#directoryExistsSafely(this.userDataPath)) {
      throw setupStateError('setup_state_directory_untrusted');
    }
    this.fs.mkdirSync(this.directoryPath, { recursive: true });
    if (!this.#directoryExistsSafely(this.directoryPath)) {
      throw setupStateError('setup_state_directory_untrusted');
    }

    const temporaryPath = this.path.join(
      this.directoryPath,
      `.setup-state-${process.pid}-${crypto.randomUUID()}.tmp`,
    );
    const descriptor = this.fs.openSync(temporaryPath, 'wx', 0o600);
    try {
      this.fs.writeFileSync(
        descriptor,
        Buffer.from(`${JSON.stringify(state)}\n`, 'utf8'),
      );
      this.fs.fsyncSync(descriptor);
    } catch (error) {
      this.fs.closeSync(descriptor);
      this.fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
    this.fs.closeSync(descriptor);

    try {
      this.fs.renameSync(temporaryPath, this.statePath);
    } catch (error) {
      this.fs.rmSync(temporaryPath, { force: true });
      throw error;
    }

    const stateInfo = this.fs.lstatSync(this.statePath, { bigint: true });
    if (
      !stateInfo.isFile() ||
      stateInfo.isSymbolicLink() ||
      stateInfo.nlink !== 1n
    ) {
      throw setupStateError('setup_state_file_untrusted');
    }
  }

  #directoryExistsSafely(directoryPath) {
    let info;
    try {
      info = this.fs.lstatSync(directoryPath);
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw setupStateError('setup_state_directory_untrusted');
    }
    return true;
  }
}

function validateOperationId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw setupStateError('setup_operation_id_invalid');
  }
}

export function isValidWindowsRunnerPackageSid(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 184) {
    return false;
  }
  const match =
    /^S-1-15-2-((?:0|[1-9][0-9]{0,9})(?:-(?:0|[1-9][0-9]{0,9})){6})$/u.exec(
      value,
    );
  return Boolean(
    match && match[1].split('-').every((part) => BigInt(part) <= 0xffff_ffffn),
  );
}

function nextRevision(revision) {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw setupStateError('setup_state_revision_exhausted');
  }
  return revision + 1;
}

function assertExactKeys(value, expectedKeys) {
  if (!hasExactKeys(value, expectedKeys)) {
    throw setupStateError('setup_state_invalid');
  }
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return !(
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  );
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLegacySetupState(value) {
  if (!isRecord(value) || ![1, 2].includes(value.version)) return false;
  if (
    value.status === 'unconfigured' &&
    hasExactKeys(value, ['version', 'revision', 'status'])
  ) {
    return value.revision === 0;
  }
  if (
    value.status === 'repair_required' &&
    hasExactKeys(value, [
      'version',
      'revision',
      'status',
      'operationId',
      'stage',
      'reasonCode',
    ])
  ) {
    return (
      Number.isSafeInteger(value.revision) &&
      value.revision > 0 &&
      /^[A-Za-z0-9_-]{1,128}$/u.test(value.operationId) &&
      (value.version === 1
        ? ['account', 'credentials', 'filesystem', 'network', 'verify']
        : ['profile', 'verify']
      ).includes(value.stage) &&
      (value.reasonCode === null ||
        (typeof value.reasonCode === 'string' &&
          /^[a-z0-9_]{1,96}$/u.test(value.reasonCode)))
    );
  }
  if (
    value.status === 'ready' &&
    value.version === 2 &&
    hasExactKeys(value, [
      'version',
      'revision',
      'status',
      'operationId',
      'packageSid',
    ])
  ) {
    return (
      Number.isSafeInteger(value.revision) &&
      value.revision > 0 &&
      /^[A-Za-z0-9_-]{1,128}$/u.test(value.operationId) &&
      isValidWindowsRunnerPackageSid(value.packageSid)
    );
  }
  if (
    value.status === 'ready' &&
    value.version === 1 &&
    hasExactKeys(value, [
      'version',
      'revision',
      'status',
      'operationId',
      'identitySid',
    ])
  ) {
    return (
      Number.isSafeInteger(value.revision) &&
      value.revision > 0 &&
      /^[A-Za-z0-9_-]{1,128}$/u.test(value.operationId) &&
      typeof value.identitySid === 'string' &&
      /^S-1-5-21-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})$/u.test(
        value.identitySid,
      )
    );
  }
  return false;
}

function setupStateError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
