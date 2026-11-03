import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const WINDOWS_RUNNER_ACL_JOURNAL_VERSION = 3;
const MAX_JOURNAL_BYTES = 32 * 1024;
const MAX_GRANTS = 37;
const MAX_OBJECTS_PER_GRANT = 1_000_001;
const MAX_VOLUME_SERIAL = 4_294_967_295n;
const MAX_FILE_INDEX = 18_446_744_073_709_551_615n;

export function emptyWindowsRunnerAclJournal() {
  return {
    version: WINDOWS_RUNNER_ACL_JOURNAL_VERSION,
    revision: 0,
    status: 'clean',
  };
}

export function beginWindowsRunnerAclTransaction(state, operationId, grants) {
  validateWindowsRunnerAclJournal(state);
  validateOperationId(operationId);
  if (state.status !== 'clean') {
    throw aclJournalError('acl_recovery_required');
  }
  const validatedGrants = validateGrants(grants);
  return {
    version: WINDOWS_RUNNER_ACL_JOURNAL_VERSION,
    revision: nextRevision(state.revision),
    status: 'repair_required',
    operationId,
    phase: 'applying',
    grants: validatedGrants,
  };
}

export function markWindowsRunnerAclTransactionVerified(
  state,
  operationId,
  evidence,
) {
  validateWindowsRunnerAclJournal(state);
  if (
    state.status !== 'repair_required' ||
    state.operationId !== operationId ||
    state.phase !== 'applying'
  ) {
    throw aclJournalError('acl_state_transition_invalid');
  }
  const verifiedGrants = validateVerification(state.grants, evidence);
  return {
    ...state,
    revision: nextRevision(state.revision),
    phase: 'verified',
    verifiedGrants,
  };
}

export function refreshWindowsRunnerAclTransactionVerified(
  state,
  operationId,
  evidence,
) {
  validateWindowsRunnerAclJournal(state);
  if (
    state.status !== 'repair_required' ||
    state.operationId !== operationId ||
    state.phase !== 'verified'
  ) {
    throw aclJournalError('acl_state_transition_invalid');
  }
  const verifiedGrants = validateVerification(state.grants, evidence);
  return {
    ...state,
    revision: nextRevision(state.revision),
    verifiedGrants,
  };
}

export function completeWindowsRunnerAclTransaction(
  state,
  operationId,
  liveEvidence,
) {
  validateWindowsRunnerAclJournal(state);
  if (
    state.status !== 'repair_required' ||
    state.operationId !== operationId ||
    state.phase !== 'verified'
  ) {
    throw aclJournalError('acl_state_transition_invalid');
  }
  const liveVerifiedGrants = validateVerification(state.grants, liveEvidence);
  if (!sameVerifiedGrants(state.verifiedGrants, liveVerifiedGrants)) {
    throw aclJournalError('acl_live_verification_mismatch');
  }
  return {
    version: WINDOWS_RUNNER_ACL_JOURNAL_VERSION,
    revision: nextRevision(state.revision),
    status: 'clean',
  };
}

export function validateWindowsRunnerAclJournal(value) {
  if (
    !isRecord(value) ||
    value.version !== WINDOWS_RUNNER_ACL_JOURNAL_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  ) {
    throw aclJournalError('acl_journal_invalid');
  }
  if (value.status === 'clean') {
    assertExactKeys(value, ['version', 'revision', 'status']);
    return value;
  }
  if (value.status === 'repair_required') {
    const expectedKeys = [
      'version',
      'revision',
      'status',
      'operationId',
      'phase',
      'grants',
    ];
    if (value.phase === 'verified') expectedKeys.push('verifiedGrants');
    assertExactKeys(value, expectedKeys);
    validateOperationId(value.operationId);
    if (
      value.revision === 0 ||
      !['applying', 'verified'].includes(value.phase)
    ) {
      throw aclJournalError('acl_journal_invalid');
    }
    const grants = validateGrants(value.grants);
    if (value.phase === 'verified') {
      const verifiedGrants = validateVerification(grants, value.verifiedGrants);
      if (!sameVerifiedGrants(value.verifiedGrants, verifiedGrants)) {
        throw aclJournalError('acl_journal_invalid');
      }
    }
    return value;
  }
  throw aclJournalError('acl_journal_invalid');
}

