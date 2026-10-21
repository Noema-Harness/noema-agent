import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  safeStorage,
  shell,
  screen,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { EncryptedSecretStore } from './encrypted-secret-store.mjs';
import { runIsolatedWorkerE2E } from './isolated-worker-e2e.mjs';
import { DEFAULT_BASE_URL, FreeLLMAPIClient } from './freellmapi-client.mjs';
import {
  createImportAwareSendMessage,
  registerRootIpc,
  CHANNELS,
} from './root-ipc.mjs';
import { RootAgent } from './root-agent.mjs';
import { RootStore } from './root-store.mjs';
import { SocialChatStore } from './social-chat-store.mjs';
import { SocialChatService } from './social-chat-service.mjs';
import { SocialWorkService } from './social-work-service.mjs';
import { backupBeforeSocialChatMigration } from './social-chat-migration-backup.mjs';
import {
  resolveNoemaDatabasePath,
  resolveNoemaDshUserDataPath,
} from './runtime-paths.mjs';
import {
  CodexAppServerAdapter,
  resolveCodexExecutable,
} from './codex-app-server-adapter.mjs';
import {
  DshHeadlessAdapter,
  resolveDshHeadlessRuntime,
} from './dsh-headless-adapter.mjs';
import {
  createWindowPreferences,
  isInternalNavigation,
  shouldOpenExternally,
} from './window-security.mjs';
import {
  fitsWithinWorkArea,
  resolveInitialWindowSize,
} from './window-geometry.mjs';
import {
  activateQuickCaptureWindow,
  focusPrimaryWindow,
  finishQuickCaptureWindow,
  registerQuickCaptureShortcut,
} from './quick-capture-shortcut.mjs';

function writeSmokeLog(step: string, details: Record<string, unknown> = {}) {
  const logFile = process.env.NOEMA_SMOKE_LOG_FILE;
  if (process.env.NOEMA_SMOKE_TEST !== '1' || !logFile) return;
  fs.writeFileSync(logFile, JSON.stringify({ step, ...details }));
}

writeSmokeLog('main-entry', { argv: process.argv, packaged: app.isPackaged });

const testDataArgument = process.argv.find((argument) =>
  argument.startsWith('--noema-e2e-user-data-dir='),
);
if (!app.isPackaged && testDataArgument) {
  const testPortArgument = process.argv.find((argument) =>
    argument.startsWith('--noema-e2e-port='),
  );
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    testPortArgument?.slice('--noema-e2e-port='.length) ?? '9222',
  );
  const testUserData = path.resolve(
    testDataArgument.slice('--noema-e2e-user-data-dir='.length),
  );
  fs.mkdirSync(testUserData, { recursive: true });
  app.setPath('userData', testUserData);
}

if (
  process.env.NOEMA_SMOKE_TEST === '1' &&
  process.env.NOEMA_SMOKE_USER_DATA_DIR
) {
  const smokeUserData = path.resolve(process.env.NOEMA_SMOKE_USER_DATA_DIR);
  fs.mkdirSync(smokeUserData, { recursive: true });
  app.setPath('userData', smokeUserData);
}

let mainWindow: BrowserWindow | null = null;
let initialWindowFitsWorkArea = false;
let rootStore: RootStore | null = null;
let providerSecretStore: EncryptedSecretStore | null = null;
let unregisterRootIpc: (() => void) | null = null;
let rootAgent: RootAgent | null = null;
let socialChatStore: SocialChatStore | null = null;
let socialChatService: SocialChatService | null = null;
let socialWorkService: SocialWorkService | null = null;
let socialAgentE2eModelRequests: Array<{
  model: string;
  messages: Array<{ role: string; content: string }>;
}> = [];
let quickCaptureShortcutRegistration: ReturnType<
  typeof registerQuickCaptureShortcut
> | null = null;
let quickCaptureReturnToPrevious = false;
let quickCaptureActive = false;
let quickCaptureRendererReady = false;
let pendingQuickCaptureRequest = false;
let shutdownStarted = false;
let shutdownComplete = false;
const testDatabasePath = process.env.NOEMA_E2E_DATABASE_PATH ?? null;
const testDshUserDataPath = process.env.NOEMA_E2E_DSH_USER_DATA_PATH ?? null;
const testWorkerPreface = process.env.NOEMA_E2E_WORKER_PREFACE ?? null;
const testWorkerPrompt = process.env.NOEMA_E2E_WORKER_PROMPT ?? null;
const testRootOnly = process.env.NOEMA_E2E_ROOT_ONLY === '1';
const testHistoryRecall = process.env.NOEMA_E2E_HISTORY_RECALL === '1';
const testDirectWorker = process.env.NOEMA_E2E_DIRECT_WORKER === '1';
const testVerificationChecksJson =
  process.env.NOEMA_E2E_VERIFICATION_CHECKS ?? null;
const testSocialWorkPrompt = process.env.NOEMA_E2E_SOCIAL_WORK_PROMPT ?? null;
const testSocialWorkSourcePrompt =
  process.env.NOEMA_E2E_SOCIAL_WORK_SOURCE_PROMPT ?? null;
const testSocialWorkWorkspace =
  process.env.NOEMA_E2E_SOCIAL_WORK_WORKSPACE ?? null;
const testSocialWorkResultPath =
  process.env.NOEMA_E2E_SOCIAL_WORK_RESULT_PATH ?? null;
const testSocialWorkChecksJson =
  process.env.NOEMA_E2E_SOCIAL_WORK_CHECKS ?? null;
const testSocialWorkSynthetic =
  process.env.NOEMA_E2E_SOCIAL_WORK_SYNTHETIC === '1';
const testSocialWorkProposalSourceId =
  process.env.NOEMA_E2E_SOCIAL_WORK_PROPOSAL_SOURCE_ID ?? null;
const testSocialWorkLiveEpisodes =
  process.env.NOEMA_E2E_SOCIAL_WORK_LIVE_EPISODES === '1';
const testSocialWorkPracticeDecision =
  process.env.NOEMA_E2E_SOCIAL_WORK_PRACTICE_DECISION ?? null;
const testSocialWorkEpisodeAPrompt =
  process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_A_PROMPT ?? null;
const testSocialWorkEpisodeAChecks =
  process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_A_CHECKS ?? null;
const testSocialWorkEpisodeBChecks =
  process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_B_CHECKS ?? null;
const testSocialAgentWorkflow =
  process.env.NOEMA_E2E_SOCIAL_AGENT_WORKFLOW === '1';
const testSocialAgentLiveE2e = process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE === '1';
const testSocialAgentLiveModel =
  process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE_MODEL ?? null;
const socialAgentE2eResultPath =
  process.env.NOEMA_E2E_SOCIAL_AGENT_RESULT_PATH ?? null;
const socialAgentForwardDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_FORWARD_DESKTOP_PATH ?? null;
const socialAgentForwardNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_FORWARD_NARROW_PATH ?? null;
const socialContinuationDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_DESKTOP_PATH ?? null;
const socialContinuationNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_NARROW_PATH ?? null;
const socialContinuationRoomDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_DESKTOP_PATH ?? null;
const socialContinuationRoomNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_NARROW_PATH ?? null;
const testCaptureQuickCapture =
  process.env.NOEMA_SMOKE_CAPTURE_QUICK_CAPTURE === '1';
const testCaptureHistoryTrace =
  process.env.NOEMA_SMOKE_CAPTURE_HISTORY_TRACE === '1';
const testCaptureTimelineSearch =
  process.env.NOEMA_SMOKE_CAPTURE_TIMELINE_SEARCH === '1';
const testCaptureModelAvailability =
  process.env.NOEMA_SMOKE_CAPTURE_MODEL_AVAILABILITY === '1';
const quickCaptureDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_QUICK_CAPTURE_DESKTOP_PATH ?? null;
const quickCaptureNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_QUICK_CAPTURE_NARROW_PATH ?? null;
const historyTraceDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_HISTORY_TRACE_DESKTOP_PATH ?? null;
const historyTraceIntermediateScreenshotPath =
  process.env.NOEMA_SMOKE_HISTORY_TRACE_INTERMEDIATE_PATH ?? null;
const historyTraceNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_HISTORY_TRACE_NARROW_PATH ?? null;
const timelineSearchDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_TIMELINE_SEARCH_DESKTOP_PATH ?? null;
const timelineSearchNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_TIMELINE_SEARCH_NARROW_PATH ?? null;
const modelAvailabilityScreenshotPath =
  process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_SCREENSHOT_PATH ?? null;
const modelAvailabilityNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_NARROW_SCREENSHOT_PATH ?? null;
const captureSocialChatSmoke =
  process.env.NOEMA_SMOKE_CAPTURE_SOCIAL_CHAT === '1';
const runSocialChatLiveSmoke = process.env.NOEMA_SMOKE_SOCIAL_CHAT_LIVE === '1';
const socialChatDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_CHAT_DESKTOP_PATH ?? null;
const socialChatNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_CHAT_NARROW_PATH ?? null;
const socialGroupDialogScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_GROUP_DIALOG_PATH ?? null;
const socialSettingsNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_SETTINGS_NARROW_PATH ?? null;
const socialProjectWorkDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_PROJECT_WORK_PATH ?? null;
const socialProjectWorkNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_PROJECT_WORK_NARROW_PATH ?? null;
const socialAgentCreateDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_AGENT_CREATE_PATH ?? null;
const socialAgentCreateNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_AGENT_CREATE_NARROW_PATH ?? null;
const socialAgentContactDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_PATH ?? null;
const socialAgentContactNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_NARROW_PATH ?? null;
const socialInteractionAdjustmentDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_ADJUSTMENT_DESKTOP_PATH ?? null;
const socialInteractionAdjustmentNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_ADJUSTMENT_NARROW_PATH ?? null;
delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CREATE_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CREATE_NARROW_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_NARROW_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_FORWARD_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_FORWARD_NARROW_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_NARROW_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_NARROW_PATH;
const testSocialWorkCaptureUi =
  process.env.NOEMA_E2E_SOCIAL_WORK_CAPTURE_UI === '1';
delete process.env.NOEMA_E2E_DATABASE_PATH;
delete process.env.NOEMA_E2E_DSH_USER_DATA_PATH;
delete process.env.NOEMA_E2E_WORKER_PREFACE;
delete process.env.NOEMA_E2E_WORKER_PROMPT;
delete process.env.NOEMA_E2E_ROOT_ONLY;
delete process.env.NOEMA_E2E_HISTORY_RECALL;
delete process.env.NOEMA_E2E_DIRECT_WORKER;
delete process.env.NOEMA_E2E_VERIFICATION_CHECKS;
delete process.env.NOEMA_E2E_SOCIAL_WORK_PROMPT;
delete process.env.NOEMA_E2E_SOCIAL_WORK_SOURCE_PROMPT;
delete process.env.NOEMA_E2E_SOCIAL_WORK_WORKSPACE;
delete process.env.NOEMA_E2E_SOCIAL_WORK_RESULT_PATH;
delete process.env.NOEMA_E2E_SOCIAL_WORK_CHECKS;
delete process.env.NOEMA_E2E_SOCIAL_WORK_SYNTHETIC;
delete process.env.NOEMA_E2E_SOCIAL_WORK_PROPOSAL_SOURCE_ID;
delete process.env.NOEMA_E2E_SOCIAL_WORK_LIVE_EPISODES;
delete process.env.NOEMA_E2E_SOCIAL_WORK_PRACTICE_DECISION;
delete process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_A_PROMPT;
delete process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_A_CHECKS;
delete process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_B_CHECKS;
delete process.env.NOEMA_E2E_SOCIAL_WORK_CAPTURE_UI;
delete process.env.NOEMA_E2E_SOCIAL_AGENT_WORKFLOW;
delete process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE;
delete process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE_MODEL;
delete process.env.NOEMA_E2E_SOCIAL_AGENT_RESULT_PATH;
delete process.env.NOEMA_SMOKE_CAPTURE_QUICK_CAPTURE;
delete process.env.NOEMA_SMOKE_CAPTURE_HISTORY_TRACE;
delete process.env.NOEMA_SMOKE_CAPTURE_TIMELINE_SEARCH;
delete process.env.NOEMA_SMOKE_CAPTURE_MODEL_AVAILABILITY;
delete process.env.NOEMA_SMOKE_QUICK_CAPTURE_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_QUICK_CAPTURE_NARROW_PATH;
delete process.env.NOEMA_SMOKE_HISTORY_TRACE_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_HISTORY_TRACE_INTERMEDIATE_PATH;
delete process.env.NOEMA_SMOKE_HISTORY_TRACE_NARROW_PATH;
delete process.env.NOEMA_SMOKE_TIMELINE_SEARCH_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_TIMELINE_SEARCH_NARROW_PATH;
delete process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_SCREENSHOT_PATH;
delete process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_NARROW_SCREENSHOT_PATH;

const isSquirrelLifecycleEvent = process.argv.some((argument) =>
  /^--squirrel-(install|updated|uninstall|obsolete)$/.test(argument),
);
const hasSingleInstanceLock =
  process.env.NOEMA_SMOKE_TEST === '1' ||
  isSquirrelLifecycleEvent ||
  app.requestSingleInstanceLock();

const createWindow = () => {
  quickCaptureRendererReady = false;
  const display = screen.getPrimaryDisplay();
  const windowSize = resolveInitialWindowSize(display.workAreaSize);
  mainWindow = new BrowserWindow({
    ...windowSize,
    backgroundColor: '#f1f3f0',
    webPreferences: createWindowPreferences(
      path.join(__dirname, 'preload.cjs'),
    ),
  });
  initialWindowFitsWorkArea = fitsWithinWorkArea(
    mainWindow.getBounds(),
    display.workArea,
  );

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternalNavigation(url, MAIN_WINDOW_VITE_DEV_SERVER_URL))
      event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    quickCaptureActive = false;
    quickCaptureRendererReady = false;
    pendingQuickCaptureRequest = false;
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingQuickCaptureRequest) dispatchQuickCaptureRequest();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (
    process.env.NOEMA_SMOKE_TEST === '1' &&
    !testSocialWorkCaptureUi &&
    !testSocialAgentWorkflow
  ) {
    mainWindow.webContents.once('did-finish-load', async () => {
      let bridgeProbeStage = 'root-state';
      try {
        const bridgeState = await mainWindow?.webContents.executeJavaScript(
          'window.noema.getRootState()',
        );
        if (!bridgeState || !Array.isArray(bridgeState.messages)) {
          throw new Error('Root conversation bridge did not return its state');
        }
        bridgeProbeStage = 'social-state';
        const socialState = await mainWindow?.webContents.executeJavaScript(
          'window.noema.getSocialState()',
        );
        if (
          !socialState ||
          !Array.isArray(socialState.agents) ||
          !Array.isArray(socialState.rooms)
        ) {
          throw new Error(
            'Social chat bridge did not return contacts and rooms',
          );
        }
        const firstRoom = socialState.rooms[0];
        bridgeProbeStage = 'social-room';
        const socialRoom = firstRoom
          ? await mainWindow?.webContents.executeJavaScript(
              `window.noema.getSocialRoom(${JSON.stringify(firstRoom.id)})`,
            )
          : null;
        if (!socialRoom?.room || !Array.isArray(socialRoom.members)) {
          throw new Error('Social chat room could not be opened through IPC');
        }
        bridgeProbeStage = 'smoke-rendering';
        const quickCaptureSmoke = await captureQuickCaptureSmokeScreenshots();
        const historyTraceSmoke = await captureHistoryTraceSmokeScreenshots();
        const timelineSearchSmoke =
          await captureTimelineSearchSmokeScreenshots();
        const modelAvailabilitySmoke = await inspectModelAvailabilitySmoke(
          bridgeState.models ?? [],
          bridgeState.selectedModel ?? null,
        );
        const socialChatSmoke = await captureSocialChatSmokeScreenshots();
        const socialLiveChatSmoke = await verifyLiveSocialChatSmoke();
        const result = {
          url: mainWindow?.webContents.getURL() ?? null,
          title: mainWindow?.getTitle() ?? null,
          packaged: app.isPackaged,
          windowFitsWorkArea: initialWindowFitsWorkArea,
          rootStateLoaded: true,
          socialChat: {
            agentCount: socialState.agents.length,
            roomCount: socialState.rooms.length,
            firstRoomOpened: true,
          },
          providerConfigured: Boolean(bridgeState.providerConfigured),
          providerBaseUrl: bridgeState.providerBaseUrl ?? null,
          connected: Boolean(bridgeState.connected),
          providerError: bridgeState.error ?? null,
          models: Array.isArray(bridgeState.models)
            ? bridgeState.models.map(
                (model: {
                  name: string;
                  label: string;
                  routeKind: 'router' | 'direct';
                  executionStatus: 'ready' | 'needsKey' | 'exhausted' | null;
                }) => ({
                  name: model.name,
                  label: model.label,
                  routeKind: model.routeKind,
                  executionStatus: model.executionStatus,
                }),
              )
            : [],
          dshAvailable: Boolean(bridgeState.dshAvailable),
          dshWorkerAvailable: Boolean(bridgeState.dshWorkerAvailable),
          dshWorkerError: bridgeState.dshWorkerError ?? null,
          quickCaptureShortcut: quickCaptureShortcutRegistration
            ? {
                accelerator: quickCaptureShortcutRegistration.accelerator,
                registered: quickCaptureShortcutRegistration.registered,
              }
            : null,
          quickCaptureSmoke,
          historyTraceSmoke,
          timelineSearchSmoke,
          modelAvailabilitySmoke,
          socialChatSmoke,
          socialLiveChatSmoke,
        };
        writeSmokeLog('renderer-loaded', result);
        if (process.env.NOEMA_SMOKE_TEST_FILE) {
          fs.writeFileSync(
            process.env.NOEMA_SMOKE_TEST_FILE,
            JSON.stringify(result),
          );
        }
      } catch (error) {
        writeSmokeLog('renderer-bridge-failed', {
          stage: bridgeProbeStage,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      app.quit();
    });
  }
};

function dispatchQuickCaptureRequest() {
  if (!mainWindow || mainWindow.isDestroyed() || !quickCaptureRendererReady) {
    return;
  }
  pendingQuickCaptureRequest = false;
  mainWindow.webContents.send(CHANNELS.quickCaptureRequest, {
    returnToPrevious: quickCaptureReturnToPrevious,
  });
}

function markQuickCaptureReady() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  quickCaptureRendererReady = true;
  if (pendingQuickCaptureRequest) dispatchQuickCaptureRequest();
  return true;
}

function openQuickCapture() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    quickCaptureReturnToPrevious = true;
    quickCaptureActive = true;
    pendingQuickCaptureRequest = true;
    createWindow();
    return;
  }
  const returnToPrevious = activateQuickCaptureWindow(mainWindow);
  if (!quickCaptureActive) {
    quickCaptureReturnToPrevious = returnToPrevious;
    quickCaptureActive = true;
  }

  if (mainWindow.webContents.isLoading() || !quickCaptureRendererReady) {
    pendingQuickCaptureRequest = true;
    return;
  }
  dispatchQuickCaptureRequest();
}

