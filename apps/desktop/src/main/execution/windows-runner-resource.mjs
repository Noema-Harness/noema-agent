import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  WINDOWS_RUNNER_BACKEND_ID,
  WINDOWS_RUNNER_BACKEND_VERSION,
  WINDOWS_RUNNER_POLICY_VERSION,
  WINDOWS_RUNNER_PACKAGE_MANIFEST,
  WINDOWS_RUNNER_PROTOCOL_VERSION,
  WINDOWS_RUNNER_RESOURCE_NAME,
} from './windows-runner-package-contract.mjs';

const NATIVE_RUNNER_FILENAME = WINDOWS_RUNNER_RESOURCE_NAME;
const MAX_NATIVE_RUNNER_BYTES = 64 * 1024 * 1024;

/**
 * Resolve only the app-owned packaged helper or this checkout's Cargo output.
 * @param {{platform?: string, arch?: string, isPackaged: boolean, resourcesPath?: string, appPath?: string, fsImpl?: typeof fs, pathImpl?: typeof path}} options
 */
export function resolveWindowsRunnerNativeHelper({
  platform = process.platform,
  arch = process.arch,
  isPackaged,
  resourcesPath = process.resourcesPath,
  appPath = process.cwd(),
  fsImpl = fs,
  pathImpl = path,
} = {}) {
  if (platform !== 'win32') {
    throw resourceError('runner_resource_platform_unsupported');
  }
  if (arch !== 'x64') {
    throw resourceError('runner_resource_architecture_unsupported');
  }
  if (typeof isPackaged !== 'boolean') {
    throw resourceError('runner_resource_configuration_invalid');
  }

  const candidates = isPackaged
    ? [
        typeof resourcesPath === 'string'
          ? pathImpl.join(
              resourcesPath,
              'windows-runner',
              NATIVE_RUNNER_FILENAME,
            )
          : null,
      ]
    : [
        typeof appPath === 'string'
          ? pathImpl.join(
              appPath,
              'native',
              'windows-runner',
              'target',
              'x86_64-pc-windows-msvc',
              'release',
              NATIVE_RUNNER_FILENAME,
            )
          : null,
      ];

  const candidate = candidates.find(
    (value) => typeof value === 'string' && pathImpl.isAbsolute(value),
  );
  if (!candidate) throw resourceError('runner_resource_missing');

  let info;
  try {
    info = fsImpl.lstatSync(candidate, { bigint: true });
  } catch {
    throw resourceError('runner_resource_missing');
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1n ||
    info.size < 1_024n ||
    info.size > BigInt(MAX_NATIVE_RUNNER_BYTES)
  ) {
    throw resourceError('runner_resource_untrusted');
  }
  if (isPackaged) {
    verifyPackagedRunnerManifest({
      resourceDirectory: pathImpl.dirname(candidate),
      executablePath: candidate,
      fsImpl,
      pathImpl,
    });
  }
  return candidate;
}

function verifyPackagedRunnerManifest({
  resourceDirectory,
  executablePath,
  fsImpl,
  pathImpl,
}) {
  const manifestPath = pathImpl.join(
    resourceDirectory,
    WINDOWS_RUNNER_PACKAGE_MANIFEST,
  );
  let manifest;
  let manifestInfo;
  let entries;
  try {
    manifestInfo = fsImpl.lstatSync(manifestPath, { bigint: true });
    if (
      !manifestInfo.isFile() ||
      manifestInfo.isSymbolicLink() ||
      manifestInfo.nlink !== 1n ||
      manifestInfo.size > 8_192n
    ) {
      throw resourceError('runner_manifest_untrusted');
    }
    manifest = JSON.parse(fsImpl.readFileSync(manifestPath, 'utf8'));
    entries = fsImpl.readdirSync(resourceDirectory).sort();
  } catch (error) {
    if (error?.code?.startsWith('runner_')) throw error;
    throw resourceError('runner_manifest_missing_or_invalid');
  }
  if (
    entries.length !== 2 ||
    entries[0] !== WINDOWS_RUNNER_RESOURCE_NAME ||
    entries[1] !== WINDOWS_RUNNER_PACKAGE_MANIFEST
  ) {
    throw resourceError('runner_package_resource_set_invalid');
  }
  const executableHash = createHash('sha256')
    .update(fsImpl.readFileSync(executablePath))
    .digest('hex');
  const expectedKeys = [
    'arch',
    'backendId',
    'backendVersion',
    'executable',
    'platform',
    'policyVersion',
    'protocolVersion',
    'schemaVersion',
    'sha256',
  ];
  const keys =
    manifest && typeof manifest === 'object'
      ? Object.keys(manifest).sort()
      : [];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    manifest.schemaVersion !== 2 ||
    manifest.backendId !== WINDOWS_RUNNER_BACKEND_ID ||
    manifest.backendVersion !== WINDOWS_RUNNER_BACKEND_VERSION ||
    manifest.policyVersion !== WINDOWS_RUNNER_POLICY_VERSION ||
    manifest.protocolVersion !== WINDOWS_RUNNER_PROTOCOL_VERSION ||
    manifest.platform !== 'win32' ||
    manifest.arch !== 'x64' ||
    manifest.executable !== WINDOWS_RUNNER_RESOURCE_NAME ||
    manifest.sha256 !== executableHash
  ) {
    throw resourceError('runner_manifest_mismatch');
  }
}

function resourceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
