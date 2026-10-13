import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureElectronRuntime } from './electron-runtime.mjs';

configureElectronRuntime();

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forgeCli = path.join(
  appDir,
  'node_modules',
  '@electron-forge',
  'cli',
  'dist',
  'electron-forge.js',
);
const timeoutMs = 90_000;
const smokeDir = mkdtempSync(path.join(tmpdir(), 'noema-desktop-smoke-'));
const userDataDir = path.join(smokeDir, 'user-data');
const loadedMarker = path.join(smokeDir, 'renderer-loaded.json');
const startupLog = path.join(smokeDir, 'main-started.json');
const child = spawn(process.execPath, [forgeCli, 'start'], {
  cwd: appDir,
  env: {
    ...process.env,
    NOEMA_SMOKE_TEST: '1',
    NOEMA_SMOKE_TEST_FILE: loadedMarker,
    NOEMA_SMOKE_USER_DATA_DIR: userDataDir,
    NOEMA_SMOKE_LOG_FILE: startupLog,
  },
  stdio: 'inherit',
});

function cleanSmokeDirectory() {
  const resolved = path.resolve(smokeDir);
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
    `Desktop startup smoke test timed out after ${timeoutMs / 1000}s.`,
  );
  process.exitCode = 1;
}, timeoutMs);

child.on('error', (error) => {
  clearTimeout(timeout);
  console.error('Could not launch Electron Forge:', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  clearTimeout(timeout);
  if (code === 0 && existsSync(loadedMarker)) {
    let loaded;
    try {
      loaded = JSON.parse(readFileSync(loadedMarker, 'utf8'));
    } catch (error) {
      console.error('Desktop smoke marker was not valid JSON:', error);
      process.exitCode = 1;
      return;
    }
    if (typeof loaded.url !== 'string' || !loaded.url) {
      console.error(
        'Desktop smoke marker did not contain the loaded renderer URL.',
      );
      process.exitCode = 1;
      return;
    }
    cleanSmokeDirectory();
    console.log(
      `Desktop startup smoke test passed: renderer loaded at ${loaded.url}.`,
    );
    return;
  }
  console.error(
    `Desktop startup smoke test failed: renderer-loaded marker missing or invalid (exit=${code}, signal=${signal}).`,
  );
  if (existsSync(startupLog)) {
    console.error(
      `Main process startup observation: ${readFileSync(startupLog, 'utf8')}`,
    );
  } else {
    console.error('Main process never wrote its startup observation.');
  }
  process.exitCode = 1;
});