function finishQuickCapture() {
  if (!quickCaptureActive) return false;
  const finished = finishQuickCaptureWindow(
    mainWindow,
    quickCaptureReturnToPrevious,
  );
  quickCaptureActive = false;
  quickCaptureReturnToPrevious = false;
  return finished;
}

function writeSmokeScreenshot(targetPath: string, image: Electron.NativeImage) {
  if (
    app.isPackaged ||
    process.env.NOEMA_SMOKE_TEST !== '1' ||
    !path.isAbsolute(targetPath)
  ) {
    throw new Error('截图只允许由未打包的 smoke 测试写入绝对路径。');
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, image.toPNG(), { flag: 'wx' });
}

async function waitForQuickCaptureDialog() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!mainWindow || mainWindow.isDestroyed()) break;
    const state = await mainWindow.webContents.executeJavaScript(
      `(() => ({
        open: Boolean(document.querySelector('.quick-capture-dialog')?.open),
        focused: document.activeElement?.id === 'quick-capture-input',
      }))()`,
    );
    if (state.open && state.focused) return state;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('快捷速记窗口未打开或输入框未获得焦点。');
}

async function waitForQuickCaptureRender() {
  const deadline = Date.now() + 10_000;
  let shortcutStatusVisible = false;
  while (Date.now() < deadline && mainWindow && !mainWindow.isDestroyed()) {
    const text = await mainWindow.webContents.executeJavaScript(
      "document.querySelector('.composer-hint')?.textContent ?? ''",
    );
    if (text.includes('快速速记') || text.includes('快捷速记不可用')) {
      shortcutStatusVisible = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  if (!shortcutStatusVisible) {
    throw new Error('快捷速记快捷键状态没有显示在主输入区。');
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  return shortcutStatusVisible;
}

async function captureQuickCaptureSmokeScreenshots() {
  if (!testCaptureQuickCapture) return null;
  const shortcutStatusVisible = await waitForQuickCaptureRender();
  openQuickCapture();
  const opened = await waitForQuickCaptureDialog();
  const shortcutBadgeVisible = await mainWindow?.webContents.executeJavaScript(
    `Boolean(document.querySelector('.quick-capture-heading kbd'))`,
  );
  if (
    shortcutBadgeVisible !==
    Boolean(quickCaptureShortcutRegistration?.registered)
  ) {
    throw new Error('速记窗口显示的快捷键与系统注册状态不一致。');
  }
  const screenshots = [];
  if (quickCaptureDesktopScreenshotPath) {
    const image = await mainWindow?.capturePage();
    if (!image) throw new Error('无法捕获快捷速记桌面预览。');
    writeSmokeScreenshot(quickCaptureDesktopScreenshotPath, image);
    screenshots.push(quickCaptureDesktopScreenshotPath);
  }
  if (quickCaptureNarrowScreenshotPath) {
    mainWindow?.setSize(680, 560);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const state = await waitForQuickCaptureDialog();
    if (!state.open || !state.focused) {
      throw new Error('窄窗口下快捷速记未保持可见与键盘焦点。');
    }
    const image = await mainWindow?.capturePage();
    if (!image) throw new Error('无法捕获快捷速记窄窗口预览。');
    writeSmokeScreenshot(quickCaptureNarrowScreenshotPath, image);
    screenshots.push(quickCaptureNarrowScreenshotPath);
  }
  return {
    dialogOpen: opened.open,
    inputFocused: opened.focused,
    shortcutStatusVisible,
    screenshots,
  };
}

async function captureHistoryTraceSmokeScreenshots() {
  if (!testCaptureHistoryTrace) return null;
  const deadline = Date.now() + 10_000;
  let traceState = null;
  while (Date.now() < deadline && mainWindow && !mainWindow.isDestroyed()) {
    traceState = await mainWindow.webContents.executeJavaScript(`(() => {
      const traces = [...document.querySelectorAll('details.history-recall-trace')];
      traces.forEach((trace) => { trace.open = true; });
      const includedTrace = traces.find((trace) =>
        trace.textContent?.includes('本轮请求已包含'),
      );
      includedTrace?.scrollIntoView({ block: 'center' });
      return {
        heading: document.querySelector('.page-heading h1')?.textContent?.trim() ?? null,
        contextActions: [...document.querySelectorAll('.composer-context-tools button')]
          .map((button) => button.textContent?.trim() ?? '')
          .filter(Boolean),
        found: traces.some((trace) =>
          trace.textContent?.includes('本机找到') ||
          trace.textContent?.includes('本轮请求已包含'),
        ),
        included: Boolean(includedTrace),
        sourceCount: document.querySelectorAll('.history-recall-trace li').length,
        jumpButtonCount: document.querySelectorAll('.history-source-heading button:not(:disabled)').length,
        noMatch: traces.some((trace) => trace.textContent?.includes('没有找到相关原文')),
      };
    })()`);
    if (traceState?.found && traceState.sourceCount > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  if (
    !traceState?.found ||
    traceState.sourceCount < 1 ||
    traceState.jumpButtonCount < 1
  ) {
    throw new Error('历史来源披露没有显示可检查的原文来源。');
  }
  await mainWindow?.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const screenshots = [];
  if (historyTraceDesktopScreenshotPath) {
    const image = await mainWindow?.capturePage();
    if (!image) throw new Error('无法捕获历史来源披露桌面预览。');
    writeSmokeScreenshot(historyTraceDesktopScreenshotPath, image);
    screenshots.push(historyTraceDesktopScreenshotPath);
  }
  mainWindow?.setSize(827, 573);
  await mainWindow?.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const intermediateTopbarFits = await mainWindow?.webContents
    .executeJavaScript(`(() => {
    const header = document.querySelector('.topbar');
    if (!header) return false;
    const bounds = header.getBoundingClientRect();
    const controls = [...header.querySelectorAll('.topbar-tools > *')];
    return (
      header.scrollWidth <= header.clientWidth &&
      controls.length >= 4 &&
      controls.every((control) => {
        const rect = control.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.left >= bounds.left - 1 &&
          rect.right <= bounds.right + 1
        );
      })
    );
  })()`);
  if (!intermediateTopbarFits) {
    throw new Error(
      'Model controls overflow the app header at 827 × 573 CSS pixels.',
    );
  }
  if (historyTraceIntermediateScreenshotPath) {
    await mainWindow?.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const image = await mainWindow?.capturePage();
    if (!image) throw new Error('无法捕获历史来源披露中间视口预览。');
    writeSmokeScreenshot(historyTraceIntermediateScreenshotPath, image);
    screenshots.push(historyTraceIntermediateScreenshotPath);
  }
  if (historyTraceNarrowScreenshotPath) {
    mainWindow?.setSize(680, 560);
    await mainWindow?.webContents.executeJavaScript(`new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.querySelector('details.history-recall-trace')?.scrollIntoView({ block: 'center' });
        requestAnimationFrame(resolve);
      }));
    })`);
    const image = await mainWindow?.capturePage();
    if (!image) throw new Error('无法捕获历史来源披露窄窗口预览。');
    writeSmokeScreenshot(historyTraceNarrowScreenshotPath, image);
    screenshots.push(historyTraceNarrowScreenshotPath);
  }
  await mainWindow?.webContents.executeJavaScript(`(() => {
    document.querySelector('.history-source-heading button:not(:disabled)')?.click();
  })()`);
  const jumpWorked = await mainWindow?.webContents
    .executeJavaScript(`new Promise((resolve) => {
    requestAnimationFrame(() => resolve(Boolean(
      document.activeElement?.id?.startsWith('transcript-message-')
    )));
  })`);
  if (!jumpWorked) throw new Error('历史来源按钮没有跳回原时间线消息。');
  return { ...traceState, jumpWorked, intermediateTopbarFits, screenshots };
}

async function captureTimelineSearchSmokeScreenshots() {
  if (!testCaptureTimelineSearch) return null;
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('本地时间线搜索 smoke 没有可用窗口。');
  }
  mainWindow.setSize(1280, 720);
  const opened = await mainWindow.webContents
    .executeJavaScript(`new Promise((resolve) => {
    const trigger = document.querySelector('.conversation-search-trigger');
    if (!trigger) return resolve({ triggerFound: false, inputFocused: false });
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      triggerFound: true,
      inputFocused: document.activeElement?.id === 'conversation-search-input',
    })));
  })`);
  if (!opened.triggerFound || !opened.inputFocused) {
    throw new Error('搜索按钮没有打开面板并将焦点移入搜索框。');
  }

  const desktopState = await mainWindow.webContents
    .executeJavaScript(`new Promise((resolve) => {
    const input = document.querySelector('#conversation-search-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'NOEMA-LOCAL-CAPTURE-SEARCH');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const status = document.querySelector('.conversation-search-status');
      const card = document.querySelector('.capture-card.is-search-current');
      const bounds = card?.getBoundingClientRect();
      const scrollBounds = document.querySelector('.conversation-scroll')?.getBoundingClientRect();
      const contentBounds = card?.querySelector('.capture-content')?.getBoundingClientRect();
      resolve({
        status: status?.textContent?.trim() ?? '',
        highlighted: Boolean(card),
        cardVisible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
        contentVisible: Boolean(
          scrollBounds && contentBounds &&
          contentBounds.top >= scrollBounds.top - 1 &&
          contentBounds.bottom <= scrollBounds.bottom + 1,
        ),
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      });
    }));
  })`);
  if (
    !desktopState.status.includes('1 / 1 · 速记') ||
    !desktopState.highlighted ||
    !desktopState.cardVisible ||
    !desktopState.contentVisible ||
    !desktopState.noHorizontalOverflow
  ) {
    throw new Error('桌面视口没有定位到本机速记搜索结果。');
  }

  const screenshots = [];
  if (timelineSearchDesktopScreenshotPath) {
    writeSmokeScreenshot(
      timelineSearchDesktopScreenshotPath,
      await mainWindow.capturePage(),
    );
    screenshots.push(timelineSearchDesktopScreenshotPath);
  }

  mainWindow.setSize(680, 560);
  const narrowState = await mainWindow.webContents
    .executeJavaScript(`new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const status = document.querySelector('.conversation-search-status');
      const card = document.querySelector('.capture-card.is-search-current');
      const bounds = card?.getBoundingClientRect();
      const scrollBounds = document.querySelector('.conversation-scroll')?.getBoundingClientRect();
        const contentBounds = card?.querySelector('.capture-content')?.getBoundingClientRect();
      resolve({
        status: status?.textContent?.trim() ?? '',
        highlighted: Boolean(card),
        cardVisible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
          contentVisible: Boolean(
            scrollBounds && contentBounds &&
            contentBounds.top >= scrollBounds.top - 1 &&
            contentBounds.bottom <= scrollBounds.bottom + 1,
        ),
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      });
    }));
  })`);
  if (
    !narrowState.status.includes('1 / 1 · 速记') ||
    !narrowState.highlighted ||
    !narrowState.cardVisible ||
    !narrowState.contentVisible ||
    !narrowState.noHorizontalOverflow
  ) {
    throw new Error(
      `窄窗口中速记搜索结果不可见或出现横向溢出：${JSON.stringify(narrowState)}`,
    );
  }
  if (timelineSearchNarrowScreenshotPath) {
    writeSmokeScreenshot(
      timelineSearchNarrowScreenshotPath,
      await mainWindow.capturePage(),
    );
    screenshots.push(timelineSearchNarrowScreenshotPath);
  }

  const focusReturned = await mainWindow.webContents
    .executeJavaScript(`new Promise((resolve) => {
    document.querySelector('.conversation-search-actions button[aria-label="关闭查找"]')?.click();
    requestAnimationFrame(() => resolve(
      document.activeElement?.classList.contains('conversation-search-trigger') ?? false,
    ));
  })`);
  if (!focusReturned) throw new Error('关闭搜索后焦点没有回到打开搜索的按钮。');
  return {
    opened: true,
    inputFocused: opened.inputFocused,
    matchedCapture: desktopState.highlighted && narrowState.highlighted,
    desktopNoOverflow: desktopState.noHorizontalOverflow,
    narrowNoOverflow: narrowState.noHorizontalOverflow,
    focusReturned,
    screenshots,
  };
}

async function inspectModelAvailabilitySmoke(
  models: Array<{
    name: string;
    routeKind: 'router' | 'direct';
    executionStatus: 'ready' | 'needsKey' | 'exhausted' | null;
  }>,
  selectedModel: string | null,
) {
  if (!testCaptureModelAvailability && models.length === 0) return null;
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('模型状态 smoke 没有可用窗口。');
  }
  const socialSurface = await mainWindow.webContents.executeJavaScript(
    'Boolean(document.querySelector(".social-shell"))',
  );
  if (socialSurface) {
    mainWindow.setSize(1280, 720);
    const socialState = await mainWindow.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('select[aria-label="选择对话模型"]');
      const warning = document.querySelector('.provider-warning')?.textContent?.trim() ?? '';
      return {
        options: [...(select?.options ?? [])].map((option) => ({
          value: option.value,
          label: option.textContent?.trim() ?? '',
          disabled: option.disabled,
        })),
        selectedModel: select?.value ?? '',
        connectionLabel: document.querySelector('.model-connection')?.textContent?.trim() ?? '',
        composerDisabled: Boolean(document.querySelector('#social-message-input')?.disabled),
        warning,
      };
    })()`);
    const mismatches = models.flatMap((model) => {
      const option = socialState.options.find(
        (candidate: { value: string; label: string; disabled: boolean }) =>
          candidate.value === model.name,
      );
      if (!option) return [`missing social model option: ${model.name}`];
      if (model.routeKind === 'router' && !option.label.includes('自动')) {
        return [`router is not labeled automatic: ${model.name}`];
      }
      if (
        ['exhausted', 'needsKey'].includes(model.executionStatus ?? '') &&
        !option.disabled
      ) {
        return [`unavailable route is not disabled: ${model.name}`];
      }
      if (model.executionStatus === 'ready' && option.disabled) {
        return [`ready route is disabled: ${model.name}`];
      }
      return [];
    });
    if (mismatches.length) {
      throw new Error(
        `Noema 聊天模型列表与 FreeLLMAPI 状态不一致：${mismatches.join('; ')}`,
      );
    }
    const selectedStatus = models.find(
      (model) => model.name === socialState.selectedModel,
    )?.executionStatus;
    const selectedUnavailable =
      selectedStatus === 'exhausted' || selectedStatus === 'needsKey';
    const expectedLabel = selectedUnavailable
      ? selectedStatus === 'needsKey'
        ? '所选模型需要密钥'
        : '所选模型暂不可用'
      : selectedStatus === 'ready'
        ? '对话已就绪'
        : '模型链状态未知';
    if (!socialState.connectionLabel.includes(expectedLabel)) {
      throw new Error('聊天顶部没有显示所选路由的真实就绪状态。');
    }
    if (selectedUnavailable !== socialState.composerDisabled) {
      throw new Error('所选模型状态与聊天输入框的可用状态不一致。');
    }
    if (selectedUnavailable && !socialState.warning) {
      throw new Error('所选模型不可用时没有给出切换或恢复说明。');
    }

    const screenshots: string[] = [];
    if (modelAvailabilityScreenshotPath) {
      writeSmokeScreenshot(
        modelAvailabilityScreenshotPath,
        await mainWindow.capturePage(),
      );
      screenshots.push(modelAvailabilityScreenshotPath);
    }
    let narrowLayoutValid: boolean | null = null;
    if (modelAvailabilityNarrowScreenshotPath) {
      mainWindow.setSize(680, 560);
      narrowLayoutValid = await mainWindow.webContents
        .executeJavaScript(`(() => {
        const topbar = document.querySelector('.social-topbar');
        return Boolean(
          document.documentElement.scrollWidth <= window.innerWidth &&
          topbar && topbar.scrollWidth <= topbar.clientWidth
        );
      })()`);
      if (!narrowLayoutValid) {
        throw new Error('窄窗口下模型状态标签挤出了聊天界面。');
      }
      writeSmokeScreenshot(
        modelAvailabilityNarrowScreenshotPath,
        await mainWindow.capturePage(),
      );
      screenshots.push(modelAvailabilityNarrowScreenshotPath);
    }
    return {
      verified: true,
      routes: models,
      options: socialState.options,
      selectedModel: socialState.selectedModel,
      connectionLabel: socialState.connectionLabel,
      selectedUnavailable,
      narrowLayoutValid,
      screenshots,
    };
  }
  if (
    modelAvailabilityScreenshotPath ||
    modelAvailabilityNarrowScreenshotPath
  ) {
    mainWindow.setSize(1280, 720);
  }
  const state: {
    options: Array<{ value: string; label: string; disabled: boolean }>;
    selectedModel: string;
    readinessLabel: string;
    readinessStatus: string;
    sendDisabled: boolean;
    unavailableNoticeVisible: boolean;
  } = await mainWindow.webContents.executeJavaScript(`new Promise((resolve) => {
    const draft = document.querySelector('#message-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(draft, '[NOEMA model-status smoke]');
    draft?.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      options: [...(document.querySelector('select[aria-label="选择免费回复模型"]')?.options ?? [])]
        .map((option) => ({ value: option.value, label: option.textContent?.trim() ?? '', disabled: option.disabled })),
      selectedModel: document.querySelector('select[aria-label="选择免费回复模型"]')?.value ?? '',
      readinessLabel: document.querySelector('.model-readiness-badge')?.textContent?.trim() ?? '',
      readinessStatus: document.querySelector('.model-readiness-badge')?.getAttribute('data-status') ?? '',
      sendDisabled: Boolean(document.querySelector('.send-button')?.disabled),
      unavailableNoticeVisible: [...document.querySelectorAll('.connection-notice strong')]
        .some((node) => node.textContent?.includes('所选模型当前不可用')),
    })));
  })`);
  const mismatches = models.flatMap((model) => {
    const option = state.options.find(
      (candidate) => candidate.value === model.name,
    );
    if (!option) return [`missing option: ${model.name}`];
    if (model.routeKind === 'router' && !option.label.includes('自动')) {
      return [`router is not labeled automatic: ${model.name}`];
    }
    if (model.executionStatus === 'ready' && option.disabled) {
      return [`ready route is disabled: ${model.name}`];
    }
    if (model.executionStatus === 'exhausted' && !option.disabled) {
      return [`exhausted route is not disabled: ${model.name}`];
    }
    if (model.executionStatus === 'needsKey' && !option.disabled) {
      return [`unkeyed route is not disabled: ${model.name}`];
    }
    return [];
  });
  if (mismatches.length) {
    throw new Error(
      `模型状态显示不符合 FreeLLMAPI 报告：${mismatches.join('; ')}`,
    );
  }
  const selectedStatus = models.find(
    (model) => model.name === selectedModel,
  )?.executionStatus;
  const selectedUnavailable = Boolean(
    selectedModel &&
    (!models.some((model) => model.name === selectedModel) ||
      selectedStatus === 'exhausted' ||
      selectedStatus === 'needsKey'),
  );
  const expectedReadinessLabel = selectedUnavailable
    ? selectedStatus === 'exhausted'
      ? '冷却中'
      : selectedStatus === 'needsKey'
        ? '需密钥'
        : '不可用'
    : selectedStatus === 'ready'
      ? '可用'
      : '状态未知';
  const expectedReadinessStatus =
    selectedStatus ?? (selectedUnavailable ? 'exhausted' : 'unknown');
  if (
    state.readinessLabel !== expectedReadinessLabel ||
    state.readinessStatus !== expectedReadinessStatus
  ) {
    throw new Error('所选模型的实时状态没有显示在模型控件旁。');
  }
  if (
    selectedUnavailable &&
    (!state.sendDisabled || !state.unavailableNoticeVisible)
  ) {
    throw new Error('不可用的所选模型仍可发送，或没有显示恢复说明。');
  }
  if (!selectedUnavailable && state.sendDisabled) {
    throw new Error('可用的所选模型被错误地阻止发送。');
  }
  const screenshot = modelAvailabilityScreenshotPath
    ? (() => {
        mainWindow.setSize(1280, 720);
        return mainWindow.capturePage();
      })()
    : null;
  if (screenshot && modelAvailabilityScreenshotPath) {
    writeSmokeScreenshot(modelAvailabilityScreenshotPath, await screenshot);
  }
  let narrowLayoutValid: boolean | null = null;
  if (modelAvailabilityNarrowScreenshotPath) {
    mainWindow.setSize(680, 560);
    narrowLayoutValid = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const header = document.querySelector('.topbar');
        const bounds = header?.getBoundingClientRect();
        const controls = [...(header?.querySelectorAll('.topbar-tools > *') ?? [])];
        resolve(Boolean(
          document.documentElement.scrollWidth <= window.innerWidth &&
          header && bounds && header.scrollWidth <= header.clientWidth &&
          controls.every((control) => {
            const rect = control.getBoundingClientRect();
            return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
          })
        ));
      }));
    })`);
    if (!narrowLayoutValid) {
      throw new Error('窄窗口下模型状态标签挤出了顶部控件或页面。');
    }
    writeSmokeScreenshot(
      modelAvailabilityNarrowScreenshotPath,
      await mainWindow.capturePage(),
    );
  }
  return {
    verified: true,
    routeCount: models.length,
    selectedUnavailable,
    narrowLayoutValid,
    routes: models.map((model) => ({
      name: model.name,
      routeKind: model.routeKind,
      executionStatus: model.executionStatus,
    })),
    screenshots: [
      modelAvailabilityScreenshotPath,
      modelAvailabilityNarrowScreenshotPath,
    ].filter(Boolean),
  };
}

