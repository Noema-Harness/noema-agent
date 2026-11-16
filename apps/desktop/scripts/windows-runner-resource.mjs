import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  WINDOWS_RUNNER_RESOURCE_NAME,
  WINDOWS_RUNNER_PACKAGE_MANIFEST,
  WINDOWS_RUNNER_BACKEND_ID,
  WINDOWS_RUNNER_BACKEND_VERSION,
  WINDOWS_RUNNER_POLICY_VERSION,
  WINDOWS_RUNNER_PROTOCOL_VERSION,
} from '../src/main/execution/windows-runner-package-contract.ts';

export {
  WINDOWS_RUNNER_RESOURCE_NAME,
  WINDOWS_RUNNER_PACKAGE_MANIFEST,
} from '../src/main/execution/windows-runner-package-contract.ts';

export async function stageWindowsRunnerResource({
  sourceExecutable,
  destinationDirectory,
  platform,
  arch,
  fsImpl = fs,
}) {
  if (platform !== 'win32') return null;
  if (arch !== 'x64') throw packageError('runner_package_arch_unsupported');

  const sourceStat = await fsImpl.lstat(sourceExecutable);
  if (
    !sourceStat.isFile() ||
    sourceStat.isSymbolicLink() ||
    sourceStat.size < 1_024 ||
    sourceStat.size > 64 * 1024 * 1024
  ) {
    throw packageError('runner_package_source_untrusted');
  }
  const contents = await fsImpl.readFile(sourceExecutable);
  const sha256 = createHash('sha256').update(contents).digest('hex');
  await fsImpl.mkdir(destinationDirectory, { recursive: true });

  const executablePath = path.join(
    destinationDirectory,
    WINDOWS_RUNNER_RESOURCE_NAME,
  );
  await fsImpl.copyFile(sourceExecutable, executablePath);
  const stagedStat = await fsImpl.lstat(executablePath);
  if (
    !stagedStat.isFile() ||
    stagedStat.isSymbolicLink() ||
    stagedStat.nlink !== 1
  ) {
    throw packageError('runner_package_copy_untrusted');
  }
  const copied = await fsImpl.readFile(executablePath);
  if (createHash('sha256').update(copied).digest('hex') !== sha256) {
    throw packageError('runner_package_copy_mismatch');
  }
  const manifest = {
    schemaVersion: 2,
    backendId: WINDOWS_RUNNER_BACKEND_ID,
    backendVersion: WINDOWS_RUNNER_BACKEND_VERSION,
    policyVersion: WINDOWS_RUNNER_POLICY_VERSION,
    protocolVersion: WINDOWS_RUNNER_PROTOCOL_VERSION,
    platform: 'win32',
    arch: 'x64',
    executable: WINDOWS_RUNNER_RESOURCE_NAME,
    sha256,
  };
  await fsImpl.writeFile(
    path.join(destinationDirectory, WINDOWS_RUNNER_PACKAGE_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  const entries = (await fsImpl.readdir(destinationDirectory)).sort();
  if (
    entries.length !== 2 ||
    entries[0] !== WINDOWS_RUNNER_RESOURCE_NAME ||
    entries[1] !== WINDOWS_RUNNER_PACKAGE_MANIFEST
  ) {
    throw packageError('runner_package_resource_set_invalid');
  }
  return manifest;
}

export function validateWindowsRunnerPackageManifest(manifest, expectedSha256) {
  return Boolean(
    manifest &&
    Object.keys(manifest).sort().join(',') ===
      'arch,backendId,backendVersion,executable,platform,policyVersion,protocolVersion,schemaVersion,sha256' &&
    manifest.schemaVersion === 2 &&
    manifest.backendId === WINDOWS_RUNNER_BACKEND_ID &&
    manifest.backendVersion === WINDOWS_RUNNER_BACKEND_VERSION &&
    manifest.policyVersion === WINDOWS_RUNNER_POLICY_VERSION &&
    manifest.protocolVersion === WINDOWS_RUNNER_PROTOCOL_VERSION &&
    manifest.platform === 'win32' &&
    manifest.arch === 'x64' &&
    manifest.executable === WINDOWS_RUNNER_RESOURCE_NAME &&
    manifest.sha256 === expectedSha256,
  );
}

function packageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