export function admitsWindowsRunnerAclJournal(value) {
  try {
    validateWindowsRunnerAclJournal(value);
  } catch {
    return false;
  }
  return value.status === 'clean';
}

/**
 * Main-process durable owner for the ACL batch that the helper may be applying.
 * Persist `repair_required` before any helper ACL call. A pending record blocks
 * another batch until the helper has revalidated every recorded root and the
 * main process has completed the journal transition.
 */
export class WindowsRunnerAclJournalStore {
  constructor({ userDataPath, fsImpl = fs, pathImpl = path }) {
    if (
      typeof userDataPath !== 'string' ||
      !pathImpl.isAbsolute(userDataPath)
    ) {
      throw aclJournalError('acl_journal_path_invalid');
    }
    this.fs = fsImpl;
    this.path = pathImpl;
    this.userDataPath = pathImpl.resolve(userDataPath);
    this.directoryPath = pathImpl.join(this.userDataPath, 'windows-runner');
    this.journalPath = pathImpl.join(this.directoryPath, 'acl-journal.json');
  }

  load() {
    if (!this.#directoryExistsSafely(this.userDataPath)) {
      return emptyWindowsRunnerAclJournal();
    }
    if (!this.#directoryExistsSafely(this.directoryPath)) {
      return emptyWindowsRunnerAclJournal();
    }
    let info;
    try {
      info = this.fs.lstatSync(this.journalPath, { bigint: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyWindowsRunnerAclJournal();
      throw aclJournalError('acl_journal_unavailable');
    }
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1n ||
      info.size > BigInt(MAX_JOURNAL_BYTES)
    ) {
      throw aclJournalError('acl_journal_untrusted');
    }
    let value;
    try {
      const bytes = this.fs.readFileSync(this.journalPath);
      if (bytes.byteLength > MAX_JOURNAL_BYTES) {
        throw aclJournalError('acl_journal_invalid');
      }
      value = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      if (error?.code?.startsWith('acl_')) throw error;
      throw aclJournalError('acl_journal_invalid');
    }
    return validateWindowsRunnerAclJournal(value);
  }

  begin(operationId, grants) {
    const current = this.load();
    return this.#commit(
      beginWindowsRunnerAclTransaction(current, operationId, grants),
      current,
    );
  }

  markVerified(operationId, evidence) {
    const current = this.load();
    return this.#commit(
      markWindowsRunnerAclTransactionVerified(current, operationId, evidence),
      current,
    );
  }

  refreshVerified(operationId, evidence) {
    const current = this.load();
    return this.#commit(
      refreshWindowsRunnerAclTransactionVerified(
        current,
        operationId,
        evidence,
      ),
      current,
    );
  }

  complete(operationId, liveEvidence) {
    const current = this.load();
    return this.#commit(
      completeWindowsRunnerAclTransaction(current, operationId, liveEvidence),
      current,
    );
  }

  #commit(next, current) {
    validateWindowsRunnerAclJournal(next);
    if (next.revision !== current.revision + 1) {
      throw aclJournalError('acl_journal_revision_invalid');
    }
    this.#writeAtomic(next);
    return next;
  }

  #writeAtomic(value) {
    validateWindowsRunnerAclJournal(value);
    this.fs.mkdirSync(this.userDataPath, { recursive: true });
    this.#requireDirectory(this.userDataPath);
    this.fs.mkdirSync(this.directoryPath, { recursive: true });
    this.#requireDirectory(this.directoryPath);
    const temporaryPath = this.path.join(
      this.directoryPath,
      `.acl-journal-${process.pid}-${crypto.randomUUID()}.tmp`,
    );
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
    if (bytes.byteLength > MAX_JOURNAL_BYTES) {
      throw aclJournalError('acl_journal_invalid');
    }
    const descriptor = this.fs.openSync(temporaryPath, 'wx', 0o600);
    try {
      this.fs.writeFileSync(descriptor, bytes);
      this.fs.fsyncSync(descriptor);
    } catch (error) {
      this.fs.closeSync(descriptor);
      this.fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
    this.fs.closeSync(descriptor);
    try {
      this.fs.renameSync(temporaryPath, this.journalPath);
    } catch {
      this.fs.rmSync(temporaryPath, { force: true });
      throw aclJournalError('acl_journal_persist_failed');
    }
    const info = this.fs.lstatSync(this.journalPath, { bigint: true });
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1n ||
      info.size > BigInt(MAX_JOURNAL_BYTES)
    ) {
      throw aclJournalError('acl_journal_untrusted');
    }
  }

  #directoryExistsSafely(directoryPath) {
    try {
      this.#requireDirectory(directoryPath);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  #requireDirectory(directoryPath) {
    const info = this.fs.lstatSync(directoryPath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw aclJournalError('acl_journal_directory_untrusted');
    }
  }
}