async function captureSocialChatSmokeScreenshots() {
  if (!captureSocialChatSmoke) return null;
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('社交聊天 smoke 没有可用窗口。');
  }
  const originalSize = mainWindow.getSize();
  const screenshots: string[] = [];
  try {
    const inspectAt = async (width: number, height: number) => {
      mainWindow?.setSize(width, height);
      await mainWindow?.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      return mainWindow?.webContents.executeJavaScript(`(() => {
        const shell = document.querySelector('.social-shell');
        const panel = document.querySelector('.conversation-panel');
        const header = document.querySelector('.social-topbar');
        const composer = document.querySelector('.message-composer');
        const routing = document.querySelector('.reply-routing');
        const rect = composer?.getBoundingClientRect();
        return {
          loaded: Boolean(shell),
          roomTitle: document.querySelector('.room-header h2')?.textContent?.trim() ?? '',
          participantCount: document.querySelectorAll('.room-header-copy p').length,
          routingChoices: routing?.querySelectorAll('button').length ?? 0,
          composerVisible: Boolean(rect && rect.width > 0 && rect.height > 0 && rect.bottom <= window.innerHeight),
          shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
          panelNoOverflow: Boolean(panel && panel.scrollWidth <= panel.clientWidth),
          headerNoOverflow: Boolean(header && header.scrollWidth <= header.clientWidth),
          documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        };
      })()`);
    };

    await mainWindow.webContents.executeJavaScript(`(() => {
      const group = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.textContent?.includes('工程协作'));
      group?.click();
    })()`);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 80))',
    );

    mainWindow.setSize(1280, 800);
    const desktop = await inspectAt(1280, 800);
    if (
      !desktop?.loaded ||
      desktop.roomTitle !== '工程协作' ||
      desktop.routingChoices !== 2 ||
      !desktop.composerVisible ||
      !desktop.shellNoOverflow ||
      !desktop.panelNoOverflow ||
      !desktop.headerNoOverflow ||
      !desktop.documentNoOverflow
    ) {
      throw new Error(`桌面聊天状态不符合预期：${JSON.stringify(desktop)}`);
    }
    if (socialChatDesktopScreenshotPath) {
      const image = await mainWindow.capturePage();
      writeSmokeScreenshot(socialChatDesktopScreenshotPath, image);
      screenshots.push(socialChatDesktopScreenshotPath);
    }

    const target = await mainWindow.webContents.executeJavaScript(`(() => {
      const buttons = [...document.querySelectorAll('.reply-routing button')];
      buttons[1]?.click();
      return buttons.map((button) => button.getAttribute('aria-pressed'));
    })()`);
    if (target.length !== 2 || target[0] !== 'false' || target[1] !== 'true') {
      throw new Error(`群聊回应对象切换没有生效：${JSON.stringify(target)}`);
    }

    if (
      socialProjectWorkDesktopScreenshotPath ||
      socialProjectWorkNarrowScreenshotPath
    ) {
      const projectMode = await mainWindow.webContents
        .executeJavaScript(`(async () => {
        const workCard = document.querySelector('.project-work-card');
        const button = document.querySelectorAll('.composer-mode-switch button')[1];
        if (!workCard || !button || button.disabled) {
          return { available: false, workCard: Boolean(workCard) };
        }
        button.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          available: true,
          selected: button.getAttribute('aria-pressed') === 'true',
          placeholder: document.querySelector('.message-composer textarea')?.getAttribute('placeholder') ?? '',
        };
      })()`);
      if (!projectMode.available || !projectMode.selected) {
        throw new Error(
          `真实项目工作活动没有进入可操作的聊天状态：${JSON.stringify(projectMode)}`,
        );
      }
      const projectDesktop = await inspectAt(1280, 800);
      if (
        !projectDesktop?.composerVisible ||
        !projectDesktop.shellNoOverflow ||
        !projectDesktop.panelNoOverflow ||
        !projectDesktop.documentNoOverflow
      ) {
        throw new Error(
          `桌面项目工作界面布局不符合预期：${JSON.stringify(projectDesktop)}`,
        );
      }
      if (socialProjectWorkDesktopScreenshotPath) {
        const image = await mainWindow.capturePage();
        writeSmokeScreenshot(socialProjectWorkDesktopScreenshotPath, image);
        screenshots.push(socialProjectWorkDesktopScreenshotPath);
      }
      const projectNarrow = await inspectAt(680, 560);
      if (
        !projectNarrow?.composerVisible ||
        !projectNarrow.shellNoOverflow ||
        !projectNarrow.panelNoOverflow ||
        !projectNarrow.documentNoOverflow
      ) {
        throw new Error(
          `窄窗口项目工作界面布局不符合预期：${JSON.stringify(projectNarrow)}`,
        );
      }
      if (socialProjectWorkNarrowScreenshotPath) {
        const image = await mainWindow.capturePage();
        writeSmokeScreenshot(socialProjectWorkNarrowScreenshotPath, image);
        screenshots.push(socialProjectWorkNarrowScreenshotPath);
      }
      await mainWindow.webContents.executeJavaScript(`(() => {
        document.querySelector('.composer-mode-switch button[aria-pressed="false"]')?.click();
      })()`);
    }

    const groupDialog = await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const trigger = document.querySelector('.new-group-button');
      trigger?.focus();
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dialog = document.querySelector('.social-dialog[aria-labelledby="create-group-title"]');
      const focusable = () => [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? [])];
      const first = dialog?.querySelector('#social-group-title');
      const initiallyFocused = document.activeElement === first;
      const items = focusable();
      items.at(-1)?.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      const tabWrapped = document.activeElement === items[0];
      return {
        opened: Boolean(dialog),
        initiallyFocused,
        focusEntered: Boolean(dialog?.contains(document.activeElement)),
        activeElement: document.activeElement instanceof HTMLElement ? document.activeElement.outerHTML.slice(0, 180) : '',
        firstInput: first instanceof HTMLElement ? first.outerHTML.slice(0, 180) : '',
        tabWrapped,
      };
    })()`);
    if (
      !groupDialog.opened ||
      !groupDialog.initiallyFocused ||
      !groupDialog.tabWrapped
    ) {
      throw new Error(
        `新建群聊对话框的焦点管理不完整：${JSON.stringify(groupDialog)}`,
      );
    }
    if (socialGroupDialogScreenshotPath) {
      await new Promise((resolve) => setTimeout(resolve, 240));
      const image = await mainWindow.capturePage();
      writeSmokeScreenshot(socialGroupDialogScreenshotPath, image);
      screenshots.push(socialGroupDialogScreenshotPath);
    }
    const groupDialogClosed = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        closed: !document.querySelector('.social-dialog[aria-labelledby="create-group-title"]'),
        focusRestored: document.activeElement === document.querySelector('.new-group-button'),
      })));
    })`);
    if (!groupDialogClosed.closed || !groupDialogClosed.focusRestored) {
      throw new Error('关闭新建群聊后没有恢复焦点。');
    }

    const narrow = await inspectAt(680, 560);
    if (
      !narrow?.loaded ||
      narrow.roomTitle !== '工程协作' ||
      narrow.routingChoices !== 2 ||
      !narrow.composerVisible ||
      !narrow.shellNoOverflow ||
      !narrow.panelNoOverflow ||
      !narrow.documentNoOverflow
    ) {
      throw new Error(`窄窗口聊天状态不符合预期：${JSON.stringify(narrow)}`);
    }
    if (socialChatNarrowScreenshotPath) {
      const image = await mainWindow.capturePage();
      writeSmokeScreenshot(socialChatNarrowScreenshotPath, image);
      screenshots.push(socialChatNarrowScreenshotPath);
    }
    const settingsDialog = await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const trigger = document.querySelector('.settings-button');
      trigger?.focus();
      trigger?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const dialog = document.querySelector('.social-dialog[aria-labelledby="connection-settings-title"]');
      const first = dialog?.querySelector('[data-dialog-initial-focus]');
      const modelPicker = dialog?.querySelector('select[aria-label="在设置中选择对话模型"]');
      const initialFocus = document.activeElement === first;
      const items = [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? [])];
      items.at(-1)?.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      return { opened: Boolean(dialog), initialFocus, tabWrapped: document.activeElement === items[0], modelPickerVisible: Boolean(modelPicker) };
    })()`);
    if (
      !settingsDialog.opened ||
      !settingsDialog.initialFocus ||
      !settingsDialog.tabWrapped ||
      !settingsDialog.modelPickerVisible
    ) {
      throw new Error(
        `模型设置对话框缺少键盘边界或窄屏模型入口：${JSON.stringify(settingsDialog)}`,
      );
    }
    if (socialSettingsNarrowScreenshotPath) {
      await new Promise((resolve) => setTimeout(resolve, 240));
      const image = await mainWindow.capturePage();
      writeSmokeScreenshot(socialSettingsNarrowScreenshotPath, image);
      screenshots.push(socialSettingsNarrowScreenshotPath);
    }
    const settingsDialogClosed = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        closed: !document.querySelector('.social-dialog[aria-labelledby="connection-settings-title"]'),
        focusRestored: document.activeElement === document.querySelector('.settings-button'),
      })));
    })`);
    if (!settingsDialogClosed.closed || !settingsDialogClosed.focusRestored) {
      throw new Error('关闭模型设置后没有恢复焦点。');
    }
    return {
      desktop,
      narrow,
      targetSwitchWorked: true,
      groupDialog,
      groupDialogClosed,
      settingsDialog,
      settingsDialogClosed,
      screenshots,
    };
  } finally {
    mainWindow?.setSize(originalSize[0], originalSize[1]);
  }
}

