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
import { EncryptedSecretStore } from './encrypted-secret-store.mjs';
import { resolveElectronProxy } from './electron-proxy.mjs';
import { verifyConversationNavigation } from './conversation-navigation-e2e.mjs';
import { runIsolatedWorkerE2E } from './isolated-worker-e2e.mjs';
import {
  OpenAICompatibleClient,
  resolveConfiguredModelBaseUrl,
} from './openai-compatible-client.mjs';
import {
  createImportAwareSendMessage,
  registerRootIpc,
  CHANNELS,
} from './root-ipc.mjs';
import { RootAgent } from './root-agent.mjs';
import { RootStore } from './root-store.mjs';
import { SocialChatStore } from './social-chat-store.mjs';
import { SocialProjectStore } from './social-project-store.mjs';
import { SocialChatService } from './social-chat-service.mjs';
import { searchAndReadWeb } from './web-search.mjs';
import { SocialWorkService } from './social-work-service.mjs';
import { NoemaProjectExecutor } from './noema-project-executor.mjs';
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
import { createSocialReplyNotificationHandler } from './desktop-notifications.mjs';

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
const testDatabasePath = process.env.NOEMA_E2E_DATABASE_PATH ?? null;
const testRendererUrl = testDataArgument
  ? (process.env.NOEMA_E2E_RENDERER_URL ?? null)
  : null;
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
const testSocialAttachmentsOnly =
  process.env.NOEMA_E2E_SOCIAL_ATTACHMENTS_ONLY === '1';
const testSocialAgentLiveE2e = process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE === '1';
const testSocialAgentLiveModel =
  process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE_MODEL ?? null;
const testSocialAgentR0FirstUse =
  process.env.NOEMA_E2E_SOCIAL_R0_FIRST_USE === '1';
const testSocialAgentKeepOpen = process.env.NOEMA_E2E_KEEP_OPEN === '1';
const socialAgentE2eResultPath =
  process.env.NOEMA_E2E_SOCIAL_AGENT_RESULT_PATH ?? null;
const socialAgentForwardDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_FORWARD_DESKTOP_PATH ?? null;
const socialAgentForwardNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_FORWARD_NARROW_PATH ?? null;
const socialAgentDelegationDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_DELEGATION_DESKTOP_PATH ?? null;
const socialAgentDelegationNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_DELEGATION_NARROW_PATH ?? null;
const socialMessageSearchScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_SEARCH_PATH ?? null;
const socialHistoryRecallScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_HISTORY_RECALL_PATH ?? null;
const socialAgentProfileDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_AGENT_PROFILE_PATH ?? null;
const socialAgentProfileNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_AGENT_PROFILE_NARROW_PATH ?? null;
const socialAgentProjectScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_PROJECT_PATH ?? null;
const socialAgentDelegationMarker = '请帮我独立核对';
const socialHistoryRecallMarker = 'Noema 历史回忆验证标记：河谷石英';
const socialAgentDelegationTask =
  '列出比较三种代码托管方案时应核对的五个关键字段。';
