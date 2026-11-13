import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveWindowsRunnerNativeHelper } from '../../../src/main/execution/windows-runner-resource.ts';
import { stageWindowsRunnerResource } from '../../../scripts/windows-runner-resource.mjs';

function resourceStat(overrides = {}) {
  return {
    isFile: () => true,
    isSymbolicLink: () => false,
    nlink: 1n,
    size: 2_000_000n,
    ...overrides,
  };
}

test('packaged Windows runner resolves only the fixed resources path with a matching manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'noema-runner-package-'));
  const resourcesPath = path.join(root, 'resources');
  const packageDir = path.join(resourcesPath, 'windows-runner');
  const sourceDirectory = path.join(root, 'native');
  const source = path.join(sourceDirectory, 'noema-windows-runner.exe');
  try {
    await mkdir(sourceDirectory);
    await writeFile(source, Buffer.alloc(4_096, 7));
    await stageWindowsRunnerResource({
      sourceExecutable: source,
      destinationDirectory: packageDir,
      platform: 'win32',
      arch: 'x64',
    });
    assert.equal(
      resolveWindowsRunnerNativeHelper({
        platform: 'win32',
        arch: 'x64',
        isPackaged: true,
        resourcesPath,
      }),
      path.join(packageDir, 'noema-windows-runner.exe'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('development Windows runner resolves the fixed Cargo release output', () => {
  assert.equal(
    resolveWindowsRunnerNativeHelper({
      platform: 'win32',
      arch: 'x64',
      isPackaged: false,
      appPath: 'C:\\Noema\\app',
      fsImpl: { lstatSync: () => resourceStat() },
      pathImpl: path.win32,
    }),
    'C:\\Noema\\app\\native\\windows-runner\\target\\x86_64-pc-windows-msvc\\release\\noema-windows-runner.exe',
  );
});

test('runner resource rejects unsupported platform, architecture, and missing file', () => {
  const resolve = (overrides = {}, stat = resourceStat()) =>
    resolveWindowsRunnerNativeHelper({
      platform: 'win32',
      arch: 'x64',
      isPackaged: false,
      appPath: 'C:\\Noema\\app',
      fsImpl: { lstatSync: () => stat },
      pathImpl: path.win32,
      ...overrides,
    });
  assert.throws(() => resolve({ arch: 'arm64' }), {
    code: 'runner_resource_architecture_unsupported',
  });
  assert.throws(() => resolve({ platform: 'linux' }), {
    code: 'runner_resource_platform_unsupported',
  });
  assert.throws(
    () =>
      resolve({
        fsImpl: {
          lstatSync: () => {
            throw new Error('missing');
          },
        },
      }),
    { code: 'runner_resource_missing' },
  );
  for (const stat of [
    resourceStat({ isFile: () => false }),
    resourceStat({ isSymbolicLink: () => true }),
    resourceStat({ nlink: 2n }),
    resourceStat({ size: 10n }),
    resourceStat({ size: 70_000_000n }),
  ]) {
    assert.throws(() => resolve({}, stat), {
      code: 'runner_resource_untrusted',
    });
  }
});

test('packaged runner rejects missing/mismatched manifest and extra resources', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'noema-runner-manifest-'));
  const resourceDirectory = path.join(root, 'windows-runner');
  const source = path.join(root, 'native.exe');
  const resolve = () =>
    resolveWindowsRunnerNativeHelper({
      platform: 'win32',
      arch: 'x64',
      isPackaged: true,
      resourcesPath: root,
    });
  try {
    await mkdir(resourceDirectory);
    await writeFile(source, Buffer.alloc(4_096, 9));
    await writeFile(
      path.join(resourceDirectory, 'noema-windows-runner.exe'),
      Buffer.alloc(4_096, 9),
    );
    assert.throws(resolve, { code: 'runner_manifest_missing_or_invalid' });
    await stageWindowsRunnerResource({
      sourceExecutable: source,
      destinationDirectory: resourceDirectory,
      platform: 'win32',
      arch: 'x64',
    });
    assert.equal(
      resolve(),
      path.join(resourceDirectory, 'noema-windows-runner.exe'),
    );
    const manifestPath = path.join(
      resourceDirectory,
      'noema-windows-runner.json',
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.policyVersion = 2;
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.throws(resolve, { code: 'runner_manifest_mismatch' });
    await stageWindowsRunnerResource({
      sourceExecutable: source,
      destinationDirectory: resourceDirectory,
      platform: 'win32',
      arch: 'x64',
    });
    const currentManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    currentManifest.backendVersion = '9.9.9';
    await writeFile(manifestPath, JSON.stringify(currentManifest));
    assert.throws(resolve, { code: 'runner_manifest_mismatch' });
    await stageWindowsRunnerResource({
      sourceExecutable: source,
      destinationDirectory: resourceDirectory,
      platform: 'win32',
      arch: 'x64',
    });
    await writeFile(path.join(resourceDirectory, 'unexpected.bin'), 'extra');
    assert.throws(resolve, { code: 'runner_package_resource_set_invalid' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