async function captureSocialAgentCreationE2e() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('联系人创建测试没有可用窗口。');
  }
  const adjustmentEditorReady = await mainWindow.webContents
    .executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const setValue = (element, value) => {
      if (!element) throw new Error('互动约定表单缺少字段');
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await waitFor(async () => {
      try {
        const state = await window.noema.getSocialState();
        return state.rooms.length > 0 && document.querySelector('.room-list-item');
      } catch {
        return null;
      }
    }, '联系人和聊天列表初始化');
    const loadedNoemaRoom = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.room-list-title')?.textContent?.trim() === 'Noema');
    if (!loadedNoemaRoom) throw new Error('Noema 私聊未出现在联系人列表中');
    loadedNoemaRoom.click();
    const roomOpened = await waitFor(
      () => document.querySelector('.social-body')?.classList.contains('room-open'),
      'Noema 私聊已打开',
      1200,
    ).catch(() => false);
    if (!roomOpened) {
      throw new Error('点击 Noema 聊天后仍停留在列表：' + JSON.stringify({
        bodyClass: document.querySelector('.social-body')?.className,
        roomTitle: document.querySelector('.room-header h2')?.textContent?.trim(),
        row: loadedNoemaRoom.outerHTML.slice(0, 500),
      }));
    }
    const sourceText = 'E2E 原话标记：分享不愉快经历时，请先问我最在意的部分。';
    const sourceArticle = () => [...document.querySelectorAll('.chat-message.user-message')]
      .find((article) => article.textContent?.includes(sourceText));
    await waitFor(sourceArticle, 'Noema 私聊中的用户原话');
    const sourceAction = [...(sourceArticle()?.querySelectorAll('.message-actions button') ?? [])]
      .find((button) => button.textContent?.trim() === '设为约定');
    if (!sourceAction) throw new Error('Noema 私聊原话没有显示互动约定入口');
    sourceAction.click();
    const form = await waitFor(() => document.querySelector('.interaction-adjustment-editor'), '互动约定行内编辑器');
    setValue(form.querySelector('input'), '用户分享一段不愉快经历但没有请求分析');
    setValue(form.querySelectorAll('textarea')[0], '先回应当下感受，再问用户最在意的部分；不要立刻分析或给建议。');
    const scope = form.querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(scope, 'conversation');
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    setValue(form.querySelectorAll('textarea')[1], '请先问我最在意的部分');
    return true;
  })()`);
  if (!adjustmentEditorReady) {
    throw new Error('互动约定编辑器未打开。');
  }
  const adjustmentDesktopLayout = await mainWindow.webContents
    .executeJavaScript(`(() => {
    const form = document.querySelector('.interaction-adjustment-editor');
    return {
      width: window.innerWidth,
      visible: Boolean(form?.getClientRects().length),
      noOverflow: Boolean(form && form.scrollWidth <= form.clientWidth && document.documentElement.scrollWidth <= window.innerWidth),
      roomOpen: document.querySelector('.social-body')?.classList.contains('room-open') === true,
      roomTitle: document.querySelector('.room-header h2')?.textContent?.trim() ?? '',
    };
  })()`);
  if (socialInteractionAdjustmentDesktopScreenshotPath) {
    writeSmokeScreenshot(
      socialInteractionAdjustmentDesktopScreenshotPath,
      await mainWindow.capturePage(),
    );
  }
  mainWindow.setSize(680, 640);
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const adjustmentNarrowLayout = await mainWindow.webContents
    .executeJavaScript(`(() => {
    const form = document.querySelector('.interaction-adjustment-editor');
    const rect = form?.getBoundingClientRect();
    const thread = document.querySelector('.message-thread');
    const threadRect = thread?.getBoundingClientRect();
    const saveButton = form?.querySelector('button[type="submit"]');
    const saveRect = saveButton?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      visible: Boolean(rect && threadRect && rect.width > 0 && rect.height > 0 && rect.top >= threadRect.top - 2 && rect.bottom <= threadRect.bottom + 2),
      noOverflow: Boolean(form && form.scrollWidth <= form.clientWidth && document.documentElement.scrollWidth <= window.innerWidth),
      saveVisible: Boolean(saveRect && threadRect && saveRect.top >= threadRect.top - 2 && saveRect.bottom <= threadRect.bottom + 2),
      roomOpen: document.querySelector('.social-body')?.classList.contains('room-open') === true,
      roomTitle: document.querySelector('.room-header h2')?.textContent?.trim() ?? '',
      formTop: rect?.top ?? null,
      formBottom: rect?.bottom ?? null,
      threadTop: threadRect?.top ?? null,
      threadBottom: threadRect?.bottom ?? null,
      threadScrollTop: thread?.scrollTop ?? null,
      threadClientHeight: thread?.clientHeight ?? null,
      threadScrollHeight: thread?.scrollHeight ?? null,
      formClientHeight: form?.clientHeight ?? null,
      formScrollHeight: form?.scrollHeight ?? null,
    };
  })()`);
  if (socialInteractionAdjustmentNarrowScreenshotPath) {
    writeSmokeScreenshot(
      socialInteractionAdjustmentNarrowScreenshotPath,
      await mainWindow.capturePage(),
    );
  }
  mainWindow.setSize(1280, 800);
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  if (
    !adjustmentDesktopLayout.visible ||
    !adjustmentDesktopLayout.noOverflow ||
    !adjustmentDesktopLayout.roomOpen ||
    adjustmentDesktopLayout.roomTitle !== 'Noema' ||
    adjustmentNarrowLayout.width > 700 ||
    !adjustmentNarrowLayout.visible ||
    !adjustmentNarrowLayout.noOverflow ||
    !adjustmentNarrowLayout.saveVisible ||
    !adjustmentNarrowLayout.roomOpen ||
    adjustmentNarrowLayout.roomTitle !== 'Noema'
  ) {
    throw new Error(
      `互动约定编辑器布局不符合预期：${JSON.stringify({ desktop: adjustmentDesktopLayout, narrow: adjustmentNarrowLayout })}`,
    );
  }
  const interactionAdjustments = await mainWindow.webContents
    .executeJavaScript(`(async () => {
    const waitFor = async (predicate, label, timeoutMs = 10000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const setValue = (element, value) => {
      if (!element) throw new Error('互动约定测试缺少输入框');
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const sourceText = 'E2E 原话标记：分享不愉快经历时，请先问我最在意的部分。';
    const sourceArticle = () => [...document.querySelectorAll('.chat-message.user-message')]
      .find((article) => article.textContent?.includes(sourceText));
    const form = document.querySelector('.interaction-adjustment-editor');
    if (!form) throw new Error('窄屏核验后互动约定编辑器没有恢复');
    form.querySelector('button[type="submit"]')?.click();
    const saved = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      return state.interactionAdjustments?.find((item) =>
        item.sourceSurface === 'social' &&
        item.sourceRoomId === 'room-noema' &&
        item.sourceQuote === '请先问我最在意的部分'
      ) ?? null;
    }, '互动约定持久化');
    const sourceState = await window.noema.getSocialRoom('room-noema');
    const sourceMessage = sourceState.messages.find((message) => message.role === 'user' && message.content.includes(sourceText));
    const sourceValidated = saved.sourceTurnId === sourceMessage?.turnId;
    const send = async (text) => {
      const input = document.querySelector('#social-message-input');
      setValue(input, text);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return waitFor(async () => {
        const room = await window.noema.getSocialRoom('room-noema');
        const user = [...room.messages].reverse().find((message) => message.role === 'user' && message.content === text);
        const reply = user ? room.messages.find((message) => message.turnId === user.turnId && message.role === 'assistant') : null;
        return reply?.status === 'complete' ? { user, reply } : null;
      }, 'Noema 合成回复', 10000);
    };
    const firstReply = await send('E2E 后续消息：今天发生了一件让我有点难受的事。');
    const usedOnNoemaReply = firstReply.reply.interactionAdjustmentIds?.includes(saved.id) === true;
    const currentSourceArticle = sourceArticle();
    const savedAction = [...(currentSourceArticle?.querySelectorAll('.message-actions button') ?? [])]
      .find((button) => button.textContent?.trim() === '互动约定');
    savedAction?.click();
    const editForm = await waitFor(() => document.querySelector('.interaction-adjustment-editor'), '已保存互动约定的管理入口');
    const revisedBehavior = '先回应情绪，再问一个具体问题；不自动给建议。';
    setValue(editForm.querySelector('textarea'), revisedBehavior);
    editForm.querySelector('button[type="submit"]')?.click();
    const updated = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      return state.interactionAdjustments?.find((item) =>
        item.id === saved.id && item.status === 'active' && item.behavior === revisedBehavior
      ) ?? null;
    }, '互动约定修改后持久化');
    const updateReply = await send('E2E 修改后消息：想起这件事还是有些不舒服。');
    const usedUpdatedBehavior = updateReply.reply.interactionAdjustmentSnapshots?.some(
      (item) => item.id === saved.id && item.behavior === revisedBehavior,
    ) === true;
    const updatedAction = [...(sourceArticle()?.querySelectorAll('.message-actions button') ?? [])]
      .find((button) => button.textContent?.trim() === '互动约定');
    updatedAction?.click();
    await waitFor(() => document.querySelector('.interaction-adjustment-editor'), '修改后互动约定管理入口');
    document.querySelector('.interaction-adjustment-withdraw')?.click();
    const withdrawn = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      return state.interactionAdjustments?.find((item) => item.id === saved.id && item.status === 'withdrawn') ?? null;
    }, '互动约定撤回状态');
    const secondReply = await send('E2E 撤回后消息：再聊一件普通小事。');
    const notUsedAfterWithdrawal = !secondReply.reply.interactionAdjustmentIds?.includes(saved.id);
    return {
      created: Boolean(saved),
      sourceValidated,
      usedOnNoemaReply,
      updated: updated.behavior === revisedBehavior,
      usedUpdatedBehavior,
      withdrawn: withdrawn.status === 'withdrawn',
      notUsedAfterWithdrawal,
      layout: { desktop: ${JSON.stringify(adjustmentDesktopLayout)}, narrow: ${JSON.stringify(adjustmentNarrowLayout)} },
      snapshots: {
        first: firstReply.reply.interactionAdjustmentSnapshots,
        updated: updateReply.reply.interactionAdjustmentSnapshots,
        second: secondReply.reply.interactionAdjustmentSnapshots,
      },
    };
  })()`);
  const interactionRequests = socialAgentE2eModelRequests.splice(0);
  interactionAdjustments.usedOnNoemaReply &&=
    interactionRequests[0]?.messages.some((message) =>
      message.content.includes('先回应当下感受'),
    ) === true;
  interactionAdjustments.notUsedAfterWithdrawal &&=
    interactionRequests[2]?.messages.some((message) =>
      message.content.includes('先回应当下感受'),
    ) === false;
  interactionAdjustments.usedUpdatedBehavior &&=
    interactionRequests[1]?.messages.some((message) =>
      message.content.includes('先回应情绪，再问一个具体问题'),
    ) === true;
  if (
    !interactionAdjustments?.created ||
    !interactionAdjustments.sourceValidated ||
    !interactionAdjustments.usedOnNoemaReply ||
    !interactionAdjustments.updated ||
    !interactionAdjustments.usedUpdatedBehavior ||
    !interactionAdjustments.withdrawn ||
    !interactionAdjustments.notUsedAfterWithdrawal
  ) {
    throw new Error(
      `社交聊天互动约定链路不符合预期：${JSON.stringify(interactionAdjustments)}`,
    );
  }
  if (
    !interactionAdjustments.layout?.desktop?.visible ||
    !interactionAdjustments.layout?.desktop?.noOverflow ||
    interactionAdjustments.layout?.narrow?.width > 700 ||
    !interactionAdjustments.layout?.narrow?.visible ||
    !interactionAdjustments.layout?.narrow?.noOverflow
  ) {
    throw new Error(
      `互动约定编辑器布局不符合预期：${JSON.stringify(interactionAdjustments.layout)}`,
    );
  }
  socialAgentE2eModelRequests = [];
  const forwardingSelection = await mainWindow.webContents
    .executeJavaScript(`(async () => {
    const waitFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    await waitFor(() => document.querySelector('.room-list-item'), '联系人和聊天列表初始化');
    const sourceRoomItem = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.room-list-title')?.textContent?.trim() === '工程搭档');
    if (!sourceRoomItem) throw new Error('找不到工程搭档私聊');
    sourceRoomItem.click();
    await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === '工程搭档', '工程搭档私聊');
    const findSourceUser = () => [...document.querySelectorAll('.chat-message.user-message')]
      .find((article) => article.textContent?.includes('OpenAI 官方发布说明'));
    if (!findSourceUser()) throw new Error('找不到来源私聊中的目标消息');
    const sourceRoom = await window.noema.getSocialRoom('room-engineering-partner');
    const initialTargetCount = (await window.noema.getSocialRoom('room-engineering-collaboration')).messages.length;
    const clickForward = () => {
      const button = [...(findSourceUser()?.querySelectorAll('.message-actions button') ?? [])]
        .find((candidate) => candidate.textContent?.trim() === '转发');
      if (!button) throw new Error('来源消息没有显示转发操作');
      button.click();
    };
    clickForward();
    await waitFor(() => document.querySelector('.forward-selection-toolbar'), '转发消息选择状态');
    const selectSecondMessage = () => {
      const secondSource = [...document.querySelectorAll('.chat-message.agent-message')]
        .find((article) => article.textContent?.includes('收到：我会先核对 OpenAI 官方发布说明'));
      const button = [...(secondSource?.querySelectorAll('.message-actions button') ?? [])]
        .find((candidate) => candidate.textContent?.includes('选择转发'));
      if (!button) throw new Error('无法把同一私聊中的第二条消息加入合并转发');
      button.click();
    };
    selectSecondMessage();
    await waitFor(
      () => document.querySelectorAll('.message-actions button.is-selected').length === 2,
      '取消前选中两条消息',
    );
    const selectedBeforeCancel = document.querySelectorAll('.message-actions button.is-selected').length;
    document.querySelector('.forward-selection-toolbar button:not(.primary-action)')?.click();
    await waitFor(() => !document.querySelector('.forward-selection-toolbar'), '取消转发选择');
    const targetCountAfterCancel = (await window.noema.getSocialRoom('room-engineering-collaboration')).messages.length;
    const cancelHadNoSend = initialTargetCount === targetCountAfterCancel;
    clickForward();
    await waitFor(() => document.querySelector('.forward-selection-toolbar'), '重新开始转发');
    selectSecondMessage();
    await waitFor(
      () => document.querySelectorAll('.message-actions button.is-selected').length === 2,
      '合并转发选中两条消息',
    );
    document.querySelector('.forward-selection-toolbar .primary-action')?.click();
    await waitFor(() => document.querySelector('.forward-dialog'), '转发目标选择窗口');
    return {
      sourceTitle: sourceRoom.room.title,
      selectedCount: document.querySelectorAll('.message-actions button.is-selected').length,
      previewContainsSource: Boolean(document.querySelector('.forward-dialog-preview')?.textContent?.includes('OpenAI 官方发布说明')),
      previewHasTwoMessages: document.querySelectorAll('.forward-dialog-preview article').length === 2,
      targetCanBeChosen: Boolean(document.querySelector('.forward-dialog select option[value="room-engineering-collaboration"]')),
      cancelHadNoSend,
      selectedBeforeCancel,
    };
  })()`);
  mainWindow.setSize(1280, 800);
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  await new Promise((resolve) => setTimeout(resolve, 240));
  if (socialAgentForwardDesktopScreenshotPath) {
    const image = await mainWindow.capturePage();
    writeSmokeScreenshot(socialAgentForwardDesktopScreenshotPath, image);
  }
  mainWindow.setSize(680, 560);
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const forwardNarrow = await mainWindow.webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('.forward-dialog');
    const shell = document.querySelector('.social-shell');
    const rect = dialog?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      dialogVisible: Boolean(rect && rect.width > 0 && rect.height > 0),
      dialogInViewport: Boolean(rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight),
      dialogNoOverflow: Boolean(dialog && dialog.scrollWidth <= dialog.clientWidth),
      shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
      documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  })()`);
  if (
    !forwardNarrow.dialogVisible ||
    !forwardNarrow.dialogInViewport ||
    !forwardNarrow.dialogNoOverflow ||
    !forwardNarrow.shellNoOverflow ||
    !forwardNarrow.documentNoOverflow
  ) {
    throw new Error(
      `转发目标选择窄屏布局不符合预期：${JSON.stringify(forwardNarrow)}`,
    );
  }
  if (socialAgentForwardNarrowScreenshotPath) {
    const image = await mainWindow.capturePage();
    writeSmokeScreenshot(socialAgentForwardNarrowScreenshotPath, image);
  }
  mainWindow.setSize(1280, 800);
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const forwardingSent = await mainWindow.webContents
    .executeJavaScript(`(async () => {
    const liveResponseTimeout = ${testSocialAgentLiveE2e ? 65_000 : 7_000};
    const waitFor = async (predicate, label, timeoutMs = 7000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const choose = document.querySelector('.forward-dialog select');
    if (!choose) throw new Error('缺少转发目标选择器');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(choose, 'room-engineering-collaboration');
    choose.dispatchEvent(new Event('change', { bubbles: true }));
    const sendButton = document.querySelector('.forward-dialog button[type="submit"]');
    if (!sendButton || sendButton.disabled) throw new Error('转发目标未准备好');
    sendButton.click();
    const state = await waitFor(async () => {
      const room = await window.noema.getSocialRoom('room-engineering-collaboration');
      const user = [...room.messages].reverse().find((message) => message.role === 'user' && message.forwardedSources?.length === 2);
      return user ? { room, user } : null;
    }, '合并转发消息送达目标聊天');
    await waitFor(
      () =>
        [...document.querySelectorAll('.forwarded-message-card')].some(
          (item) => item.textContent?.includes('工程搭档'),
        ),
      '目标聊天中的转发卡片',
    );
    const assistantForForward = state.room.messages.find(
      (message) => message.turnId === state.user.turnId && message.role === 'assistant',
    );
    const userArticle = [...document.querySelectorAll('.chat-message.user-message')]
      .find((article) => article.querySelector('.forwarded-message-card')?.textContent?.includes('OpenAI 官方发布说明'));
    return {
      bundlePersisted: state.user.forwardedSources.length === 2,
      forwardCreatedAssistant: Boolean(assistantForForward),
      sourceRoom: state.user.forwardedSources[0]?.roomTitle ?? null,
      forwardCardVisible: Boolean(userArticle?.querySelector('.forwarded-message-card')),
      selectedContent: state.user.forwardedSources.map((source) => source.content),
    };
  })()`);
  forwardingSent.forwardingDidNotTriggerResponse =
    !forwardingSent.forwardCreatedAssistant &&
    socialAgentE2eModelRequests.length === 0;
  const forwardingReply = await mainWindow.webContents
    .executeJavaScript(`(async () => {
    const liveResponseTimeout = ${testSocialAgentLiveE2e ? 65_000 : 7000};
    const waitFor = async (predicate, label, timeoutMs = 7000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const userArticle = [...document.querySelectorAll('.chat-message.user-message')]
      .find((article) => article.querySelector('.forwarded-message-card')?.textContent?.includes('OpenAI 官方发布说明'));
    let replyExcerptVisible = false;
    if (!${testSocialAgentLiveE2e}) {
      const replyButton = [...(userArticle?.querySelectorAll('.message-actions button') ?? [])]
        .find((button) => button.textContent?.trim() === '回复');
      if (!replyButton) throw new Error('转发消息没有当前房间回复入口');
      replyButton.click();
      await waitFor(() => document.querySelector('.reply-composer-preview'), '当前房间回复预览');
      replyExcerptVisible = document.querySelector('.reply-composer-preview')?.textContent?.includes('OpenAI 官方发布说明') ?? false;
    }
    const textarea = document.querySelector('#social-message-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, '请说说这两条消息的重点。');
    textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.message-composer button[type="submit"]')?.click();
    const replied = await waitFor(async () => {
      const room = await window.noema.getSocialRoom('room-engineering-collaboration');
      const user = [...room.messages].reverse().find((message) => message.role === 'user' && message.content.includes('请说说这两条消息的重点。'));
      const assistant = user ? room.messages.find((message) => message.turnId === user.turnId && message.role === 'assistant') : null;
      if (assistant?.status === 'failed' || assistant?.status === 'interrupted') {
        throw new Error(
          '转发后的后续请求未完成：' +
            (assistant.errorCode ?? assistant.status),
        );
      }
      return user && assistant?.status === 'complete' ? { room, user, assistant } : null;
    }, '转发后的单独消息及模型回应', liveResponseTimeout);
    return {
      replyExcerptVisible,
      currentRoomReplyAttached: replied.user.replyTo?.roomId === 'room-engineering-collaboration',
      replyText: replied.user.content,
      realReplyStatus: replied.assistant.status,
      realReplyLength: replied.assistant.content.length,
      realReplyText: replied.assistant.content.slice(0, 800),
    };
  })()`);
  Object.assign(forwardingSent, forwardingReply);
  const modelRequest = socialAgentE2eModelRequests.at(-1);
  const modelInput =
    modelRequest?.messages.map((message) => message.content).join('\n') ?? '';
  forwardingSent.modelInputVerified = Boolean(
    modelRequest?.model ===
      (testSocialAgentLiveE2e ? testSocialAgentLiveModel : 'e2e-local-spy') &&
    modelInput.includes('用户转发的聊天消息') &&
    modelInput.includes('来自「工程搭档」') &&
    modelInput.includes('OpenAI 官方发布说明') &&
    !modelInput.includes('紫水晶') &&
    modelInput.endsWith('请说说这两条消息的重点。'),
  );
  forwardingSent.liveProviderUsed =
    testSocialAgentLiveE2e && socialAgentE2eModelRequests.length === 1;
  forwardingSent.liveProviderReplyComplete =
    testSocialAgentLiveE2e &&
    forwardingSent.realReplyStatus === 'complete' &&
    forwardingSent.realReplyLength > 0;
  forwardingSent.followUpTriggeredOneResponse =
    !testSocialAgentLiveE2e && socialAgentE2eModelRequests.length === 1;
  if (
    forwardingSelection.selectedCount !== 2 ||
    forwardingSelection.selectedBeforeCancel !== 2 ||
    !forwardingSelection.previewContainsSource ||
    !forwardingSelection.previewHasTwoMessages ||
    !forwardingSelection.targetCanBeChosen ||
    !forwardingSelection.cancelHadNoSend ||
    !forwardingSent.bundlePersisted ||
    !forwardingSent.forwardingDidNotTriggerResponse ||
    !forwardingSent.forwardCardVisible ||
    (!testSocialAgentLiveE2e && !forwardingSent.replyExcerptVisible) ||
    (!testSocialAgentLiveE2e && !forwardingSent.currentRoomReplyAttached) ||
    !forwardingSent.modelInputVerified ||
    (!testSocialAgentLiveE2e && !forwardingSent.followUpTriggeredOneResponse) ||
    (testSocialAgentLiveE2e &&
      (!forwardingSent.liveProviderUsed ||
        !forwardingSent.liveProviderReplyComplete))
  ) {
    throw new Error(
      `消息转发/回复流程与模型输入不符合预期：${JSON.stringify({ forwardingSelection, forwardingSent, modelRequest })}`,
    );
  }
  const continuationThreadWorkflow = await mainWindow.webContents
    .executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const setValue = (element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const noemaRoom = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.room-list-title')?.textContent?.trim() === 'Noema');
    if (!noemaRoom) throw new Error('找不到 Noema 主聊天');
    noemaRoom.click();
    await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === 'Noema', 'Noema 主聊天');
    const sourceText = 'E2E 原话标记：分享不愉快经历时，请先问我最在意的部分。';
    const sourceMessage = () => [...document.querySelectorAll('.chat-message.user-message')]
      .find((article) => article.textContent?.includes(sourceText));
    const source = await waitFor(sourceMessage, '来源消息');
    const sourceId = source.dataset.messageId;
    [...source.querySelectorAll('.message-actions button')]
      .find((button) => button.textContent?.trim() === '转发')?.click();
    await waitFor(() => document.querySelector('.forward-selection-toolbar'), '消息选择状态');
    [...document.querySelectorAll('.forward-selection-toolbar button')]
      .find((button) => button.textContent?.trim() === '开主题')?.click();
    await waitFor(() => document.querySelector('[aria-labelledby="continuation-title"]'), '主题创建窗口');
    setValue(document.querySelector('[aria-labelledby="continuation-title"] input'), 'E2E 持续主题');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { sourceId, dialogVisible: Boolean(document.querySelector('[aria-labelledby="continuation-title"]')) };
  })()`);
  mainWindow.setSize(1280, 800);
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  if (socialContinuationDesktopScreenshotPath) {
    writeSmokeScreenshot(
      socialContinuationDesktopScreenshotPath,
      await mainWindow.capturePage(),
    );
  }
  mainWindow.setSize(680, 560);
  const continuationNarrow = await mainWindow.webContents
    .executeJavaScript(`(() => {
    const dialog = document.querySelector('[aria-labelledby="continuation-title"]');
    const rect = dialog?.getBoundingClientRect();
    const shell = document.querySelector('.social-shell');
    return {
      width: window.innerWidth,
      visible: Boolean(rect && rect.width > 0 && rect.height > 0),
      inViewport: Boolean(rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight),
      dialogNoOverflow: Boolean(dialog && dialog.scrollWidth <= dialog.clientWidth),
      shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
      documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  })()`);
  if (socialContinuationNarrowScreenshotPath) {
    writeSmokeScreenshot(
      socialContinuationNarrowScreenshotPath,
      await mainWindow.capturePage(),
    );
  }
  if (
    !continuationThreadWorkflow.dialogVisible ||
    !continuationNarrow.visible ||
    !continuationNarrow.inViewport ||
    !continuationNarrow.dialogNoOverflow ||
    !continuationNarrow.shellNoOverflow ||
    !continuationNarrow.documentNoOverflow
  ) {
    throw new Error(
      `主题创建窗口布局不符合预期：${JSON.stringify({ continuationThreadWorkflow, continuationNarrow })}`,
    );
  }
  const continuationCreated = await mainWindow.webContents
    .executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const titleInput = document.querySelector('[aria-labelledby="continuation-title"] input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(titleInput, 'E2E 持续主题');
    titleInput?.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('[aria-labelledby="continuation-title"] button[type="submit"]')][0]?.click();
    await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === 'E2E 持续主题', '新主题聊天');
    const state = await window.noema.getSocialState();
    const room = state.rooms.find((item) => item.title === 'E2E 持续主题');
    const snapshot = await window.noema.getSocialRoom(room.id);
    const originVisible = snapshot.messages[0]?.forwardedSources?.some((item) => item.id === ${JSON.stringify(continuationThreadWorkflow.sourceId)});
    const originIdMatches = room.originMessageId === ${JSON.stringify(continuationThreadWorkflow.sourceId)};
    const originLabelVisible = document.querySelector('.forwarded-message-card')?.textContent?.includes('来源消息') === true;
    return { threadRoomId: room.id, originVisible, originIdMatches, originLabelVisible };
  })()`);
  mainWindow.setSize(1280, 800);
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  if (socialContinuationRoomDesktopScreenshotPath) {
    writeSmokeScreenshot(
      socialContinuationRoomDesktopScreenshotPath,
      await mainWindow.capturePage(),
    );
  }
  mainWindow.setSize(680, 560);
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const continuationRoomNarrow = await mainWindow.webContents
    .executeJavaScript(`(() => {
    const shell = document.querySelector('.social-shell');
    const panel = document.querySelector('.conversation-panel');
    const header = document.querySelector('.room-header');
    return {
      width: window.innerWidth,
      roomTitle: document.querySelector('.room-header h2')?.textContent?.trim() ?? '',
      shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
      panelNoOverflow: Boolean(panel && panel.scrollWidth <= panel.clientWidth),
      headerNoOverflow: Boolean(header && header.scrollWidth <= header.clientWidth),
      documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  })()`);
  if (socialContinuationRoomNarrowScreenshotPath) {
    writeSmokeScreenshot(
      socialContinuationRoomNarrowScreenshotPath,
      await mainWindow.capturePage(),
    );
  }
  mainWindow.setSize(1280, 800);
  const continuationLifecycle = await mainWindow.webContents
    .executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const room = (await window.noema.getSocialState()).rooms.find((item) => item.id === ${JSON.stringify(continuationCreated.threadRoomId)});
    document.querySelector('.continuation-parent-link')?.click();
    await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === 'Noema', '来源聊天回链');
    const sourceLink = await waitFor(() => [...document.querySelectorAll('.message-continuation-link')].find((item) => item.textContent?.includes('E2E 持续主题')), '来源消息上的主题链接');
    const originBacklinkVisible = Boolean(sourceLink);
    sourceLink.click();
    await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === 'E2E 持续主题', '返回主题聊天');
    const closeButton = [...document.querySelectorAll('.room-header-meta button')].find((button) => button.textContent?.trim() === '结束主题');
    closeButton?.click();
    await waitFor(async () => (await window.noema.getSocialRoom(room.id)).room.closedAt, '结束主题');
    await waitFor(() => document.querySelector('#social-message-input')?.disabled, '已结束主题的输入锁定');
    const closedComposerDisabled = Boolean(document.querySelector('#social-message-input')?.disabled);
    const reopenButton = await waitFor(() => [...document.querySelectorAll('.room-header-meta button')]
      .find((button) => button.textContent?.trim() === '重新打开' && !button.disabled), '重新打开按钮就绪');
    reopenButton.click();
    await waitFor(async () => !(await window.noema.getSocialRoom(room.id)).room.closedAt, '重新打开主题');
    const deleteButton = await waitFor(() => [...document.querySelectorAll('.room-header-meta button')]
      .find((button) => button.textContent?.trim() === '删除' && !button.disabled), '删除按钮就绪');
    window.confirm = () => true;
    deleteButton.click();
    await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === 'Noema', '删除后返回来源聊天');
    const afterDelete = await window.noema.getSocialState();
    return {
      originBacklinkVisible,
      closedComposerDisabled,
      deleted: !afterDelete.rooms.some((item) => item.id === room.id),
      parentPreserved: afterDelete.rooms.some((item) => item.id === 'room-noema'),
    };
  })()`);
  Object.assign(continuationLifecycle, continuationCreated, {
    threadNarrow: continuationRoomNarrow,
  });
  if (
    !continuationLifecycle.originVisible ||
    !continuationLifecycle.originIdMatches ||
    !continuationLifecycle.originLabelVisible ||
    !continuationLifecycle.originBacklinkVisible ||
    !continuationLifecycle.closedComposerDisabled ||
    !continuationLifecycle.deleted ||
    !continuationLifecycle.parentPreserved ||
    continuationRoomNarrow.width > 700 ||
    continuationRoomNarrow.roomTitle !== 'E2E 持续主题' ||
    !continuationRoomNarrow.shellNoOverflow ||
    !continuationRoomNarrow.panelNoOverflow ||
    !continuationRoomNarrow.headerNoOverflow ||
    !continuationRoomNarrow.documentNoOverflow
  ) {
    throw new Error(
      `主题线程生命周期不符合预期：${JSON.stringify(continuationLifecycle)}`,
    );
  }
  mainWindow.setSize(1280, 800);
  await mainWindow.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 5000;
    const createButton = document.querySelector('.new-agent-button');
    createButton?.focus();
    createButton?.click();
    while (Date.now() < deadline && !document.querySelector('#social-agent-name')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 220));
  })()`);
  const inspectCreateDialog = async (width: number, height: number) => {
    mainWindow?.setSize(width, height);
    await mainWindow?.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    return mainWindow?.webContents.executeJavaScript(`(() => {
      const shell = document.querySelector('.social-shell');
      const dialog = document.querySelector('.agent-create-dialog');
      const rect = dialog?.getBoundingClientRect();
      const submit = dialog?.querySelector('button[type="submit"]');
      const submitRect = submit?.getBoundingClientRect();
      return {
        dialogVisible: Boolean(rect && rect.width > 0 && rect.height > 0),
        dialogInViewport: Boolean(rect && rect.top >= 0 && rect.bottom <= window.innerHeight),
        fields: dialog?.querySelectorAll('.dialog-field').length ?? 0,
        submitVisible: Boolean(
          submitRect &&
            rect &&
            submitRect.top >= rect.top &&
            submitRect.bottom <= rect.bottom &&
            submitRect.bottom <= window.innerHeight,
        ),
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    })()`);
  };
  const dialogDesktop = await inspectCreateDialog(1280, 800);
  if (
    !dialogDesktop?.dialogVisible ||
    !dialogDesktop.dialogInViewport ||
    dialogDesktop.fields !== 3 ||
    !dialogDesktop.submitVisible ||
    !dialogDesktop.shellNoOverflow ||
    !dialogDesktop.documentNoOverflow
  ) {
    throw new Error(
      `桌面创建联系人表单布局不符合预期：${JSON.stringify(dialogDesktop)}`,
    );
  }
  if (socialAgentCreateDesktopScreenshotPath) {
    const image = await mainWindow.capturePage();
    writeSmokeScreenshot(socialAgentCreateDesktopScreenshotPath, image);
  }
  const dialogNarrow = await inspectCreateDialog(680, 560);
  if (
    !dialogNarrow?.dialogVisible ||
    !dialogNarrow.dialogInViewport ||
    dialogNarrow.fields !== 3 ||
    !dialogNarrow.submitVisible ||
    !dialogNarrow.shellNoOverflow ||
    !dialogNarrow.documentNoOverflow
  ) {
    throw new Error(
      `窄窗口创建联系人表单布局不符合预期：${JSON.stringify(dialogNarrow)}`,
    );
  }
  if (socialAgentCreateNarrowScreenshotPath) {
    const image = await mainWindow.capturePage();
    writeSmokeScreenshot(socialAgentCreateNarrowScreenshotPath, image);
  }
  mainWindow.setSize(1280, 800);
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const dialogCancel = await mainWindow.webContents
    .executeJavaScript(`(async () => {
    const waitFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const deadline = Date.now() + 5000;
    const initialDialog = {
      focusedName: document.activeElement?.id === 'social-agent-name',
      fieldCount: document.querySelectorAll('.agent-create-dialog .dialog-field').length,
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    while (Date.now() < deadline && document.querySelector('.agent-create-dialog')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (document.querySelector('.agent-create-dialog')) throw new Error('Escape 没有关闭创建联系人表单');
    await waitFrames();
    return {
      initialDialog,
      cancelReturnedFocus: document.activeElement?.classList?.contains('new-agent-button') ?? false,
      cancelFocusTarget: {
        tagName: document.activeElement?.tagName ?? null,
        className: document.activeElement?.className ?? null,
        buttonConnected: Boolean(document.querySelector('.new-agent-button')?.isConnected),
        buttonVisible: Boolean(document.querySelector('.new-agent-button')?.getClientRects().length),
      },
    };
  })()`);
  mainWindow.setSize(360, 640);
  await mainWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const result = await mainWindow.webContents.executeJavaScript(`(async () => {
    const waitFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const setValue = (element, value) => {
      if (!element) throw new Error('找不到表单字段');
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const initial = await window.noema.getSocialState();
    const initialDialog = ${JSON.stringify(dialogCancel.initialDialog)};
    const cancelReturnedFocus = ${JSON.stringify(dialogCancel.cancelReturnedFocus)};
    const cancelFocusTarget = ${JSON.stringify(dialogCancel.cancelFocusTarget)};
    document.querySelector('.mobile-back-button')?.click();
    await waitFor(() => !document.querySelector('.social-body')?.classList.contains('room-open'), '移动端返回联系人列表');
    await waitFrames();
    document.querySelector('.new-agent-button')?.click();
    await waitFor(() => document.querySelector('#social-agent-name'), '重新打开联系人表单');
    const name = 'E2E 图形观察员';
    setValue(document.querySelector('#social-agent-name'), name);
    setValue(document.querySelector('#social-agent-headline'), '长期观察游戏视觉与交互');
    setValue(document.querySelector('#social-agent-description'), '先和我厘清体验，再讨论如何验证。');
    const creationCapability = document.querySelector('.agent-capability-choice input');
    const projectWorkDefaultedOff = creationCapability?.checked === false;
    creationCapability?.click();
    await waitFrames();
    document.querySelector('.agent-create-dialog button[type="submit"]')?.click();
    const createdState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const agent = state.agents.find((candidate) => candidate.name === name);
      return agent ? { state, agent } : null;
    }, '本机联系人记录');
    await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === name, '新联系人私聊');
    const directRoom = await window.noema.getSocialRoom(
      createdState.state.rooms.find((room) => room.kind === 'direct' && room.memberIds.includes(createdState.agent.id)).id,
    );
    const initialDirectIsEmpty = directRoom.messages.length === 1 && directRoom.messages[0].role === 'system';
    const capabilityWasExplicitlyGranted = createdState.agent.capabilities.includes('project-work');
    const projectWorkControl = document.querySelector('.agent-project-capability input');
    const projectModeInitiallyVisible = Boolean(document.querySelector('.composer-mode-switch button'));
    projectWorkControl?.click();
    const projectWorkRevokedState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const agent = state.agents.find((candidate) => candidate.id === createdState.agent.id);
      return agent && !agent.capabilities.includes('project-work') ? state : null;
    }, '撤回项目工作能力');
    await waitFor(() => !document.querySelector('.composer-mode-switch'), '关闭项目工作入口');
    const projectModeDisappeared = !document.querySelector('.composer-mode-switch');
    const refreshedCapabilityControl = document.querySelector('.agent-project-capability input');
    refreshedCapabilityControl?.click();
    const projectWorkEnabledState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const agent = state.agents.find((candidate) => candidate.id === createdState.agent.id);
      return agent?.capabilities.includes('project-work') ? state : null;
    }, '重新开启项目工作能力');
    await waitFor(() => Boolean(document.querySelector('.composer-mode-switch button')), '恢复项目工作入口');
    const projectModeAppeared = Boolean(document.querySelector('.composer-mode-switch button'));
    const projectWorkOptInAndReversible =
      projectWorkDefaultedOff &&
      capabilityWasExplicitlyGranted &&
      projectModeInitiallyVisible &&
      projectModeDisappeared &&
      projectModeAppeared &&
      projectWorkRevokedState.agents.some(
        (agent) => agent.id === createdState.agent.id && agent.capabilities.length === 0,
      ) &&
      projectWorkEnabledState.agents.some(
        (agent) => agent.id === createdState.agent.id && agent.capabilities.includes('project-work'),
      );
    const shell = document.querySelector('.social-shell');
    const panel = document.querySelector('.conversation-panel');
    const header = document.querySelector('.room-header');
    const controls = document.querySelector('.agent-header-actions');
    const compactRoomLayout = {
      width: window.innerWidth,
      roomTitle: document.querySelector('.room-header h2')?.textContent?.trim() ?? '',
      actionsVisible: Boolean(controls && controls.getClientRects().length),
      shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
      panelNoOverflow: Boolean(panel && panel.scrollWidth <= panel.clientWidth),
      headerNoOverflow: Boolean(header && header.scrollWidth <= header.clientWidth),
      documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };

    document.querySelector('.agent-archive-button')?.click();
    const archivedState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      return state.agents.find((candidate) => candidate.id === createdState.agent.id)?.archivedAt
        ? state : null;
    }, '联系人归档状态');
    await waitFor(() => document.querySelector('.agent-archive-button')?.textContent?.includes('恢复'), '联系人恢复入口');
    const archivedUi = Boolean(document.querySelector('.archived-agent-notice'));
    document.querySelector('.new-group-button')?.click();
    await waitFor(() => document.querySelector('#social-group-title'), '归档状态下新群聊表单');
    const archivedInviteExcluded = ![...document.querySelectorAll('.group-agent-option')]
      .some((option) => option.querySelector('strong')?.textContent?.trim() === name);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !document.querySelector('#social-group-title'), '关闭归档状态群聊表单');

    document.querySelector('.agent-archive-button')?.click();
    const restoredState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const agent = state.agents.find((candidate) => candidate.id === createdState.agent.id);
      return agent && !agent.archivedAt ? state : null;
    }, '联系人恢复状态');
    await waitFor(() => document.querySelector('.agent-archive-button')?.textContent?.includes('归档'), '联系人归档入口');

    document.querySelector('.new-group-button')?.click();
    await waitFor(() => document.querySelector('#social-group-title'), '新群聊表单');
    const inviteOption = [...document.querySelectorAll('.group-agent-option')]
      .find((option) => option.querySelector('strong')?.textContent?.trim() === name);
    const inviteVisible = Boolean(inviteOption);
    if (!inviteVisible) throw new Error('新联系人没有出现在群聊邀请列表中');
    inviteOption.querySelector('input')?.click();
    setValue(document.querySelector('#social-group-title'), 'E2E 专业协作');
    await waitFrames();
    document.querySelector('.social-dialog[aria-labelledby="create-group-title"] button[type="submit"]')?.click();
    await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === 'E2E 专业协作', '包含新联系人的群聊');
    const groupState = await window.noema.getSocialState();
    const groupRoom = groupState.rooms.find((room) => room.title === 'E2E 专业协作');
    const groupSnapshot = await window.noema.getSocialRoom(groupRoom.id);
    const sameIdentityJoined = groupSnapshot.members.some((member) => member.id === createdState.agent.id);
    const groupDidNotImportDm = !groupSnapshot.messages.some((message) => message.content.includes('长期观察游戏视觉与交互'));
    return {
      interactionAdjustments: ${JSON.stringify(interactionAdjustments)},
      forwarding: {
        ...${JSON.stringify(forwardingSelection)},
        narrow: ${JSON.stringify(forwardNarrow)},
        ...${JSON.stringify(forwardingSent)},
      },
      continuationThread: {
        ...${JSON.stringify(continuationThreadWorkflow)},
        narrow: ${JSON.stringify(continuationNarrow)},
        threadNarrow: ${JSON.stringify(continuationRoomNarrow)},
        ...${JSON.stringify(continuationLifecycle)},
      },
      initial,
      initialDialog,
      dialogDesktop: ${JSON.stringify(dialogDesktop)},
      dialogNarrow: ${JSON.stringify(dialogNarrow)},
      cancelReturnedFocus,
      cancelFocusTarget,
      agentId: createdState.agent.id,
      createdRoomId: directRoom.room.id,
      initialDirectIsEmpty,
      projectWorkDefaultedOff,
      capabilityWasExplicitlyGranted,
      projectWorkOptInAndReversible,
      compactRoomLayout,
      archived: Boolean(archivedState.agents.find((agent) => agent.id === createdState.agent.id)?.archivedAt),
      archivedUi,
      archivedInviteExcluded,
      restored: !restoredState.agents.find((agent) => agent.id === createdState.agent.id)?.archivedAt,
      inviteVisible,
      sameIdentityJoined,
      groupDidNotImportDm,
      totalAgents: groupState.agents.length,
      totalRooms: groupState.rooms.length,
    };
  })()`);

  if (
    !result?.initialDialog?.focusedName ||
    result.initialDialog.fieldCount !== 3 ||
    result.compactRoomLayout.width > 700 ||
    !result.compactRoomLayout.actionsVisible ||
    !result.compactRoomLayout.shellNoOverflow ||
    !result.compactRoomLayout.panelNoOverflow ||
    !result.compactRoomLayout.headerNoOverflow ||
    !result.compactRoomLayout.documentNoOverflow ||
    !result.cancelReturnedFocus ||
    !result.initialDirectIsEmpty ||
    !result.projectWorkDefaultedOff ||
    !result.capabilityWasExplicitlyGranted ||
    !result.projectWorkOptInAndReversible ||
    !result.archived ||
    !result.archivedUi ||
    !result.archivedInviteExcluded ||
    !result.restored ||
    !result.inviteVisible ||
    !result.sameIdentityJoined ||
    !result.groupDidNotImportDm
  ) {
    throw new Error(
      `用户专业联系人创建流程不符合预期：${JSON.stringify(result)}`,
    );
  }
  await mainWindow.webContents.executeJavaScript(`(async () => {
    const row = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.room-list-title')?.textContent?.trim() === 'E2E 图形观察员');
    row?.click();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && document.querySelector('.room-header h2')?.textContent?.trim() !== 'E2E 图形观察员') {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  })()`);
  const inspectContactRoom = async (width: number, height: number) => {
    mainWindow?.setSize(width, height);
    await mainWindow?.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    return mainWindow?.webContents.executeJavaScript(`(() => {
      const shell = document.querySelector('.social-shell');
      const panel = document.querySelector('.conversation-panel');
      const header = document.querySelector('.room-header');
      const actions = document.querySelector('.agent-header-actions');
      const capability = document.querySelector('.agent-project-capability input');
      return {
        width: window.innerWidth,
        roomTitle: document.querySelector('.room-header h2')?.textContent?.trim() ?? '',
        actionsVisible: Boolean(actions && actions.getClientRects().length),
        projectWorkEnabled: capability?.checked ?? null,
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        panelNoOverflow: Boolean(panel && panel.scrollWidth <= panel.clientWidth),
        headerNoOverflow: Boolean(header && header.scrollWidth <= header.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    })()`);
  };
  const contactDesktop = await inspectContactRoom(1280, 800);
  if (
    contactDesktop?.roomTitle !== 'E2E 图形观察员' ||
    !contactDesktop.actionsVisible ||
    contactDesktop.projectWorkEnabled !== true ||
    !contactDesktop.shellNoOverflow ||
    !contactDesktop.panelNoOverflow ||
    !contactDesktop.headerNoOverflow ||
    !contactDesktop.documentNoOverflow
  ) {
    throw new Error(
      `联系人能力控制桌面布局不符合预期：${JSON.stringify(contactDesktop)}`,
    );
  }
  if (socialAgentContactDesktopScreenshotPath) {
    const image = await mainWindow.capturePage();
    writeSmokeScreenshot(socialAgentContactDesktopScreenshotPath, image);
  }
  const contactNarrow = await inspectContactRoom(666, 640);
  if (
    contactNarrow?.roomTitle !== 'E2E 图形观察员' ||
    !contactNarrow.actionsVisible ||
    contactNarrow.projectWorkEnabled !== true ||
    !contactNarrow.shellNoOverflow ||
    !contactNarrow.panelNoOverflow ||
    !contactNarrow.headerNoOverflow ||
    !contactNarrow.documentNoOverflow
  ) {
    throw new Error(
      `联系人能力控制窄窗口布局不符合预期：${JSON.stringify(contactNarrow)}`,
    );
  }
  if (socialAgentContactNarrowScreenshotPath) {
    const image = await mainWindow.capturePage();
    writeSmokeScreenshot(socialAgentContactNarrowScreenshotPath, image);
  }
  return { ...result, contactDesktop, contactNarrow };
}