const socialAgentDelegationResult =
  '核对套餐价格、计费周期、并发限制、私有仓库权限和超额费用。';
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
const socialTextAttachmentDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_ATTACHMENTS_DESKTOP_PATH ?? null;
const socialTextAttachmentNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_SOCIAL_ATTACHMENTS_NARROW_PATH ?? null;
delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CREATE_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CREATE_NARROW_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_NARROW_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_ATTACHMENTS_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_ATTACHMENTS_NARROW_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_FORWARD_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_FORWARD_NARROW_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_DELEGATION_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_DELEGATION_NARROW_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_SEARCH_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_NARROW_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_NARROW_PATH;
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
delete process.env.NOEMA_E2E_SOCIAL_AGENT_WORKFLOW;
delete process.env.NOEMA_E2E_SOCIAL_ATTACHMENTS_ONLY;
delete process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE;
delete process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE_MODEL;
delete process.env.NOEMA_E2E_SOCIAL_R0_FIRST_USE;
delete process.env.NOEMA_E2E_KEEP_OPEN;
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
        const quickCaptureSmoke = await captureQuickCaptureSmokeScreenshots();
        const historyTraceSmoke = await captureHistoryTraceSmokeScreenshots();
        const timelineSearchSmoke =
          await captureTimelineSearchSmokeScreenshots();
        const modelAvailabilitySmoke = await inspectModelAvailabilitySmoke(
          bridgeState.models ?? [],
          bridgeState.selectedModel ?? null,
          {
            connected: Boolean(bridgeState.connected),
            providerConfigured: Boolean(bridgeState.providerConfigured),
            providerName: bridgeState.providerName,
          },
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
  providerState: {
    connected: boolean;
    providerConfigured: boolean;
    providerName: string;
  },
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
    const socialState = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
      document.querySelector('[aria-label="连接与模型设置"]')?.click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
      const dialog = document.querySelector('.settings-dialog');
      const select = dialog?.querySelector('select[aria-label="在设置中选择对话模型"]');
      const warning = document.querySelector('.provider-warning')?.textContent?.trim() ?? '';
      resolve({
        options: [...(select?.options ?? [])].map((option) => ({
          value: option.value,
          label: option.textContent?.trim() ?? '',
          disabled: option.disabled,
        })),
        selectedModel: select?.value ?? '',
        connectionSummary: dialog?.querySelector('.connection-summary')?.textContent?.trim() ?? '',
        dialogVisible: Boolean(dialog),
        composerDisabled: Boolean(document.querySelector('#social-message-input')?.disabled),
        warning,
      });
      }));
    })`);
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
        `Noema 设置中的模型列表与 FreeLLMAPI 状态不一致：${mismatches.join('; ')}`,
      );
    }
    if (!socialState.dialogVisible) {
      throw new Error('连接与模型设置没有打开。');
    }
    const selectedStatus = models.find(
      (model) => model.name === selectedModel,
    )?.executionStatus;
    const selectedUnavailable =
      selectedStatus === 'exhausted' || selectedStatus === 'needsKey';
    const providerReady = Boolean(
      providerState.connected && models.length > 0 && !selectedUnavailable,
    );
    if (socialState.selectedModel !== (selectedModel ?? '')) {
      throw new Error(
        `设置中的当前模型与 Noema 持久化选择不一致（UI=${JSON.stringify(socialState.selectedModel)}, store=${JSON.stringify(selectedModel)}, options=${JSON.stringify(socialState.options.map((option: { value: string }) => option.value))}）。`,
      );
    }
    const expectedConnectionSummary = providerState.providerConfigured
      ? providerState.connected
        ? `${providerState.providerName} 已连接`
        : `${providerState.providerName} 已配置，当前连接不可用`
      : '';
    if (
      expectedConnectionSummary &&
      !socialState.connectionSummary.includes(expectedConnectionSummary)
    ) {
      throw new Error('连接设置没有显示当前模型服务的真实连接状态。');
    }
    if (providerReady === socialState.composerDisabled) {
      throw new Error('所选模型状态与聊天输入框的可用状态不一致。');
    }
    if (Boolean(socialState.warning) === providerReady) {
      throw new Error('聊天输入区没有按模型服务的真实状态显示提示。');
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
        const dialog = document.querySelector('.settings-dialog');
        const rect = dialog?.getBoundingClientRect();
        return Boolean(
          document.documentElement.scrollWidth <= window.innerWidth &&
          rect && rect.width <= window.innerWidth && rect.height <= window.innerHeight
        );
      })()`);
      if (!narrowLayoutValid) {
        throw new Error('窄窗口下连接与模型设置超出可视范围。');
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
      connectionSummary: socialState.connectionSummary,
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
        const header = document.querySelector('.room-header');
        const composer = document.querySelector('.message-composer');
        const routing = document.querySelector('.reply-routing');
        const rect = composer?.getBoundingClientRect();
        const groupedResponseTurns = [...document.querySelectorAll('.conversation-turn')]
          .filter((turn) => turn.querySelectorAll('.chat-message').length > 1)
          .length;
        const groupAttributionVisible = [...document.querySelectorAll('.conversation-turn .chat-message .message-author')]
          .some((author) => !author.classList.contains('visually-hidden'));
        return {
          loaded: Boolean(shell),
          roomTitle: document.querySelector('.room-header h2')?.textContent?.trim() ?? '',
          participantCount: document.querySelectorAll('.room-header-copy p').length,
          routingChoices: routing?.querySelectorAll('button').length ?? 0,
          groupedResponseTurns,
          groupAttributionVisible,
          projectModeSwitchVisible: Boolean(
            document.querySelector('.composer-mode-switch'),
          ),
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
      desktop.groupedResponseTurns < 1 ||
      !desktop.groupAttributionVisible ||
      !desktop.projectModeSwitchVisible ||
      !desktop.composerVisible ||
      !desktop.shellNoOverflow ||
      !desktop.panelNoOverflow ||
      !desktop.headerNoOverflow ||
      !desktop.documentNoOverflow
    ) {
      throw new Error(`桌面聊天状态不符合预期：${JSON.stringify(desktop)}`);
    }
    await mainWindow.webContents.executeJavaScript(`(() => {
      const mainChat = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
      mainChat?.click();
    })()`);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 80))',
    );
    const noemaProjectModeSwitchVisible =
      await mainWindow.webContents.executeJavaScript(
        `Boolean(document.querySelector('.composer-mode-switch'))`,
      );
    if (noemaProjectModeSwitchVisible) {
      throw new Error('Noema 主聊仍显示冗余的手动项目模式切换。');
    }
    await mainWindow.webContents.executeJavaScript(`(() => {
      const group = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.textContent?.includes('工程协作'));
      group?.click();
    })()`);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 80))',
    );
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
        const updatedWorkCard = document.querySelector('.project-work-card');
        const taskDetail = updatedWorkCard?.querySelector('.project-work-task-detail');
        const sourceBody = updatedWorkCard?.closest('.conversation-turn')
          ?.querySelector('.user-message .message-body');
        const actionIndent = updatedWorkCard && sourceBody
          ? Math.round(updatedWorkCard.getBoundingClientRect().left - sourceBody.getBoundingClientRect().left)
          : null;
        const taskTextCollapsed = taskDetail instanceof HTMLDetailsElement && !taskDetail.open && Boolean(taskDetail.querySelector('.project-work-request')?.textContent?.trim());
        taskDetail?.querySelector('summary')?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const taskTextExpandWorks = taskDetail instanceof HTMLDetailsElement && taskDetail.open && Boolean(taskDetail.querySelector('.project-work-request')?.textContent?.trim());
        taskDetail?.querySelector('summary')?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          available: true,
          selected: button.getAttribute('aria-pressed') === 'true',
          placeholder: document.querySelector('.message-composer textarea')?.getAttribute('placeholder') ?? '',
          taskTextCollapsed,
          taskTextExpandWorks,
          actionIndent,
        };
      })()`);
      if (
        !projectMode.available ||
        !projectMode.selected ||
        !projectMode.taskTextCollapsed ||
        !projectMode.taskTextExpandWorks ||
        projectMode.actionIndent === null ||
        projectMode.actionIndent < 0 ||
        projectMode.actionIndent > 40
      ) {
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
  const navigationLayout = await verifyConversationNavigation(mainWindow);
  const roomDraftIsolation = await mainWindow.webContents
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
    const setDraft = (value) => {
      const input = document.querySelector('#social-message-input');
      if (!input) throw new Error('找不到聊天草稿输入框');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input;
    };
    const selectRoom = async (title) => {
      const row = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === title);
      if (!row) throw new Error('找不到聊天：' + title);
      row.click();
      await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === title, title + ' 聊天');
      return document.querySelector('#social-message-input');
    };
    await waitFor(() => document.querySelector('.room-list-item'), '联系人和聊天列表初始化');
    await selectRoom('Noema');
    const noemaDraft = 'E2E 草稿仅属于 Noema';
    setDraft(noemaDraft);
    const partnerInput = await selectRoom('工程搭档');
    const partnerStartedEmpty = partnerInput?.value === '';
    const partnerDraft = 'E2E 草稿仅属于工程搭档';
    setDraft(partnerDraft);
    const noemaInput = await selectRoom('Noema');
    const noemaDraftRestored = noemaInput?.value === noemaDraft;
    const partnerInputAgain = await selectRoom('工程搭档');
    const partnerDraftRestored = partnerInputAgain?.value === partnerDraft;
    await selectRoom('Noema');
    setDraft('');
    return { partnerStartedEmpty, noemaDraftRestored, partnerDraftRestored };
  })()`);
  if (
    !roomDraftIsolation?.partnerStartedEmpty ||
    !roomDraftIsolation?.noemaDraftRestored ||
    !roomDraftIsolation?.partnerDraftRestored
  ) {
    throw new Error(
      `切换聊天时的草稿隔离不符合预期：${JSON.stringify(roomDraftIsolation)}`,
    );
  }
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
      .find((item) => item.querySelector('.item-title')?.textContent?.trim() === '工程搭档');
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
  let specialistDelegation: Record<string, unknown> | null = null;
  if (!testSocialAgentLiveE2e) {
    socialAgentE2eModelRequests = [];
    const delegation = (await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const waitFor = async (predicate, label, timeoutMs = 7000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        throw new Error('等待超时：' + label);
      };
      const noemaRoomItem = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
      noemaRoomItem?.click();
      await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === 'Noema', '返回 Noema 主聊');
      const before = await window.noema.getSocialState();
      const beforeRoom = await window.noema.getSocialRoom('room-noema');
      const input = document.querySelector('#social-message-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!input || input.disabled || !setter) throw new Error('Noema 主聊输入框不可用');
      const trigger = ${JSON.stringify(socialAgentDelegationMarker)} + '一项信息，并整理成清单：比较三种代码托管方案应核对哪些关键字段？';
      setter.call(input, trigger);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const completed = await waitFor(async () => {
        const room = await window.noema.getSocialRoom('room-noema');
        const user = [...room.messages].reverse().find((message) => message.role === 'user' && message.content.includes(${JSON.stringify(socialAgentDelegationMarker)}));
        const assistant = user ? room.messages.find((message) => message.turnId === user.turnId && message.role === 'assistant') : null;
        if (assistant?.status === 'failed' || assistant?.status === 'interrupted') {
          throw new Error('委派回复未完成：' + (assistant.errorCode ?? assistant.status));
        }
        return user && assistant?.status === 'complete' ? { room, user, assistant } : null;
      }, '专业 agent 委派完成');
      await waitFor(
        () =>
          [...document.querySelectorAll('.chat-message.agent-message')].some(
            (article) => article.dataset.messageId === completed.assistant.id,
          ),
        '专业 agent 委派回复显示在聊天中',
      );
      const after = await window.noema.getSocialState();
      const assistantArticle = [...document.querySelectorAll('.chat-message.agent-message')]
        .find((article) => article.dataset.messageId === completed.assistant.id);
      const turn = assistantArticle?.closest('.conversation-turn');
      const userArticle = turn?.querySelector('.user-message');
      const measureMessage = (article) => {
        const body = article?.querySelector('.message-body');
        const bubble = article?.querySelector('.message-bubble');
        const bodyRect = body?.getBoundingClientRect();
        const bubbleRect = bubble?.getBoundingClientRect();
        return bodyRect && bubbleRect
          ? {
              bodyHeight: Math.round(bodyRect.height),
              bubbleHeight: Math.round(bubbleRect.height),
              bodyWidth: Math.round(bodyRect.width),
              bubbleWidth: Math.round(bubbleRect.width),
              authorHeight: Math.round(article.querySelector('.message-author')?.getBoundingClientRect().height ?? 0),
            }
          : null;
      };
      const messageGeometry = {
        user: measureMessage(userArticle),
        assistant: measureMessage(assistantArticle),
      };
      const messagesInTurn = turn?.querySelectorAll('.chat-message').length ?? 0;
      const promptText = ${JSON.stringify(socialAgentDelegationTask)};
      return {
        userText: completed.user.content,
        assistantMessageId: completed.assistant.id,
        assistantText: completed.assistant.content,
        assistantStatus: completed.assistant.status,
        sameTurn: completed.user.turnId === completed.assistant.turnId,
        groupedInUi: messagesInTurn === 2,
        directSpeakerAttributionWorks: Boolean(
          turn &&
            !turn.querySelector('.user-message .message-author')?.classList.contains('visually-hidden') &&
            turn.querySelector('.user-message .message-author strong')?.textContent?.trim() === '你' &&
            !turn.querySelector('.agent-message .message-author')?.classList.contains('visually-hidden') &&
            turn.querySelector('.agent-message .message-author strong')?.textContent?.trim() === 'Noema',
        ),
        assistantVisible: Boolean(assistantArticle && assistantArticle.getClientRects().length),
        messageGeometry,
        messageBodyFitsContent: [messageGeometry.user, messageGeometry.assistant].every(
          (item) => item && item.bodyHeight <= item.bubbleHeight + 32,
        ),
        messageAuxiliaryOutsideBubble: Boolean(
          turn &&
            !turn.querySelector('.message-actions')?.closest('.message-body') &&
            !turn.querySelector('.interaction-adjustment-trace')?.closest('.message-body'),
        ),
        visibleDelegationLabels: Boolean(turn?.textContent?.includes('工程搭档的协助') && turn.textContent.includes(${JSON.stringify(socialAgentDelegationTask)})),
        actualResultVisible: Boolean(turn?.textContent?.includes(${JSON.stringify(socialAgentDelegationResult)})),
        initialMessageCount: beforeRoom.messages.length,
        messageCountDelta: completed.room.messages.length - beforeRoom.messages.length,
        roomCountUnchanged: before.rooms.length === after.rooms.length,
        workspaceTasksUnchanged: completed.room.workTasks.length === beforeRoom.workTasks.length,
        model: completed.assistant.model,
        promptText,
      };
    })()`)) as Record<string, unknown>;
    specialistDelegation = delegation;
    const delegationRequests = socialAgentE2eModelRequests.splice(0);
    const delegatedInput = delegationRequests[1]?.messages ?? [];
    delegation.specialistContextBounded =
      delegationRequests.length === 2 &&
      delegatedInput.length === 3 &&
      delegatedInput.at(-1)?.role === 'user' &&
      delegatedInput.at(-1)?.content === socialAgentDelegationTask &&
      delegatedInput.every(
        (message) =>
          !message.content.includes(socialAgentDelegationMarker) &&
          !message.content.includes('紫水晶') &&
          !message.content.includes('先问我最在意的部分'),
      );
    delegation.singleExtraInference = delegationRequests.length === 2;
    if (
      delegation.assistantStatus !== 'complete' ||
      !delegation.sameTurn ||
      !delegation.groupedInUi ||
      !delegation.directSpeakerAttributionWorks ||
      !delegation.assistantVisible ||
      !delegation.messageAuxiliaryOutsideBubble ||
      !delegation.messageBodyFitsContent ||
      !delegation.visibleDelegationLabels ||
      !delegation.actualResultVisible ||
      delegation.messageCountDelta !== 2 ||
      !delegation.roomCountUnchanged ||
      !delegation.workspaceTasksUnchanged ||
      !delegation.specialistContextBounded ||
      !delegation.singleExtraInference
    ) {
      throw new Error(
        `Noema 主聊委派与消息呈现不符合预期：${JSON.stringify(delegation)}`,
      );
    }
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await mainWindow.webContents.executeJavaScript(`(() => {
      const trigger = [...document.querySelectorAll('.chat-message.user-message')]
        .find((article) => article.textContent?.includes(${JSON.stringify(socialAgentDelegationMarker)}));
      trigger?.scrollIntoView({ block: 'center' });
    })()`);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    if (socialAgentDelegationDesktopScreenshotPath) {
      writeSmokeScreenshot(
        socialAgentDelegationDesktopScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
    mainWindow.setSize(680, 560);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await mainWindow.webContents.executeJavaScript(`(() => {
      const reply = [...document.querySelectorAll('.chat-message.agent-message')]
        .find((article) => article.dataset.messageId === ${JSON.stringify(specialistDelegation.assistantMessageId)});
      reply?.scrollIntoView({ block: 'center' });
    })()`);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const delegationNarrowLayout = await mainWindow.webContents
      .executeJavaScript(`(() => {
      const shell = document.querySelector('.social-shell');
      const thread = document.querySelector('.message-thread');
      const composer = document.querySelector('.message-composer');
      const rect = composer?.getBoundingClientRect();
      return {
        width: window.innerWidth,
        composerVisible: Boolean(rect && rect.width > 0 && rect.height > 0 && rect.bottom <= window.innerHeight),
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        threadNoOverflow: Boolean(thread && thread.scrollWidth <= thread.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        groupedTurnVisible: Boolean([...document.querySelectorAll('.conversation-turn')].some((turn) => turn.querySelectorAll('.chat-message').length === 2 && turn.getClientRects().length)),
      };
    })()`);
    delegation.narrowLayout = delegationNarrowLayout;
    if (
      !delegationNarrowLayout.composerVisible ||
      !delegationNarrowLayout.shellNoOverflow ||
      !delegationNarrowLayout.threadNoOverflow ||
      !delegationNarrowLayout.documentNoOverflow ||
      !delegationNarrowLayout.groupedTurnVisible
    ) {
      throw new Error(
        `专业 agent 委派窄窗布局不符合预期：${JSON.stringify(delegationNarrowLayout)}`,
      );
    }
    delegation.passed = true;
    if (socialAgentDelegationNarrowScreenshotPath) {
      writeSmokeScreenshot(
        socialAgentDelegationNarrowScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
  }
  let historySearch: Record<string, unknown> | null = null;
  if (!testSocialAgentLiveE2e) {
    if (!socialChatService) throw new Error('社交聊天服务尚未就绪');
    const historySeed = socialChatService.store.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: `${socialHistoryRecallMarker}。`,
      model: 'e2e-local-spy',
    });
    socialChatService.store.appendAssistantDelta(
      historySeed.assistantMessageId,
      '这条旧消息用于检查 Noema 是否能在用户明确提及时找回原文。',
    );
    socialChatService.store.completeReply(historySeed.assistantMessageId);
    mainWindow.setSize(1280, 800);
    const searchFlow = (await mainWindow.webContents
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
      const setSearch = (query) => {
        const input = document.querySelector('.chat-search input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!input || !setter) throw new Error('聊天搜索框不可用');
        setter.call(input, query);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setSearch('不愉快经历');
      const earlierHit = await waitFor(
        () =>
          document.querySelector('.message-search-results')?.dataset.searchQuery === '不愉快经历' &&
          document.querySelector('.message-search-results')?.dataset.searchState === 'complete'
            ? [...document.querySelectorAll('.message-search-result')]
                .find((button) => button.textContent?.includes('不愉快经历'))
            : null,
        '搜索到不在最新预览中的历史消息',
      );
      const earlierTitle = earlierHit.querySelector('.message-search-result-heading strong')?.textContent?.trim();
      const earlierMessageId = earlierHit.dataset.messageId;
      earlierHit.click();
      await waitFor(() => {
        const room = document.querySelector('.room-header h2')?.textContent?.trim();
        const target = document.querySelector('[data-message-id="' + earlierMessageId + '"]');
        const thread = document.querySelector('.message-thread')?.getBoundingClientRect();
        const rect = target?.getBoundingClientRect();
        return room === 'Noema' && rect && thread && rect.bottom > thread.top && rect.top < thread.bottom;
      }, '跳回历史消息');
      setSearch('紫水晶');
      const crossRoomHit = await waitFor(
        () =>
          document.querySelector('.message-search-results')?.dataset.searchQuery === '紫水晶' &&
          document.querySelector('.message-search-results')?.dataset.searchState === 'complete'
            ? [...document.querySelectorAll('.message-search-result')]
                .find((button) => button.textContent?.includes('紫水晶') && button.querySelector('.message-search-result-heading strong')?.textContent?.trim() === '工程搭档')
            : null,
        '搜索到另一聊天中的消息',
      );
      const crossRoomMessageId = crossRoomHit.dataset.messageId;
      crossRoomHit.click();
      await waitFor(() => {
        const room = document.querySelector('.room-header h2')?.textContent?.trim();
        const target = document.querySelector('[data-message-id="' + crossRoomMessageId + '"]');
        const thread = document.querySelector('.message-thread')?.getBoundingClientRect();
        const rect = target?.getBoundingClientRect();
        return room === '工程搭档' && rect && thread && rect.bottom > thread.top && rect.top < thread.bottom;
      }, '跨聊天跳回命中消息');
      const searchClearedAfterOpen = document.querySelector('.chat-search input')?.value === '';
      setSearch('紫水晶');
      await waitFor(
        () =>
          document.querySelector('.message-search-results')?.dataset.searchQuery === '紫水晶' &&
          document.querySelector('.message-search-results')?.dataset.searchState === 'complete' &&
          [...document.querySelectorAll('.message-search-result')]
            .some((button) => button.textContent?.includes('紫水晶')),
        '显示聊天搜索结果',
      );
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const searchResults = [...document.querySelectorAll('.message-search-result')];
      const visibleSearchResults = searchResults.filter((button) => {
        const rect = button.getBoundingClientRect();
        return getComputedStyle(button).visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
      return {
        earlierResultRoom: earlierTitle,
        earlierResultReached: true,
        crossRoomResultRoom: '工程搭档',
        crossRoomResultReached: true,
        searchClearedAfterOpen,
        searchResultCount: searchResults.length,
        searchResultsVisible: visibleSearchResults.length > 0,
        searchResultBounds: visibleSearchResults.map((button) => {
          const rect = button.getBoundingClientRect();
          const list = button.closest('.conversation-list');
          const listRect = list?.getBoundingClientRect();
          const style = getComputedStyle(button);
          return {
            top: rect.top,
            bottom: rect.bottom,
            listTop: listRect?.top,
            listBottom: listRect?.bottom,
            listScrollTop: list?.scrollTop,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            color: style.color,
            text: button.textContent?.trim(),
          };
        }),
      };
    })()`)) as Record<string, unknown>;
    socialAgentE2eModelRequests = [];
    const historyRecall = (await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const waitFor = async (predicate, label, timeoutMs = 7000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        throw new Error('等待超时：' + label);
      };
      const noemaRoomItem = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
      noemaRoomItem?.click();
      await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === 'Noema', '返回 Noema 主聊');
      const input = document.querySelector('#social-message-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!input || input.disabled || !setter) throw new Error('Noema 主聊输入框不可用');
      const userText = '你还记得我们之前说过「${socialHistoryRecallMarker}」吗？';
      setter.call(input, userText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const state = await waitFor(async () => {
        const room = await window.noema.getSocialRoom('room-noema');
        const user = [...room.messages].reverse().find((message) => message.role === 'user' && message.content === userText);
        const assistant = user ? room.messages.find((message) => message.turnId === user.turnId && message.role === 'assistant') : null;
        if (assistant?.status === 'failed' || assistant?.status === 'interrupted') {
          throw new Error('历史回忆回复未完成：' + (assistant.errorCode ?? assistant.status));
        }
        return user && assistant?.status === 'complete' ? { room, user, assistant } : null;
      }, 'Noema 历史回忆回复完成');
      const article = await waitFor(
        () => [...document.querySelectorAll('.chat-message.agent-message')]
          .find((item) => item.dataset.messageId === state.assistant.id),
        '历史来源追溯显示在回复旁',
      );
      const trace = article.querySelector('.social-history-recall-trace');
      if (!trace) throw new Error('主聊没有显示历史来源追溯');
      trace.open = true;
      trace.setAttribute('open', '');
      const sourceButton = trace.querySelector('button');
      const sourceId = sourceButton?.closest('li')?.querySelector('blockquote')?.textContent;
      const sourceExcerptVisible = Boolean(
        trace.open &&
        sourceButton?.getBoundingClientRect().height &&
        sourceButton.closest('li')?.querySelector('blockquote')?.getBoundingClientRect().height,
      );
      const sourceMessageId = state.assistant.historySources?.[0]?.id;
      const sourceRoomId = state.assistant.historySources?.[0]?.roomId;
      const sourceVisible = Boolean(
        trace.textContent.includes(${JSON.stringify(socialHistoryRecallMarker)}) &&
        trace.textContent.includes('跳到原对话') &&
        state.assistant.historySearchStatus === 'found' &&
        state.assistant.historySourcesIncluded === true &&
        state.assistant.historySources.some((source) => source.id === ${JSON.stringify(historySeed.userMessageId)}),
      );
      if (!sourceVisible || !sourceExcerptVisible || !sourceButton || sourceRoomId !== 'room-noema') {
        throw new Error('历史来源未按预期展示：' + JSON.stringify(state.assistant.historySources));
      }
      return {
        userText,
        assistantId: state.assistant.id,
        status: state.assistant.historySearchStatus,
        sourceCount: state.assistant.historySources.length,
        sourcesIncluded: state.assistant.historySourcesIncluded,
        sourceRoomId,
        sourceText: sourceId,
        sourceMessageId,
        sourceVisible,
        sourceExcerptVisible,
      };
    })()`)) as Record<string, unknown>;
    const recallModelInput =
      socialAgentE2eModelRequests[0]?.messages
        .map((message) => message.content)
        .join('\n') ?? '';
    const recallModelCalls = socialAgentE2eModelRequests.length;
    historySearch = {
      ...searchFlow,
      recall: { ...historyRecall, modelCalls: recallModelCalls },
    };
    if (
      recallModelCalls !== 1 ||
      !recallModelInput.includes(socialHistoryRecallMarker) ||
      recallModelInput.includes('紫水晶') ||
      !historyRecall.sourceVisible ||
      !historyRecall.sourceExcerptVisible
    ) {
      throw new Error(
        `历史回忆未保持范围、成本和来源边界：${JSON.stringify({ historyRecall, recallModelCalls, recallModelInput })}`,
      );
    }
    if (socialHistoryRecallScreenshotPath) {
      writeSmokeScreenshot(
        socialHistoryRecallScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
    const recallSourceJump = await mainWindow.webContents
      .executeJavaScript(`(() => {
      const trace = document.querySelector('[data-message-id="${historyRecall.assistantId}"] .social-history-recall-trace');
      const button = trace?.querySelector('button');
      const sourceId = ${JSON.stringify(historyRecall.sourceMessageId)};
      button?.click();
      const target = document.querySelector('[data-message-id="' + sourceId + '"]');
      const thread = document.querySelector('.message-thread')?.getBoundingClientRect();
      const rect = target?.getBoundingClientRect();
      return Boolean(target && rect && thread && rect.bottom > thread.top && rect.top < thread.bottom);
    })()`);
    if (!recallSourceJump) throw new Error('历史来源入口没有跳回原消息');
    (historySearch.recall as Record<string, unknown>).sourceJumped = true;
    if (
      searchFlow.earlierResultRoom !== 'Noema' ||
      !searchFlow.earlierResultReached ||
      !searchFlow.crossRoomResultReached ||
      !searchFlow.searchClearedAfterOpen ||
      !searchFlow.searchResultsVisible ||
      !recallSourceJump
    ) {
      throw new Error(
        `历史消息搜索没有回到原对话：${JSON.stringify(searchFlow)}`,
      );
    }
    if (socialMessageSearchScreenshotPath) {
      writeSmokeScreenshot(
        socialMessageSearchScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
    await mainWindow.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('.chat-search input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (input && setter) {
        setter.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
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
      .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
    if (!noemaRoom) throw new Error('找不到 Noema 主聊天');
    noemaRoom.click();
    await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === 'Noema', 'Noema 主聊天');
    const sourceText = '分享不愉快经历时，请先问我最在意的部分。';
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
    const originMessageTimeHidden = !document.querySelector('.chat-message.user-message .message-meta');
    return { threadRoomId: room.id, originVisible, originIdMatches, originLabelVisible, originMessageTimeHidden };
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
    !continuationLifecycle.originMessageTimeHidden ||
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
    document.querySelector('.navigation-reveal')?.click();
    await waitFor(() => !document.querySelector('.social-body')?.classList.contains('room-open'), '移动端返回联系人列表');
    await waitFrames();
    document.querySelector('.new-agent-button')?.click();
    await waitFor(() => document.querySelector('#social-agent-name'), '重新打开联系人表单');
    let name = 'E2E 图形观察员';
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
    const directBeforeProfileEdit = await window.noema.getSocialRoom(directRoom.room.id);
    const initialDirectMessageIds = directBeforeProfileEdit.messages.map((message) => message.id);
    document.querySelector('button[aria-label^="编辑"]')?.click();
    await waitFor(() => document.querySelector('#social-agent-name'), '编辑联系人资料表单');
    await waitFrames();
    const profileEditNarrow = (() => {
      const dialog = document.querySelector('.agent-create-dialog')?.getBoundingClientRect();
      const submit = document.querySelector('.agent-create-dialog button[type="submit"]')?.getBoundingClientRect();
      const shell = document.querySelector('.social-shell');
      return {
        width: window.innerWidth,
        visible: Boolean(dialog && dialog.width > 0 && dialog.height > 0),
        fieldCount: document.querySelectorAll('.agent-create-dialog .dialog-field').length,
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        submitVisible: Boolean(dialog && submit && submit.top >= dialog.top && submit.bottom <= dialog.bottom && submit.bottom <= window.innerHeight),
      };
    })();
    if (
      !profileEditNarrow.visible ||
      profileEditNarrow.fieldCount !== 3 ||
      !profileEditNarrow.shellNoOverflow ||
      !profileEditNarrow.documentNoOverflow ||
      !profileEditNarrow.submitVisible
    ) throw new Error('窄窗口联系人资料表单布局不符合预期：' + JSON.stringify(profileEditNarrow));
    const updatedName = 'E2E 视觉与交互研究员';
    setValue(document.querySelector('#social-agent-name'), updatedName);
    setValue(document.querySelector('#social-agent-headline'), '长期研究游戏视觉、交互与用户测试');
    setValue(document.querySelector('#social-agent-description'), '先检查一手证据，再说明不确定性和可验证的下一步。');
    document.querySelector('.agent-create-dialog button[type="submit"]')?.click();
    const profileUpdatedState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const agent = state.agents.find((candidate) => candidate.id === createdState.agent.id);
      return agent?.name === updatedName ? { state, agent } : null;
    }, '更新后的联系人资料');
    await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === updatedName, '同步更新联系人私聊标题');
    const updatedDirectRoom = await window.noema.getSocialRoom(directRoom.room.id);
    const profileEdit = {
      name: updatedName,
      identityPreserved: profileUpdatedState.agent.id === createdState.agent.id,
      updatedForFutureReplies:
        profileUpdatedState.agent.headline === '长期研究游戏视觉、交互与用户测试' &&
        profileUpdatedState.agent.description === '先检查一手证据，再说明不确定性和可验证的下一步。',
      capabilityPreserved: profileUpdatedState.agent.capabilities.includes('project-work'),
      historyPreserved:
        updatedDirectRoom.messages.length === initialDirectMessageIds.length &&
        updatedDirectRoom.messages.every((message, index) => message.id === initialDirectMessageIds[index]),
      directTitleUpdated: updatedDirectRoom.room.title === updatedName,
      narrowLayout: profileEditNarrow,
    };
    if (
      !profileEdit.identityPreserved ||
      !profileEdit.updatedForFutureReplies ||
      !profileEdit.capabilityPreserved ||
      !profileEdit.historyPreserved ||
      !profileEdit.directTitleUpdated
    ) throw new Error('联系人资料编辑破坏了身份、能力或聊天记录：' + JSON.stringify(profileEdit));
    name = updatedName;
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
    document.querySelector('.new-project-button')?.click();
    await waitFor(() => document.querySelector('.project-dialog input'), '新项目表单');
    setValue(document.querySelector('.project-dialog input'), 'E2E 定价追踪');
    setValue(document.querySelector('.project-dialog textarea'), '比较平台价格并记录变化。');
    const projectMemberOption = [...document.querySelectorAll('.project-dialog .group-agent-option')]
      .find((option) => option.querySelector('strong')?.textContent?.trim() === name);
    if (!projectMemberOption) throw new Error('已创建的专业联系人没有出现在项目成员列表中');
    projectMemberOption.querySelector('input')?.click();
    document.querySelector('.project-dialog button[type="submit"]')?.click();
    await waitFor(() => document.querySelector('.project-workspace h2')?.textContent?.trim() === 'E2E 定价追踪' && document.querySelector('.room-header h2')?.textContent?.trim() === 'Noema', 'Noema 主聊旁的项目工作区');
    const projectCreatedState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const project = state.projects.find((candidate) => candidate.title === 'E2E 定价追踪');
      return project ? { state, project } : null;
    }, '项目持久化状态');
    const projectSidebarEntry = [...document.querySelectorAll('.project-list-item')]
      .find((item) => item.querySelector('strong')?.textContent?.trim() === 'E2E 定价追踪');
    const projectNotDuplicatedInOtherChats = ![...document.querySelectorAll('.conversation-list .room-list-item')]
      .some((item) => item.querySelector('.item-title')?.textContent?.includes('E2E 定价追踪'));
    const projectBannerVisible = Boolean(document.querySelector('.project-workspace-brief')?.textContent?.includes('比较平台价格并记录变化'));
    const projectMemberSession = projectCreatedState.project.members.find((member) => member.agentId === createdState.agent.id);
    const projectGroup = await window.noema.getSocialRoom(projectCreatedState.project.groupRoomId);
    const projectPrivateDmUnchanged = !(await window.noema.getSocialRoom(directRoom.room.id)).messages.some((message) => message.content.includes('比较平台价格并记录变化'));
    document.querySelector('.project-archive-action')?.click();
    const archivedProjectState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const project = state.projects.find((candidate) => candidate.id === projectCreatedState.project.id);
      return project?.status === 'archived' ? state : null;
    }, '项目归档状态');
    const archivedProjectHidden = !archivedProjectState.rooms.some((room) => room.id === projectCreatedState.project.groupRoomId);
    await waitFor(() => document.querySelector('.archived-project-toggle'), '归档项目分区');
    document.querySelector('.archived-project-toggle')?.click();
    const archivedProjectEntry = await waitFor(() =>
      [...document.querySelectorAll('.archived-project-item')]
        .find((item) => item.querySelector('strong')?.textContent?.trim() === 'E2E 定价追踪'),
      '归档列表中的项目恢复入口',
    );
    archivedProjectEntry?.click();
    const restoredProjectState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const project = state.projects.find((candidate) => candidate.id === projectCreatedState.project.id);
      return project?.status === 'active' ? state : null;
    }, '项目恢复状态');
    await waitFor(() => document.querySelector('.project-workspace h2')?.textContent?.trim() === 'E2E 定价追踪', '恢复后的原项目工作区');
    const openMemberSession = [...document.querySelectorAll('.project-workspace .project-member-open')]
      .find((button) => button.parentElement?.textContent?.includes(name));
    if (!openMemberSession) throw new Error('项目群没有提供成员独立会话入口');
    openMemberSession.click();
    await waitFor(() => document.querySelector('.room-header h2')?.textContent?.trim() === name, '成员项目会话');
    const sessionMarker = 'E2E 项目会话请求标记：蓝松石';
    setValue(document.querySelector('#social-message-input'), sessionMarker);
    document.querySelector('.send-message-button')?.click();
    const projectSessionReply = await waitFor(async () => {
      const room = await window.noema.getSocialRoom(projectMemberSession.sessionRoomId);
      const userMessage = room.messages.find((message) => message.content.includes(sessionMarker));
      const assistantMessage = userMessage && room.messages.find((message) => message.turnId === userMessage.turnId && message.role === 'assistant');
      return assistantMessage?.status === 'complete' ? { room, userMessage, assistantMessage } : null;
    }, '成员项目会话回复');
    const projectLifecycle = {
      created: Boolean(projectSidebarEntry && projectCreatedState.project.status === 'active'),
      projectNotDuplicatedInOtherChats,
      projectBannerVisible,
      memberSessionCreated: Boolean(projectMemberSession?.sessionRoomId),
      groupRoomLoaded: projectGroup.room.id === projectCreatedState.project.groupRoomId,
      projectPrivateDmUnchanged,
      archived: archivedProjectState.projects.find((candidate) => candidate.id === projectCreatedState.project.id)?.status === 'archived',
      archivedProjectHidden,
      restored: restoredProjectState.rooms.some((room) => room.id === projectCreatedState.project.groupRoomId),
      restoredSameSession: restoredProjectState.projects.find((candidate) => candidate.id === projectCreatedState.project.id)?.members.find((member) => member.agentId === createdState.agent.id)?.sessionRoomId === projectMemberSession?.sessionRoomId,
      memberSessionOpened: document.querySelector('.project-context-kicker')?.textContent?.includes(name) ?? false,
      memberSessionReplied: projectSessionReply.assistantMessage.status === 'complete',
      projectSessionContainsOnlyItsOwnRequest: projectSessionReply.room.messages.some((message) => message.content.includes(sessionMarker)) && !projectSessionReply.room.messages.some((message) => message.content.includes('葡萄柚') || message.content.includes('珊瑚标记')),
    };
    return {
      navigationLayout: ${JSON.stringify(navigationLayout)},
      roomDraftIsolation: ${JSON.stringify(roomDraftIsolation)},
      forwarding: {
        ...${JSON.stringify(forwardingSelection)},
        narrow: ${JSON.stringify(forwardNarrow)},
        ...${JSON.stringify(forwardingSent)},
      },
      specialistDelegation: ${JSON.stringify(specialistDelegation)},
      historySearch: ${JSON.stringify(historySearch)},
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
      agentProfileEdit: profileEdit,
      compactRoomLayout,
      archived: Boolean(archivedState.agents.find((agent) => agent.id === createdState.agent.id)?.archivedAt),
      archivedUi,
      archivedInviteExcluded,
      restored: !restoredState.agents.find((agent) => agent.id === createdState.agent.id)?.archivedAt,
      inviteVisible,
      sameIdentityJoined,
      groupDidNotImportDm,
      projectLifecycle,
      totalAgents: groupState.agents.length,
      totalRooms: groupState.rooms.length,
    };
  })()`);

  const projectSessionPrompt =
    socialAgentE2eModelRequests.at(-1)?.messages ?? [];
  result.projectLifecycle.projectSessionModelScope =
    projectSessionPrompt.some((message) =>
      message.content.includes('noema_project_session'),
    ) &&
    projectSessionPrompt.some((message) =>
      message.content.includes('比较平台价格并记录变化'),
    ) &&
    projectSessionPrompt.some((message) =>
      message.content.includes('E2E 项目会话请求标记：蓝松石'),
    ) &&
    !projectSessionPrompt.some((message) =>
      /葡萄柚|珊瑚标记/.test(message.content),
    );

  if (socialAgentProjectScreenshotPath) {
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const image = await mainWindow.capturePage();
    writeSmokeScreenshot(socialAgentProjectScreenshotPath, image);
  }

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
    !result.groupDidNotImportDm ||
    !result.projectLifecycle?.created ||
    !result.projectLifecycle.projectNotDuplicatedInOtherChats ||
    !result.projectLifecycle.projectBannerVisible ||
    !result.projectLifecycle.memberSessionCreated ||
    !result.projectLifecycle.groupRoomLoaded ||
    !result.projectLifecycle.projectPrivateDmUnchanged ||
    !result.projectLifecycle.archived ||
    !result.projectLifecycle.archivedProjectHidden ||
    !result.projectLifecycle.restored ||
    !result.projectLifecycle.restoredSameSession ||
    !result.projectLifecycle.memberSessionOpened ||
    !result.projectLifecycle.memberSessionReplied ||
    !result.projectLifecycle.projectSessionContainsOnlyItsOwnRequest ||
    !result.projectLifecycle.projectSessionModelScope
  ) {
    throw new Error(
      `用户专业联系人创建流程不符合预期：${JSON.stringify(result)}`,
    );
  }
  await mainWindow.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    document.querySelector('.navigation-reveal')?.click();
    await waitFor(() => !document.querySelector('.social-body')?.classList.contains('room-open'), '打开移动端聊天列表');
    const expectedAgentName = ${JSON.stringify(result.agentProfileEdit?.name ?? '')};
    const row = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.item-title')?.textContent?.trim() === expectedAgentName);
    if (!row) throw new Error('找不到专业联系人的常驻私聊列表项');
    row?.click();
    await waitFor(
      () =>
        document.querySelector('.room-header h2')?.textContent?.trim() ===
          expectedAgentName &&
        !document.querySelector('.project-context-strip'),
      '返回成员常驻私聊',
    );
  })()`);
  const inspectAgentProfileDialog = async (width: number, height: number) => {
    mainWindow?.setSize(width, height);
    await mainWindow?.webContents.executeJavaScript(
      `new Promise((resolve) => {
        const dialog = document.querySelector('.agent-create-dialog');
        const animations = dialog?.getAnimations() ?? [];
        Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
          .then(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })`,
    );
    return mainWindow?.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('.agent-create-dialog')?.getBoundingClientRect();
      const submit = document.querySelector('.agent-create-dialog button[type="submit"]')?.getBoundingClientRect();
      const shell = document.querySelector('.social-shell');
      return {
        width: window.innerWidth,
        visible: Boolean(dialog && dialog.width > 0 && dialog.height > 0),
        fieldCount: document.querySelectorAll('.agent-create-dialog .dialog-field').length,
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        submitVisible: Boolean(dialog && submit && submit.top >= dialog.top && submit.bottom <= dialog.bottom && submit.bottom <= window.innerHeight),
      };
    })()`);
  };
  await mainWindow.webContents.executeJavaScript(`(async () => {
    const edit = document.querySelector('button[aria-label^="编辑"]');
    if (!edit) throw new Error('联系人私聊缺少资料编辑入口');
    edit.click();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !document.querySelector('.agent-create-dialog')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (!document.querySelector('.agent-create-dialog')) throw new Error('资料编辑窗口没有打开');
  })()`);
  const profileNarrow = await inspectAgentProfileDialog(360, 640);
  if (
    !profileNarrow?.visible ||
    profileNarrow.width > 700 ||
    profileNarrow.fieldCount !== 3 ||
    !profileNarrow.shellNoOverflow ||
    !profileNarrow.documentNoOverflow ||
    !profileNarrow.submitVisible
  ) {
    throw new Error(
      `窄窗口联系人资料编辑布局不符合预期：${JSON.stringify(profileNarrow)}`,
    );
  }
  if (socialAgentProfileNarrowScreenshotPath) {
    writeSmokeScreenshot(
      socialAgentProfileNarrowScreenshotPath,
      await mainWindow.capturePage(),
    );
  }
  await mainWindow.webContents.executeJavaScript(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
  );
  await mainWindow.webContents.executeJavaScript(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
  mainWindow.setSize(1280, 800);
  await mainWindow.webContents.executeJavaScript(`(async () => {
    const edit = document.querySelector('button[aria-label^="编辑"]');
    edit?.click();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !document.querySelector('.agent-create-dialog')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  })()`);
  const profileDesktop = await inspectAgentProfileDialog(1280, 800);
  if (
    !profileDesktop?.visible ||
    profileDesktop.fieldCount !== 3 ||
    !profileDesktop.shellNoOverflow ||
    !profileDesktop.documentNoOverflow ||
    !profileDesktop.submitVisible
  ) {
    throw new Error(
      `桌面联系人资料编辑布局不符合预期：${JSON.stringify(profileDesktop)}`,
    );
  }
  if (socialAgentProfileDesktopScreenshotPath) {
    writeSmokeScreenshot(
      socialAgentProfileDesktopScreenshotPath,
      await mainWindow.capturePage(),
    );
  }
  await mainWindow.webContents.executeJavaScript(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
  );
  result.agentProfileEdit.desktopLayout = profileDesktop;
  result.agentProfileEdit.narrowLayout = profileNarrow;
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
    contactDesktop?.roomTitle !== result.agentProfileEdit?.name ||
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
    contactNarrow?.roomTitle !== result.agentProfileEdit?.name ||
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
  const textAttachments = await captureSocialTextAttachmentsE2e();
  return { ...result, contactDesktop, contactNarrow, textAttachments };
}

