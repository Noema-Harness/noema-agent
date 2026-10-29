import { spawn } from 'node:child_process';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RootStore } from '../src/root-store.mjs';
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
const probeUserDataDir = path.join(probeDirectory, 'user-data');
const loadedMarker = path.join(smokeDir, 'renderer-loaded.json');
const startupLog = path.join(smokeDir, 'main-started.json');
const probeFreeLLMAPI = process.env.NOEMA_SMOKE_PROBE_FREELLMAPI === '1';
const injectedFreeLlmApiCredential = Boolean(
  process.env.NOEMA_FREELLMAPI_API_KEY?.trim(),
);
const probeQuickCapture = process.env.NOEMA_SMOKE_CAPTURE_QUICK_CAPTURE === '1';
const probeHistoryTrace = process.env.NOEMA_SMOKE_CAPTURE_HISTORY_TRACE === '1';
const probeTimelineSearch =
  process.env.NOEMA_SMOKE_CAPTURE_TIMELINE_SEARCH === '1';
const quickCaptureScreenshotPaths = [
  process.env.NOEMA_SMOKE_QUICK_CAPTURE_DESKTOP_PATH,
  process.env.NOEMA_SMOKE_QUICK_CAPTURE_NARROW_PATH,
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
const historyTraceScreenshotPaths = [
  process.env.NOEMA_SMOKE_HISTORY_TRACE_DESKTOP_PATH,
  process.env.NOEMA_SMOKE_HISTORY_TRACE_INTERMEDIATE_PATH,
  process.env.NOEMA_SMOKE_HISTORY_TRACE_NARROW_PATH,
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
const timelineSearchScreenshotPaths = [
  process.env.NOEMA_SMOKE_TIMELINE_SEARCH_DESKTOP_PATH,
  process.env.NOEMA_SMOKE_TIMELINE_SEARCH_NARROW_PATH,
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
let timelineSearchDatabasePath;
let timelineSearchDshUserDataPath;
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
if (probeTimelineSearch) {
  const timelineSearchDirectory = path.join(smokeDir, 'timeline-search-probe');
  mkdirSync(timelineSearchDirectory, { recursive: true });
  timelineSearchDatabasePath = path.join(
    timelineSearchDirectory,
    'root.sqlite3',
  );
  timelineSearchDshUserDataPath = path.join(
    timelineSearchDirectory,
    'dsh-user-data',
  );
  const fixture = new RootStore(timelineSearchDatabasePath);
  fixture.createCapture(
    '这是 NOEMA-LOCAL-CAPTURE-SEARCH 速记内容，用于验证本机搜索。',
  );
  fixture.close();
}
const childEnvironment = {
  ...process.env,
  NOEMA_SMOKE_TEST: '1',
  NOEMA_SMOKE_TEST_FILE: loadedMarker,
  NOEMA_SMOKE_LOG_FILE: startupLog,
  NOEMA_SMOKE_SESSION_DATA_DIR: path.join(smokeDir, 'session-data'),
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
  ...(probeTimelineSearch
    ? {
        NOEMA_E2E_DATABASE_PATH: timelineSearchDatabasePath,
        NOEMA_E2E_DSH_USER_DATA_PATH: timelineSearchDshUserDataPath,
        NOEMA_SMOKE_CAPTURE_TIMELINE_SEARCH: '1',
      }
    : {}),
  ...(timelineSearchScreenshotPaths[0]
    ? {
        NOEMA_SMOKE_TIMELINE_SEARCH_DESKTOP_PATH:
          timelineSearchScreenshotPaths[0],
      }
    : {}),
  ...(timelineSearchScreenshotPaths[1]
    ? {
        NOEMA_SMOKE_TIMELINE_SEARCH_NARROW_PATH:
          timelineSearchScreenshotPaths[1],
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
    if (probeTimelineSearch) {
      if (
        !loaded.timelineSearchSmoke?.opened ||
        !loaded.timelineSearchSmoke.inputFocused ||
        !loaded.timelineSearchSmoke.matchedCapture ||
        !loaded.timelineSearchSmoke.desktopNoOverflow ||
        !loaded.timelineSearchSmoke.narrowNoOverflow ||
        !loaded.timelineSearchSmoke.focusReturned
      ) {
        console.error(
          'Local timeline search did not find the capture and preserve keyboard focus/layout.',
        );
        process.exitCode = 1;
        return;
      }
      const missingScreenshots = timelineSearchScreenshotPaths.filter(
        (screenshotPath) => !existsSync(screenshotPath),
      );
      if (missingScreenshots.length > 0) {
        console.error(
          `Timeline search screenshots missing: ${missingScreenshots.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(
        `Local timeline search: captured note found and highlighted at desktop/narrow widths; focus returned after close; screenshots: ${loaded.timelineSearchSmoke.screenshots?.join(', ') || 'not requested'}`,
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