async function captureSocialProjectWorkSmokeScreenshots() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('项目工作截图没有可用窗口。');
  }
  const expectedExperienceReference =
    testSocialWorkPracticeDecision === 'case'
      ? 'RELEASE-CHECKLIST.md'
      : '素材导入说明';
  const screenshots: string[] = [];
  await mainWindow.webContents.executeJavaScript(`(async () => {
    const waitForRoom = async (title) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (document.querySelector('.room-header h2')?.textContent?.trim() === title) return true;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return false;
    };
    const noemaRoom = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.room-list-title')?.textContent?.trim() === 'Noema');
    noemaRoom?.click();
    await waitForRoom('Noema');
    const groupRoom = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.room-list-title')?.textContent?.trim() === '工程协作');
    groupRoom?.click();
    await waitForRoom('工程协作');
    const engineering = [...document.querySelectorAll('.reply-routing button')]
      .find((button) => button.textContent?.includes('工程搭档'));
    engineering?.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.querySelectorAll('.composer-mode-switch button')[1]?.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const targetPrompt = ${JSON.stringify(testSocialWorkPrompt)};
    const findTargetTask = () => [...document.querySelectorAll('.project-work-card')]
      .find((card) => card.querySelector('.project-work-request')?.textContent?.trim() === targetPrompt);
    const taskDeadline = Date.now() + 5_000;
    while (Date.now() < taskDeadline && !findTargetTask()?.querySelector('.project-work-practice')) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const targetTask = findTargetTask();
    const experience = targetTask?.querySelector('.project-work-practice') ?? targetTask?.querySelector('.project-work-case');
    experience?.querySelector('summary')?.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  const inspect = async (width: number, height: number) => {
    mainWindow?.setSize(width, height);
    await mainWindow?.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    return mainWindow?.webContents.executeJavaScript(`(() => {
      const shell = document.querySelector('.social-shell');
      const panel = document.querySelector('.conversation-panel');
      const composer = document.querySelector('.message-composer');
      const rect = composer?.getBoundingClientRect();
      const targetPrompt = ${JSON.stringify(testSocialWorkPrompt)};
      const task = [...document.querySelectorAll('.project-work-card')]
        .find((card) => card.querySelector('.project-work-request')?.textContent?.trim() === targetPrompt);
      const experienceReference = task?.querySelector('.project-work-practice') ?? task?.querySelector('.project-work-case');
        if (experienceReference instanceof HTMLDetailsElement) experienceReference.open = true;
      const caseControl = document.querySelector('.case-reuse-control');
      const mode = document.querySelector('.composer-mode-switch button[aria-pressed="true"]');
      return {
        roomTitle: document.querySelector('.room-header h2')?.textContent?.trim() ?? '',
        taskVisible: Boolean(task),
        taskText: task?.textContent?.trim() ?? '',
        projectModeSelected: mode?.textContent?.trim() === '项目工作',
        caseControlVisible: Boolean(caseControl && caseControl.getClientRects().length),
          experienceReferenceVisible: Boolean(experienceReference && experienceReference.getClientRects().length),
          experienceReferenceExpanded: experienceReference instanceof HTMLDetailsElement && experienceReference.open,
          experienceReferenceText: experienceReference?.textContent?.trim() ?? '',
        composerVisible: Boolean(rect && rect.width > 0 && rect.height > 0 && rect.bottom <= window.innerHeight),
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        panelNoOverflow: Boolean(panel && panel.scrollWidth <= panel.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    })()`);
  };

  const desktop = await inspect(1280, 800);
  if (
    !desktop?.taskVisible ||
    desktop.roomTitle !== '工程协作' ||
    !desktop.projectModeSelected ||
    !desktop.caseControlVisible ||
    !desktop.experienceReferenceVisible ||
    !desktop.experienceReferenceExpanded ||
    !desktop.experienceReferenceText.includes(expectedExperienceReference) ||
    !desktop.composerVisible ||
    !desktop.shellNoOverflow ||
    !desktop.panelNoOverflow ||
    !desktop.documentNoOverflow
  ) {
    throw new Error(`桌面项目工作状态不符合预期：${JSON.stringify(desktop)}`);
  }
  if (socialProjectWorkDesktopScreenshotPath) {
    const image = await mainWindow.capturePage();
    writeSmokeScreenshot(socialProjectWorkDesktopScreenshotPath, image);
    screenshots.push(socialProjectWorkDesktopScreenshotPath);
  }

  const narrow = await inspect(680, 560);
  if (
    !narrow?.taskVisible ||
    narrow.roomTitle !== '工程协作' ||
    !narrow.projectModeSelected ||
    !narrow.caseControlVisible ||
    !narrow.experienceReferenceVisible ||
    !narrow.experienceReferenceExpanded ||
    !narrow.experienceReferenceText.includes(expectedExperienceReference) ||
    !narrow.composerVisible ||
    !narrow.shellNoOverflow ||
    !narrow.panelNoOverflow ||
    !narrow.documentNoOverflow
  ) {
    throw new Error(`窄窗口项目工作状态不符合预期：${JSON.stringify(narrow)}`);
  }
  if (socialProjectWorkNarrowScreenshotPath) {
    const image = await mainWindow.capturePage();
    writeSmokeScreenshot(socialProjectWorkNarrowScreenshotPath, image);
    screenshots.push(socialProjectWorkNarrowScreenshotPath);
  }

  const candidateReview = await mainWindow.webContents
    .executeJavaScript(`(async () => {
    const deadline = Date.now() + 5_000;
    const sourcePrompt = ${JSON.stringify(testSocialWorkSourcePrompt)};
    const roomItem = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.room-list-title')?.textContent?.trim() === '工程搭档');
    roomItem?.click();
    while (Date.now() < deadline && document.querySelector('.room-header h2')?.textContent?.trim() !== '工程搭档') {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const findSourceTask = () => [...document.querySelectorAll('.project-work-card')]
      .find((card) =>
        card.querySelector('.project-work-request')?.textContent?.trim() === sourcePrompt &&
        [...(card.querySelector('.project-work-practice')?.querySelectorAll('button') ?? [])]
          .some((button) => button.textContent?.trim() === '撤回候选'));
    while (Date.now() < deadline && !findSourceTask()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const sourceTask = findSourceTask();
    const details = sourceTask?.querySelector('.project-work-practice');
    if (details instanceof HTMLDetailsElement) details.open = true;
    const before = details?.textContent?.trim() ?? '';
    const withdraw = [...(details?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent?.trim() === '撤回候选');
    withdraw?.click();
    while (Date.now() < deadline) {
      const room = await window.noema.getSocialRoom('room-engineering-partner');
      const task = room.workTasks.find((candidate) =>
        candidate.taskPrompt === sourcePrompt && candidate.practiceBasisTaskId,
      );
      if (task?.practiceCandidateStatus === 'revoked') {
        return {
          sourceTaskVisible: Boolean(sourceTask),
          candidateBefore: before,
          withdrawn: true,
          status: task.practiceCandidateStatus,
          trialStatus: task.practiceTrialTaskStatus,
          trialVerification: task.practiceTrialVerificationStatus,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { sourceTaskVisible: Boolean(sourceTask), candidateBefore: before, withdrawn: false };
  })()`);
  if (
    !candidateReview?.sourceTaskVisible ||
    !candidateReview.withdrawn ||
    candidateReview.status !== 'revoked' ||
    candidateReview.trialStatus !==
      (testSocialWorkPracticeDecision === 'case' ? null : 'completed') ||
    candidateReview.trialVerification !==
      (testSocialWorkPracticeDecision === 'case' ? null : 'verified')
  ) {
    throw new Error(
      `候选来源与撤回状态不符合预期：${JSON.stringify(candidateReview)}`,
    );
  }

  return { desktop, narrow, candidateReview, screenshots };
}

async function verifyLiveSocialChatSmoke() {
  if (!runSocialChatLiveSmoke) return null;
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('真实模型聊天 smoke 没有可用窗口。');
  }
  const result = await mainWindow.webContents.executeJavaScript(`(async () => {
    const expected = 'NOEMA_CHAT_OK_59D2';
    const roomDeadline = Date.now() + 5000;
    while (Date.now() < roomDeadline) {
      const noemaRoom = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.room-list-title')?.textContent?.trim() === 'Noema');
      noemaRoom?.click();
      if (document.querySelector('.room-header h2')?.textContent?.trim() === 'Noema') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const input = document.querySelector('#social-message-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!input || input.disabled || !setter) return { verified: false, status: 'composer_unavailable' };
    setter.call(input, '[NOEMA synthetic chat smoke] 请只回复这个标记，不要添加其它内容：' + expected);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }));
    const deadline = Date.now() + 65000;
    while (Date.now() < deadline) {
      const room = await window.noema.getSocialRoom('room-noema');
      const userTurn = [...room.messages].reverse().find((message) =>
        message.role === 'user' && message.content.includes('NOEMA synthetic chat smoke'),
      );
      const reply = userTurn
        ? room.messages.find((message) => message.turnId === userTurn.turnId && message.role === 'assistant')
        : null;
      if (reply?.status === 'complete') {
        return {
          verified: reply.content.includes(expected),
          status: reply.status,
          responseLength: reply.content.length,
          model: reply.model,
          via: 'composer-enter',
        };
      }
      if (reply?.status === 'failed' || reply?.status === 'interrupted') {
        return { verified: false, status: reply.status, error: reply.errorMessage ?? '' };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { verified: false, status: 'timeout' };
  })()`);
  if (!result?.verified) {
    throw new Error(
      `真实 FreeLLMAPI 聊天没有通过合成标记检查：${JSON.stringify(result)}`,
    );
  }
  return result;
}

function discoverFreeLLMAPIBaseUrl(appDataPath: string) {
  try {
    const configPath = path.join(appDataPath, 'FreeLLMAPI', 'config.json');
    const configuration = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (
      Number.isInteger(configuration.port) &&
      configuration.port > 0 &&
      configuration.port <= 65_535
    ) {
      return `http://127.0.0.1:${configuration.port}/v1`;
    }
  } catch {
    // Use FreeLLMAPI's documented default when the desktop configuration is absent.
  }
  return DEFAULT_BASE_URL;
}

function isPathWithin(directory: string, candidate: string) {
  const relative = path.relative(
    path.resolve(directory),
    path.resolve(candidate),
  );
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function isIsolatedE2eDirectory(directory: string, userDataDirectory: string) {
  try {
    const e2eRealPath = fs.realpathSync(directory);
    const userDataRealPath = fs.realpathSync(userDataDirectory);
    return (
      !isPathWithin(e2eRealPath, userDataRealPath) &&
      !isPathWithin(userDataRealPath, e2eRealPath)
    );
  } catch {
    return false;
  }
}

async function startNoema() {
  if (app.isPackaged && process.platform === 'win32') {
    try {
      const { default: handleSquirrelEvent } =
        await import('electron-squirrel-startup');
      writeSmokeLog('squirrel-event', { handled: handleSquirrelEvent });
      if (handleSquirrelEvent) return;
    } catch (error) {
      console.error('Could not handle the Windows installer event:', error);
      app.quit();
      return;
    }
  }

  await app.whenReady();
  writeSmokeLog('app-ready', { userData: app.getPath('userData') });
  try {
    const databasePath = resolveNoemaDatabasePath({
      userDataPath: app.getPath('userData'),
      isPackaged: app.isPackaged,
      testDatabasePath,
    });
    rootStore = new RootStore(databasePath);
    writeSmokeLog('store-opened');
    providerSecretStore = new EncryptedSecretStore({
      safeStorage,
      filePath: path.join(
        app.getPath('userData'),
        'credentials',
        'freellmapi.key',
      ),
    });
    if (process.env.NOEMA_FREELLMAPI_API_KEY) {
      providerSecretStore.set(process.env.NOEMA_FREELLMAPI_API_KEY);
      delete process.env.NOEMA_FREELLMAPI_API_KEY;
    }
    const configuredBaseUrl =
      providerSecretStore.getBaseUrl() ??
      process.env.NOEMA_FREELLMAPI_BASE_URL ??
      discoverFreeLLMAPIBaseUrl(app.getPath('appData'));
    const provider = new FreeLLMAPIClient({
      baseUrl: configuredBaseUrl,
      getApiKey: () => providerSecretStore?.get() ?? null,
    });
    const codexAdapter = new CodexAppServerAdapter({
      executable: resolveCodexExecutable(),
    });
    let dshAdapter: DshHeadlessAdapter | null = null;
    let dshRuntimeError: string | null = null;
    try {
      const runtime = await resolveDshHeadlessRuntime();
      dshAdapter = new DshHeadlessAdapter({
        runtime,
        userDataPath: resolveNoemaDshUserDataPath({
          userDataPath: app.getPath('userData'),
          isPackaged: app.isPackaged,
          testDatabasePath,
          testDshUserDataPath,
        }),
        providerBaseUrl: provider.baseUrl,
        getApiKey: () => providerSecretStore?.get() ?? null,
      });
    } catch (error) {
      dshRuntimeError =
        error instanceof Error
          ? error.message
          : '没有找到可用的 DSH 后台运行环境。';
    }
    const agent = new RootAgent({
      store: rootStore,
      provider,
      secretStore: providerSecretStore,
      dshAdapter,
      dshRuntimeError,
      codexAdapter: codexAdapter.available ? codexAdapter : null,
      emit: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CHANNELS.event, payload);
        }
      },
    });
    rootAgent = agent;
    const migrationBackupPath = await backupBeforeSocialChatMigration({
      db: rootStore.db,
      databasePath,
    });
    if (migrationBackupPath) {
      writeSmokeLog('social-chat-migration-backup', {
        backupPath: migrationBackupPath,
      });
    }
    socialChatStore = new SocialChatStore(rootStore.db);
    const socialWorkE2eDirectory =
      testDatabasePath && path.isAbsolute(testDatabasePath)
        ? path.dirname(path.resolve(testDatabasePath))
        : null;
    const socialWorkE2eValid = Boolean(
      !app.isPackaged &&
      !testWorkerPrompt &&
      typeof testSocialWorkPrompt === 'string' &&
      testSocialWorkPrompt.startsWith('[NOEMA E2E]') &&
      testSocialWorkPrompt.length <= 4_000 &&
      (!testSocialWorkSourcePrompt ||
        (testSocialWorkSourcePrompt.length <= 2_000 &&
          !testSocialWorkSourcePrompt.includes('\n'))) &&
      typeof testDatabasePath === 'string' &&
      typeof testSocialWorkWorkspace === 'string' &&
      path.isAbsolute(testSocialWorkWorkspace) &&
      typeof testSocialWorkResultPath === 'string' &&
      path.isAbsolute(testSocialWorkResultPath) &&
      typeof testDshUserDataPath === 'string' &&
      path.isAbsolute(testDshUserDataPath) &&
      (!testSocialWorkProposalSourceId ||
        (testSocialWorkProposalSourceId.startsWith('e2e-') &&
          typeof testSocialWorkSourcePrompt === 'string')) &&
      (!testSocialWorkLiveEpisodes ||
        (typeof testSocialWorkEpisodeAPrompt === 'string' &&
          testSocialWorkEpisodeAPrompt.startsWith('[NOEMA E2E]') &&
          typeof testSocialWorkEpisodeAChecks === 'string' &&
          typeof testSocialWorkEpisodeBChecks === 'string')) &&
      (!testSocialWorkPracticeDecision ||
        ['trial', 'case', 'cancel'].includes(testSocialWorkPracticeDecision)) &&
      socialWorkE2eDirectory &&
      isIsolatedE2eDirectory(socialWorkE2eDirectory, app.getPath('userData')) &&
      path.resolve(testDatabasePath) !==
        path.join(app.getPath('userData'), 'noema.sqlite3') &&
      isPathWithin(socialWorkE2eDirectory, testSocialWorkWorkspace) &&
      path.resolve(testSocialWorkWorkspace) !== socialWorkE2eDirectory &&
      isPathWithin(socialWorkE2eDirectory, testSocialWorkResultPath) &&
      isPathWithin(socialWorkE2eDirectory, testDshUserDataPath) &&
      path.resolve(testDshUserDataPath) !== socialWorkE2eDirectory &&
      fs.existsSync(testSocialWorkWorkspace) &&
      fs.statSync(testSocialWorkWorkspace).isDirectory(),
    );
    const socialAgentE2eDirectory =
      testDatabasePath && path.isAbsolute(testDatabasePath)
        ? path.dirname(path.resolve(testDatabasePath))
        : null;
    const socialAgentE2eValid = Boolean(
      !app.isPackaged &&
      testSocialAgentWorkflow &&
      !testWorkerPrompt &&
      !testSocialWorkPrompt &&
      typeof testDatabasePath === 'string' &&
      path.isAbsolute(testDatabasePath) &&
      typeof testDshUserDataPath === 'string' &&
      path.isAbsolute(testDshUserDataPath) &&
      typeof socialAgentE2eResultPath === 'string' &&
      path.isAbsolute(socialAgentE2eResultPath) &&
      socialAgentE2eDirectory &&
      isIsolatedE2eDirectory(
        socialAgentE2eDirectory,
        app.getPath('userData'),
      ) &&
      path.resolve(testDatabasePath) !==
        path.join(app.getPath('userData'), 'noema.sqlite3') &&
      path.resolve(testDshUserDataPath) !== socialAgentE2eDirectory &&
      isPathWithin(socialAgentE2eDirectory, testDshUserDataPath) &&
      isPathWithin(socialAgentE2eDirectory, socialAgentE2eResultPath),
    );
    if (
      testSocialAgentWorkflow &&
      !socialAgentE2eValid &&
      socialAgentE2eDirectory &&
      typeof socialAgentE2eResultPath === 'string' &&
      path.isAbsolute(socialAgentE2eResultPath) &&
      isIsolatedE2eDirectory(
        socialAgentE2eDirectory,
        app.getPath('userData'),
      ) &&
      isPathWithin(socialAgentE2eDirectory, socialAgentE2eResultPath)
    ) {
      fs.writeFileSync(
        path.resolve(socialAgentE2eResultPath),
        JSON.stringify(
          {
            outcome: 'preflight_failed',
            packaged: app.isPackaged,
            testFlag: testSocialAgentWorkflow,
            workerPromptConfigured: Boolean(testWorkerPrompt),
            socialWorkPromptConfigured: Boolean(testSocialWorkPrompt),
            databasePath: testDatabasePath,
            dshUserDataPath: testDshUserDataPath,
            resultPath: socialAgentE2eResultPath,
            isolatedDirectory: socialAgentE2eDirectory,
          },
          null,
          2,
        ),
        { encoding: 'utf8', flag: 'wx' },
      );
      app.quit();
      return;
    }
    const useSyntheticSocialWork =
      socialWorkE2eValid && testSocialWorkSynthetic;
    const practiceRouteMetadata: string[] = [];
    const practiceProvider =
      !useSyntheticSocialWork &&
      (testSocialWorkProposalSourceId || testSocialWorkLiveEpisodes)
        ? ({
            async *streamChat(input: {
              model: string;
              messages: Array<{ role: string; content: string }>;
              signal: AbortSignal;
              maxTokens?: number;
              tools?: Array<object>;
              onToolCalls?: (calls: Array<object>) => void;
            }) {
              yield* provider.streamChat({
                ...input,
                onRouteMetadata: (route) => {
                  if (route) practiceRouteMetadata.push(route);
                },
              });
            },
          } as unknown as FreeLLMAPIClient)
        : provider;
    const syntheticSocialWorkAdapter = (useSyntheticSocialWork
      ? {
          async startTask({
            workspacePath,
            taskId,
            onEvent,
          }: {
            workspacePath: string;
            taskId: string;
            onEvent: (event: Record<string, unknown>) => void;
          }) {
            const sessionId = `noema-social-work-fixture-${taskId}`;
            let stopped = false;
            const started = Promise.resolve({ sessionId });
            const done = (async () => {
              onEvent({ type: 'session', sessionId });
              onEvent({ type: 'status', phase: 'working' });
              await new Promise((resolve) => setTimeout(resolve, 250));
              if (stopped) {
                return {
                  status: 'interrupted' as const,
                  errorCode: 'worker_interrupted',
                  sessionId,
                  toolCallCount: 0,
                };
              }
              const checks = JSON.parse(testSocialWorkChecksJson ?? '[]');
              if (
                !Array.isArray(checks) ||
                checks.length === 0 ||
                checks.some(
                  (check) =>
                    check?.kind !== 'file_contains' ||
                    typeof check.path !== 'string' ||
                    typeof check.text !== 'string' ||
                    path.isAbsolute(check.path) ||
                    !isPathWithin(
                      workspacePath,
                      path.resolve(workspacePath, check.path),
                    ),
                )
              ) {
                return {
                  status: 'failed' as const,
                  errorCode: 'invalid_synthetic_fixture',
                  errorMessage: '合成工作任务只接受工作区内的文件标记检查。',
                  sessionId,
                  toolCallCount: 0,
                };
              }
              const groupedChecks = new Map<string, string[]>();
              for (const check of checks) {
                groupedChecks.set(check.path, [
                  ...(groupedChecks.get(check.path) ?? []),
                  check.text,
                ]);
              }
              for (const [relativePath, texts] of groupedChecks) {
                const filePath = path.resolve(workspacePath, relativePath);
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, texts.join('\n'), 'utf8');
              }
              onEvent({
                type: 'tool-call',
                tool: 'synthetic_fixture_write',
                count: 1,
              });
              return {
                status: 'completed' as const,
                result: '合成 E2E 执行器写入了验收标记。',
                sessionId,
                toolCallCount: 1,
              };
            })();
            return {
              started,
              done,
              stop() {
                stopped = true;
                return true;
              },
            };
          },
        }
      : null) as unknown as DshHeadlessAdapter | null;
    const practiceConfirmationEvidence: Array<Record<string, unknown>> = [];
    socialWorkService = new SocialWorkService({
      store: socialChatStore,
      adapter: syntheticSocialWorkAdapter ?? dshAdapter,
      secretStore: useSyntheticSocialWork
        ? { isConfigured: () => true }
        : providerSecretStore,
      practiceProvider: useSyntheticSocialWork ? null : practiceProvider,
      getCodingInteractionAdjustments: () =>
        agent.store.getInteractionAdjustmentsForSurface('coding'),
      defaultVerificationChecks:
        socialWorkE2eValid && testSocialWorkChecksJson
          ? JSON.parse(testSocialWorkChecksJson)
          : [],
      chooseWorkspace: async ({ reuseCase = false } = {}) => {
        if (socialWorkE2eValid) return testSocialWorkWorkspace;
        if (!mainWindow || mainWindow.isDestroyed()) return null;
        const selection = await dialog.showOpenDialog(mainWindow, {
          title: '选择工程搭档可以操作的项目文件夹',
          message: [
            '工程搭档会使用自己的专业资料、读取/修改项目文件，并可运行前台项目命令。Windows 文件沙箱主要限制写入，不能限制网络或进程可见性，也不能保证目录外读取隔离。项目内容可能通过 FreeLLMAPI 发往当前第三方免费模型路由。不要选择含不应发送的密钥或隐私资料的目录。停止任务不会自动撤销已经发生的改动。',
            reuseCase
              ? '本轮还会检查同一位工程搭档在同一项目的其他聊天中，是否有一项通过 Noema 文件条件核验的工作；若找到，会把一份过滤常见凭据样式的限长摘要随本任务发送给模型，不会发送原聊天记录。若本任务也通过 Noema 核验，Noema 还可能用同一免费路由对两项任务的摘要和核验结果做一次额外分析，提出一条候选做法；候选不会自动升级为技能，可在任务卡撤回。若已有候选，选定目录后还会先展示候选正文，供你决定本轮是否试用；普通经验复用勾选不会自动授权使用某条候选。过滤无法保证识别所有敏感信息。'
              : '本轮不会从其他聊天带入项目案例。',
          ].join('\n\n'),
          properties: ['openDirectory'],
          buttonLabel: '允许并继续',
        });
        return selection.canceled ? null : (selection.filePaths[0] ?? null);
      },
      confirmPracticeCandidate: async ({
        candidate,
        taskPrompt,
        caseSnapshot,
      }: {
        candidate: {
          sourceTaskId: string;
          basisTaskId: string;
          basisRoomTitle: string;
          basisTaskPrompt: string;
          roomTitle: string;
          trigger: string;
          action: string;
          limits: string;
        };
        taskPrompt: string;
        caseSnapshot: { taskId: string; taskPrompt: string } | null;
      }) => {
        const preview = {
          taskPrompt,
          trigger: candidate.trigger,
          action: candidate.action,
          limits: candidate.limits,
          sourceRoomTitle: candidate.roomTitle,
          sourceTaskId: candidate.sourceTaskId,
          basisTaskPrompt: candidate.basisTaskPrompt,
          fallbackCaseTaskId: caseSnapshot?.taskId ?? null,
        };
        if (socialWorkE2eValid) {
          const decision =
            testSocialWorkPracticeDecision ??
            (testSocialWorkLiveEpisodes ? 'case' : 'trial');
          practiceConfirmationEvidence.push({ ...preview, decision });
          return decision as 'trial' | 'case' | 'cancel';
        }
        if (!mainWindow || mainWindow.isDestroyed()) return 'cancel';
        const previewText = (value: string, limit: number) =>
          value.length <= limit
            ? value
            : `${value.slice(0, limit)}\n……（预览已截断）`;
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: '先审阅这条做法是否适合当前任务',
          message: '这是一条由过往已核验工作提炼的候选，不是已学会的能力。',
          detail: [
            `当前任务：\n${previewText(taskPrompt, 1_800)}`,
            `触发条件：\n${candidate.trigger}`,
            `候选做法：\n${candidate.action}`,
            `适用边界：\n${candidate.limits}`,
            `来源：${candidate.roomTitle}；基础案例：${previewText(candidate.basisTaskPrompt || candidate.basisTaskId, 1_200)}`,
            caseSnapshot
              ? `选择“只引用已核验案例”会带入「${caseSnapshot.taskPrompt || caseSnapshot.taskId}」，不发送候选做法。`
              : '当前没有可带入的原案例；选择“不试用候选”时只执行当前任务。',
            '选择“试用”会把这条候选和当前任务一并发送给当前 FreeLLMAPI 免费路由。试用结果只表示 Noema 文件条件是否通过，不证明候选导致了结果。',
          ].join('\n\n'),
          buttons: [
            caseSnapshot ? '只引用已核验案例' : '不带入候选',
            '试用候选一次',
            '取消任务',
          ],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        const decision =
          confirmation.response === 1
            ? 'trial'
            : confirmation.response === 0
              ? 'case'
              : 'cancel';
        practiceConfirmationEvidence.push({ ...preview, decision });
        return decision;
      },
      emit: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CHANNELS.socialEvent, payload);
        }
      },
    });
    socialAgentE2eModelRequests = [];
    const socialAgentE2eModel = 'e2e-local-spy';
    const socialChatProvider =
      socialAgentE2eValid && !testSocialAgentLiveE2e
        ? {
            async *streamChat(input: {
              model: string;
              messages: Array<{ role: string; content: string }>;
            }) {
              socialAgentE2eModelRequests.push(input);
              yield '我看到了这组转发消息。';
            },
          }
        : testSocialAgentLiveE2e
          ? {
              async *streamChat(input: {
                model: string;
                messages: Array<{ role: string; content: string }>;
                signal: AbortSignal;
              }) {
                socialAgentE2eModelRequests.push(input);
                yield* provider.streamChat(input);
              },
            }
          : provider;
    const getSocialRootState = async () => {
      const state = await agent.getUiState();
      if (!socialAgentE2eValid || testSocialAgentLiveE2e) return state;
      return {
        ...state,
        connected: true,
        checking: false,
        models: [
          {
            name: socialAgentE2eModel,
            label: 'E2E 本机测试模型',
            routeKind: 'direct' as const,
            executionStatus: 'ready' as const,
          },
        ],
        selectedModel: socialAgentE2eModel,
        error: null,
        providerConfigured: true,
      };
    };
    socialChatService = new SocialChatService({
      store: socialChatStore,
      provider: socialChatProvider as FreeLLMAPIClient,
      secretStore:
        socialAgentE2eValid && !testSocialAgentLiveE2e
          ? { isConfigured: () => true }
          : providerSecretStore,
      getSelectedModel: () =>
        socialAgentE2eValid && !testSocialAgentLiveE2e
          ? socialAgentE2eModel
          : (rootStore?.getSelectedModel() ?? null),
      getRootState: getSocialRootState,
      getInteractionAdjustments: () => agent.store.getInteractionAdjustments(),
      getProjectWorkReadiness: () =>
        socialWorkService?.getReadiness() ?? {
          available: false,
          reason: '项目工作运行环境尚未初始化。',
        },
      emit: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CHANNELS.socialEvent, payload);
        }
      },
    });
    unregisterRootIpc = registerRootIpc({
      ipcMain,
      rootAgent: agent,
      socialChatService,
      socialWorkService,
      isTrustedSender: (sender) =>
        Boolean(mainWindow && sender === mainWindow.webContents),
      sendMessage: createImportAwareSendMessage(agent, async (imported) => {
        if (!mainWindow || mainWindow.isDestroyed()) return false;
        const consent = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '发送导入的 Codex 上下文',
          message: `“${imported.title}”的可见对话将随 Noema 本轮及后续对话发送。`,
          detail:
            '这份快照保存在本机。确认后，快照和你在 Noema 的近期对话会通过 FreeLLMAPI 发往当前选定的免费模型路由；上游服务的数据处理政策各不相同。该授权持续有效，直到你在 Noema 移除此快照。移除无法撤回此前已发送的数据；Codex 原会话不会被修改。',
          buttons: ['取消本次发送', '发送并继续使用此快照'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return consent.response === 1;
      }),
      chooseWorkspace: async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return null;
        const disclosure = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '后台任务的数据范围',
          message: '选择工作区会允许后台 DSH agent 读取和修改其中的文件。',
          detail: `任务指令${agent.store.getInteractionAdjustmentsForSurface('coding').length ? '及你保存的编码协作调整' : ''}，以及 agent 实际读取的文件内容，会通过本机 FreeLLMAPI 发往当前免费链中的第三方服务（目前包括 BlockRun、Kilo 和 OVH，并可能按可用性切换）。不同服务的数据处理条款不同；例如 Kilo 声明会记录请求/响应用于训练。免费不代表私密。不要选择包含不应发送给第三方的密钥或敏感资料的目录。你仍可在任务运行时停止它，但停止前的文件改动不会自动回滚。`,
          buttons: ['取消', '继续选择工作区'],
          defaultId: 1,
          cancelId: 0,
          noLink: true,
        });
        if (disclosure.response !== 1) return null;
        const selection = await dialog.showOpenDialog(mainWindow, {
          title: '选择后台 agent 可访问的工作区',
          properties: ['openDirectory'],
          buttonLabel: '允许此文件夹',
        });
        return selection.canceled ? null : (selection.filePaths[0] ?? null);
      },
      finishQuickCapture,
      markQuickCaptureReady,
      getQuickCaptureShortcutStatus: () =>
        quickCaptureShortcutRegistration
          ? {
              accelerator: quickCaptureShortcutRegistration.accelerator,
              registered: quickCaptureShortcutRegistration.registered,
            }
          : null,
    });
    if (socialAgentE2eValid && socialAgentE2eDirectory) {
      const resultPath = path.resolve(socialAgentE2eResultPath!);
      if (testSocialAgentLiveE2e) {
        await agent.refreshModels();
        const providerState = await agent.getUiState();
        const availableModels = providerState.models as Array<{
          name: string;
          routeKind: 'router' | 'direct';
          executionStatus: 'ready' | 'needsKey' | 'exhausted' | null;
        }>;
        const selectedRoute = availableModels.find(
          (model) => model.name === providerState.selectedModel,
        );
        const selectedRouteAvailable = Boolean(
          selectedRoute?.routeKind === 'router' ||
          selectedRoute?.executionStatus === 'ready',
        );
        if (
          !providerState.providerConfigured ||
          !providerState.connected ||
          !providerState.selectedModel ||
          providerState.selectedModel !== testSocialAgentLiveModel ||
          !selectedRouteAvailable
        ) {
          fs.writeFileSync(
            resultPath,
            JSON.stringify(
              {
                outcome: 'preflight_failed',
                providerConfigured: Boolean(providerState.providerConfigured),
                connected: Boolean(providerState.connected),
                modelSelected: Boolean(providerState.selectedModel),
                selectedRouteReady: selectedRouteAvailable,
              },
              null,
              2,
            ),
            { encoding: 'utf8', flag: 'wx' },
          );
          app.quit();
          return;
        }
      }
      void (async () => {
        try {
          await new Promise<void>((resolve) => {
            createWindow();
            if (!mainWindow || mainWindow.isDestroyed()) {
              resolve();
              return;
            }
            mainWindow.webContents.once('did-finish-load', () => resolve());
          });
          const workflow = await captureSocialAgentCreationE2e();
          fs.writeFileSync(
            resultPath,
            JSON.stringify({ outcome: 'passed', workflow }, null, 2),
            {
              encoding: 'utf8',
              flag: 'wx',
            },
          );
        } catch (error) {
          fs.writeFileSync(
            resultPath,
            JSON.stringify(
              {
                outcome: 'failed',
                errorMessage:
                  error instanceof Error ? error.message.slice(0, 8_000) : null,
              },
              null,
              2,
            ),
            { encoding: 'utf8', flag: 'wx' },
          );
        } finally {
          app.quit();
        }
      })();
      return;
    }
    if (socialWorkE2eValid && socialWorkE2eDirectory) {
      const resultPath = path.resolve(testSocialWorkResultPath!);
      const workspacePath = path.resolve(testSocialWorkWorkspace!);
      if (testSocialWorkCaptureUi) {
        await agent.refreshModels();
        await new Promise<void>((resolve) => {
          createWindow();
          if (!mainWindow || mainWindow.isDestroyed()) {
            resolve();
            return;
          }
          mainWindow.webContents.once('did-finish-load', () => resolve());
        });
      }
      void (async () => {
        let socialWorkUiPreflight: unknown = null;
        let livePracticeProposal: unknown = null;
        const liveEpisodeTasks: Array<Record<string, unknown>> = [];
        try {
          if (testSocialWorkCaptureUi && mainWindow) {
            socialWorkUiPreflight = await mainWindow.webContents
              .executeJavaScript(`(async () => {
              if (!window.noema) return { bridge: false };
              try {
                const state = await window.noema.getSocialState();
                return {
                  bridge: true,
                  agentCount: state.agents.length,
                  roomCount: state.rooms.length,
                  projectWork: state.projectWork,
                };
              } catch (error) {
                return { bridge: true, error: String(error) };
              }
            })()`);
            if (
              !socialWorkUiPreflight ||
              typeof socialWorkUiPreflight !== 'object' ||
              !('roomCount' in socialWorkUiPreflight) ||
              socialWorkUiPreflight.roomCount !== 3
            ) {
              throw new Error(
                `桌面社交界面尚未就绪：${JSON.stringify(socialWorkUiPreflight)}`,
              );
            }
          }
          if (testSocialWorkLiveEpisodes) {
            const episodeA = await socialWorkService!.startTask({
              roomId: 'room-engineering-collaboration',
              agentId: 'engineering-partner',
              prompt: testSocialWorkEpisodeAPrompt!,
              verificationChecks: JSON.parse(testSocialWorkEpisodeAChecks!),
            });
            if (!episodeA.accepted || !episodeA.taskId) {
              throw new Error('真实经历 A 未能启动。');
            }
            const completedA = await socialWorkService!.waitForTask(
              episodeA.taskId,
            );
            liveEpisodeTasks.push({
              id: completedA.id,
              roomId: completedA.roomId,
              taskPrompt: completedA.taskPrompt,
              status: completedA.status,
              verificationStatus: completedA.verificationStatus,
              toolCallCount: completedA.toolCallCount,
              toolActionCategories: completedA.toolActionCategories,
              caseSnapshot: completedA.caseSnapshot,
              verificationResults: completedA.verificationResults,
              errorCode: completedA.errorCode,
              errorMessage: completedA.errorMessage,
            });
            if (
              completedA.status !== 'completed' ||
              completedA.verificationStatus !== 'verified' ||
              completedA.toolActionCategories.length === 0
            ) {
              throw new Error('真实经历 A 未通过独立核验或没有记录工具类别。');
            }
            socialWorkService!.setCaseEligible(completedA.id, true);

            const startEpisodeB = () =>
              socialWorkService!.startTask({
                roomId: 'room-engineering-partner',
                agentId: 'engineering-partner',
                prompt: testSocialWorkSourcePrompt!,
                verificationChecks: JSON.parse(testSocialWorkEpisodeBChecks!),
                reuseCase: true,
              });
            const recordEpisode = (task: {
              id: string;
              roomId: string;
              taskPrompt: string;
              status: string;
              verificationStatus: string;
              toolActionCategories: string[];
              caseSnapshot: { taskId: string } | null;
              toolCallCount: number;
              verificationResults: Array<{ status: string }>;
              errorCode: string | null;
              errorMessage: string | null;
            }) =>
              liveEpisodeTasks.push({
                id: task.id,
                roomId: task.roomId,
                taskPrompt: task.taskPrompt,
                status: task.status,
                verificationStatus: task.verificationStatus,
                toolCallCount: task.toolCallCount,
                toolActionCategories: task.toolActionCategories,
                caseSnapshot: task.caseSnapshot,
                verificationResults: task.verificationResults,
                errorCode: task.errorCode,
                errorMessage: task.errorMessage,
              });
            const firstB = await startEpisodeB();
            if (!firstB.accepted || !firstB.taskId) {
              throw new Error('真实经历 B 未能启动。');
            }
            let completedB = await socialWorkService!.waitForTask(
              firstB.taskId,
            );
            recordEpisode(completedB);
            const cooldown = Number(
              /约\s*(\d+)\s*秒后/u.exec(completedB.errorMessage ?? '')?.[1],
            );
            const safeRateLimitRetry =
              completedB.status === 'failed' &&
              completedB.errorCode === 'dsh_rate_limited' &&
              completedB.toolCallCount === 0 &&
              completedB.verificationResults.length > 0 &&
              (
                completedB.verificationResults as Array<{
                  status: string;
                  reason?: string;
                }>
              ).every(
                (check) =>
                  check.status === 'failed' && check.reason === 'file_missing',
              ) &&
              Number.isInteger(cooldown) &&
              cooldown >= 1 &&
              cooldown <= 120;
            if (safeRateLimitRetry) {
              await new Promise((resolve) =>
                setTimeout(resolve, (cooldown + 1) * 1_000),
              );
              const retryB = await startEpisodeB();
              if (!retryB.accepted || !retryB.taskId) {
                throw new Error('限流等待后真实经历 B 未能重新启动。');
              }
              completedB = await socialWorkService!.waitForTask(retryB.taskId);
              recordEpisode(completedB);
            }
            if (
              completedB.status !== 'completed' ||
              completedB.verificationStatus !== 'verified' ||
              completedB.caseSnapshot?.taskId !== completedA.id ||
              completedB.toolActionCategories.length === 0
            ) {
              throw new Error(
                '真实经历 B 未复用 A、通过独立核验或记录工具类别。',
              );
            }
            const proposalDeadline = Date.now() + 55_000;
            let source = socialChatStore!.getSocialWorkTask(completedB.id);
            while (
              Date.now() < proposalDeadline &&
              source.practiceCandidateStatus === 'pending'
            ) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              source = socialChatStore!.getSocialWorkTask(completedB.id);
            }
            livePracticeProposal = {
              sourceTaskId: completedB.id,
              status: source.practiceCandidateStatus,
              candidate: source.practiceCandidate,
              basisTaskId: source.practiceBasisTaskId,
              routedVia: practiceRouteMetadata,
            };
            if (source.practiceCandidateStatus === 'failed') {
              throw new Error(
                '基于真实 DSH 经历的 FreeLLMAPI 提炼调用失败；查看本机网关请求日志。',
              );
            }
            if (source.practiceCandidateStatus === 'pending') {
              throw new Error('真实 DSH 经历的候选提炼超过 55 秒仍未结束。');
            }
            if (source.practiceCandidateStatus === 'available') {
              const candidate = source.practiceCandidate;
              if (
                !candidate ||
                candidate.basisTaskId !== completedA.id ||
                candidate.trigger.length < 5 ||
                candidate.action.length < 5 ||
                candidate.limits.length < 5
              ) {
                throw new Error('真实经历候选缺少有效字段或来源。');
              }
            }
          }
          if (testSocialWorkProposalSourceId) {
            const started = socialWorkService!.startPracticeProposal(
              testSocialWorkProposalSourceId,
            );
            if (!started) {
              throw new Error('隔离的候选来源不符合实践提炼条件。');
            }
            const proposalDeadline = Date.now() + 55_000;
            let source = socialChatStore!.getSocialWorkTask(
              testSocialWorkProposalSourceId,
            );
            while (
              Date.now() < proposalDeadline &&
              source.practiceCandidateStatus === 'pending'
            ) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              source = socialChatStore!.getSocialWorkTask(
                testSocialWorkProposalSourceId,
              );
            }
            livePracticeProposal = {
              status: source.practiceCandidateStatus,
              candidate: source.practiceCandidate,
              basisTaskId: source.practiceBasisTaskId,
              routedVia: practiceRouteMetadata,
            };
            if (source.practiceCandidateStatus === 'failed') {
              throw new Error(
                'FreeLLMAPI 候选提炼调用失败；请查看本机网关请求日志。',
              );
            }
            if (source.practiceCandidateStatus === 'pending') {
              throw new Error('FreeLLMAPI 候选提炼超过 55 秒仍未结束。');
            }
            if (source.practiceCandidateStatus === 'available') {
              const candidate = source.practiceCandidate;
              if (
                !candidate ||
                candidate.basisTaskId !== source.caseSnapshot?.taskId ||
                candidate.trigger.length < 5 ||
                candidate.action.length < 5 ||
                candidate.limits.length < 5
              ) {
                throw new Error('真实模型生成的候选字段或来源校验未通过。');
              }
            }
          }
          let taskId: string | null = null;
          if (
            (testSocialWorkProposalSourceId || testSocialWorkLiveEpisodes) &&
            (livePracticeProposal as { status?: string } | null)?.status ===
              'none'
          ) {
            fs.writeFileSync(
              resultPath,
              JSON.stringify(
                {
                  outcome: 'practice_proposal_none',
                  livePracticeProposal,
                  practiceConfirmationEvidence,
                  liveEpisodeTasks,
                  practiceRouteMetadata,
                  workspacePath,
                  socialWorkUiPreflight,
                },
                null,
                2,
              ),
              { encoding: 'utf8', flag: 'wx' },
            );
            return;
          }
          if (testSocialWorkCaptureUi) {
            taskId = await mainWindow!.webContents
              .executeJavaScript(`(async () => {
              const prompt = ${JSON.stringify(testSocialWorkPrompt)};
              const deadline = Date.now() + 10_000;
              const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              let roomItem = null;
              while (Date.now() < deadline && !roomItem) {
                roomItem = [...document.querySelectorAll('.room-list-item')]
                  .find((item) => item.querySelector('.room-list-title')?.textContent?.trim() === '工程协作') ?? null;
                if (!roomItem) await new Promise((resolve) => setTimeout(resolve, 50));
              }
              roomItem?.click();
              while (Date.now() < deadline && document.querySelector('.room-header h2')?.textContent?.trim() !== '工程协作') {
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const responder = [...document.querySelectorAll('.reply-routing button')]
                .find((button) => button.textContent?.includes('工程搭档'));
              responder?.click();
              await waitFrame();
              const modeButton = document.querySelectorAll('.composer-mode-switch button')[1];
              modeButton?.click();
              await waitFrame();
              const caseReuse = document.querySelector('.case-reuse-control input');
              caseReuse?.click();
              await waitFrame();
              const input = document.querySelector('#social-message-input');
              const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              const submit = document.querySelector('.message-composer button[type="submit"]');
              const diagnostics = {
                roomTitle: document.querySelector('.room-header h2')?.textContent?.trim() ?? '',
                responderSelected: [...document.querySelectorAll('.reply-routing button')].find((button) => button.textContent?.includes('工程搭档'))?.getAttribute('aria-pressed') ?? null,
                modeDisabled: modeButton?.disabled ?? true,
                modeSelected: modeButton?.getAttribute('aria-pressed') ?? null,
                caseReuseChecked: caseReuse?.checked ?? false,
                inputDisabled: input?.disabled ?? true,
                submitDisabled: submit?.disabled ?? true,
              };
              if (!caseReuse?.checked) return { error: 'case-reuse-not-enabled', diagnostics };
              if (!input || input.disabled || !setter) return { error: 'composer-unavailable', diagnostics };
              setter.call(input, prompt);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              await waitFrame();
              if (!submit || submit.disabled) return { error: 'submit-disabled', diagnostics };
              submit.click();
              const taskDeadline = Date.now() + 10_000;
              while (Date.now() < taskDeadline) {
                const room = await window.noema.getSocialRoom('room-engineering-collaboration');
                const task = room.workTasks.find((candidate) => candidate.taskPrompt === prompt);
                if (task) return task.id;
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              return { error: 'task-not-persisted', diagnostics, notice: document.querySelector('.inline-notice')?.textContent?.trim() ?? '' };
            })()`);
            if (typeof taskId !== 'string') {
              throw new Error(
                `聊天界面没有提交项目工作任务：${JSON.stringify(taskId)}`,
              );
            }
          } else {
            const started = await socialWorkService!.startTask({
              roomId: 'room-engineering-collaboration',
              agentId: 'engineering-partner',
              prompt: testSocialWorkPrompt!,
              verificationChecks: testSocialWorkChecksJson
                ? JSON.parse(testSocialWorkChecksJson)
                : [],
            });
            taskId = started.accepted ? (started.taskId ?? null) : null;
          }
          const task = taskId
            ? await socialWorkService!.waitForTask(taskId)
            : null;
          const socialWorkUiSmoke = testSocialWorkCaptureUi
            ? await captureSocialProjectWorkSmokeScreenshots()
            : null;
          fs.writeFileSync(
            resultPath,
            JSON.stringify(
              {
                outcome: task ? 'finished' : 'preflight_failed',
                task,
                workspacePath,
                socialWorkUiSmoke,
                livePracticeProposal,
                practiceConfirmationEvidence,
                liveEpisodeTasks,
                practiceRouteMetadata,
              },
              null,
              2,
            ),
            { encoding: 'utf8', flag: 'wx' },
          );
        } catch (error) {
          fs.writeFileSync(
            resultPath,
            JSON.stringify(
              {
                outcome: 'setup_failed',
                errorCode:
                  error &&
                  typeof error === 'object' &&
                  'code' in error &&
                  typeof error.code === 'string'
                    ? error.code
                    : 'social_work_e2e_failed',
                errorMessage:
                  error instanceof Error ? error.message.slice(0, 1_000) : null,
                socialWorkUiPreflight,
                livePracticeProposal,
                practiceConfirmationEvidence,
                liveEpisodeTasks,
                practiceRouteMetadata,
              },
              null,
              2,
            ),
            { encoding: 'utf8', flag: 'wx' },
          );
        } finally {
          app.quit();
        }
      })();
      return;
    }
    if (
      !app.isPackaged &&
      testDatabasePath &&
      path.isAbsolute(testDatabasePath) &&
      testDshUserDataPath &&
      path.isAbsolute(testDshUserDataPath) &&
      (!testWorkerPreface ||
        testWorkerPreface.startsWith('[NOEMA E2E PREFACE]')) &&
      testWorkerPrompt?.startsWith('[NOEMA E2E]') &&
      path.resolve(testDatabasePath) !==
        path.join(app.getPath('userData'), 'noema.sqlite3') &&
      isIsolatedE2eDirectory(
        path.dirname(path.resolve(testDatabasePath)),
        app.getPath('userData'),
      ) &&
      path.resolve(testDshUserDataPath) !==
        path.resolve(app.getPath('userData')) &&
      path.resolve(testDshUserDataPath) !==
        path.dirname(path.resolve(testDatabasePath)) &&
      isPathWithin(
        path.dirname(path.resolve(testDatabasePath)),
        testDshUserDataPath,
      )
    ) {
      const e2eDirectory = path.dirname(path.resolve(testDatabasePath));
      const resultPath = path.join(
        e2eDirectory,
        `worker-e2e-result-${Date.now()}.json`,
      );
      void runIsolatedWorkerE2E({
        agent,
        store: rootStore,
        databasePath: testDatabasePath,
        prefacePrompt: testWorkerPreface,
        prompt: testWorkerPrompt,
        resultPath,
        rootOnly: testRootOnly,
        historyRecall: testHistoryRecall,
        directWorker: testDirectWorker,
        verificationChecks:
          testDirectWorker && testVerificationChecksJson
            ? JSON.parse(testVerificationChecksJson)
            : [],
      })
        .catch((error) => {
          const result = {
            outcome: 'setup_failed',
            errorCode:
              typeof error?.code === 'string'
                ? error.code
                : 'e2e_scenario_failed',
          };
          fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), {
            encoding: 'utf8',
            flag: 'wx',
          });
          console.error(
            'Isolated Noema E2E scenario failed:',
            result.errorCode,
          );
        })
        .finally(() => app.quit());
      return;
    }
    if (
      process.env.NOEMA_SMOKE_TEST === '1' &&
      process.env.NOEMA_SMOKE_REFRESH_MODELS === '1'
    ) {
      await agent.refreshModels();
    } else if (process.env.NOEMA_SMOKE_TEST !== '1') {
      void agent.refreshModels();
    }
    quickCaptureShortcutRegistration = registerQuickCaptureShortcut({
      shortcutApi: globalShortcut,
      platform: process.platform,
      onQuickCapture: openQuickCapture,
    });
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    writeSmokeLog('window-created');
  } catch (error) {
    const message = `本机对话数据无法打开。请检查应用数据目录权限后重试。\n\n${error instanceof Error ? error.message : '未知错误'}`;
    writeSmokeLog('startup-error', {
      error: error instanceof Error ? error.message : String(error),
    });
    if (process.env.NOEMA_SMOKE_TEST === '1') {
      console.error('Noema startup smoke failed:', message);
    } else {
      dialog.showErrorBox('Noema 无法启动', message);
    }
    app.quit();
  }
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    focusPrimaryWindow(mainWindow);
  });
  void startNoema();
} else {
  app.quit();
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (!rootAgent || shutdownComplete) {
    unregisterRootIpc?.();
    rootStore?.close();
    return;
  }
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void Promise.allSettled([
    rootAgent.shutdown(),
    socialChatService?.shutdown(),
    socialWorkService?.shutdown(),
  ]).finally(() => {
    shutdownComplete = true;
    unregisterRootIpc?.();
    rootStore?.close();
    app.quit();
  });
});

app.on('will-quit', () => {
  quickCaptureShortcutRegistration?.unregister();
  quickCaptureShortcutRegistration = null;
});
