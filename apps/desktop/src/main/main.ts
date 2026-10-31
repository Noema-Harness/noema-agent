import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  net,
  safeStorage,
  session,
  shell,
  screen,
  Notification,
} from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EncryptedSecretStore } from './platform/encrypted-secret-store.mjs';
import { resolveElectronProxy } from './platform/electron-proxy.mjs';
import {
  OpenAICompatibleClient,
  resolveConfiguredModelBaseUrl,
} from './providers/openai-compatible-client.mjs';
import {
  createImportAwareSendMessage,
  registerRootIpc,
  CHANNELS,
} from './ipc/root-ipc.mjs';
import { RootAgent } from './agents/root-agent.mjs';
import { RootStore } from './storage/root-store.mjs';
import { SocialChatStore } from './chat/social-chat-store.mjs';
import { SocialProjectStore } from './projects/social-project-store.mjs';
import { SocialChatService } from './chat/social-chat-service.mjs';
import { searchAndReadWeb } from './tools/web-search.mjs';
import { SocialWorkService } from './execution/social-work-service.mjs';
import { NoemaProjectExecutor } from './execution/noema-project-executor.mjs';
import { backupBeforeSocialChatMigration } from './chat/social-chat-migration-backup.mjs';
import {
  resolveNoemaDatabasePath,
  resolveNoemaDshUserDataPath,
} from './platform/runtime-paths.mjs';
import {
  CodexAppServerAdapter,
  resolveCodexExecutable,
} from './integrations/codex-app-server-adapter.mjs';
import {
  DshHeadlessAdapter,
  resolveDshHeadlessRuntime,
} from './integrations/dsh-headless-adapter.mjs';
import {
  createWindowPreferences,
  isInternalNavigation,
  shouldOpenExternally,
} from './platform/window-security.mjs';
import {
  fitsWithinWorkArea,
  resolveInitialWindowSize,
} from './platform/window-geometry.mjs';
import {
  activateQuickCaptureWindow,
  focusPrimaryWindow,
  finishQuickCaptureWindow,
  registerQuickCaptureShortcut,
} from './platform/quick-capture-shortcut.mjs';
import { createSocialReplyNotificationHandler } from './platform/desktop-notifications.mjs';
import { readDesktopDevelopmentOptions } from './platform/development-options';
const developmentOptions = readDesktopDevelopmentOptions();
const {
  testDataArgument,
  testDatabasePath,
  testRendererUrl,
  testDshUserDataPath,
  testWorkerPreface,
  testWorkerPrompt,
  testRootOnly,
  testHistoryRecall,
  testDirectWorker,
  testVerificationChecksJson,
  testSocialWorkPrompt,
  testSocialWorkSourcePrompt,
  testSocialWorkWorkspace,
  testSocialWorkResultPath,
  testSocialWorkChecksJson,
  testSocialWorkSynthetic,
  testSocialWorkProposalSourceId,
  testSocialWorkLiveEpisodes,
  testSocialWorkPracticeDecision,
  testSocialWorkEpisodeAPrompt,
  testSocialWorkEpisodeAChecks,
  testSocialWorkEpisodeBChecks,
  testSocialAgentWorkflow,
  testSocialAttachmentsOnly,
  testSocialAgentLiveE2e,
  testSocialAgentLiveModel,
  testSocialAgentR0FirstUse,
  testSocialAgentKeepOpen,
  socialAgentE2eResultPath,
  socialAgentDelegationMarker,
  socialAgentDelegationTask,
  socialAgentDelegationResult,
} = developmentOptions;

function writeSmokeLog(step: string, details: Record<string, unknown> = {}) {
  const logFile = process.env.NOEMA_SMOKE_LOG_FILE;
  if (process.env.NOEMA_SMOKE_TEST !== '1' || !logFile) return;
  fs.writeFileSync(logFile, JSON.stringify({ step, ...details }));
}

