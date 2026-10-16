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
const probeDirectory = path.join(smokeDir, 'catalog-probe');
const loadedMarker = path.join(smokeDir, 'renderer-loaded.json');
const startupLog = path.join(smokeDir, 'main-started.json');
const probeFreeLLMAPI = process.env.NOEMA_SMOKE_PROBE_FREELLMAPI === '1';
const probeQuickCapture = process.env.NOEMA_SMOKE_CAPTURE_QUICK_CAPTURE === '1';
const quickCaptureScreenshotPaths = [
  process.env.NOEMA_SMOKE_QUICK_CAPTURE_DESKTOP_PATH,
  process.env.NOEMA_SMOKE_QUICK_CAPTURE_NARROW_PATH,
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
if (probeFreeLLMAPI) mkdirSync(probeDirectory, { recursive: true });
const childEnvironment = {
  ...process.env,
  NOEMA_SMOKE_TEST: '1',
  NOEMA_SMOKE_TEST_FILE: loadedMarker,
  NOEMA_SMOKE_LOG_FILE: startupLog,
  ...(probeFreeLLMAPI
    ? {
        NOEMA_E2E_DATABASE_PATH: path.join(probeDirectory, 'root.sqlite3'),
        NOEMA_E2E_DSH_USER_DATA_PATH: path.join(
          probeDirectory,
          'dsh-user-data',
        ),
        NOEMA_SMOKE_REFRESH_MODELS: '1',
      }
    : { NOEMA_SMOKE_USER_DATA_DIR: userDataDir }),
};
if (probeFreeLLMAPI) delete childEnvironment.NOEMA_SMOKE_USER_DATA_DIR;
if (probeFreeLLMAPI) {
  // Use the encrypted key already stored by Noema, and never let an ambient
  // API-key/base-URL override write into the real userData during this probe.
  delete childEnvironment.NOEMA_FREELLMAPI_API_KEY;
  delete childEnvironment.NOEMA_FREELLMAPI_BASE_URL;
  delete childEnvironment.NOEMA_E2E_WORKER_PROMPT;
}
const child = spawn(process.execPath, [forgeCli, 'start'], {
  cwd: appDir,
  env: childEnvironment,
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
    console.log(
      `DSH adapter discovery: ${loaded.dshAvailable ? 'available' : 'unavailable'}${loaded.dshWorkerError ? ` — ${loaded.dshWorkerError}` : ''}`,
    );
    console.log(
      `Quick capture shortcut: ${loaded.quickCaptureShortcut?.accelerator ?? 'unknown'} — ${loaded.quickCaptureShortcut?.registered ? 'registered' : 'unavailable'}`,
    );
    if (probeQuickCapture) {
      if (
        !loaded.quickCaptureSmoke?.dialogOpen ||
        !loaded.quickCaptureSmoke?.inputFocused ||
        !loaded.quickCaptureSmoke?.shortcutStatusVisible
      ) {
        console.error(
          'Quick capture smoke test did not render its status, open the dialog, and focus its input.',
        );
        process.exitCode = 1;
        return;
      }
      const missingScreenshots = quickCaptureScreenshotPaths.filter(
        (screenshotPath) => !existsSync(screenshotPath),
      );
      if (missingScreenshots.length > 0) {
        console.error(
          `Quick capture screenshots missing: ${missingScreenshots.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(
        `Quick capture UI: dialog opened and input focused; screenshots: ${loaded.quickCaptureSmoke.screenshots?.join(', ') || 'not requested'}`,
      );
    }
    if (probeFreeLLMAPI) {
      console.log(
        `FreeLLMAPI credential: ${loaded.providerConfigured ? 'configured' : 'missing'}; endpoint: ${loaded.providerBaseUrl ?? 'unknown'}; gateway: ${loaded.connected ? 'connected' : 'unavailable'}${loaded.providerError ? ` — ${loaded.providerError}` : ''}; free routes: ${(loaded.models ?? []).map((model) => model.name).join(', ') || 'none'}`,
      );
      if (
        !loaded.providerConfigured ||
        !loaded.connected ||
        loaded.models?.length === 0
      ) {
        process.exitCode = 1;
      }
    }
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