function validateGrants(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_GRANTS
  ) {
    throw aclJournalError('acl_grants_invalid');
  }
  const seenIdentities = new Set();
  const seenPaths = new Set();
  return value.map((grant) => {
    if (
      !isRecord(grant) ||
      !hasExactKeys(grant, [
        'path',
        'fileIdentity',
        'capabilityName',
        'access',
        'isDirectory',
      ]) ||
      !isValidLocalPath(grant.path) ||
      !isValidIdentity(grant.fileIdentity) ||
      !isWindowsRunnerCapabilityName(grant.capabilityName) ||
      !['read', 'write'].includes(grant.access) ||
      !grant.capabilityName.startsWith(
        `Noema.${grant.access === 'read' ? 'Read' : 'Write'}.`,
      ) ||
      typeof grant.isDirectory !== 'boolean'
    ) {
      throw aclJournalError('acl_grants_invalid');
    }
    const identity = `${grant.fileIdentity.volumeSerialNumber}:${grant.fileIdentity.fileIndex}`;
    const pathKey = grant.path.toLowerCase();
    if (seenIdentities.has(identity) || seenPaths.has(pathKey)) {
      throw aclJournalError('acl_grants_invalid');
    }
    seenIdentities.add(identity);
    seenPaths.add(pathKey);
    return {
      path: grant.path,
      fileIdentity: {
        volumeSerialNumber: grant.fileIdentity.volumeSerialNumber,
        fileIndex: grant.fileIdentity.fileIndex,
      },
      capabilityName: grant.capabilityName,
      access: grant.access,
      isDirectory: grant.isDirectory,
    };
  });
}

