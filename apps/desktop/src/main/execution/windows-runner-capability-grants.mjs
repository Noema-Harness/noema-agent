import path from 'node:path';
import { stat as defaultStat } from 'node:fs/promises';
import { WINDOWS_RUNNER_POLICY_VERSION } from './windows-runner-package-contract.mjs';

const MAX_READ_ROOTS = 37;
const MAX_WRITE_ROOTS = 5;

/**
 * Bind the trusted compiled policy to one persisted capability name per
 * effective filesystem root. A root present in writeRoots receives only its
 * write-mode SID; every other read root receives a read-mode SID.
 */
export async function createWindowsRunnerCapabilityGrants(
  policy,
  { capabilityNameStore, statPath = defaultStat } = {},
) {
  if (
    !policy ||
    typeof policy !== 'object' ||
    policy.version !== WINDOWS_RUNNER_POLICY_VERSION ||
    !policy.filesystem ||
    !['read-only', 'read-write'].includes(policy.filesystem.mode) ||
    policy.filesystem.defaultDeny !== true ||
    !Array.isArray(policy.filesystem.readRoots) ||
    !Array.isArray(policy.filesystem.writeRoots) ||
    policy.filesystem.readRoots.length === 0 ||
    policy.filesystem.readRoots.length > MAX_READ_ROOTS ||
    (policy.filesystem.mode === 'read-only' &&
      policy.filesystem.writeRoots.length !== 0) ||
    (policy.filesystem.mode === 'read-write' &&
      policy.filesystem.writeRoots.length === 0) ||
    policy.filesystem.writeRoots.length > MAX_WRITE_ROOTS ||
    !capabilityNameStore ||
    typeof capabilityNameStore.getOrCreate !== 'function' ||
    typeof statPath !== 'function'
  ) {
    return denied('capability_grant_policy_invalid');
  }

  const readRoots = new Map();
  const writeRoots = new Map();
  if (!indexRoots(policy.filesystem.readRoots, readRoots)) {
    return denied('capability_grant_policy_invalid');
  }
  if (!indexRoots(policy.filesystem.writeRoots, writeRoots)) {
    return denied('capability_grant_policy_invalid');
  }
  for (const [key, root] of writeRoots) {
    const readRoot = readRoots.get(key);
    if (!readRoot || !sameIdentity(root.fileIdentity, readRoot.fileIdentity)) {
      return denied('capability_grant_policy_invalid');
    }
  }

  const planned = [];
  const identities = new Set();
  for (const [key, root] of readRoots) {
    let info;
    try {
      info = await statPath(root.path, { bigint: true });
    } catch {
      return denied('path_identity_unavailable');
    }
    const isDirectory = info?.isDirectory?.() === true;
    const isFile = info?.isFile?.() === true;
    const identity = {
      volumeSerialNumber: decimal(info?.dev),
      fileIndex: decimal(info?.ino),
    };
    if (
      isDirectory === isFile ||
      !identity.volumeSerialNumber ||
      !identity.fileIndex ||
      !sameIdentity(identity, root.fileIdentity)
    ) {
      return denied('path_identity_unavailable');
    }
    const identityKey = `${identity.volumeSerialNumber}:${identity.fileIndex}`;
    if (identities.has(identityKey)) {
      return denied('path_identity_alias');
    }
    identities.add(identityKey);
    planned.push({
      key,
      path: root.path,
      fileIdentity: identity,
      access: writeRoots.has(key) ? 'write' : 'read',
      isDirectory,
    });
  }

  const grants = [];
  const capabilityNames = new Set();
  try {
    for (const root of planned) {
      const capabilityName = capabilityNameStore.getOrCreate(
        root.fileIdentity,
        root.access,
      );
      if (
        typeof capabilityName !== 'string' ||
        !/^Noema\.(?:Read|Write)\.[a-f0-9]{64}$/u.test(capabilityName) ||
        capabilityNames.has(capabilityName)
      ) {
        return denied('capability_sid_record_invalid');
      }
      capabilityNames.add(capabilityName);
      grants.push({
        ...root,
        capabilityName,
      });
    }
  } catch (error) {
    return denied(
      typeof error?.code === 'string' &&
        /^capability_sid_[a-z0-9_]{1,80}$/u.test(error.code)
        ? error.code
        : 'capability_sid_unavailable',
    );
  }

  return {
    ok: true,
    grants: grants.map(({ key: _key, ...grant }) => grant),
  };
}

function indexRoots(roots, index) {
  for (const root of roots) {
    if (
      !root ||
      typeof root !== 'object' ||
      typeof root.path !== 'string' ||
      !path.win32.isAbsolute(root.path) ||
      root.path.startsWith('\\\\') ||
      root.path.startsWith('\\\\?\\') ||
      root.path.startsWith('\\\\.\\') ||
      !isIdentity(root.fileIdentity)
    ) {
      return false;
    }
    const normalized = path.win32.normalize(root.path);
    const key = normalized.toLowerCase();
    if (index.has(key)) return false;
    index.set(key, {
      path: normalized,
      fileIdentity: root.fileIdentity,
    });
  }
  return true;
}

function isIdentity(identity) {
  return (
    identity &&
    typeof identity === 'object' &&
    typeof identity.volumeSerialNumber === 'string' &&
    /^[1-9][0-9]{0,9}$/u.test(identity.volumeSerialNumber) &&
    BigInt(identity.volumeSerialNumber) <= 4_294_967_295n &&
    typeof identity.fileIndex === 'string' &&
    /^[1-9][0-9]{0,19}$/u.test(identity.fileIndex) &&
    BigInt(identity.fileIndex) <= 18_446_744_073_709_551_615n
  );
}

function decimal(value) {
  return typeof value === 'bigint' && value > 0n ? value.toString() : undefined;
}

function sameIdentity(left, right) {
  return (
    isIdentity(left) &&
    isIdentity(right) &&
    left.volumeSerialNumber === right.volumeSerialNumber &&
    left.fileIndex === right.fileIndex
  );
}

function denied(code) {
  return { ok: false, code };
}
