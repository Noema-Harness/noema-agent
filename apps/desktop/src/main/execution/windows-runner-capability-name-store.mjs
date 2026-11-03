import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const WINDOWS_RUNNER_CAPABILITY_RECORD_VERSION = 3;
export const WINDOWS_RUNNER_CAPABILITY_ACCESS = Object.freeze({
  READ: 'read',
  WRITE: 'write',
});
const MAX_RECORD_BYTES = 1_024;
const MAX_VOLUME_SERIAL = 4_294_967_295n;
const MAX_FILE_INDEX = 18_446_744_073_709_551_615n;

/**
 * Persist deterministic AppContainer capability names by verified filesystem
 * object identity. Native code resolves each name to its Windows capability
 * SID. The names never enter renderer/agent IPC or diagnostics.
 */
export class WindowsRunnerCapabilityNameStore {
  constructor({
    userDataPath,
    fsImpl = fs,
    pathImpl = path,
    cryptoImpl = crypto,
  }) {
    if (
      typeof userDataPath !== 'string' ||
      !pathImpl.isAbsolute(userDataPath)
    ) {
      throw capabilityStoreError('capability_sid_path_invalid');
    }
    this.fs = fsImpl;
    this.path = pathImpl;
    this.crypto = cryptoImpl;
    this.userDataPath = pathImpl.resolve(userDataPath);
    this.runnerDirectoryPath = pathImpl.join(
      this.userDataPath,
      'windows-runner',
    );
    this.recordsDirectoryPath = pathImpl.join(
      this.runnerDirectoryPath,
      'capabilities',
    );
  }

  getOrCreate(fileIdentity, access) {
    const identity = validateFileIdentity(fileIdentity);
    if (!Object.values(WINDOWS_RUNNER_CAPABILITY_ACCESS).includes(access)) {
      throw capabilityStoreError('capability_sid_access_invalid');
    }
    this.#ensureDirectories();
    const recordPath = this.#recordPath(identity, access);
    const existing = this.#readRecord(recordPath, identity, access);
    if (existing) return existing.capabilityName;

    const capabilityName = this.#newName(identity, access);
    const record = {
      version: WINDOWS_RUNNER_CAPABILITY_RECORD_VERSION,
      access,
      volumeSerialNumber: identity.volumeSerialNumber,
      fileIndex: identity.fileIndex,
      capabilityName,
    };
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
    if (bytes.byteLength > MAX_RECORD_BYTES) {
      throw capabilityStoreError('capability_sid_record_invalid');
    }

    let descriptor;
    try {
      descriptor = this.fs.openSync(recordPath, 'wx', 0o600);
      this.fs.writeFileSync(descriptor, bytes);
      this.fs.fsyncSync(descriptor);
      this.fs.closeSync(descriptor);
      descriptor = undefined;
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          this.fs.closeSync(descriptor);
        } catch {}
      }
      if (error?.code === 'EEXIST') {
        const concurrent = this.#readRecord(recordPath, identity, access);
        if (concurrent) return concurrent.capabilityName;
      } else {
        try {
          this.fs.rmSync(recordPath, { force: true });
        } catch {}
      }
      throw capabilityStoreError(
        error?.code === 'EEXIST'
          ? 'capability_sid_record_untrusted'
          : 'capability_sid_persist_failed',
      );
    }

    const persisted = this.#readRecord(recordPath, identity, access);
    if (!persisted || persisted.capabilityName !== capabilityName) {
      throw capabilityStoreError('capability_sid_record_untrusted');
    }
    return capabilityName;
  }

  #recordPath(identity, access) {
    const key = `${identity.volumeSerialNumber}:${identity.fileIndex}:${access}`;
    const digest = this.crypto.createHash('sha256').update(key).digest('hex');
    return this.path.join(this.recordsDirectoryPath, `${digest}.json`);
  }

  #newName(identity, access) {
    const key = `${identity.volumeSerialNumber}:${identity.fileIndex}:${access}`;
    const digest = this.crypto.createHash('sha256').update(key).digest('hex');
    const mode =
      access === WINDOWS_RUNNER_CAPABILITY_ACCESS.READ ? 'Read' : 'Write';
    return `Noema.${mode}.${digest}`;
  }

  #readRecord(recordPath, identity, access) {
    let info;
    try {
      info = this.fs.lstatSync(recordPath, { bigint: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined;
      throw capabilityStoreError('capability_sid_record_unavailable');
    }
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1n ||
      info.size > BigInt(MAX_RECORD_BYTES)
    ) {
      throw capabilityStoreError('capability_sid_record_untrusted');
    }

    let record;
    try {
      const bytes = this.fs.readFileSync(recordPath);
      if (bytes.byteLength > MAX_RECORD_BYTES) {
        throw capabilityStoreError('capability_sid_record_invalid');
      }
      record = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      if (error?.code?.startsWith('capability_sid_')) throw error;
      throw capabilityStoreError('capability_sid_record_invalid');
    }
    if (
      !isRecord(record) ||
      !hasExactKeys(record, [
        'version',
        'access',
        'volumeSerialNumber',
        'fileIndex',
        'capabilityName',
      ]) ||
      record.version !== WINDOWS_RUNNER_CAPABILITY_RECORD_VERSION ||
      record.access !== access ||
      record.volumeSerialNumber !== identity.volumeSerialNumber ||
      record.fileIndex !== identity.fileIndex ||
      !isCapabilityName(record.capabilityName) ||
      record.capabilityName !== this.#newName(identity, access)
    ) {
      throw capabilityStoreError('capability_sid_record_invalid');
    }
    return { capabilityName: record.capabilityName };
  }

  #ensureDirectories() {
    for (const directory of [
      this.userDataPath,
      this.runnerDirectoryPath,
      this.recordsDirectoryPath,
    ]) {
      let info;
      try {
        info = this.fs.lstatSync(directory);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw capabilityStoreError('capability_sid_directory_untrusted');
        }
        try {
          this.fs.mkdirSync(directory);
        } catch (createError) {
          if (createError?.code !== 'EEXIST') {
            throw capabilityStoreError('capability_sid_directory_unavailable');
          }
        }
        try {
          info = this.fs.lstatSync(directory);
        } catch {
          throw capabilityStoreError('capability_sid_directory_unavailable');
        }
      }
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw capabilityStoreError('capability_sid_directory_untrusted');
      }
    }
  }
}

function isCapabilityName(value) {
  return (
    typeof value === 'string' &&
    /^Noema\.(?:Read|Write)\.[a-f0-9]{64}$/u.test(value)
  );
}

function validateFileIdentity(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['volumeSerialNumber', 'fileIndex']) ||
    !isBoundedIntegerString(value.volumeSerialNumber, MAX_VOLUME_SERIAL) ||
    !isBoundedIntegerString(value.fileIndex, MAX_FILE_INDEX)
  ) {
    throw capabilityStoreError('capability_sid_identity_invalid');
  }
  return value;
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

function capabilityStoreError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
