import {
  createDevelopmentDirectory,
  removeDevelopmentDirectory,
} from '../test-support/development-workspace.mjs';
import { spawn } from 'node:child_process';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { RootStore } from '../src/main/storage/root-store.mjs';
import { resolveNoemaDatabasePath } from '../src/main/platform/runtime-paths.mjs';
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
const probeRendererHmr = process.argv.includes('--hmr');
const smokeDir = createDevelopmentDirectory('noema-desktop-smoke-');
const userDataDir = path.join(smokeDir, 'user-data');
const probeDirectory = path.join(smokeDir, 'catalog-probe');
const probeUserDataDir = path.join(probeDirectory, 'user-data');
const loadedMarker = path.join(smokeDir, 'renderer-loaded.json');
const startupLog = path.join(smokeDir, 'main-started.json');
const hmrDoneMarker = path.join(smokeDir, 'renderer-hmr-done');
const hmrResultPath = path.join(smokeDir, 'renderer-hmr.json');
const probeFreeLLMAPI = process.env.NOEMA_SMOKE_PROBE_FREELLMAPI === '1';
const injectedFreeLlmApiCredential = Boolean(
  process.env.NOEMA_FREELLMAPI_API_KEY?.trim(),
);
const probeHistoryTrace = process.env.NOEMA_SMOKE_CAPTURE_HISTORY_TRACE === '1';
const probeLegacyArchive =
  process.env.NOEMA_SMOKE_CAPTURE_LEGACY_ARCHIVE === '1';