async function captureSocialTextAttachmentsE2e() {
  if (!mainWindow || mainWindow.isDestroyed() || testSocialAgentLiveE2e) {
    throw new Error('文字附件 E2E 需要隔离的确定性模型与桌面窗口。');
  }
  const requestCountBefore = socialAgentE2eModelRequests.length;
  const ui = await mainWindow.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate, label, timeoutMs = 7000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    await waitFor(() => document.querySelector('.room-list-item'), '聊天列表初始化');
    const noema = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
    if (!noema) {
      const state = await window.noema.getSocialState();
      return {
        missingNoema: true,
        rooms: state.rooms.map((room) => ({ id: room.id, title: room.title })),
        roomListTitles: [...document.querySelectorAll('.item-title')].map((item) => item.textContent?.trim()),
        visibleText: document.body.innerText.slice(0, 1200),
      };
    }
    noema.click();
    await waitFor(() => document.querySelector('.chat-header-title strong')?.textContent?.trim() === 'Noema', 'Noema 主聊');

    const choose = (file) => {
      const input = document.querySelector('input[aria-label="选择附件"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('找不到附件输入框。');
      const transfer = new DataTransfer();
      transfer.items.add(file);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set?.call(input, transfer.files);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const makePdf = () => {
      const stream = 'BT /F1 12 Tf 72 720 Td (Noema PDF marker: amber harbor) Tj ET';
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        '<< /Length ' + stream.length + ' >>\\nstream\\n' + stream + '\\nendstream',
      ];
      let pdf = '%PDF-1.4\\n';
      const offsets = [0];
      for (const [index, object] of objects.entries()) {
        offsets.push(new TextEncoder().encode(pdf).byteLength);
        pdf += String(index + 1) + ' 0 obj\\n' + object + '\\nendobj\\n';
      }
      const xrefOffset = new TextEncoder().encode(pdf).byteLength;
      pdf += 'xref\\n0 ' + (objects.length + 1) + '\\n0000000000 65535 f \\n';
      pdf += offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n \\n').join('');
      pdf += 'trailer\\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\\nstartxref\\n' + xrefOffset + '\\n%%EOF';
      return new File([pdf], 'brief.pdf', { type: 'application/pdf' });
    };
    choose(new File(['unsupported'], 'photo.png', { type: 'image/png' }));
    await waitFor(() => document.querySelector('.inline-notice')?.textContent?.includes('图片暂不支持'), '不支持格式提示');
    const unsupportedNotice = document.querySelector('.inline-notice')?.textContent?.trim() ?? '';

    const input = document.querySelector('#social-message-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!(input instanceof HTMLTextAreaElement) || !setter) throw new Error('找不到聊天输入框。');
    setter.call(input, '请概括这个文件。');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    choose(new File(['remove me'], 'discard.txt', { type: 'text/plain' }));
    await waitFor(() => document.querySelector('.attachment-chip')?.textContent?.includes('discard.txt'), '待移除附件预览');
    document.querySelector('[aria-label="移除附件 discard.txt"]')?.click();
    await waitFor(() => !document.querySelector('.attachment-chip'), '移除附件');
    const draftPreservedAfterRemoval = input.value === '请概括这个文件。';
    choose(new File(['附件正文标记：琥珀海岸'], 'brief.txt', { type: 'text/plain' }));
    await waitFor(() => document.querySelector('.attachment-chip')?.textContent?.includes('brief.txt'), '附件预览');
    choose(makePdf());
    await waitFor(() => [...document.querySelectorAll('.attachment-chip')].some((chip) => chip.textContent?.includes('brief.pdf')), 'PDF 附件预览');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const desktop = (() => {
      const shell = document.querySelector('.social-shell');
      const composer = document.querySelector('.message-composer');
      return {
        width: window.innerWidth,
        sendEnabled: !document.querySelector('.send-message-button')?.disabled,
        chipVisible: Boolean(document.querySelector('.attachment-chip')?.getClientRects().length),
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        composerVisible: Boolean(composer && composer.getBoundingClientRect().bottom <= window.innerHeight),
      };
    })();
    return { unsupportedNotice, draftPreservedAfterRemoval, desktop };
  })()`);

  if (ui.missingNoema) {
    if (socialTextAttachmentDesktopScreenshotPath) {
      writeSmokeScreenshot(
        socialTextAttachmentDesktopScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
    throw new Error(`附件 E2E 未找到 Noema：${JSON.stringify(ui)}`);
  }
  if (
    !ui.draftPreservedAfterRemoval ||
    !ui.desktop?.sendEnabled ||
    !ui.desktop?.chipVisible ||
    !ui.desktop?.shellNoOverflow ||
    !ui.desktop?.documentNoOverflow ||
    !ui.desktop?.composerVisible
  ) {
    throw new Error(`文字附件桌面输入状态异常：${JSON.stringify(ui)}`);
  }
  if (socialTextAttachmentDesktopScreenshotPath) {
    writeSmokeScreenshot(
      socialTextAttachmentDesktopScreenshotPath,
      await mainWindow.capturePage(),
    );
  }

  mainWindow.setSize(680, 560);
  const narrow = await mainWindow.webContents.executeJavaScript(`(() => {
    const shell = document.querySelector('.social-shell');
    const composer = document.querySelector('.message-composer');
    return {
      width: window.innerWidth,
      sendEnabled: !document.querySelector('.send-message-button')?.disabled,
      chipVisible: Boolean(document.querySelector('.attachment-chip')?.getClientRects().length),
      shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
      documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      composerVisible: Boolean(composer && composer.getBoundingClientRect().bottom <= window.innerHeight),
    };
  })()`);
  if (
    !narrow?.sendEnabled ||
    !narrow?.chipVisible ||
    !narrow?.shellNoOverflow ||
    !narrow?.documentNoOverflow ||
    !narrow?.composerVisible
  ) {
    throw new Error(`文字附件窄窗输入状态异常：${JSON.stringify(narrow)}`);
  }
  if (socialTextAttachmentNarrowScreenshotPath) {
    writeSmokeScreenshot(
      socialTextAttachmentNarrowScreenshotPath,
      await mainWindow.capturePage(),
    );
  }

  const sent = await mainWindow.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate, label, timeoutMs = 7000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    document.querySelector('.send-message-button')?.click();
    return waitFor(async () => {
      const room = await window.noema.getSocialRoom('room-noema');
      const user = [...room.messages].reverse().find((message) =>
        message.role === 'user' && message.content.includes('Noema PDF marker: amber harbor'),
      );
      const assistant = user
        ? room.messages.find((message) => message.turnId === user.turnId && message.role === 'assistant')
        : null;
      if (assistant?.status === 'failed' || assistant?.status === 'interrupted') {
        throw new Error('附件消息回复失败：' + assistant.errorMessage);
      }
      if (user && assistant?.status === 'complete') {
        return {
          messageContent: user.content,
          replyStatus: assistant.status,
          remainingAttachmentChips: document.querySelectorAll('.attachment-chip').length,
        };
      }
      return null;
    }, '附件消息完成');
  })()`);
  const request = socialAgentE2eModelRequests.at(-1);
  const modelInput =
    request?.messages.map((message) => message.content).join('\n') ?? '';
  mainWindow.setSize(1280, 800);
  const result = {
    unsupportedNotice: ui.unsupportedNotice,
    draftPreservedAfterRemoval: ui.draftPreservedAfterRemoval,
    desktop: ui.desktop,
    narrow,
    messagePersisted:
      sent.messageContent.includes('附件文件："brief.txt"') &&
      sent.messageContent.includes('附件正文标记：琥珀海岸') &&
      sent.messageContent.includes('附件文件："brief.pdf"') &&
      sent.messageContent.includes('Noema PDF marker: amber harbor'),
    replyCompleted: sent.replyStatus === 'complete',
    modelReceivedAttachment:
      modelInput.includes('附件文件："brief.txt"') &&
      modelInput.includes('附件正文标记：琥珀海岸') &&
      modelInput.includes('附件文件："brief.pdf"') &&
      modelInput.includes('Noema PDF marker: amber harbor'),
    singleModelRequest:
      socialAgentE2eModelRequests.length === requestCountBefore + 1,
    attachmentDraftCleared: sent.remainingAttachmentChips === 0,
  };
  if (
    !result.unsupportedNotice.includes('图片暂不支持') ||
    !result.draftPreservedAfterRemoval ||
    !result.messagePersisted ||
    !result.replyCompleted ||
    !result.modelReceivedAttachment ||
    !result.singleModelRequest ||
    !result.attachmentDraftCleared
  ) {
    throw new Error(`文字附件没有完成同条消息闭环：${JSON.stringify(result)}`);
  }
  return result;
}

