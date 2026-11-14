#!/usr/bin/env node
/**
 * Make distributables with a reproducible temp directory and a working NuGet.
 *
 * Three environment problems turn the Squirrel step into an unreproducible
 * failure:
 *
 * 1. `electron-winstaller` shells out to a vendored NuGet.exe that writes the
 *    `.nupkg` into `%TEMP%`. Under a restricted process token (sandbox,
 *    hardened profile, managed device) that write is denied and the maker
 *    fails with "access to the path ... is denied". TEMP is pinned to
 *    `apps/desktop/.tmp` so the build does not depend on machine temp policy.
 * 2. The vendored NuGet is 2.8, whose `System.IO.Packaging` writer throws
 *    `ObjectDisposedException` for package parts that compress to more than
 *    ~64 KB — true for every `app.asar`. A pinned NuGet is vendored under
 *    `vendor/squirrel/` and staged into a vendor directory that MakerSquirrel
 *    receives through `NOEMA_SQUIRREL_VENDOR`.
 * 3. Squirrel's releasify step creates its own scratch directory under
 *    `%LOCALAPPDATA%\SquirrelTemp` and takes a lock file under `%TEMP%`, which
 *    are not always writable for the build process. Squirrel honours
 *    `SQUIRREL_TEMP`, and the pinned TEMP covers the lock file.
 *
 * If the default `out/` directory cannot be rewritten because another process
 * holds a file inside it, the build is repeated into `.tmp/forge-out` instead
 * of failing. That keeps `npm run make:desktop` usable on machines where an
 * editor, indexer or an earlier package still keeps the default output open.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const tempDir = path.join(appRoot, '.tmp');
const vendorSource = path.join(
  appRoot,
  'node_modules',
  'electron-winstaller',
  'vendor',
);
const nugetSource = path.join(appRoot, 'vendor', 'squirrel', 'nuget.exe');
const vendorStage = path.join(tempDir, 'squirrel-vendor');
const defaultOutDir = path.join(appRoot, 'out');

mkdirSync(tempDir, { recursive: true });
const squirrelTemp = path.join(tempDir, 'squirrel-temp');
mkdirSync(squirrelTemp, { recursive: true });
rmSync(vendorStage, { recursive: true, force: true });
cpSync(vendorSource, vendorStage, { recursive: true });
copyFileSync(nugetSource, path.join(vendorStage, 'nuget.exe'));

const buildEnv = {
  ...process.env,
  TEMP: tempDir,
  TMP: tempDir,
  TMPDIR: tempDir,
  SQUIRREL_TEMP: squirrelTemp,
  NOEMA_SQUIRREL_VENDOR: vendorStage,
};

function outDirIsWritable() {
  const probe = path.join(
    defaultOutDir,
    'Noema-win32-x64',
    'resources',
    'app.asar',
  );
  if (!existsSync(probe)) return true;
  const moved = `${probe}.lock-probe`;
  try {
    renameSync(probe, moved);
    renameSync(moved, probe);
    return true;
  } catch {
    return false;
  }
}

function runApiFallback(outDir) {
  console.warn(
    `make: ${path.relative(appRoot, defaultOutDir)} is held by another process; building into ${path.relative(appRoot, outDir)} instead.`,
  );
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  Object.assign(process.env, buildEnv);
  return import('@electron-forge/core').then(async ({ api }) => {
    await api.package({ dir: appRoot, outDir, interactive: false });
    const results = await api.make({
      dir: appRoot,
      outDir,
      fromPackage: true,
      interactive: false,
    });
    for (const result of results)
      console.log(result.target || 'squirrel', result.artifacts);
    return 0;
  });
}

if (!outDirIsWritable()) {
  process.exitCode = await runApiFallback(path.join(tempDir, 'forge-out'));
} else {
  const forge =
    process.platform === 'win32' ? 'electron-forge.cmd' : 'electron-forge';
  const result = spawnSync(forge, ['make', ...process.argv.slice(2)], {
    cwd: appRoot,
    env: buildEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exitCode = result.status ?? 1;
}