const historyTraceScreenshotPaths = [
  process.env.NOEMA_SMOKE_HISTORY_TRACE_DESKTOP_PATH,
  process.env.NOEMA_SMOKE_HISTORY_TRACE_INTERMEDIATE_PATH,
  process.env.NOEMA_SMOKE_HISTORY_TRACE_NARROW_PATH,
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
const legacyArchiveScreenshotPaths = [
  process.env.NOEMA_SMOKE_LEGACY_ARCHIVE_DESKTOP_PATH,
  process.env.NOEMA_SMOKE_LEGACY_ARCHIVE_NARROW_PATH,
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
if (probeFreeLLMAPI) {
  mkdirSync(probeDirectory, { recursive: true });
  if (!injectedFreeLlmApiCredential) {
    const appDataDirectory =
      process.platform === 'win32'
        ? process.env.APPDATA
        : process.platform === 'darwin'
          ? path.join(homedir(), 'Library', 'Application Support')
          : (process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'));
    if (!appDataDirectory)
      throw new Error('Cannot locate the Noema credential profile.');
    const sourceProfile = path.join(appDataDirectory, 'Noema');
    for (const relativePath of [
      'Local State',
      'credentials/model-provider.key',
      'credentials/freellmapi.key',
    ]) {
      const source = path.join(sourceProfile, relativePath);
      if (!existsSync(source)) continue;
      const destination = path.join(probeUserDataDir, relativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    if (!existsSync(path.join(probeUserDataDir, 'Local State')))
      throw new Error('Noema credential profile has no Local State file.');
  }
  const fixture = new RootStore(path.join(probeDirectory, 'root.sqlite3'));
  fixture.setSelectedModel(process.env.NOEMA_SMOKE_MODEL ?? 'auto:noema-free');
  fixture.close();
}
let historyTraceDatabasePath;
let historyTraceDshUserDataPath;
let legacyArchiveDatabasePath;
let legacyArchiveDshUserDataPath;
if (probeHistoryTrace) {
  const historyTraceDirectory = path.join(smokeDir, 'history-trace-probe');
  mkdirSync(historyTraceDirectory, { recursive: true });
  historyTraceDatabasePath = path.join(historyTraceDirectory, 'root.sqlite3');
  historyTraceDshUserDataPath = path.join(
    historyTraceDirectory,
    'dsh-user-data',
  );
  const fixture = new RootStore(historyTraceDatabasePath);
  fixture.setSelectedModel('auto:noema-free');
  const sourceTurn = fixture.beginTurn({
    id: 'smoke-history-source',
    text: '我希望 Noema 能在一条持续对话中找回以前讨论过的具体经历。',
    model: 'auto:noema-free',
  });
  const sourceMessage = fixture
    .getSnapshot()
    .messages.find(
      (message) => message.turnId === sourceTurn.id && message.role === 'user',
    );
  fixture.appendAssistant({
    id: sourceTurn.id,
    attempt: sourceTurn.attempt,
    content: '旧对话原文仍然是权威来源。',
  });
  fixture.completeTurn(sourceTurn.id, sourceTurn.attempt);
  const replyTurn = fixture.beginTurn({
    id: 'smoke-history-recall',
    text: '你还记得我之前对持续对话的要求吗？',
    model: 'auto:noema-free',
  });
  fixture.setTurnHistorySources(replyTurn.id, replyTurn.attempt, [
    {
      id: sourceMessage.id,
      role: sourceMessage.role,
      createdAt: sourceMessage.createdAt,
      snippet: sourceMessage.content,
    },
  ]);
  fixture.markTurnHistorySourcesIncluded(replyTurn.id, replyTurn.attempt);
  fixture.appendAssistant({
    id: replyTurn.id,
    attempt: replyTurn.attempt,
    content: '我找到了你先前的原话，并会按上下文理解它。',
  });
  fixture.completeTurn(replyTurn.id, replyTurn.attempt);
  const noMatchTurn = fixture.beginTurn({
    id: 'smoke-history-no-match',
    text: '之前有没有聊过一个不存在的测试主题？',
    model: 'auto:noema-free',
  });
  fixture.setTurnHistorySources(noMatchTurn.id, noMatchTurn.attempt, []);
  fixture.appendAssistant({
    id: noMatchTurn.id,
    attempt: noMatchTurn.attempt,
    content: '我没有在之前的对话中找到匹配的原文。',
  });
  fixture.completeTurn(noMatchTurn.id, noMatchTurn.attempt);
  fixture.close();
}
if (probeLegacyArchive) {
  const legacyArchiveDirectory = path.join(smokeDir, 'legacy-archive-probe');
  mkdirSync(legacyArchiveDirectory, { recursive: true });
  legacyArchiveDatabasePath = path.join(legacyArchiveDirectory, 'root.sqlite3');
  legacyArchiveDshUserDataPath = path.join(
    legacyArchiveDirectory,
    'dsh-user-data',
  );
  const fixture = new RootStore(legacyArchiveDatabasePath);
  fixture.db
    .prepare(`
    INSERT INTO captured_moments (id, content, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `)
    .run(
      'local-capture-search-fixture',
      '这是 NOEMA-LOCAL-CAPTURE-SEARCH 速记内容，用于验证本机搜索。',
      new Date().toISOString(),
      new Date().toISOString(),
    );
  fixture.close();
}

async function findFreePort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a renderer HMR debug port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

const hmrDebugPort = probeRendererHmr ? await findFreePort() : null;
const hmrProbeCssPath = path.join(appDir, 'src', 'renderer', 'hmr-smoke.css');

async function waitForFile(filePath, waitMs) {
  const deadline = Date.now() + waitMs;
  while (!existsSync(filePath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return existsSync(filePath);
}

async function waitForPageTarget(port, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(
          (item) =>
            item.type === 'page' &&
            item.url.startsWith('http://localhost:5173/'),
        );
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The renderer CDP target did not become available.');
}

async function createCdpSession(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function runRendererHmrProbe() {
  const originalCss = readFileSync(hmrProbeCssPath, 'utf8');
  let cdp;
  try {
    if (!(await waitForFile(loadedMarker, 30_000))) {
      throw new Error('The renderer startup marker did not appear for HMR.');
    }
    const target = await waitForPageTarget(hmrDebugPort, 8_000);
    cdp = await createCdpSession(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    const expression = `({value:getComputedStyle(document.documentElement).getPropertyValue('--noema-hmr-smoke-value').trim(),timeOrigin:performance.timeOrigin,url:location.href})`;
    const evaluate = async () => {
      const response = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
      });
      return response.result?.value;
    };
    let before;
    const initialDeadline = Date.now() + 3_000;
    do {
      before = await evaluate();
      if (before?.value === 'before') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < initialDeadline);
    if (before?.value !== 'before' || !before.timeOrigin) {
      throw new Error('The renderer HMR probe stylesheet did not load.');
    }
    if (!originalCss.includes('before')) {
      throw new Error(
        'The renderer HMR probe source is not in its baseline state.',
      );
    }
    writeFileSync(hmrProbeCssPath, originalCss.replace('before', 'after'));
    const updateDeadline = Date.now() + 8_000;
    let after = before;
    do {
      await new Promise((resolve) => setTimeout(resolve, 100));
      after = await evaluate();
      if (after?.value === 'after') break;
    } while (Date.now() < updateDeadline);
    if (after?.value !== 'after') {
      throw new Error('Vite did not apply the renderer CSS HMR update.');
    }
    if (after.timeOrigin !== before.timeOrigin || after.url !== before.url) {
      throw new Error(
        'The renderer page reloaded instead of applying HMR in place.',
      );
    }
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    });
    const keyboardFocus = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const button = document.querySelector('.sidebar-settings-button'); button?.focus(); return Boolean(button && document.activeElement === button && button.matches(':focus-visible')); })()`,
      returnByValue: true,
    });
    if (keyboardFocus.result?.value !== true) {
      throw new Error(
        'Keyboard focus is not visibly indicated in the renderer.',
      );
    }
    const buttonRect = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const rect = document.querySelector('.index-toggle')?.getBoundingClientRect(); return rect ? {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2} : null; })()`,
      returnByValue: true,
    });
    const pointerTarget = buttonRect.result?.value;
    if (!pointerTarget)
      throw new Error(
        'Could not locate the navigation button for pointer focus probe.',
      );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: pointerTarget.x,
      y: pointerTarget.y,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: pointerTarget.x,
      y: pointerTarget.y,
      button: 'left',
      clickCount: 1,
    });
    const pointerFocus = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const button = document.querySelector('.index-toggle'); const style = button ? getComputedStyle(button) : null; return {active: Boolean(button && document.activeElement === button), focusVisible: button?.matches(':focus-visible') ?? null, outlineStyle: style?.outlineStyle, boxShadow: style?.boxShadow}; })()`,
      returnByValue: true,
    });
    const pointerState = pointerFocus.result?.value;
    if (
      !pointerState?.active ||
      pointerState.focusVisible ||
      pointerState.outlineStyle !== 'none' ||
      pointerState.boxShadow !== 'none'
    ) {
      throw new Error(
        `Pointer focus leaves a distracting button outline: ${JSON.stringify(pointerState)}`,
      );
    }
    writeFileSync(
      hmrResultPath,
      JSON.stringify({
        passed: true,
        before,
        after,
        keyboardFocus: true,
        pointerFocus: true,
      }),
    );
  } finally {
    writeFileSync(hmrProbeCssPath, originalCss);
    cdp?.close();
    writeFileSync(hmrDoneMarker, 'done');
  }
}

const childEnvironment = {
  ...process.env,
  NOEMA_SMOKE_TEST: '1',
  NOEMA_SMOKE_TEST_FILE: loadedMarker,
  NOEMA_SMOKE_LOG_FILE: startupLog,
  NOEMA_SMOKE_SESSION_DATA_DIR: path.join(smokeDir, 'session-data'),
  ...(probeRendererHmr
    ? {
        NOEMA_SMOKE_ENABLE_HMR: '1',
        NOEMA_SMOKE_HMR_DONE_FILE: hmrDoneMarker,
        NOEMA_DEV_REMOTE_DEBUGGING_PORT: String(hmrDebugPort),
        VITE_NOEMA_SMOKE_HMR: '1',
      }
    : {}),
  ...(probeFreeLLMAPI
    ? {
        NOEMA_E2E_DATABASE_PATH: path.join(probeDirectory, 'root.sqlite3'),
        NOEMA_E2E_DSH_USER_DATA_PATH: path.join(
          probeDirectory,
          'dsh-user-data',
        ),
        NOEMA_SMOKE_USER_DATA_DIR: probeUserDataDir,
        NOEMA_SMOKE_REFRESH_MODELS: '1',
        NOEMA_SMOKE_CAPTURE_MODEL_AVAILABILITY: '1',
        ...(process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_SCREENSHOT_PATH
          ? {
              NOEMA_SMOKE_MODEL_AVAILABILITY_SCREENSHOT_PATH:
                process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_SCREENSHOT_PATH,
            }
          : {}),
      }
    : { NOEMA_SMOKE_USER_DATA_DIR: userDataDir }),
  ...(probeHistoryTrace
    ? {
        NOEMA_E2E_DATABASE_PATH: historyTraceDatabasePath,
        NOEMA_E2E_DSH_USER_DATA_PATH: historyTraceDshUserDataPath,
        NOEMA_SMOKE_CAPTURE_HISTORY_TRACE: '1',
      }
    : {}),
  ...(probeLegacyArchive
    ? {
        NOEMA_E2E_DATABASE_PATH: legacyArchiveDatabasePath,
        NOEMA_E2E_DSH_USER_DATA_PATH: legacyArchiveDshUserDataPath,
        NOEMA_SMOKE_CAPTURE_LEGACY_ARCHIVE: '1',
      }
    : {}),
  ...(legacyArchiveScreenshotPaths[0]
    ? {
        NOEMA_SMOKE_LEGACY_ARCHIVE_DESKTOP_PATH:
          legacyArchiveScreenshotPaths[0],
      }
    : {}),
  ...(legacyArchiveScreenshotPaths[1]
    ? {
        NOEMA_SMOKE_LEGACY_ARCHIVE_NARROW_PATH: legacyArchiveScreenshotPaths[1],
      }
    : {}),
};
if (probeFreeLLMAPI) {
  if (!process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_SCREENSHOT_PATH)
    childEnvironment.NOEMA_SMOKE_HIDDEN = '1';
  // The isolated profile lets Electron encrypt an explicitly injected key
  // without touching the real userData. Otherwise, use the copied encrypted
  // Noema credential and prevent ambient overrides from changing its route.
  if (!injectedFreeLlmApiCredential) {
    delete childEnvironment.NOEMA_FREELLMAPI_API_KEY;
    delete childEnvironment.NOEMA_FREELLMAPI_BASE_URL;
  }
  delete childEnvironment.NOEMA_E2E_WORKER_PROMPT;
}
const child = spawn(process.execPath, [forgeCli, 'start'], {
  cwd: appDir,
  env: childEnvironment,
  stdio: 'inherit',
});
const hmrProbePromise = probeRendererHmr
  ? runRendererHmrProbe().catch((error) => {
      writeFileSync(
        hmrResultPath,
        JSON.stringify({ passed: false, error: String(error) }),
      );
      writeFileSync(hmrDoneMarker, 'done');
      return error;
    })
  : Promise.resolve(null);

function cleanSmokeDirectory() {
  removeDevelopmentDirectory(smokeDir);
}
process.once('exit', cleanSmokeDirectory);

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

child.on('exit', async (code, signal) => {
  clearTimeout(timeout);
  const hmrProbeError = await hmrProbePromise;
  if (hmrProbeError) {
    console.error(`Renderer HMR smoke test failed: ${hmrProbeError.message}`);
    process.exitCode = 1;
    return;
  }
  if (code === 0 && existsSync(loadedMarker)) {
    let loaded;
    try {
      loaded = JSON.parse(readFileSync(loadedMarker, 'utf8'));
    } catch (error) {
      console.error('Desktop smoke marker was not valid JSON:', error);
      process.exitCode = 1;
      return;
    }
    if (
      loaded.socialChat?.agentIds?.join(',') !== 'noema' ||
      loaded.socialChat?.roomIds?.join(',') !== 'room-noema'
    ) {
      console.error(
        'Fresh Noema must start with its main conversation only, without a demo team.',
      );
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
    if (!loaded.windowFitsWorkArea) {
      console.error(
        'Desktop startup window was larger than the display work area.',
      );
      process.exitCode = 1;
      return;
    }
    const databasePath =
      legacyArchiveDatabasePath ??
      historyTraceDatabasePath ??
      resolveNoemaDatabasePath({
        userDataPath: userDataDir,
        isPackaged: true,
      });
    let entryEvents = [];
    try {
      const diagnosticsDb = new Database(databasePath, { readonly: true });
      try {
        entryEvents = diagnosticsDb
          .prepare(`SELECT application_execution_id AS applicationExecutionId,
            execution_id AS executionId, module, operation, status, details_json AS detailsJson
            FROM diagnostic_events WHERE operation IN (
              'entry.route_selected', 'entry.capability_availability'
            ) OR module = 'desktop.lifecycle' ORDER BY occurred_at`)
          .all()
          .map((event) => ({
            ...event,
            details: JSON.parse(event.detailsJson),
          }));
      } finally {
        diagnosticsDb.close();
      }
    } catch (error) {
      console.error('Could not read local diagnostic events:', error);
      process.exitCode = 1;
      return;
    }
    const routeEvent = entryEvents.find(
      (event) => event.operation === 'entry.route_selected',
    );
    const capabilityEvent = entryEvents.find(
      (event) => event.operation === 'entry.capability_availability',
    );
    if (
      routeEvent?.details.route !== 'social-chat' ||
      typeof routeEvent.applicationExecutionId !== 'string' ||
      routeEvent.applicationExecutionId.length < 16 ||
      capabilityEvent?.applicationExecutionId !==
        routeEvent.applicationExecutionId ||
      !['available', 'unavailable'].includes(capabilityEvent.status)
    ) {
      console.error(
        'Default entry diagnostics did not correlate route and project-work readiness.',
      );
      process.exitCode = 1;
      return;
    }
    if (process.platform === 'win32') {
      const lifecycleOperations = new Set(
        entryEvents
          .filter((event) => event.module === 'desktop.lifecycle')
          .map((event) => event.operation),
      );
      const shutdownStarted = entryEvents.find(
        (event) => event.operation === 'shutdown.started',
      );
      const shutdownCompleted = entryEvents.find(
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
        !loaded.desktopLifecycleSmoke?.trayReady ||
        !loaded.desktopLifecycleSmoke.hiddenOnClose ||
        !loaded.desktopLifecycleSmoke.restoredSameWindow ||
        shutdownStarted?.details.reason !== 'application_exit' ||
        shutdownCompleted?.details.reason !== 'application_exit' ||
        requiredOperations.some(
          (operation) => !lifecycleOperations.has(operation),
        )
      ) {
        console.error(
          `Desktop tray lifecycle smoke was incomplete: ${JSON.stringify({
            probe: loaded.desktopLifecycleSmoke,
            events: [...lifecycleOperations],
          })}`,
        );
        process.exitCode = 1;
        return;
      }
    }
    cleanSmokeDirectory();
    console.log(
      `Desktop startup smoke test passed: renderer loaded at ${loaded.url}.`,
    );
    console.log(
      `Entry diagnostics: route and project-work readiness share execution ${routeEvent.applicationExecutionId}.`,
    );
    console.log(
      `Social shell: ${loaded.socialChat.agentCount} contacts, ${loaded.socialChat.roomCount} rooms, no workspace-task entry.`,
    );
    if (loaded.desktopLifecycleSmoke) {
      console.log(
        'Desktop tray lifecycle: tray ready, close hid the window, restore reused it, and shutdown was recorded.',
      );
    }
    if (probeRendererHmr) {
      console.log(
        'Renderer HMR applied a stylesheet update without reloading the page.',
      );
      console.log(
        'Renderer focus: keyboard navigation shows focus; pointer activation leaves no outline.',
      );
    }
    if (probeHistoryTrace) {
      if (
        !loaded.historyTraceSmoke?.found ||
        !loaded.historyTraceSmoke.included ||
        loaded.historyTraceSmoke.sourceCount < 1 ||
        loaded.historyTraceSmoke.heading !== '对话' ||
        !Array.isArray(loaded.historyTraceSmoke.contextActions) ||
        loaded.historyTraceSmoke.contextActions.length < 2 ||
        !loaded.historyTraceSmoke.intermediateTopbarFits ||
        !loaded.historyTraceSmoke.noMatch ||
        !loaded.historyTraceSmoke.jumpWorked
      ) {
        console.error(
          'History trace smoke test did not render a source or jump to its original message.',
        );
        process.exitCode = 1;
        return;
      }
      const missingScreenshots = historyTraceScreenshotPaths.filter(
        (screenshotPath) => !existsSync(screenshotPath),
      );
      if (missingScreenshots.length > 0) {
        console.error(
          `History trace screenshots missing: ${missingScreenshots.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(
        `History trace UI: ${loaded.historyTraceSmoke.sourceCount} source(s), jump verified; screenshots: ${loaded.historyTraceSmoke.screenshots?.join(', ')}`,
      );
    }
    if (probeLegacyArchive) {
      if (
        !loaded.legacyArchiveSmoke?.opened ||
        !loaded.legacyArchiveSmoke.matchedCapture ||
        !loaded.legacyArchiveSmoke.readOnly ||
        !loaded.legacyArchiveSmoke.exportPreviewValid ||
        !loaded.legacyArchiveSmoke.desktopNoOverflow ||
        !loaded.legacyArchiveSmoke.narrowNoOverflow
      ) {
        console.error(
          'Legacy capture was not queryable/exportable as a read-only archive record.',
        );
        process.exitCode = 1;
        return;
      }
      const missingScreenshots = legacyArchiveScreenshotPaths.filter(
        (screenshotPath) => !existsSync(screenshotPath),
      );
      if (missingScreenshots.length > 0) {
        console.error(
          `Legacy archive screenshots missing: ${missingScreenshots.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(
        `Legacy capture archive: read-only record query and local export preview passed at desktop/narrow widths; screenshots: ${loaded.legacyArchiveSmoke.screenshots?.join(', ') || 'not requested'}`,
      );
    }
    if (probeFreeLLMAPI) {
      console.log(
        `Model provider credential: ${loaded.providerConfigured ? 'configured' : 'missing'}; endpoint: ${loaded.providerBaseUrl ?? 'unknown'}; connection: ${loaded.connected ? 'available' : 'unavailable'}${loaded.providerError ? ` — ${loaded.providerError}` : ''}; models: ${(loaded.models ?? []).map((model) => `${model.name} [${model.executionStatus ?? (model.routeKind === 'router' ? 'router status unknown' : 'status unavailable')}]`).join(', ') || 'none'}`,
      );
      if (
        !loaded.providerConfigured ||
        !loaded.connected ||
        loaded.models?.length === 0
      ) {
        process.exitCode = 1;
      }
      if (!loaded.modelAvailabilitySmoke?.verified) {
        console.error(
          'Noema did not render the FreeLLMAPI model readiness states it received.',
        );
        process.exitCode = 1;
      }
      if (
        process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_SCREENSHOT_PATH &&
        !existsSync(process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_SCREENSHOT_PATH)
      ) {
        console.error('Model availability screenshot was not created.');
        process.exitCode = 1;
      }
      if (
        process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_NARROW_SCREENSHOT_PATH &&
        !existsSync(
          process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_NARROW_SCREENSHOT_PATH,
        )
      ) {
        console.error('Narrow model availability screenshot was not created.');
        process.exitCode = 1;
      }
      console.log(
        `Model availability rendered: ${(loaded.modelAvailabilitySmoke?.routes ?? []).map((model) => `${model.name}=${model.executionStatus ?? 'unknown'}`).join(', ')}; narrow layout: ${loaded.modelAvailabilitySmoke?.narrowLayoutValid ? 'fits' : 'not checked'}`,
      );
      if (process.env.NOEMA_SMOKE_SOCIAL_CHAT_LIVE === '1') {
        if (!loaded.socialLiveChatSmoke?.verified) {
          console.error(
            `Synthetic Noema chat failed (${loaded.socialLiveChatSmoke?.status ?? 'unknown'}): ${loaded.socialLiveChatSmoke?.error || 'response did not match the marker.'}`,
          );
          process.exitCode = 1;
          return;
        }
        console.log(
          `Synthetic Noema chat: response received through ${loaded.socialLiveChatSmoke.model ?? 'an unreported route'}; marker matched; ${loaded.socialLiveChatSmoke.responseLength} response characters.`,
        );
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
