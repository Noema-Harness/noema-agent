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
delete process.env.NOEMA_E2E_DATABASE_PATH;
delete process.env.NOEMA_E2E_DSH_USER_DATA_PATH;
delete process.env.NOEMA_E2E_WORKER_PREFACE;
delete process.env.NOEMA_E2E_WORKER_PROMPT;
delete process.env.NOEMA_E2E_ROOT_ONLY;
delete process.env.NOEMA_E2E_HISTORY_RECALL;
delete process.env.NOEMA_E2E_DIRECT_WORKER;
delete process.env.NOEMA_E2E_VERIFICATION_CHECKS;
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

  if (process.env.NOEMA_SMOKE_TEST === '1') {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const bridgeState = await mainWindow?.webContents.executeJavaScript(
          'window.noema.getRootState()',
        );
        if (!bridgeState || !Array.isArray(bridgeState.messages)) {
          throw new Error('Root conversation bridge did not return its state');
        }
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
        const socialRoom = firstRoom
          ? await mainWindow?.webContents.executeJavaScript(
              `window.noema.getSocialRoom(${JSON.stringify(firstRoom.id)})`,
            )
          : null;
        if (!socialRoom?.room || !Array.isArray(socialRoom.members)) {
          throw new Error('Social chat room could not be opened through IPC');
        }
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
    socialChatService = new SocialChatService({
      store: socialChatStore,
      provider,
      secretStore: providerSecretStore,
      getSelectedModel: () => rootStore?.getSelectedModel() ?? null,
      getRootState: () => agent.getUiState(),
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