function writeRendererHealthLog(
  event: string,
  details: Record<string, unknown> = {},
) {
  try {
    const logFile = path.join(app.getPath('userData'), 'renderer-health.jsonl');
    const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`;
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 64 * 1024) {
      const recent = fs
        .readFileSync(logFile, 'utf8')
        .split('\n')
        .slice(-200)
        .join('\n');
      fs.writeFileSync(logFile, recent, 'utf8');
    }
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (error) {
    console.warn('Could not record renderer health event:', error);
  }
}

writeSmokeLog('main-entry', { argv: process.argv, packaged: app.isPackaged });
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

const devRemoteDebuggingPort = process.env.NOEMA_DEV_REMOTE_DEBUGGING_PORT;
if (!app.isPackaged && devRemoteDebuggingPort) {
  const port = Number(devRemoteDebuggingPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('NOEMA_DEV_REMOTE_DEBUGGING_PORT must be 1024–65535.');
  }
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port', String(port));
}

if (
  process.env.NOEMA_SMOKE_TEST === '1' &&
  process.env.NOEMA_SMOKE_USER_DATA_DIR
) {
  const smokeUserData = path.resolve(process.env.NOEMA_SMOKE_USER_DATA_DIR);
  fs.mkdirSync(smokeUserData, { recursive: true });
  app.setPath('userData', smokeUserData);
}
if (
  process.env.NOEMA_SMOKE_TEST === '1' &&
  process.env.NOEMA_SMOKE_SESSION_DATA_DIR
) {
  const smokeSessionData = path.resolve(
    process.env.NOEMA_SMOKE_SESSION_DATA_DIR,
  );
  fs.mkdirSync(smokeSessionData, { recursive: true });
  app.setPath('sessionData', smokeSessionData);
  delete process.env.NOEMA_SMOKE_SESSION_DATA_DIR;
}
let mainWindow: BrowserWindow | null = null;
let initialWindowFitsWorkArea = false;
let rootStore: RootStore | null = null;
let providerSecretStore: EncryptedSecretStore | null = null;
let unregisterRootIpc: (() => void) | null = null;
let rootAgent: RootAgent | null = null;
let socialChatStore: SocialChatStore | null = null;
let socialProjectStore: SocialProjectStore | null = null;
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

const isSquirrelLifecycleEvent = process.argv.some((argument) =>
  /^--squirrel-(install|updated|uninstall|obsolete)$/.test(argument),
);
const hasSingleInstanceLock =
  process.env.NOEMA_SMOKE_TEST === '1' ||
  (!app.isPackaged && Boolean(testDataArgument)) ||
  isSquirrelLifecycleEvent ||
  app.requestSingleInstanceLock();

ipcMain.handle('noema:window-control', (event, action: unknown) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target !== mainWindow)
    throw new Error('Window is unavailable');
  if (action === 'minimize') target.minimize();
  else if (action === 'maximize') {
    if (target.isMaximized()) target.unmaximize();
    else target.maximize();
  } else if (action === 'close') target.close();
  else if (action !== 'state') throw new Error('Unknown window action');
  return !target.isDestroyed() && target.isMaximized();
});

const createWindow = () => {
  quickCaptureRendererReady = false;
  const display = screen.getPrimaryDisplay();
  const windowSize = resolveInitialWindowSize(display.workAreaSize);
  mainWindow = new BrowserWindow({
    ...windowSize,
    show: process.env.NOEMA_SMOKE_HIDDEN !== '1',
    title: 'Noema',
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#fcfcfc',
    webPreferences: createWindowPreferences(
      path.join(__dirname, 'preload.cjs'),
    ),
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on('unresponsive', () => {
    writeRendererHealthLog('unresponsive');
  });
  mainWindow.webContents.on('responsive', () => {
    writeRendererHealthLog('responsive');
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeRendererHealthLog('render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  const publishWindowState = () => {
    if (mainWindow && !mainWindow.webContents.isDestroyed())
      mainWindow.webContents.send(
        'noema:window-state',
        mainWindow.isMaximized(),
      );
  };
  mainWindow.on('maximize', publishWindowState);
  mainWindow.on('unmaximize', publishWindowState);
  initialWindowFitsWorkArea = fitsWithinWorkArea(
    mainWindow.getBounds(),
    display.workArea,
  );

  mainWindow.webContents.on(
    'console-message',
    (details, legacyLevel, legacyMessage, legacyLine, legacySource) => {
      if (details.level !== 'error' && legacyLevel !== 3) return;
      const message = details.message ?? legacyMessage;
      const source = details.sourceId ?? legacySource;
      const line = details.lineNumber ?? legacyLine;
      writeRendererHealthLog('console-error', {
        message,
        source,
        line,
      });
      if (process.env.NOEMA_SMOKE_TEST === '1') {
        console.error('Noema renderer error:', message, source, line);
      }
    },
  );
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (
      !isInternalNavigation(
        url,
        testRendererUrl ?? MAIN_WINDOW_VITE_DEV_SERVER_URL,
      )
    )
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

  if (testRendererUrl) {
    void mainWindow.loadURL(testRendererUrl);
  } else if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (
    process.env.NOEMA_SMOKE_TEST === '1' &&
    !testSocialWorkPrompt &&
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
        const quickCaptureSmoke = await runDesktopProbe(
          'captureQuickCaptureSmokeScreenshots',
        );
        const historyTraceSmoke = await runDesktopProbe(
          'captureHistoryTraceSmokeScreenshots',
        );
        const timelineSearchSmoke = await runDesktopProbe(
          'captureTimelineSearchSmokeScreenshots',
        );
        const modelAvailabilitySmoke = await runDesktopProbe(
          'inspectModelAvailabilitySmoke',
          bridgeState.models ?? [],
          bridgeState.selectedModel ?? null,
          {
            connected: Boolean(bridgeState.connected),
            providerConfigured: Boolean(bridgeState.providerConfigured),
            providerName: bridgeState.providerName,
          },
        );
        const socialChatSmoke = await runDesktopProbe(
          'captureSocialChatSmokeScreenshots',
        );
        const socialLiveChatSmoke = await runDesktopProbe(
          'verifyLiveSocialChatSmoke',
        );
        const result = {
          url: mainWindow?.webContents.getURL() ?? null,
          title: mainWindow?.getTitle() ?? null,
          packaged: app.isPackaged,
          windowFitsWorkArea: initialWindowFitsWorkArea,
          rootStateLoaded: true,
          socialChat: {
            agentCount: socialState.agents.length,
            roomCount: socialState.rooms.length,
            agentIds: socialState.agents.map(
              (agent: { id: string }) => agent.id,
            ),
            roomIds: socialState.rooms.map((room: { id: string }) => room.id),
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

const notifySocialReply = createSocialReplyNotificationHandler({
  NotificationClass: Notification,
  getWindow: () => mainWindow,
  disabled: process.env.NOEMA_E2E_SILENT_NOTIFICATIONS === '1',
  openMainWindow: () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    focusPrimaryWindow(mainWindow);
  },
});

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
  return 'http://127.0.0.1:3001/v1';
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
  const proxy = resolveElectronProxy(process.env);
  if (proxy.config) {
    await session.defaultSession.setProxy(proxy.config);
    writeSmokeLog('network-proxy-configured', { source: 'environment' });
  } else if (proxy.invalid) {
    writeSmokeLog('network-proxy-ignored', {
      reason: 'unsupported-or-credential-bearing-url',
    });
  }
  writeSmokeLog('app-ready', { userData: app.getPath('userData') });
  try {
    const databasePath = resolveNoemaDatabasePath({
      userDataPath: app.getPath('userData'),
      isPackaged: app.isPackaged,
      testDatabasePath,
    });
    rootStore = new RootStore(databasePath);
    writeSmokeLog('store-opened');
    const legacyFreeLlmApiSecretStore = new EncryptedSecretStore({
      safeStorage,
      filePath: path.join(
        app.getPath('userData'),
        'credentials',
        'freellmapi.key',
      ),
    });
    const modelProviderCredentialPath = path.join(
      app.getPath('userData'),
      'credentials',
      'model-provider.key',
    );
    providerSecretStore = new EncryptedSecretStore({
      safeStorage,
      filePath: modelProviderCredentialPath,
      fallbackStores: [legacyFreeLlmApiSecretStore],
    });
    const webSearchSecretStore = new EncryptedSecretStore({
      safeStorage,
      filePath: path.join(
        app.getPath('userData'),
        'credentials',
        'web-search.key',
      ),
    });
    const envModelBaseUrl = process.env.NOEMA_MODEL_BASE_URL;
    const injectedModelApiKey = process.env.NOEMA_MODEL_API_KEY;
    const allowIsolatedModelCredential = Boolean(
      testSocialAgentR0FirstUse && testDatabasePath,
    );
    writeSmokeLog('model-provider-credential-source', {
      isolatedCredentialProvided: Boolean(injectedModelApiKey),
      isolatedModelTestEnabled: allowIsolatedModelCredential,
    });
    if (injectedModelApiKey && allowIsolatedModelCredential) {
      providerSecretStore.setConfiguration({
        apiKey: injectedModelApiKey,
        baseUrl: envModelBaseUrl ?? 'https://api.deepseek.com',
      });
    }
    delete process.env.NOEMA_MODEL_API_KEY;
    delete process.env.NOEMA_MODEL_BASE_URL;
    if (process.env.NOEMA_FREELLMAPI_API_KEY) {
      legacyFreeLlmApiSecretStore.set(process.env.NOEMA_FREELLMAPI_API_KEY);
      delete process.env.NOEMA_FREELLMAPI_API_KEY;
    }
    const explicitLegacyBaseUrl = process.env.NOEMA_FREELLMAPI_BASE_URL;
    const hasLegacyFreeLlmApiCredential =
      legacyFreeLlmApiSecretStore.isConfigured();
    const legacyFreeLlmApiBaseUrl = hasLegacyFreeLlmApiCredential
      ? (explicitLegacyBaseUrl ??
        discoverFreeLLMAPIBaseUrl(app.getPath('appData')))
      : null;
    const hasCurrentProviderCredential = fs.existsSync(
      modelProviderCredentialPath,
    );
    const configuredBaseUrl = resolveConfiguredModelBaseUrl({
      hasCurrentProviderCredential,
      currentProviderBaseUrl: providerSecretStore.getBaseUrl(),
      legacyFreeLlmApiBaseUrl,
    });
    const useLegacyFreeLlmApi =
      !hasCurrentProviderCredential && Boolean(legacyFreeLlmApiBaseUrl);
    const provider = new OpenAICompatibleClient({
      baseUrl: configuredBaseUrl,
      legacyFreeRouteMode: useLegacyFreeLlmApi,
      getApiKey: () => providerSecretStore?.get() ?? null,
      fetchImpl: (input, init) =>
        net.fetch(input instanceof URL ? input.toString() : input, init),
    });
    const noemaProjectExecutor = new NoemaProjectExecutor({
      provider,
      authorizeAdditionalAccess: async ({
        command,
        path: requestedPath,
        access,
        reason,
      }) => {
        if (!mainWindow || mainWindow.isDestroyed()) return false;
        const response = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: '项目命令请求访问工作区外的路径',
          message: `仅为本次命令${access === 'write' ? '读取并修改' : '读取'}此路径？`,
          detail: [
            `路径：${requestedPath}`,
            `用途：${reason}`,
            `命令：${command.slice(0, 1_600)}${command.length > 1_600 ? '\n……（命令已截断）' : ''}`,
            '授权只用于当前这一条命令，命令退出后 Noema 会撤销沙箱路径授权。拒绝不会运行该命令。',
          ].join('\n\n'),
          buttons: ['本次允许', '拒绝'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        return response.response === 0;
      },
      authorizeNetwork: async ({ command, host, port }) => {
        if (!mainWindow || mainWindow.isDestroyed()) return false;
        const response = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: '项目命令请求联网',
          message: `仅为本次命令连接 ${host}:${port}？`,
          detail: [
            `目标主机：${host}:${port}`,
            `命令：${command.slice(0, 1_600)}${command.length > 1_600 ? '\n……（命令已截断）' : ''}`,
            '拒绝后该连接会被沙箱阻断；允许仅对当前命令有效。',
          ].join('\n\n'),
          buttons: ['本次允许', '拒绝'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        return response.response === 0;
      },
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
          : '没有找到可用的 DSH 兼容环境。';
    }
    const agent = new RootAgent({
      store: rootStore,
      provider,
      secretStore: providerSecretStore,
      webSearchSecretStore,
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
    socialProjectStore = new SocialProjectStore({
      db: rootStore.db,
      socialChatStore,
    });
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
      (!testSocialAgentR0FirstUse || testSocialAgentLiveE2e) &&
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
          } as unknown as OpenAICompatibleClient)
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
              const stepId = randomUUID();
              onEvent({
                type: 'tool-call',
                tool: 'synthetic_fixture_write',
                count: 1,
                stepId,
                externalCallId: 'synthetic-write',
                category: 'write',
                hasSideEffect: true,
              });
              for (const [relativePath, texts] of groupedChecks) {
                const filePath = path.resolve(workspacePath, relativePath);
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, texts.join('\n'), 'utf8');
              }
              onEvent({
                type: 'tool-result',
                stepId,
                status: 'completed',
                effectStatus: 'applied',
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
      projectStore: socialProjectStore,
      getSelectedModel: () => rootStore?.getSelectedModel() ?? null,
      assertWorkAllowed: (roomId: string) =>
        socialProjectStore?.assertWorkAllowed(roomId),
      adapter: syntheticSocialWorkAdapter ?? noemaProjectExecutor,
      secretStore: useSyntheticSocialWork
        ? { isConfigured: () => true }
        : providerSecretStore,
      practiceProvider: useSyntheticSocialWork ? null : practiceProvider,
      defaultVerificationChecks:
        socialWorkE2eValid && testSocialWorkChecksJson
          ? JSON.parse(testSocialWorkChecksJson)
          : [],
      chooseWorkspace: async ({ reuseCase = false, prompt = '' } = {}) => {
        if (socialWorkE2eValid) return testSocialWorkWorkspace;
        const devWorkspaceOverride = !app.isPackaged
          ? process.env.NOEMA_DEV_PROJECT_WORKSPACE_PATH
          : null;
        if (devWorkspaceOverride) {
          const workspace = path.resolve(devWorkspaceOverride);
          if (
            !path.isAbsolute(devWorkspaceOverride) ||
            !fs.existsSync(workspace) ||
            !fs.statSync(workspace).isDirectory()
          ) {
            throw new Error(
              'NOEMA_DEV_PROJECT_WORKSPACE_PATH must point to an existing absolute directory.',
            );
          }
          return workspace;
        }
        if (!mainWindow || mainWindow.isDestroyed()) return null;
        const selection = await dialog.showOpenDialog(mainWindow, {
          title: '检查项目工作并选择文件夹',
          message: [
            `Noema 准备在你选择的工作区执行项目任务：\n${prompt}`,
            'Noema 会读取/修改项目文件，并在操作系统沙箱中运行前台项目命令。默认读写范围是你选定的工作区，网络和工作区外路径默认受限；需要越界时会展示具体命令与目标，逐项询问是否仅对该命令开放。Windows 首次使用需要一次管理员确认来创建独立沙箱账户和出站过滤规则；不会授权读取整个用户目录。项目内容可能发送到当前配置的模型服务商，并按该服务商的数据处理条款处理。不要选择含不应发送的密钥或隐私资料的目录。停止任务不会自动撤销已经发生的项目改动。',
            reuseCase
              ? '本轮还会检查同一位工程搭档在同一项目的其他聊天中，是否有一项通过 Noema 文件条件核验的工作；若找到，会把一份过滤常见凭据样式的限长摘要随本任务发送给模型，不会发送原聊天记录。若本任务也通过 Noema 核验，Noema 还可能用当前模型服务对两项任务的摘要和核验结果做一次额外分析，提出一条候选做法；候选不会自动升级为技能，可在任务卡撤回。若已有候选，选定目录后还会先展示候选正文，供你决定本轮是否试用；普通经验复用勾选不会自动授权使用某条候选。过滤无法保证识别所有敏感信息。'
              : '本轮不会从其他聊天带入项目案例。',
          ].join('\n\n'),
          properties: ['openDirectory'],
          buttonLabel: '允许并继续',
        });
        if (selection.canceled || !selection.filePaths[0]) return null;
        if (process.platform === 'win32') {
          const sandbox = await import('@anthropic-ai/sandbox-runtime');
          const srtWin = sandbox.resolveSrtWin({
            path: sandbox.VENDORED_SRT_WIN_EXE,
          });
          const status = await sandbox.getWindowsSandboxUserStatusAsync({
            srtWin,
          });
          if (!status.provisioned) {
            const installationChoice = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              title: '启用项目命令沙箱',
              message: 'Noema 需要先安装本机命令隔离组件。',
              detail: [
                '安装会请求一次 Windows 管理员确认，创建独立的 srt-sandbox 本地账户并添加只匹配该账户的出站过滤规则。',
                'Noema 会跳过整个用户目录的读取授权；命令仅额外读取所需的系统/工具运行目录、所选工作区，以及你逐次批准的路径。Windows 支持目前仍是上游 alpha。',
                '账户安装后，真正的 ACL 与出站隔离探针会在命令执行器授予本次运行所需的精确 helper 与工作区路径后执行。若验证失败，命令不会改用当前 Windows 账户运行。',
              ].join('\n\n'),
              buttons: ['安装并继续', '取消'],
              defaultId: 0,
              cancelId: 1,
              noLink: true,
            });
            if (installationChoice.response !== 0) return null;
            try {
              const installed = await sandbox.installWindowsSandboxAsync({
                skipProfileGrant: true,
                srtWin,
              });
              if (installed.cancelled) return null;
              const verified = await sandbox.getWindowsSandboxUserStatusAsync({
                srtWin,
              });
              if (!verified.provisioned || !verified.credPresent) {
                throw new Error(
                  'Windows 命令沙箱安装后未通过状态核验；命令未执行。',
                );
              }
            } catch (error) {
              await dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Windows 命令沙箱安装未完成',
                message: '安装或账户状态检查未通过，项目命令未执行。',
                detail: error instanceof Error ? error.message : String(error),
                buttons: ['返回'],
                noLink: true,
              });
              return null;
            }
          }
        }
        return selection.filePaths[0];
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
            '选择“试用”会把这条候选和当前任务一并发送给当前配置的模型服务商。试用结果只表示 Noema 文件条件是否通过，不证明候选导致了结果。',
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
        if (
          'type' in payload &&
          payload.type === 'project-work-updated' &&
          'task' in payload
        )
          socialChatService?.onProjectWorkUpdated(payload.task);
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
              onToolCalls?: (
                calls: Array<{
                  function: { name: string; arguments: string };
                }>,
              ) => void;
              onRouteMetadata?: (route: string | null) => void;
            }) {
              socialAgentE2eModelRequests.push(input);
              const history = input.messages.find((message) =>
                message.content.includes('"type":"noema_history_recall"'),
              );
              if (history) {
                input.onRouteMetadata?.('e2e-local-spy');
                yield '我找到了你提到的旧对话，可以从来源查看原文。';
                return;
              }
              const latestUserMessage = [...input.messages]
                .reverse()
                .find((message) => message.role === 'user')?.content;
              if (latestUserMessage?.includes(socialAgentDelegationMarker)) {
                input.onToolCalls?.([
                  {
                    function: {
                      name: 'delegate_to_specialist',
                      arguments: JSON.stringify({
                        agent_id: 'engineering-partner',
                        task: socialAgentDelegationTask,
                      }),
                    },
                  },
                ]);
                return;
              }
              if (latestUserMessage === socialAgentDelegationTask) {
                yield socialAgentDelegationResult;
                return;
              }
              if (latestUserMessage?.includes('今天发生了一件让我有点难受')) {
                yield '听起来这件事还留在你心里。你愿意先讲讲，最难受的是哪一部分吗？';
                return;
              }
              if (latestUserMessage?.includes('想起这件事还是有些不舒服')) {
                yield '它似乎还在影响你。你现在最想先说的是哪一部分？';
                return;
              }
              if (latestUserMessage?.includes('我们再聊一件普通小事')) {
                yield '好啊，说来听听，你想聊什么？';
                return;
              }
              if (latestUserMessage?.includes('请说说这两条消息的重点')) {
                yield '第一条是 OpenAI 的官方发布说明，第二条补充了项目进展；前者说明能力变化，后者说明这些变化怎样影响实际使用。';
                return;
              }
              yield '收到。你想先从哪一部分聊起？';
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
      projectStore: socialProjectStore,
      provider: socialChatProvider as OpenAICompatibleClient,
      secretStore:
        socialAgentE2eValid && !testSocialAgentLiveE2e
          ? { isConfigured: () => true }
          : providerSecretStore,
      getSelectedModel: () =>
        socialAgentE2eValid && !testSocialAgentLiveE2e
          ? socialAgentE2eModel
          : (rootStore?.getSelectedModel() ?? null),
      getRootState: getSocialRootState,
      getProjectWorkReadiness: () =>
        socialWorkService?.getReadiness() ?? {
          available: false,
          reason: '项目工作运行环境尚未初始化。',
        },
      getProjectSessionContext: (roomId, agentId) =>
        socialProjectStore?.getProjectSessionContext(roomId, agentId) ?? null,
      isWebSearchConfigured: () => webSearchSecretStore.isConfigured(),
      searchPublicSources: (query, signal, maxSources) =>
        searchAndReadWeb(query, webSearchSecretStore.get(), {
          signal,
          maxSources,
        }),
      startProjectWork: ({ dispatchFromNoema, ...input }, signal) =>
        dispatchFromNoema
          ? socialWorkService!.startTaskFromNoema({ ...input, signal })
          : socialWorkService!.startTask({ ...input, signal }),
      emit: (payload) => {
        const outgoingPayload =
          process.env.NOEMA_E2E_SILENT_NOTIFICATIONS === '1' &&
          'notifyUser' in payload &&
          payload.notifyUser === true
            ? { ...payload, notifyUser: false }
            : payload;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CHANNELS.socialEvent, outgoingPayload);
        }
        notifySocialReply(outgoingPayload);
      },
    });
    unregisterRootIpc = registerRootIpc({
      ipcMain,
      rootAgent: agent,
      socialChatService,
      socialProjectStore,
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
            '这份快照保存在本机。确认后，快照和你在 Noema 的近期对话会发往当前选定的模型服务商；上游服务的数据处理政策各不相同。该授权持续有效，直到你在 Noema 移除此快照。移除无法撤回此前已发送的数据；Codex 原会话不会被修改。',
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
          detail:
            '任务指令以及 agent 实际读取的文件内容会发送到当前配置的模型服务商，并按其数据处理条款处理。不要选择包含不应发送给第三方的密钥或敏感资料的目录。你仍可在任务运行时停止它，但停止前的文件改动不会自动回滚。',
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
      Boolean(testDatabasePath) &&
      (await (
        await import('../../test-support/electron/scenarios')
      ).runDevelopmentScenarios({
        socialAgentE2eValid,
        socialAgentE2eDirectory,
        socialAgentE2eResultPath,
        testSocialAgentLiveE2e,
        writeSmokeLog,
        agent,
        testSocialAgentLiveModel,
        createWindow,
        get mainWindow() {
          return mainWindow;
        },
        testSocialAgentR0FirstUse,
        testSocialAttachmentsOnly,
        runDesktopProbe,
        testSocialAgentKeepOpen,
        socialWorkE2eValid,
        socialWorkE2eDirectory,
        testSocialWorkResultPath,
        testSocialWorkWorkspace,
        testSocialWorkSynthetic,
        rootStore,
        testSocialWorkLiveEpisodes,
        socialWorkService,
        testSocialWorkEpisodeAPrompt,
        testSocialWorkEpisodeAChecks,
        testSocialWorkSourcePrompt,
        testSocialWorkEpisodeBChecks,
        socialChatStore,
        practiceRouteMetadata,
        testSocialWorkProposalSourceId,
        practiceConfirmationEvidence,
        testSocialWorkPrompt,
        testSocialWorkChecksJson,
        testDatabasePath,
        testDshUserDataPath,
        testWorkerPreface,
        testWorkerPrompt,
        isIsolatedE2eDirectory,
        isPathWithin,
        testRootOnly,
        testHistoryRecall,
        testDirectWorker,
        testVerificationChecksJson,
      }))
    )
      return;

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
      stack: error instanceof Error ? error.stack : undefined,
      userData: app.getPath('userData'),
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

type DesktopProbes = ReturnType<
  typeof import('../../test-support/electron/probes').createDesktopProbes
>;
async function runDesktopProbe<K extends keyof DesktopProbes>(
  name: K,
  ...args: Parameters<DesktopProbes[K]>
): Promise<Awaited<ReturnType<DesktopProbes[K]>>> {
  const { createDesktopProbes } =
    await import('../../test-support/electron/probes');
  const probes = createDesktopProbes({
    mainWindow,
    openQuickCapture,
    quickCaptureShortcutRegistration,
    socialAgentE2eModelRequests,
    socialChatService,
    writeSmokeLog,
    options: developmentOptions,
  });
  const invoke = probes[name] as (
    ...args: Parameters<DesktopProbes[K]>
  ) => ReturnType<DesktopProbes[K]>;
  return (await invoke(...args)) as Awaited<ReturnType<DesktopProbes[K]>>;
}
