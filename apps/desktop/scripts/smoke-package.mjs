import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage } from '@electron/asar';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = path.join(appDir, 'out', 'Noema-win32-x64');
const packagedApp = path.join(packageDirectory, 'Noema.exe');
const resourcesDirectory = path.join(packageDirectory, 'resources');
const archivePath = path.join(resourcesDirectory, 'app.asar');
const timeoutMs = 60_000;

if (!existsSync(packagedApp)) {
  throw new Error(`Packaged Noema executable not found: ${packagedApp}`);
}
if (!existsSync(archivePath)) {
  throw new Error(`Packaged app archive not found: ${archivePath}`);
}

const archiveEntries = new Set(
  listPackage(archivePath).map((entry) =>
    entry.replaceAll('\\', '/').replace(/^\/+/, ''),
  ),
);
const runtimeDependencies = ['better-sqlite3'];
const missingDependencies = runtimeDependencies.filter((dependency) => {
  const archiveEntry = `node_modules/${dependency}/package.json`;
  const unpackedEntry = path.join(
    resourcesDirectory,
    'app.asar.unpacked',
    'node_modules',
    dependency,
    'package.json',
  );
  return !archiveEntries.has(archiveEntry) && !existsSync(unpackedEntry);
});
if (missingDependencies.length > 0) {
  throw new Error(
    `Packaged app is missing runtime dependencies: ${missingDependencies.join(', ')}.`,
  );
}

const smokeDirectory = mkdtempSync(path.join(tmpdir(), 'noema-package-smoke-'));
const userDataDirectory = path.join(smokeDirectory, 'user-data');
const loadedMarker = path.join(smokeDirectory, 'renderer-loaded.json');
const startupLog = path.join(smokeDirectory, 'startup.json');
mkdirSync(userDataDirectory, { recursive: true });

const childEnvironment = { ...process.env };
for (const key of Object.keys(childEnvironment)) {
  if (key.startsWith('NOEMA_E2E_') || key.startsWith('NOEMA_SMOKE_')) {
    delete childEnvironment[key];
  }
}
Object.assign(childEnvironment, {
  NOEMA_SMOKE_TEST: '1',
  NOEMA_SMOKE_USER_DATA_DIR: userDataDirectory,
  NOEMA_SMOKE_TEST_FILE: loadedMarker,
  NOEMA_SMOKE_LOG_FILE: startupLog,
});
delete childEnvironment.NOEMA_FREELLMAPI_API_KEY;
delete childEnvironment.NOEMA_FREELLMAPI_BASE_URL;

const child = spawn(packagedApp, ['--enable-logging=stderr'], {
  cwd: path.dirname(packagedApp),
  env: childEnvironment,
  stdio: 'inherit',
});

function cleanSmokeDirectory() {
  const resolved = path.resolve(smokeDirectory);
  const tempRoot = path.resolve(tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}`)) {
    throw new Error(
      `Refusing to remove smoke data outside the temp directory: ${resolved}`,
    );
  }
  rmSync(resolved, { recursive: true, force: true });
}

const timeout = setTimeout(() => {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  } else {
    child.kill('SIGTERM');
  }
  console.error(
    `Packaged desktop startup smoke timed out after ${timeoutMs / 1000}s.`,
  );
  process.exitCode = 1;
}, timeoutMs);

child.on('error', (error) => {
  clearTimeout(timeout);
  console.error('Could not launch packaged Noema:', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  clearTimeout(timeout);
  if (code !== 0 || !existsSync(loadedMarker)) {
    console.error(
      `Packaged desktop startup smoke failed (exit=${code}, signal=${signal}).`,
    );
    if (existsSync(startupLog)) {
      console.error(
        `Main process observation: ${readFileSync(startupLog, 'utf8')}`,
      );
    } else {
      console.error('Main process never wrote its startup observation.');
    }
    process.exitCode = 1;
    return;
  }

  let loaded;
  try {
    loaded = JSON.parse(readFileSync(loadedMarker, 'utf8'));
  } catch (error) {
    console.error('Packaged renderer marker was not valid JSON:', error);
    process.exitCode = 1;
    return;
  }

  if (
    !loaded.packaged ||
    !loaded.rootStateLoaded ||
    typeof loaded.url !== 'string' ||
    !loaded.url.startsWith('file:')
  ) {
    console.error(
      'Packaged Noema did not load its local production renderer and root state.',
    );
    process.exitCode = 1;
    return;
  }

  cleanSmokeDirectory();
  console.log(
    `Packaged desktop startup smoke test passed: ${loaded.title} renderer loaded at ${loaded.url}.`,
  );
});