async function captureSocialR0FirstUseE2e() {
  if (!mainWindow || mainWindow.isDestroyed() || !testSocialAgentLiveE2e) {
    throw new Error('R0 首次使用路径需要隔离的真实模型和桌面窗口。');
  }
  const prompt =
    '我有一个摄影工作坊的小副业想法：面向本地新手，周末做半天实操课，家里已有场地，单次试办预算上限 3000 元。我想判断需求、课程设计、运营和预算是否可行，最后形成一页试办方案与关键风险。请先判断是否需要组织不同专业角色协作；如果需要，就创建合适的成员并完成首轮分析，把结果整理回这条主聊。不要替我决定是否上线；没有可靠本地数据的地方请标明待核实。';
  const sendPrompt = async (text: string, phase: string) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('发送 R0 主聊消息前，桌面窗口已关闭。');
    }
    writeSmokeLog(`${phase}-send-started`);
    let sendTimeout: NodeJS.Timeout | null = null;
    const sent = await Promise.race([
      mainWindow.webContents.executeJavaScript(
        `window.noema.sendSocialMessage(${JSON.stringify({
          roomId: 'room-noema',
          agentId: 'noema',
          text,
        })})`,
      ),
      new Promise<never>((_, reject) => {
        sendTimeout = setTimeout(
          () => reject(new Error('等待主聊接受 R0 消息超过 30 秒。')),
          30_000,
        );
      }),
    ]).finally(() => {
      if (sendTimeout) clearTimeout(sendTimeout);
    });
    writeSmokeLog(`${phase}-send-accepted`, { turnId: sent.turnId });
    return sent;
  };
  const waitForReply = async (sent: { turnId: string; messageId: string }) =>
    mainWindow!.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 7 * 60_000;
      const sent = ${JSON.stringify(sent)};
      while (Date.now() < deadline) {
        const [state, mainRoom] = await Promise.all([
          window.noema.getSocialState(),
          window.noema.getSocialRoom('room-noema'),
        ]);
        const userMessage = mainRoom.messages.find((message) => message.turnId === sent.turnId && message.role === 'user');
        const mainReply = userMessage
          ? mainRoom.messages.find((message) => message.turnId === userMessage.turnId && message.role === 'assistant')
          : null;
        const project = userMessage
          ? state.projects.find((item) => item.sourceMessageId === userMessage.id)
          : null;
        let memberReplies = [];
        if (project) {
          const group = await window.noema.getSocialRoom(project.groupRoomId);
          memberReplies = group.messages.filter((message) =>
            message.role === 'assistant' && message.senderAgentId !== 'noema' && message.status === 'complete'
          );
        }
        if (mainReply?.status === 'failed' || mainReply?.status === 'interrupted') {
          return {
            outcome: 'reply_failed', sent, replyStatus: mainReply.status,
            errorCode: mainReply.errorCode, errorMessage: mainReply.errorMessage,
            project: project ? { id: project.id, title: project.title, status: project.status, members: project.members.map(({ agentId, name, headline }) => ({ agentId, name, headline })) } : null,
            memberReplyCount: memberReplies.length, mainReply: mainReply.content,
          };
        }
        if (mainReply?.status === 'complete') {
          return {
            outcome: 'reply_complete', sent,
            project: project ? { id: project.id, title: project.title, status: project.status, members: project.members.map(({ agentId, name, headline }) => ({ agentId, name, headline })) } : null,
            memberReplyCount: memberReplies.length, mainReply: mainReply.content,
            memberReplySummaries: memberReplies.map((message) => ({ senderAgentId: message.senderAgentId, contentLength: message.content.length, tail: message.content.slice(-120) })),
            model: mainReply.model,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const room = await window.noema.getSocialRoom('room-noema');
      const state = await window.noema.getSocialState();
      const userMessage = room.messages.find((message) => message.turnId === sent.turnId && message.role === 'user');
      const project = userMessage
        ? state.projects.find((item) => item.sourceMessageId === userMessage.id)
        : null;
      const mainReply = userMessage
        ? room.messages.find((message) => message.turnId === userMessage.turnId && message.role === 'assistant')
        : null;
      return {
        outcome: 'timed_out', sent,
        replyStatus: mainReply?.status ?? null,
        errorCode: mainReply?.errorCode ?? null,
        errorMessage: mainReply?.errorMessage ?? null,
        project: project ? { id: project.id, title: project.title, status: project.status, members: project.members.map(({ agentId, name, headline }) => ({ agentId, name, headline })) } : null,
      };
    })()`);
  const sent = await sendPrompt(prompt, 'r0-initial');
  const firstTurn = await waitForReply(sent);
  const followupPrompt =
    '先按二线城市、每期 4–6 人、预算 3000 元、有现成场地、我会基础摄影但没有教学经验作为工作假设。现在请实际推进首轮分析：组织两位不同专业成员，一位评估本地需求与竞品验证方法，一位设计半天新手课程和材料清单。让他们各自给建议，再由你汇总并标出待核实的信息。不要替我决定是否开课，也不必再追问，先按假设完成这一轮。';
  let result = firstTurn;
  if (firstTurn.outcome === 'reply_complete' && !firstTurn.project) {
    const followupSent = await sendPrompt(followupPrompt, 'r0-followup');
    result = await waitForReply(followupSent);
    result.firstTurn = {
      status: firstTurn.outcome,
      model: firstTurn.model,
      reply: firstTurn.mainReply,
    };
    result.followupPrompt = followupPrompt;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('R0 首次使用结果返回前，桌面窗口已关闭。');
  }
  result.modelCallCount = socialAgentE2eModelRequests.length;
  result.prompt = prompt;
  if (
    result.outcome !== 'reply_complete' ||
    !result.project ||
    result.project.members.filter(
      (member: { agentId: string }) => member.agentId !== 'noema',
    ).length < 2 ||
    result.memberReplyCount < 2
  ) {
    writeSmokeLog('r0-result-incomplete', {
      outcome: result.outcome,
      modelCallCount: result.modelCallCount,
      projectCreated: Boolean(result.project),
      memberReplyCount: result.memberReplyCount ?? 0,
      replyStatus: result.replyStatus ?? null,
      errorCode: result.errorCode ?? null,
    });
    throw new Error(`R0 首次真实组队闭环未完成：${JSON.stringify(result)}`);
  }
  if (socialAgentE2eResultPath) {
    const renderedReplyComplete = await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const deadline = Date.now() + 5_000;
      const messageId = ${JSON.stringify(result.sent.messageId)};
      while (Date.now() < deadline) {
        const message = document.querySelector('[data-message-id="' + CSS.escape(messageId) + '"]');
        if (message?.querySelector('.message-actions') && !document.querySelector('.runtime-status')) {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    })()`);
    if (!renderedReplyComplete) {
      throw new Error(
        '主聊回复已持久化完成，但桌面界面仍显示生成中；不保存未稳定截图。',
      );
    }
    const screenshotPath = path.join(
      path.dirname(socialAgentE2eResultPath),
      'r0-first-use.png',
    );
    writeSmokeScreenshot(screenshotPath, await mainWindow.capturePage());
    result.screenshotPath = screenshotPath;
  }
  writeSmokeLog('r0-result-complete', {
    projectCreated: true,
    memberCount: result.project.members.length,
    memberReplyCount: result.memberReplyCount,
    modelCallCount: result.modelCallCount,
  });
  return result;
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
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
      noemaRoom?.click();
      if (document.querySelector('.room-header h2')?.textContent?.trim() === 'Noema') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const input = document.querySelector('#social-message-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!input || input.disabled || !setter) {
      const state = await window.noema.getSocialState();
      return {
        verified: false,
        status: 'composer_unavailable',
        inputFound: Boolean(input),
        inputDisabled: Boolean(input?.disabled),
        activeRoom: document.querySelector('.room-header h2')?.textContent?.trim() ?? null,
        selectedModel: state.selectedModel ?? null,
        connected: Boolean(state.connected),
        providerConfigured: Boolean(state.providerConfigured),
        modelCount: state.models?.length ?? 0,
        providerWarning: document.querySelector('.provider-warning')?.textContent?.trim() ?? '',
      };
    }
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
    if (socialAgentE2eValid && socialAgentE2eDirectory) {
      const resultPath = path.resolve(socialAgentE2eResultPath!);
      if (testSocialAgentLiveE2e) {
        writeSmokeLog('social-agent-live-preflight-started');
        let catalogTimer: NodeJS.Timeout | null = null;
        const catalogResult = await Promise.race([
          agent.refreshModels().then(() => 'ready' as const),
          new Promise<'timeout'>((resolve) => {
            catalogTimer = setTimeout(() => resolve('timeout'), 25_000);
          }),
        ]).finally(() => {
          if (catalogTimer) clearTimeout(catalogTimer);
        });
        if (catalogResult === 'timeout') {
          writeSmokeLog('social-agent-live-preflight-timeout');
          fs.writeFileSync(
            resultPath,
            JSON.stringify(
              {
                outcome: 'preflight_timeout',
                stage: 'refresh-model-catalog',
              },
              null,
              2,
            ),
            { encoding: 'utf8', flag: 'wx' },
          );
          app.quit();
          return;
        }
        writeSmokeLog('social-agent-live-preflight-completed');
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
                availableModels: availableModels.map(
                  ({ name, routeKind, executionStatus }) => ({
                    name,
                    routeKind,
                    executionStatus,
                  }),
                ),
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
          await new Promise<void>((resolve, reject) => {
            createWindow();
            if (!mainWindow || mainWindow.isDestroyed()) {
              resolve();
              return;
            }
            const contents = mainWindow.webContents;
            if (testSocialAgentR0FirstUse) {
              void (async () => {
                try {
                  const deadline = Date.now() + 20_000;
                  while (Date.now() < deadline) {
                    const ready = await contents.executeJavaScript(
                      "document.readyState !== 'loading' && Boolean(window.noema?.sendSocialMessage && window.noema?.getSocialState)",
                    );
                    if (ready) {
                      writeSmokeLog('r0-renderer-ready');
                      resolve();
                      return;
                    }
                    await new Promise((wait) => setTimeout(wait, 100));
                  }
                  throw new Error('R0 renderer bridge did not become ready');
                } catch (error) {
                  writeSmokeLog('r0-renderer-wait-failed', {
                    error:
                      error instanceof Error
                        ? error.message.slice(0, 500)
                        : null,
                  });
                  reject(error);
                }
              })();
              return;
            }
            if (!contents.isLoadingMainFrame() && contents.getURL()) {
              resolve();
              return;
            }
            contents.once('did-finish-load', () => resolve());
          });
          const workflow = testSocialAttachmentsOnly
            ? {
                textAttachments: await captureSocialTextAttachmentsE2e(),
              }
            : testSocialAgentR0FirstUse
              ? await captureSocialR0FirstUseE2e()
              : await captureSocialAgentCreationE2e();
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
          if (!testSocialAgentKeepOpen) app.quit();
        }
      })();
      return;
    }
    if (socialWorkE2eValid && socialWorkE2eDirectory) {
      const resultPath = path.resolve(testSocialWorkResultPath!);
      const workspacePath = path.resolve(testSocialWorkWorkspace!);
      void (async () => {
        let livePracticeProposal: unknown = null;
        const liveEpisodeTasks: Array<Record<string, unknown>> = [];
        let modelCatalog: Awaited<
          ReturnType<typeof agent.refreshModels>
        > | null = null;
        try {
          if (!testSocialWorkSynthetic) {
            modelCatalog = await agent.refreshModels();
            const selectedModel = rootStore!.getSelectedModel();
            const availableModels = modelCatalog.models as Array<{
              name: string;
            }>;
            if (
              !modelCatalog.connected ||
              !availableModels.some((model) => model.name === selectedModel)
            ) {
              throw new Error(
                '当前 Noema 模型目录没有返回已选择的模型，不能开始真实项目执行。',
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
                '基于真实 DSH 经历的模型调用失败；请检查当前模型服务连接。',
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
                '候选提炼的模型调用失败；请检查当前模型服务连接。',
              );
            }
            if (source.practiceCandidateStatus === 'pending') {
              throw new Error('候选提炼的模型调用超过 55 秒仍未结束。');
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
                },
                null,
                2,
              ),
              { encoding: 'utf8', flag: 'wx' },
            );
            return;
          }
          const started = await socialWorkService!.startTask({
            roomId: 'room-engineering-collaboration',
            agentId: 'engineering-partner',
            prompt: testSocialWorkPrompt!,
            reuseCase: true,
            verificationChecks: testSocialWorkChecksJson
              ? JSON.parse(testSocialWorkChecksJson)
              : [],
          });
          const taskId = started.accepted ? (started.taskId ?? null) : null;
          const task = taskId
            ? await socialWorkService!.waitForTask(taskId)
            : null;
          fs.writeFileSync(
            resultPath,
            JSON.stringify(
              {
                outcome: task ? 'finished' : 'preflight_failed',
                task,
                modelCatalog,
                workspacePath,
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
                modelCatalog,
                errorCode:
                  error &&
                  typeof error === 'object' &&
                  'code' in error &&
                  typeof error.code === 'string'
                    ? error.code
                    : 'social_work_e2e_failed',
                errorMessage:
                  error instanceof Error ? error.message.slice(0, 1_000) : null,
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
