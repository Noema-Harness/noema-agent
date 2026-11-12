import {
  createDevelopmentDirectory,
  removeDevelopmentDirectory,
} from '../test-support/development-workspace.mjs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage } from '@electron/asar';
import Database from 'better-sqlite3';
import { resolveNoemaDatabasePath } from '../src/main/platform/runtime-paths.mjs';
import {
  WINDOWS_RUNNER_BACKEND_ID,
  WINDOWS_RUNNER_BACKEND_VERSION,
  WINDOWS_RUNNER_PACKAGE_MANIFEST,
  WINDOWS_RUNNER_POLICY_VERSION,
  WINDOWS_RUNNER_PROTOCOL_VERSION,
  WINDOWS_RUNNER_RESOURCE_NAME,
} from '../src/main/execution/windows-runner-package-contract.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = process.env.NOEMA_PACKAGE_DIR
  ? path.resolve(process.env.NOEMA_PACKAGE_DIR)
  : path.join(appDir, 'out', 'Noema-win32-x64');
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

const runnerResourceDirectory = path.join(resourcesDirectory, 'windows-runner');
const runnerEntries = readdirSync(runnerResourceDirectory).sort();
if (
  runnerEntries.length !== 2 ||
  runnerEntries[0] !== WINDOWS_RUNNER_RESOURCE_NAME ||
  runnerEntries[1] !== WINDOWS_RUNNER_PACKAGE_MANIFEST ||
  existsSync(path.join(resourcesDirectory, 'srt-win')) ||
  [...archiveEntries].some(
    (entry) =>
      entry.includes('@anthropic-ai/sandbox-runtime') ||
      entry.includes('srt-win'),
  )
) {
  throw new Error(
    `Windows package contains an unexpected runner resource set: ${runnerEntries.join(', ')}`,
  );
}
const runnerExecutable = readFileSync(
  path.join(runnerResourceDirectory, WINDOWS_RUNNER_RESOURCE_NAME),
);
const runnerManifest = JSON.parse(
  readFileSync(
    path.join(runnerResourceDirectory, WINDOWS_RUNNER_PACKAGE_MANIFEST),
    'utf8',
  ),
);
const runnerDigest = createHash('sha256')
  .update(runnerExecutable)
  .digest('hex');
if (
  runnerManifest.backendId !== WINDOWS_RUNNER_BACKEND_ID ||
  runnerManifest.backendVersion !== WINDOWS_RUNNER_BACKEND_VERSION ||
  runnerManifest.protocolVersion !== WINDOWS_RUNNER_PROTOCOL_VERSION ||
  runnerManifest.platform !== 'win32' ||
  runnerManifest.arch !== 'x64' ||
  runnerManifest.executable !== WINDOWS_RUNNER_RESOURCE_NAME ||
  runnerManifest.sha256 !== runnerDigest
) {
  throw new Error('Packaged Windows runner identity or digest does not match.');
}
if (
  archiveEntries.has(
    'native/windows-runner/target/x86_64-pc-windows-msvc/release/noema-windows-runner.exe',
  )
) {
  throw new Error('Native runner build output was duplicated inside app.asar.');
}

const smokeDirectory = createDevelopmentDirectory('noema-package-smoke-');
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
  removeDevelopmentDirectory(smokeDirectory);
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
    !loaded.windowFitsWorkArea ||
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

  if (
    loaded.socialChat?.agentIds?.join(',') !== 'noema' ||
    loaded.socialChat?.roomIds?.join(',') !== 'room-noema'
  ) {
    throw new Error('Packaged Noema starts with an unexpected demo team.');
  }
  const runtime = loaded.diagnosticsRuntime;
  if (
    !runtime?.applicationVersion ||
    !runtime.electronVersion ||
    !runtime.nodeVersion ||
    !runtime.osVersion ||
    runtime.isPackaged !== true ||
    !Number.isSafeInteger(runtime.socialSchemaVersion) ||
    !Number.isSafeInteger(runtime.diagnosticsSchemaVersion)
  ) {
    throw new Error(
      `Packaged diagnostics runtime manifest was incomplete: ${JSON.stringify(runtime)}`,
    );
  }
  if (loaded.socialChat?.firstRoomOpened !== true) {
    throw new Error('Packaged Noema did not open its resident conversation.');
  }
  if (process.platform === 'win32') {
    const trayProbe = loaded.desktopLifecycleSmoke;
    const databasePath = resolveNoemaDatabasePath({
      userDataPath: userDataDirectory,
      isPackaged: true,
    });
    const db = new Database(databasePath, { readonly: true });
    let lifecycleEvents;
    let runnerReadinessEvents;
    try {
      lifecycleEvents = db
        .prepare(`SELECT operation, details_json AS detailsJson
          FROM diagnostic_events
          WHERE module = ? ORDER BY occurred_at`)
        .all('desktop.lifecycle')
        .map((event) => ({ ...event, details: JSON.parse(event.detailsJson) }));
      runnerReadinessEvents = db
        .prepare(`SELECT operation, status, details_json AS detailsJson
          FROM diagnostic_events
          WHERE module = ? AND operation IN (?, ?) ORDER BY occurred_at`)
        .all('windows_runner', 'capability.initialized', 'startup_readiness')
        .map((event) => ({ ...event, details: JSON.parse(event.detailsJson) }));
    } finally {
      db.close();
    }
    const runnerIdentity = runnerReadinessEvents.find(
      (event) => event.details.backendId === WINDOWS_RUNNER_BACKEND_ID,
    );
    if (
      !runnerIdentity ||
      runnerIdentity.details.backendVersion !==
        WINDOWS_RUNNER_BACKEND_VERSION ||
      runnerIdentity.details.policyVersion !== WINDOWS_RUNNER_POLICY_VERSION ||
      runnerIdentity.details.protocolVersion !== WINDOWS_RUNNER_PROTOCOL_VERSION
    ) {
      throw new Error(
        `Packaged Noema did not report the verified Windows runner identity: ${JSON.stringify(runnerReadinessEvents)}`,
      );
    }
    const lifecycleOperations = new Set(
      lifecycleEvents.map(({ operation }) => operation),
    );
    const shutdownStarted = lifecycleEvents.find(
      (event) => event.operation === 'shutdown.started',
    );
    const shutdownCompleted = lifecycleEvents.find(
      (event) => event.operation === 'shutdown.completed',
    );
    const requiredOperations = [
      'tray.ready',
      'window.hidden',
      'window.restored',
      'exit.requested',
      'shutdown.started',
      'shutdown.completed',
    ];
    if (
      !trayProbe?.trayReady ||
      !trayProbe.hiddenOnClose ||
      !trayProbe.restoredSameWindow ||
      shutdownStarted?.details.reason !== 'application_exit' ||
      shutdownCompleted?.details.reason !== 'application_exit' ||
      requiredOperations.some(
        (operation) => !lifecycleOperations.has(operation),
      )
    ) {
      console.error(
        `Packaged tray lifecycle was incomplete: ${JSON.stringify({
          trayProbe,
          lifecycleOperations: [...lifecycleOperations],
        })}`,
      );
      process.exitCode = 1;
      return;
    }
  }
  cleanSmokeDirectory();
  console.log(
    `Packaged desktop startup smoke test passed: ${loaded.title} renderer loaded at ${loaded.url}.`,
  );
  if (loaded.desktopLifecycleSmoke) {
    console.log(
      'Packaged tray lifecycle passed: close-to-hide, same-window restore and recorded shutdown.',
    );
  }
});