function validateVerification(grants, evidence) {
  if (!Array.isArray(evidence) || evidence.length !== grants.length) {
    throw aclJournalError('acl_live_verification_incomplete');
  }
  const byIdentity = new Map(
    grants.map((grant) => [
      `${grant.fileIdentity.volumeSerialNumber}:${grant.fileIdentity.fileIndex}`,
      grant,
    ]),
  );
  const actual = evidence
    .map((entry) => {
      if (
        !isRecord(entry) ||
        !hasExactKeys(entry, [
          'volumeSerialNumber',
          'fileIndex',
          'capabilityName',
          'access',
          'objectCount',
          'aclVerifiedCount',
          'treeDigest',
          'inheritanceVerified',
        ]) ||
        !isValidIdentity({
          volumeSerialNumber: entry.volumeSerialNumber,
          fileIndex: entry.fileIndex,
        }) ||
        !isWindowsRunnerCapabilityName(entry.capabilityName) ||
        !['read', 'write'].includes(entry.access) ||
        !entry.capabilityName.startsWith(
          `Noema.${entry.access === 'read' ? 'Read' : 'Write'}.`,
        ) ||
        !Number.isSafeInteger(entry.objectCount) ||
        entry.objectCount < 1 ||
        entry.objectCount > MAX_OBJECTS_PER_GRANT ||
        entry.aclVerifiedCount !== entry.objectCount ||
        !/^[a-f0-9]{64}$/u.test(entry.treeDigest) ||
        typeof entry.inheritanceVerified !== 'boolean'
      ) {
        throw aclJournalError('acl_live_verification_invalid');
      }
      const identity = `${entry.volumeSerialNumber}:${entry.fileIndex}`;
      const grant = byIdentity.get(identity);
      if (
        !grant ||
        grant.capabilityName !== entry.capabilityName ||
        grant.access !== entry.access ||
        entry.inheritanceVerified !== grant.isDirectory
      ) {
        throw aclJournalError('acl_live_verification_mismatch');
      }
      return {
        volumeSerialNumber: entry.volumeSerialNumber,
        fileIndex: entry.fileIndex,
        capabilityName: entry.capabilityName,
        access: entry.access,
        objectCount: entry.objectCount,
        aclVerifiedCount: entry.aclVerifiedCount,
        treeDigest: entry.treeDigest,
        inheritanceVerified: entry.inheritanceVerified,
      };
    })
    .sort((left, right) => {
      const leftKey = identityKey(left);
      const rightKey = identityKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  const actualIdentities = actual.map(identityKey);
  const expectedIdentities = [...byIdentity.keys()].sort();
  if (
    expectedIdentities.some((value, index) => value !== actualIdentities[index])
  ) {
    throw aclJournalError('acl_live_verification_mismatch');
  }
  return actual;
}

function verificationKey(value) {
  return JSON.stringify(value);
}

function identityKey(value) {
  return `${value.volumeSerialNumber}:${value.fileIndex}`;
}

function sameVerifiedGrants(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  const expected = left.map(verificationKey).sort();
  const actual = right.map(verificationKey).sort();
  return expected.every((value, index) => value === actual[index]);
}

function isValidIdentity(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['volumeSerialNumber', 'fileIndex']) &&
    isBoundedIntegerString(value.volumeSerialNumber, MAX_VOLUME_SERIAL) &&
    isBoundedIntegerString(value.fileIndex, MAX_FILE_INDEX)
  );
}

function isValidLocalPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1_000 ||
    !path.win32.isAbsolute(value) ||
    value.startsWith('\\\\') ||
    value.startsWith('\\\\?\\') ||
    value.startsWith('\\\\.\\')
  ) {
    return false;
  }
  const normalized = path.win32.normalize(value);
  const root = path.win32.parse(normalized).root;
  if (
    normalized.toLowerCase() !== value.toLowerCase() ||
    normalized.toLowerCase() === root.toLowerCase()
  ) {
    return false;
  }
  return !value
    .slice(3)
    .split('\\')
    .some((component) => {
      const deviceStem = component
        .split('.', 1)[0]
        .replace(/[ .]+$/gu, '')
        .toUpperCase();
      return (
        component === '.' ||
        component === '..' ||
        component.endsWith('.') ||
        component.endsWith(' ') ||
        /[<>:"|?*]/u.test(component) ||
        [...component].some((character) => character.charCodeAt(0) < 32) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/u.test(deviceStem)
      );
    });
}

function isBoundedIntegerString(value, maximum) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <= maximum;
  } catch {
    return false;
  }
}

function validateOperationId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(value)) {
    throw aclJournalError('acl_operation_id_invalid');
  }
}

function nextRevision(revision) {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw aclJournalError('acl_journal_revision_exhausted');
  }
  return revision + 1;
}

function assertExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw aclJournalError('acl_journal_invalid');
  }
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWindowsRunnerCapabilityName(value) {
  return (
    typeof value === 'string' &&
    /^Noema\.(?:Read|Write)\.[a-f0-9]{64}$/u.test(value)
  );
}

function aclJournalError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
