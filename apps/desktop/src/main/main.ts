import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
  screen,
  Notification,
} from 'electron';
import { createNoemaTray } from './app/tray';
import { createMainWindow } from './app/window';
import { createProviderRuntime } from './app/provider-runtime';
import { writeSmokeLog } from './testing/smoke-log';
import { scheduleRendererSmoke } from './testing/renderer-smoke';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EncryptedSecretStore } from './platform/encrypted-secret-store.mjs';
import { redactSensitiveText } from '../shared/text/sensitive-text.mjs';
import { resolveElectronProxy } from './platform/electron-proxy.mjs';
import { createPendingFollowupNavigationDelivery } from './platform/pending-followup-navigation.mjs';
import { OpenAICompatibleClient } from './providers/openai-compatible-client.mjs';
import { registerRootIpc, CHANNELS } from './ipc/root-ipc.mjs';
import { WorkspaceFileService } from './execution/workspace-file-service.mjs';
import { registerLegacyHistoryArchiveIpc } from './ipc/legacy-history-archive-ipc.mjs';
import { RootAgent } from './agents/root-agent.mjs';
import { RootStore } from './storage/root-store.mjs';
import { LegacyHistoryArchiveService } from './archive/legacy-history-archive-service.mjs';
import { saveLegacyHistoryExport } from './archive/save-legacy-history-export.mjs';
import { DiagnosticsEventStore } from './storage/diagnostics-event-store.mjs';
import { OfficialPluginStateStore } from './plugins/official-plugin-state-store.mjs';
import { OfficialPluginHost } from './plugins/official-plugin-host.mjs';
import { officialContractSample } from './plugins/official-contract-sample.mjs';
import { DiagnosticsQueryService } from './diagnostics/diagnostics-query-service.mjs';
import { collectDiagnosticsRuntimeInfo } from './diagnostics/diagnostics-runtime-info.mjs';
import { startupFailureDiagnostic } from './diagnostics/startup-failure-diagnostic.mjs';
import {
  openNoemaDataDirectory,
  readDatabaseHealth,
  showDatabaseStartupFailure,
} from './diagnostics/database-recovery.mjs';
import { saveDiagnosticsExport } from './diagnostics/save-diagnostics-export.mjs';
import { SocialChatStore } from './chat/social-chat-store.mjs';
import {
  conversationExportFileName,
  formatConversationMarkdown,
} from '../shared/export/conversation-markdown.mjs';
import {
  formatWorkTicketMarkdown,
  workTicketExportFileName,
} from '../shared/export/work-ticket-markdown.mjs';
import { SOCIAL_SCHEMA_VERSION } from './chat/social-chat-schema.mjs';
import { SocialProjectStore } from './projects/social-project-store.mjs';
import { SocialChatService } from './chat/social-chat-service.mjs';
import { searchAndReadWeb } from './tools/web-search.mjs';
import { SocialWorkService } from './execution/social-work-service.mjs';
import { captureWorkspaceIdentity } from './platform/workspace-identity.mjs';
import {
  createWindowsRunnerRuntime,
  type WindowsRunnerRuntime,
} from './app/windows-runner-runtime';
import { backupBeforeSocialChatMigration } from './chat/social-chat-migration-backup.mjs';
import { resolveNoemaDatabasePath } from './platform/runtime-paths.mjs';
import {
  DshHeadlessAdapter,
  resolveDshHeadlessRuntime,
} from './integrations/dsh-headless-adapter.mjs';
import { DshChatRuntime } from './runtime/dsh-chat-runtime.mjs';
import { createNativeChatRuntime } from './runtime/chat-runtime.mjs';
import { createChatRuntimeRegistry } from './runtime/chat-runtime-registry.mjs';
import { createWorkRuntimeRegistry } from './runtime/work-runtime-registry.mjs';
import { NoemaProjectExecutor } from './execution/noema-project-executor.mjs';
import { createNoemaToolRegistry } from './runtime/noema-tool-registry.mjs';
import { NoemaToolSession } from './mcp/noema-tool-session.mjs';
import { createChatTicketTool } from './chat/chat-ticket-tool.mjs';
import { createNoemaReadTools } from './chat/noema-read-tools.mjs';
import {
  createWindowPreferences,
  isMainFrameIpcEvent,
  isInternalNavigation,
  shouldOpenExternally,
} from './platform/window-security.mjs';
import {
  fitsWithinWorkArea,
  resolveInitialWindowSize,
} from './platform/window-geometry.mjs';
import {
  createSocialReplyNotificationHandler,
  createUserFollowupNotificationHandler,
} from './platform/desktop-notifications.mjs';
import {
  createDesktopLifecycle,
  waitForDesktopShutdown,
} from './platform/desktop-lifecycle.mjs';
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
  testSocialWorkEntry,
  testSocialWorkProposalSourceId,
  testSocialWorkLiveEpisodes,
  testSocialWorkPracticeDecision,
  testSocialWorkEpisodeAPrompt,
  testSocialWorkEpisodeAChecks,
  testSocialWorkEpisodeBChecks,
  testSocialAgentWorkflow,
  testPersonalMemoryLifecycle,
  testUserFollowupLifecycle,
  testSocialAttachmentsOnly,
  testSocialAgentLiveE2e,
  testSocialAgentLiveModel,
  testSocialProviderLiveAcceptance,
  testReadOnlyCredentialDirectory,
  testSocialAgentR0FirstUse,
  testSocialAgentKeepOpen,
  socialAgentE2eResultPath,
  socialAgentDelegationMarker,
  socialHistoryRecallMarker,
  socialComposerQueueMarker,
  socialAgentDelegationTask,
  socialAgentDelegationResult,
} = developmentOptions;

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

function beginAuthorizationDecision(capability: string) {
  const executionId = randomUUID();
  const record = (
    decision: 'requested' | 'granted' | 'denied' | 'revoked',
    reason?: string,
  ) =>
    recordDiagnosticEvent({
      executionId,
      parentExecutionId: currentApplicationExecutionId,
      module: 'authorization',
      operation: `authorization.${capability}`,
      status: decision,
      details: {
        capability,
        ...(reason ? { reason } : {}),
      },
    });
  record('requested');
  return record;
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
if (testSocialProviderLiveAcceptance) {
  const expectedCredentialDirectory = path.join(
    app.getPath('appData'),
    'Noema',
    'credentials',
  );
  const currentUserDataDirectory = path.resolve(
    path.join(app.getPath('appData'), 'Noema'),
  );
  const isolatedUserDataDirectory = path.resolve(app.getPath('userData'));
  let rendererIsLocal = false;
  try {
    const rendererAddress = new URL(testRendererUrl ?? '');
    rendererIsLocal =
      rendererAddress.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
        rendererAddress.hostname,
      );
  } catch {
    rendererIsLocal = false;
  }
  if (
    app.isPackaged ||
    !testDataArgument ||
    !testDatabasePath ||
    !path.isAbsolute(testDatabasePath) ||
    isPathWithin(currentUserDataDirectory, isolatedUserDataDirectory) ||
    isPathWithin(isolatedUserDataDirectory, currentUserDataDirectory) ||
    isPathWithin(isolatedUserDataDirectory, testDatabasePath) ||
    !testReadOnlyCredentialDirectory ||
    !path.isAbsolute(testReadOnlyCredentialDirectory) ||
    path.resolve(testReadOnlyCredentialDirectory).toLowerCase() !==
      path.resolve(expectedCredentialDirectory).toLowerCase() ||
    !rendererIsLocal
  ) {
    throw new Error(
      'Live provider acceptance requires an isolated development profile and database, and may only read the current Noema credential directory.',
    );
  }
}
let mainWindow: BrowserWindow | null = null;
let desktopLifecycle: ReturnType<typeof createDesktopLifecycle> | null = null;
const currentApplicationExecutionId = randomUUID();
let currentEntryRoute: 'social-chat' | 'legacy-archive' | null = null;
let entryReadinessRecordedFor: string | null = null;
let rootStore: RootStore | null = null;
let diagnosticsEventStore: DiagnosticsEventStore | null = null;
let officialPluginHost: OfficialPluginHost | null = null;
let diagnosticsWriteFailureCount = 0;
let windowsRunnerRuntime: WindowsRunnerRuntime | null = null;
let providerSecretStore: EncryptedSecretStore | null = null;

function recordDiagnosticEvent(event: Record<string, unknown>) {
  if (!diagnosticsEventStore) {
    diagnosticsWriteFailureCount += 1;
    return false;
  }
  const recorded = diagnosticsEventStore.record({
    applicationExecutionId: currentApplicationExecutionId,
    ...event,
  });
  if (!recorded) {
    diagnosticsWriteFailureCount += 1;
    windowsRunnerRuntime?.markDiagnosticsUnavailable();
  }
  return recorded;
}

let unregisterRootIpc: (() => void) | null = null;
let diagnosticsReadFailureProbeArmed = false;
let rootAgent: RootAgent | null = null;
let legacyHistoryArchiveService: LegacyHistoryArchiveService | null = null;
let socialChatStore: SocialChatStore | null = null;
let socialProjectStore: SocialProjectStore | null = null;
let socialChatService: SocialChatService | null = null;
let socialWorkService: SocialWorkService | null = null;
let socialAgentE2eModelRequests: Array<{
  model: string;
  messages: Array<{ role: string; content: string }>;
}> = [];
let shutdownStarted = false;
let shutdownComplete = false;

function focusMainWindow(target: BrowserWindow | null) {
  if (!target || target.isDestroyed()) return;
  if (target.isMinimized()) target.restore();
  if (!target.isVisible()) target.show();
  target.focus();
}

const pendingFollowupNavigation = createPendingFollowupNavigationDelivery(
  (target: {
    roomId: string;
    messageId: string | null;
    followupExecutionId?: string;
  }) => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      mainWindow.webContents.isDestroyed()
    )
      return false;
    const navigationTarget = {
      roomId: target.roomId,
      messageId: target.messageId,
    };
    mainWindow.webContents.send(CHANNELS.socialEvent, {
      type: 'open-followup-source',
      ...navigationTarget,
    });
    return true;
  },
  (target: { followupExecutionId?: string }) => {
    if (!target.followupExecutionId) return;
    recordDiagnosticEvent({
      executionId: target.followupExecutionId,
      module: 'social.followup',
      operation: 'followup.navigation.dispatched',
      status: 'dispatched',
    });
  },
);

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
  if (!isMainFrameIpcEvent(event) || !target || target !== mainWindow)
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
  createMainWindow({
    dirname: __dirname,
    testRendererUrl,
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    viteName: MAIN_WINDOW_VITE_NAME,
    testSocialWorkPrompt: Boolean(testSocialWorkPrompt),
    testSocialAgentWorkflow: Boolean(testSocialAgentWorkflow),
    socialWorkReverseSnapshotProbe:
      process.env.NOEMA_E2E_SOCIAL_WORK_REVERSE_SNAPSHOT === '1',
    desktopLifecycle,
    pendingFollowupNavigation,
    recordDiagnosticEvent,
    writeRendererHealthLog,
    setMainWindow: (window) => {
      mainWindow = window;
    },
    resetEntryReadiness: () => {
      entryReadinessRecordedFor = null;
    },
    setEntryRoute: (route) => {
      currentEntryRoute = route;
    },
    getApplicationExecutionId: () => currentApplicationExecutionId,
    smoke: {
      enabled: process.env.NOEMA_SMOKE_TEST === '1',
      hidden: process.env.NOEMA_SMOKE_HIDDEN === '1',
      run: (window, fits) => {
        scheduleRendererSmoke(
          {
            restoreMainWindowForTest: () =>
              desktopLifecycle?.restoreWindow() ?? false,
            hasTray: () => desktopLifecycle?.hasTray ?? false,
            runProbe: runDesktopProbe as unknown as (
              name: string,
              ...args: unknown[]
            ) => Promise<unknown>,
            writeSmokeLog,
            armDiagnosticsReadFailure: (armed) => {
              diagnosticsReadFailureProbeArmed = armed;
            },
          },
          window,
          app,
          fits,
        );
      },
    },
  });
};

desktopLifecycle = createDesktopLifecycle({
  app,
  createTray: createNoemaTray,
  getWindow: () => mainWindow,
  createWindow: () => {
    createWindow();
    return mainWindow;
  },
  recordEvent: recordDiagnosticEvent,
  onSystemSessionEnd: () => {
    void beginHostShutdown('system_shutdown');
  },
});

const notifySocialReply = createSocialReplyNotificationHandler({
  NotificationClass: Notification,
  getWindow: () => mainWindow,
  disabled: process.env.NOEMA_E2E_SILENT_NOTIFICATIONS === '1',
  openMainWindow: () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    focusMainWindow(mainWindow);
  },
});
function recordFollowupDiagnosticEvent(event: Record<string, unknown>) {
  try {
    recordDiagnosticEvent(event);
  } catch {
    // Notification click and navigation must not depend on diagnostics.
  }
}
function openUserFollowupSource({
  followupId,
  sourceRoomId,
  sourceMessageId,
}: {
  followupId: string;
  sourceRoomId: string | null;
  sourceMessageId: string | null;
}): boolean {
  recordFollowupDiagnosticEvent({
    executionId: followupId,
    module: 'social.followup',
    operation: 'followup.notification.clicked',
    status: 'clicked',
  });
  if (!sourceRoomId) {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    focusMainWindow(mainWindow);
    recordFollowupDiagnosticEvent({
      executionId: followupId,
      module: 'social.followup',
      operation: 'followup.navigation.dispatched',
      status: 'opened_main',
    });
    return true;
  }
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  focusMainWindow(mainWindow);
  return pendingFollowupNavigation.request({
    roomId: sourceRoomId,
    messageId: sourceMessageId,
    followupExecutionId: followupId,
  });
}

const notifyUserFollowup = createUserFollowupNotificationHandler({
  NotificationClass: Notification,
  disabled: process.env.NOEMA_E2E_SILENT_NOTIFICATIONS === '1',
  openMainWindow: () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    focusMainWindow(mainWindow);
  },
  openFollowupSource: openUserFollowupSource,
});

function markSocialChatReady() {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isDestroyed()
  )
    return false;
  pendingFollowupNavigation.markRendererReady();
  return true;
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
    legacyHistoryArchiveService = new LegacyHistoryArchiveService({
      rootStore,
    });
    diagnosticsEventStore = new DiagnosticsEventStore(rootStore.db);
    officialPluginHost = new OfficialPluginHost({
      definitions: [officialContractSample],
      stateStore: new OfficialPluginStateStore(rootStore.db),
      recordDiagnostic: (event: Record<string, unknown>) =>
        recordDiagnosticEvent(event),
    });
    await officialPluginHost.startAll();
    writeSmokeLog('store-opened');
    const providerRuntime = createProviderRuntime({
      app,
      safeStorage,
      rootStore,
      writeSmokeLog,
      recordDiagnosticEvent,
      testSocialProviderLiveAcceptance,
      testDataArgument: testDataArgument ?? null,
      testDatabasePath: testDatabasePath ?? null,
      testReadOnlyCredentialDirectory: testReadOnlyCredentialDirectory ?? null,
      testSocialAgentR0FirstUse,
    });
    const { provider, modelUsageStore, webSearchSecretStore } = providerRuntime;
    providerSecretStore = providerRuntime.providerSecretStore;
    windowsRunnerRuntime = await createWindowsRunnerRuntime({
      app,
      getMainWindow: () => mainWindow,
      recordDiagnosticEvent,
      getDiagnosticsWriteFailureCount: () => diagnosticsWriteFailureCount,
    });
    // Prefer the DSH session runtime for work execution. Noema keeps the
    // ticket/attention layer, while DSH owns the agent loop, tools, session
    // durability and context management. Fall back to the legacy executor when
    // the DSH CLI or provider credentials are unavailable.
    let dshProjectExecutor: DshHeadlessAdapter | null = null;
    try {
      const secretStore = providerSecretStore;
      const rawBaseUrl = secretStore?.getBaseUrl() ?? null;
      if (
        secretStore?.isConfigured() &&
        typeof rawBaseUrl === 'string' &&
        rawBaseUrl
      ) {
        const baseUrl = rawBaseUrl.endsWith('/v1')
          ? rawBaseUrl
          : `${rawBaseUrl.replace(/\/+$/u, '')}/v1`;
        const dshRuntime = await resolveDshHeadlessRuntime();
        const executionPermission =
          rootStore?.getExecutionPermissions().externalFiles ?? 'ask';
        const dshPermissionMode =
          executionPermission === 'allow'
            ? 'danger-full-access'
            : executionPermission === 'read-only'
              ? 'read-only'
              : 'workspace-write';
        dshProjectExecutor = new DshHeadlessAdapter({
          runtime: dshRuntime,
          userDataPath: app.getPath('userData'),
          providerBaseUrl: baseUrl,
          getApiKey: () => secretStore.get(),
          getPermissionMode: () => {
            const value =
              rootStore?.getExecutionPermissions().externalFiles ?? 'ask';
            return value === 'allow'
              ? 'danger-full-access'
              : value === 'read-only'
                ? 'read-only'
                : 'workspace-write';
          },
          onUsage: (usage) => modelUsageStore.record(usage),
        });
        recordDiagnosticEvent({
          module: 'dsh',
          operation: 'runtime.startup',
          status: 'ready',
          details: { phase: 'startup' },
        });
        recordDiagnosticEvent({
          module: 'dsh',
          operation: 'runtime.permission',
          status: 'ready',
          details: { capability: dshPermissionMode },
        });
      }
    } catch (error) {
      const code =
        typeof (error as { code?: unknown })?.code === 'string'
          ? (error as { code: string }).code
          : 'dsh_runtime_unavailable';
      recordDiagnosticEvent({
        module: 'dsh',
        operation: 'runtime.startup',
        status: 'unavailable',
        errorCode: code,
        details: { phase: 'startup' },
      });
    }
    const agent = new RootAgent({
      store: rootStore,
      provider,
      recordDiagnosticEvent,
      secretStore: providerSecretStore,
      webSearchSecretStore,
      recordExternalUsage: (record) => modelUsageStore.recordExternal(record),
      allowRootActions: false,
      allowHistorySearch: false,
      recoverInterruptedTurns: false,
      emit: (payload) => {
        const eventPayload = payload as {
          type?: unknown;
          model?: unknown;
        };
        const modelEvents = new Set([
          'models-updated',
          'model-selected',
          'provider-configured',
          'web-search-configured',
        ]);
        if (
          typeof eventPayload?.type !== 'string' ||
          !modelEvents.has(eventPayload.type)
        )
          return;
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send(CHANNELS.modelStateEvent, {
            type: eventPayload.type,
            ...(eventPayload.type === 'model-selected' &&
            typeof eventPayload.model === 'string'
              ? { model: eventPayload.model }
              : {}),
          });
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
    socialChatStore = new SocialChatStore(rootStore.db, {
      workspaceChangeBlobDirectory: path.join(
        path.dirname(databasePath),
        'workspace-change-blobs',
      ),
    });
    try {
      const integrity = socialChatStore.verifyReferencedWorkspaceChangeBlobs();
      if (integrity.verified || integrity.orphanFilesRemoved) {
        writeSmokeLog('workspace-change-blobs-verified', integrity);
      }
    } catch (error) {
      recordDiagnosticEvent({
        executionId: currentApplicationExecutionId,
        module: 'desktop.store',
        operation: 'social.command_recovery.integrity',
        status: 'failed',
        errorCode: 'workspace_change_blob_integrity_failed',
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
    recordDiagnosticEvent({
      executionId: currentApplicationExecutionId,
      module: 'desktop.store',
      operation: 'social.schema.ready',
      status: 'completed',
      details: { schemaVersion: SOCIAL_SCHEMA_VERSION },
    });
    for (const taskId of socialChatStore.recoveredSocialWorkTaskIds) {
      const recoveryReason =
        socialChatStore.recoveredSocialWorkTaskErrorCode ?? 'app_restarted';
      recordFollowupDiagnosticEvent({
        executionId: taskId,
        taskId,
        module: 'social.store',
        operation: 'task.recovered',
        status: 'interrupted',
        errorCode: recoveryReason,
        details: { recoveryReason },
      });
    }
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
    const socialWorkEntryE2eValid = Boolean(
      socialWorkE2eValid && testSocialWorkEntry && testSocialWorkSynthetic,
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
              await new Promise((resolve) => setTimeout(resolve, 10_000));
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
    const nativeProjectExecutor = new NoemaProjectExecutor({ provider });
    const workRuntimes = createWorkRuntimeRegistry({
      dshRuntime: syntheticSocialWorkAdapter ?? dshProjectExecutor,
      nativeRuntime: nativeProjectExecutor,
    });
    socialWorkService = new SocialWorkService({
      store: socialChatStore,
      projectStore: socialProjectStore,
      getSelectedModel: () => rootStore?.getSelectedModel() ?? null,
      assertWorkAllowed: (roomId: string) =>
        socialProjectStore?.assertWorkAllowed(roomId),
      adapter: workRuntimes.forTicket(),
      secretStore: useSyntheticSocialWork
        ? { isConfigured: () => true }
        : providerSecretStore,
      practiceProvider: useSyntheticSocialWork ? null : practiceProvider,
      recordDiagnosticEvent: (event) =>
        recordDiagnosticEvent({
          ...event,
          ...(event.operation === 'workspace.selection' &&
          event.status === 'canceled'
            ? { parentExecutionId: currentApplicationExecutionId }
            : {}),
        }),
      defaultVerificationChecks:
        socialWorkE2eValid && testSocialWorkChecksJson
          ? JSON.parse(testSocialWorkChecksJson)
          : [],
      chooseWorkspace: async ({
        reuseCase = false,
        prompt = '',
        projectId = null,
        agentId = null,
      } = {}) => {
        const recordWorkspaceAuthorization =
          beginAuthorizationDecision('workspace_access');
        if (socialWorkE2eValid) {
          if (
            socialWorkEntryE2eValid &&
            prompt.includes('NOEMA_WORK_ENTRY_CANCEL')
          ) {
            return null;
          }
          recordWorkspaceAuthorization('granted');
          return testSocialWorkWorkspace;
        }
        if (!projectId && agentId && agentId !== 'noema') {
          const agent = socialChatStore?.getAgent(agentId);
          const directory = ensureAgentDirectory({
            agentId,
            name: agent?.name ?? agentId,
          });
          recordWorkspaceAuthorization('granted', 'agent_default');
          return directory;
        }
        const devWorkspaceOverride = !app.isPackaged
          ? process.env.NOEMA_DEV_PROJECT_WORKSPACE_PATH
          : null;
        if (projectId && socialProjectStore) {
          const binding = socialProjectStore.getWorkspaceBinding(projectId);
          if (
            binding?.valid &&
            binding.workspacePath &&
            fs.existsSync(binding.workspacePath)
          ) {
            recordWorkspaceAuthorization('granted', 'project_binding');
            return binding.workspacePath;
          }
        }
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
          recordWorkspaceAuthorization('granted', 'development_override');
          return workspace;
        }
        if (!mainWindow || mainWindow.isDestroyed()) {
          recordWorkspaceAuthorization('denied', 'main_window_unavailable');
          return null;
        }
        const selection = await dialog.showOpenDialog(mainWindow, {
          title: '检查项目工作并选择文件夹',
          message: [
            `Noema 准备在你选择的工作区执行项目任务：\n${prompt}`,
            'Noema 会读取/修改项目文件，并在当前 Windows 用户的 AppContainer 沙箱中运行前台项目命令。首次启用时，Noema 会建立并核验当前用户的隔离配置，无需管理员权限，不创建 Windows 登录账号。命令默认没有网络访问，读写范围限于你选定的工作区；需要访问工作区外路径时会展示具体命令与目标，逐项询问是否仅对该命令开放。项目内容可能发送到当前配置的模型服务商，并按该服务商的数据处理条款处理。不要选择含不应发送的密钥或隐私资料的目录。停止任务不会自动撤销已经发生的项目改动。',
            reuseCase
              ? '本轮还会检查同一位工程搭档在同一项目的其他聊天中，是否有一项通过 Noema 文件条件核验的工作；若找到，会把一份过滤常见凭据样式的限长摘要随本任务发送给模型，不会发送原聊天记录。若本任务也通过 Noema 核验，Noema 还可能用当前模型服务对两项任务的摘要和核验结果做一次额外分析，提出一条候选做法；候选不会自动升级为技能，可在任务卡撤回。若已有候选，选定目录后还会先展示候选正文，供你决定本轮是否试用；普通经验复用勾选不会自动授权使用某条候选。过滤无法保证识别所有敏感信息。'
              : '本轮不会从其他聊天带入项目案例。',
          ].join('\n\n'),
          properties: ['openDirectory'],
          buttonLabel: '允许并继续',
        });
        if (selection.canceled || !selection.filePaths[0]) {
          recordWorkspaceAuthorization('denied', 'user_cancelled');
          return null;
        }
        recordWorkspaceAuthorization('granted');
        return selection.filePaths[0];
      },
      confirmWorkspaceRebind: async ({
        oldPath,
        newPath,
      }: {
        projectId: string;
        oldPath: string;
        newPath: string;
      }) => {
        if (!mainWindow || mainWindow.isDestroyed()) return 'cancel';
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '更换工作文件夹',
          message:
            '这个项目已绑定到另一个文件夹。是否将项目绑定更换到新文件夹？',
          detail: `当前绑定：${oldPath}\n新选择：${newPath}\n\n更换后，新任务会在新文件夹中执行。已有任务记录与恢复检查点不会迁移。`,
          buttons: ['更换工作区', '取消'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        return confirmation.response === 0 ? 'rebind' : 'cancel';
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
      (socialAgentE2eValid || socialWorkEntryE2eValid) &&
      !testSocialAgentLiveE2e
        ? {
            async *streamChat(input: {
              model: string;
              messages: Array<{ role: string; content: string }>;
              tools?: Array<{ function?: { name?: string } }>;
              onToolCalls?: (
                calls: Array<{
                  id: string;
                  function: { name: string; arguments: string };
                }>,
              ) => void;
              onRouteMetadata?: (route: string | null) => void;
            }) {
              socialAgentE2eModelRequests.push(input);
              const latestUserMessage = [...input.messages]
                .reverse()
                .find((message) => message.role === 'user')?.content;
              if (latestUserMessage?.includes('NOEMA_WORK_ENTRY_')) {
                const latestUserIndex = input.messages.findLastIndex(
                  (message) => message.role === 'user',
                );
                const hasCurrentToolResult = input.messages
                  .slice(latestUserIndex + 1)
                  .some((message) => message.role === 'tool');
                if (hasCurrentToolResult) {
                  yield 'NOEMA_WORK_ENTRY_TOOL_HANDLED';
                  return;
                }
                const workToolAvailable = input.tools?.some(
                  (tool) => tool.function?.name === 'start_project_work',
                );
                if (!workToolAvailable) {
                  yield 'NOEMA_WORK_ENTRY_CHAT_ONLY';
                  return;
                }
                const executor = socialChatStore
                  ?.listAgents()
                  .find(
                    (member: {
                      id: string;
                      archivedAt: string | null;
                      capabilities: string[];
                    }) =>
                      !member.archivedAt &&
                      member.capabilities.includes('project-work'),
                  );
                if (!executor) {
                  throw new Error(
                    'Synthetic workspace-entry E2E could not find an eligible executor.',
                  );
                }
                input.onToolCalls?.([
                  {
                    id: 'e2e-social-work-entry',
                    function: {
                      name: 'start_project_work',
                      arguments: JSON.stringify({
                        agent_id: executor.id,
                        task: latestUserMessage,
                      }),
                    },
                  },
                ]);
                return;
              }
              const history = latestUserMessage?.includes(
                socialHistoryRecallMarker,
              )
                ? input.messages.find((message) =>
                    message.content?.includes('"type":"noema_history_recall"'),
                  )
                : undefined;
              if (history) {
                input.onRouteMetadata?.('e2e-local-spy');
                yield '我找到了你提到的旧对话，可以从来源查看原文。';
                return;
              }
              if (latestUserMessage?.includes(socialComposerQueueMarker)) {
                await new Promise((resolve) => setTimeout(resolve, 6_000));
                yield '输入区队列布局夹具回复已完成。';
                return;
              }
              const specialistReport = input.messages.find(
                (message) => message.role === 'tool',
              );
              if (specialistReport) {
                input.onRouteMetadata?.('e2e-local-spy');
                yield `结合工程搭档的协助，我核对了这项信息。${socialAgentDelegationTask} 核对结果：${socialAgentDelegationResult}`;
                return;
              }
              if (latestUserMessage?.includes(socialAgentDelegationMarker)) {
                input.onToolCalls?.([
                  {
                    id: 'e2e-specialist-delegation',
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
      if (
        (!socialAgentE2eValid && !socialWorkEntryE2eValid) ||
        testSocialAgentLiveE2e
      )
        return state;
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
    const ensureAgentDirectory = ({
      agentId,
      name,
    }: {
      agentId: string;
      name: string;
    }) => {
      const base =
        socialAgentE2eValid || socialWorkEntryE2eValid
          ? path.join(app.getPath('userData'), 'agent-workspaces')
          : path.join(app.getPath('documents'), 'Noema', 'Agents');
      const safeName =
        String(name)
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
          .trim()
          .slice(0, 60) || 'agent';
      const directory = path.join(base, `${safeName}-${agentId.slice(-6)}`);
      fs.mkdirSync(directory, { recursive: true });
      return directory;
    };
    const chooseProjectWorkspace = async (input?: {
      source?: string;
    }): Promise<{
      workspacePath: string;
      identity: {
        version: number;
        canonicalPath: string;
        device: string;
        fileIndex: string;
      };
    } | null> => {
      const recordWorkspaceChoice = (status: 'completed' | 'canceled') =>
        recordDiagnosticEvent({
          executionId: randomUUID(),
          parentExecutionId: currentApplicationExecutionId,
          module: 'social.project',
          operation: 'workspace.selection',
          status,
          details: { source: input?.source ?? 'project_create' },
        });
      if (socialWorkE2eValid && testSocialWorkWorkspace) {
        const identity = captureWorkspaceIdentity(testSocialWorkWorkspace);
        if (!identity.ok || !identity.identity) {
          throw new Error('无法读取 E2E 工作区。');
        }
        recordWorkspaceChoice('completed');
        return {
          workspacePath: testSocialWorkWorkspace,
          identity: identity.identity,
        };
      }
      if (socialAgentE2eValid && socialAgentE2eDirectory) {
        const workspacePath = path.join(
          socialAgentE2eDirectory,
          'project-workspace',
        );
        fs.mkdirSync(workspacePath, { recursive: true });
        const identity = captureWorkspaceIdentity(workspacePath);
        if (!identity.ok || !identity.identity) {
          throw new Error('无法读取 E2E 工作区。');
        }
        recordWorkspaceChoice('completed');
        return { workspacePath, identity: identity.identity };
      }
      const devWorkspaceOverride = !app.isPackaged
        ? process.env.NOEMA_DEV_PROJECT_WORKSPACE_PATH
        : null;
      if (devWorkspaceOverride) {
        const workspacePath = path.resolve(devWorkspaceOverride);
        if (!path.isAbsolute(workspacePath) || !fs.existsSync(workspacePath)) {
          throw new Error(
            'NOEMA_DEV_PROJECT_WORKSPACE_PATH must point to an existing directory.',
          );
        }
        const identity = captureWorkspaceIdentity(workspacePath);
        if (!identity.ok || !identity.identity) {
          throw new Error('无法读取这个文件夹，请换一个目录。');
        }
        recordWorkspaceChoice('completed');
        return { workspacePath, identity: identity.identity };
      }
      if (!mainWindow || mainWindow.isDestroyed()) return null;
      const selection = await dialog.showOpenDialog(mainWindow, {
        title: '选择工作文件夹',
        message:
          '项目成员会读取和修改这个文件夹中的文件，并在其中运行前台命令。请只选择允许 Noema 使用的目录。',
        buttonLabel: '使用此文件夹',
        properties: ['openDirectory', 'createDirectory'],
      });
      const selectedPath = selection.filePaths[0];
      if (selection.canceled || !selectedPath) {
        recordWorkspaceChoice('canceled');
        return null;
      }
      const workspacePath = selectedPath;
      const identity = captureWorkspaceIdentity(workspacePath);
      if (!identity.ok || !identity.identity) {
        throw new Error('无法读取这个文件夹，请换一个目录。');
      }
      recordWorkspaceChoice('completed');
      return { workspacePath, identity: identity.identity };
    };
    const nativeChatRuntime = createNativeChatRuntime({
      provider: socialChatProvider as unknown as {
        streamChat: (options: object) => AsyncIterable<string>;
      },
    });
    let chatRuntimes = createChatRuntimeRegistry({
      nativeRuntime: nativeChatRuntime,
    });
    let chatToolSession: NoemaToolSession | null = null;
    if (dshProjectExecutor) {
      try {
        // Noema is a machine-scoped personal agent; it has no project workspace.
        const chatWorkspacePath = app.getPath('home');
        const chatAssignees = (
          socialChatStore.listAgents() as Array<{
            id: string;
            name: string;
            archivedAt?: string | null;
            capabilities: string[];
          }>
        ).filter(
          (agent) =>
            agent.id !== 'noema' &&
            !agent.archivedAt &&
            agent.capabilities.includes('project-work'),
        );
        chatToolSession = new NoemaToolSession({
          registry: createNoemaToolRegistry([
            createChatTicketTool({
              availableAssignees: chatAssignees.map((agent) => agent.name),
              resolveAssignee: (name: string) =>
                chatAssignees.find((agent) => agent.name === name)?.id ?? null,
              startTicket: (input: {
                prompt: string;
                workspacePath?: string | null;
                sessionId?: string | null;
                agentId?: string;
              }) => socialWorkService!.startTicket(input),
            }),
            ...createNoemaReadTools(),
          ]),
        });
        await chatToolSession.start();
        const dshChatRuntime = new DshChatRuntime({
          adapter: dshProjectExecutor,
          workspacePath: chatWorkspacePath,
          sessionId: rootStore?.getAgentChatSession('noema') ?? null,
          onSessionId: (sessionId: string) =>
            rootStore?.setAgentChatSession('noema', sessionId),
          toolSession: chatToolSession,
          profile: 'noema',
        });
        chatRuntimes = createChatRuntimeRegistry({
          nativeRuntime: nativeChatRuntime,
          dshRuntime: dshChatRuntime,
        });
      } catch (error) {
        writeSmokeLog('dsh-chat-runtime-unavailable', {
          message: String(error instanceof Error ? error.message : error),
        });
        chatToolSession = null;
      }
    }
    socialChatService = new SocialChatService({
      store: socialChatStore,
      projectStore: socialProjectStore,
      provider: socialChatProvider as OpenAICompatibleClient,
      chatRuntimes,
      secretStore:
        (socialAgentE2eValid || socialWorkEntryE2eValid) &&
        !testSocialAgentLiveE2e
          ? { isConfigured: () => true }
          : providerSecretStore,
      getSelectedModel: () =>
        (socialAgentE2eValid || socialWorkEntryE2eValid) &&
        !testSocialAgentLiveE2e
          ? socialAgentE2eModel
          : (rootStore?.getSelectedModel() ?? null),
      getRootState: getSocialRootState,
      ensureAgentWorkspace: ensureAgentDirectory,
      chooseProjectWorkspace,
      getProjectWorkReadiness: () =>
        socialWorkService?.getReadiness() ?? {
          available: false,
          reasonCode: 'executor_unavailable',
          reason: '项目工作运行环境尚未初始化。',
        },
      getProjectSessionContext: (roomId, agentId) =>
        socialProjectStore?.getProjectSessionContext(roomId, agentId) ?? null,
      isWebSearchConfigured: () => webSearchSecretStore.isConfigured(),
      recordExternalUsage: (record) => modelUsageStore.recordExternal(record),
      recordDiagnosticEvent,
      searchPublicSources: (query, signal, maxSources, options) =>
        searchAndReadWeb(query, webSearchSecretStore.get(), {
          signal,
          maxSources,
          ...options,
        }),
      startTicket: (input) => socialWorkService!.startTicket(input),
      startProjectWork: async ({ dispatchFromNoema, ...input }, signal) => {
        const result = dispatchFromNoema
          ? await socialWorkService!.startTaskFromNoema({ ...input, signal })
          : await socialWorkService!.startTask({ ...input, signal });
        if (
          currentEntryRoute === 'social-chat' &&
          dispatchFromNoema &&
          input.roomId === 'room-noema' &&
          currentApplicationExecutionId &&
          result.accepted &&
          result.taskId
        ) {
          recordDiagnosticEvent({
            executionId: result.taskId,
            parentExecutionId: currentApplicationExecutionId,
            taskId: result.taskId,
            module: 'social.work',
            operation: 'task.created_from_entry',
            status: 'starting',
          });
        }
        return result;
      },
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
        if (
          'type' in outgoingPayload &&
          outgoingPayload.type === 'user-followup-due'
        )
          return notifyUserFollowup(outgoingPayload);
        notifySocialReply(outgoingPayload);
      },
    });
    const diagnosticsQueryService = new DiagnosticsQueryService({
      eventStore: diagnosticsEventStore!,
      modelUsageStore,
      socialChatStore: socialChatStore!,
      rootStore: rootStore!,
      runtimeInfo: collectDiagnosticsRuntimeInfo({
        db: rootStore!.db,
        applicationVersion: app.getVersion(),
        electronVersion: process.versions.electron ?? null,
        nodeVersion: process.versions.node ?? null,
        osVersion: process.getSystemVersion(),
        platform: process.platform,
        architecture: process.arch,
        isPackaged: app.isPackaged,
      }),
      recordDiagnosticEvent,
    });
    const workspaceFileService = socialChatStore
      ? new WorkspaceFileService({
          isKnownWorkspace: (workspacePath) =>
            Boolean(
              socialChatStore!.db
                .prepare(
                  'SELECT 1 FROM social_work_tasks WHERE workspace_path = ? LIMIT 1',
                )
                .get(workspacePath),
            ),
          openPath: (target) => shell.openPath(target),
        })
      : null;
    const unregisterRootHandlers = registerRootIpc({
      ipcMain,
      rootAgent: agent,
      socialChatService,
      socialProjectStore,
      socialWorkService,
      getWorkTaskUsage: (taskId) => modelUsageStore.getTaskUsage(taskId),
      getWorkTaskTouchedFiles: (taskId: string) =>
        socialChatStore?.listSocialWorkTouchedFiles(taskId) ?? [],
      getWorkTaskStepDetail: (taskId: string, stepId: string) => {
        const detail = socialChatStore?.getSocialWorkExecutionStepDetail(
          taskId,
          stepId,
        );
        if (!detail) return null;
        const clip = (value: string) =>
          redactSensitiveText(value).snippet.slice(0, 4_000);
        return {
          ...detail,
          argumentsText: clip(detail.argumentsText),
          resultText: clip(detail.resultText),
        };
      },
      exportConversation: async (roomId: string) => {
        if (!mainWindow || mainWindow.isDestroyed() || !socialChatStore)
          return { saved: false, errorCode: 'window_unavailable' };
        try {
          const snapshot = socialChatStore.getRoomSnapshot(roomId);
          const markdown = formatConversationMarkdown(snapshot);
          const selected = await dialog.showSaveDialog(mainWindow, {
            title: '导出对话',
            defaultPath: conversationExportFileName(snapshot.room),
            filters: [{ name: 'Markdown', extensions: ['md'] }],
          });
          if (selected.canceled || !selected.filePath)
            return { saved: false, canceled: true };
          await fs.promises.writeFile(selected.filePath, markdown, 'utf8');
          return { saved: true, path: selected.filePath };
        } catch (error) {
          return {
            saved: false,
            errorCode: error instanceof Error ? error.message : 'export_failed',
          };
        }
      },
      exportWorkTicket: async (taskId: string) => {
        if (!mainWindow || mainWindow.isDestroyed() || !socialChatStore)
          return { saved: false, errorCode: 'window_unavailable' };
        try {
          const task = socialChatStore.getSocialWorkTask(taskId);
          const usage = modelUsageStore.getTaskUsage(taskId);
          const markdown = formatWorkTicketMarkdown({ task, usage });
          const selected = await dialog.showSaveDialog(mainWindow, {
            title: '导出工单结果',
            defaultPath: workTicketExportFileName(task),
            filters: [{ name: 'Markdown', extensions: ['md'] }],
          });
          if (selected.canceled || !selected.filePath)
            return { saved: false, canceled: true };
          await fs.promises.writeFile(selected.filePath, markdown, 'utf8');
          return { saved: true, path: selected.filePath };
        } catch (error) {
          return {
            saved: false,
            errorCode: error instanceof Error ? error.message : 'export_failed',
          };
        }
      },
      workspaceFileService,
      chooseProjectWorkspace,
      resetChatSession: async () => {
        const reset = socialChatService?.resetChatSession('noema') ?? false;
        rootStore?.setAgentChatSession('noema', null);
        return reset;
      },
      getExecutionPermissions: () =>
        rootStore?.getExecutionPermissions() ?? { externalFiles: 'ask' },
      setExecutionPermissions: (permissions) =>
        rootStore?.setExecutionPermissions(permissions) ?? {
          externalFiles: 'ask',
        },
      diagnosticsQueryService,
      getDiagnosticsDatabaseHealth: () => readDatabaseHealth(rootStore?.db),
      openUserDataDirectory: () =>
        openNoemaDataDirectory({
          shell,
          userDataPath: app.getPath('userData'),
        }),
      getWindowsRunnerCapability: () => windowsRunnerRuntime!.refresh(),
      setupWindowsRunner: () => windowsRunnerRuntime!.setup(),
      shouldInjectDiagnosticsReadFailures: () =>
        diagnosticsReadFailureProbeArmed,
      shouldInjectSocialWorkReverseSnapshot: () =>
        socialWorkE2eValid &&
        process.env.NOEMA_E2E_SOCIAL_WORK_REVERSE_SNAPSHOT === '1',
      saveDiagnosticsExport: (previewId) =>
        !mainWindow || mainWindow.isDestroyed()
          ? Promise.resolve({ saved: false, errorCode: 'window_unavailable' })
          : saveDiagnosticsExport({
              previewId,
              queryService: diagnosticsQueryService,
              selectFile: () =>
                dialog.showSaveDialog(mainWindow!, {
                  title: '保存 Noema 诊断报告',
                  defaultPath: `noema-diagnostics-${new Date().toISOString().replaceAll(':', '-')}.json`,
                  filters: [{ name: 'JSON 报告', extensions: ['json'] }],
                }),
              writeFile: (filePath: string, content: string) =>
                fs.promises.writeFile(filePath, content, { encoding: 'utf8' }),
            }),
      isTrustedSender: (sender) =>
        Boolean(mainWindow && sender === mainWindow.webContents),
      recordSocialReadiness: (readiness) => {
        if (
          currentEntryRoute !== 'social-chat' ||
          !currentApplicationExecutionId ||
          entryReadinessRecordedFor === currentApplicationExecutionId
        )
          return;
        entryReadinessRecordedFor = currentApplicationExecutionId;
        recordDiagnosticEvent({
          executionId: currentApplicationExecutionId,
          module: 'desktop.main',
          operation: 'entry.capability_availability',
          status: readiness.available ? 'available' : 'unavailable',
          details: {
            reason: readiness.reason ? 'capability_unavailable' : '',
            ...(readiness.reasonCode
              ? { reasonCode: readiness.reasonCode }
              : {}),
          },
        });
      },
      markSocialChatReady,
      recordDiagnosticEvent,
    });
    const unregisterArchiveHandlers = registerLegacyHistoryArchiveIpc({
      ipcMain,
      archiveService: legacyHistoryArchiveService!,
      saveExport: (previewId) =>
        !mainWindow || mainWindow.isDestroyed()
          ? Promise.resolve({
              saved: false,
              canceled: false,
              errorCode: 'window_unavailable',
            })
          : saveLegacyHistoryExport({
              previewId,
              archiveService: legacyHistoryArchiveService!,
              selectFile: async () => {
                const selection = await dialog.showSaveDialog(mainWindow!, {
                  title: '导出 Noema 历史归档',
                  defaultPath: `noema-history-${new Date().toISOString().replaceAll(':', '-')}.json`,
                  filters: [{ name: 'JSON 归档', extensions: ['json'] }],
                });
                return {
                  canceled: selection.canceled,
                  filePath: selection.filePath,
                };
              },
              createWriteStream: fs.createWriteStream,
            }),
      isTrustedSender: (sender) =>
        Boolean(mainWindow && sender === mainWindow.webContents),
    });
    unregisterRootIpc = () => {
      unregisterRootHandlers();
      unregisterArchiveHandlers();
    };
    if (socialWorkE2eValid && process.platform === 'win32') {
      desktopLifecycle?.initializeTray();
    }
    if (
      !app.isPackaged &&
      Boolean(testDatabasePath) &&
      (await (
        await import('../../test-support/electron/scenarios')
      ).runDevelopmentScenarios({
        socialAgentE2eValid,
        socialAgentE2eDirectory,
        socialAgentE2eResultPath,
        testPersonalMemoryLifecycle,
        testUserFollowupLifecycle,
        testSocialAgentLiveE2e,
        writeSmokeLog,
        agent,
        testSocialAgentLiveModel,
        createWindow,
        get mainWindow() {
          return mainWindow;
        },
        restoreMainWindowForTest: () =>
          desktopLifecycle?.restoreWindow() ?? false,
        testSocialAgentR0FirstUse,
        testSocialAttachmentsOnly,
        runDesktopProbe,
        testSocialAgentKeepOpen,
        socialWorkE2eValid,
        socialAgentE2eModelRequests,
        socialWorkE2eDirectory,
        testSocialWorkResultPath,
        testSocialWorkWorkspace,
        testSocialWorkSynthetic,
        testSocialWorkEntry: socialWorkEntryE2eValid,
        applicationExecutionId: currentApplicationExecutionId,
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
    if (process.platform === 'win32') desktopLifecycle?.initializeTray();
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    writeSmokeLog('window-created');
  } catch (error) {
    recordDiagnosticEvent({
      executionId: currentApplicationExecutionId,
      module: 'desktop.main',
      ...startupFailureDiagnostic(error),
    });
    const message = `本机对话数据无法打开。请检查应用数据目录权限后重试。\n\n${error instanceof Error ? error.message : '未知错误'}`;
    writeSmokeLog('startup-error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      userData: app.getPath('userData'),
    });
    if (process.env.NOEMA_SMOKE_TEST === '1') {
      console.error('Noema startup smoke failed:', message);
    } else {
      await showDatabaseStartupFailure({
        dialog: {
          showMessageBox: (options) => dialog.showMessageBox(options),
        },
        shell,
        userDataPath: app.getPath('userData'),
        message,
      });
    }
    app.quit();
  }
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    desktopLifecycle?.onSecondInstance();
  });
  void startNoema();
} else {
  app.quit();
}

app.on('activate', () => {
  desktopLifecycle?.restoreWindow();
});

app.on('window-all-closed', () => {
  desktopLifecycle?.onWindowAllClosed();
});

async function beginHostShutdown(
  reason: 'application_exit' | 'system_shutdown',
) {
  if (shutdownComplete || shutdownStarted) return;
  shutdownStarted = true;
  desktopLifecycle?.markQuitting();
  try {
    socialChatStore?.recordApplicationShutdownIntent(reason);
  } catch {
    recordDiagnosticEvent({
      executionId: randomUUID(),
      module: 'desktop.lifecycle',
      operation: 'shutdown.intent',
      status: 'failed',
      errorCode: 'shutdown_intent_persist_failed',
    });
  }
  recordDiagnosticEvent({
    executionId: randomUUID(),
    module: 'desktop.lifecycle',
    operation: 'shutdown.started',
    status: 'observed',
    details: { reason },
  });
  if (!rootAgent) {
    await officialPluginHost?.stopAll();
    shutdownComplete = true;
    unregisterRootIpc?.();
    desktopLifecycle?.dispose();
    try {
      rootStore?.close();
    } catch {
      // The host is exiting; the database owns its own close failure boundary.
    }
    app.quit();
    return;
  }
  const outcome = await waitForDesktopShutdown([
    () => rootAgent?.shutdown(),
    () => socialChatService?.shutdown(),
    () => socialWorkService?.shutdown(reason),
    () => officialPluginHost?.stopAll(),
  ]);
  if (outcome.type === 'timeout') {
    recordDiagnosticEvent({
      executionId: randomUUID(),
      module: 'desktop.lifecycle',
      operation: 'shutdown.timeout',
      status: 'failed',
      errorCode: 'shutdown_deadline_exceeded',
      details: { reason },
    });
    shutdownComplete = true;
    unregisterRootIpc?.();
    desktopLifecycle?.dispose();
    app.exit(1);
    return;
  }
  const failed = outcome.results.some(
    (result: { status: string }) => result.status === 'rejected',
  );
  if (!failed) {
    try {
      socialChatStore?.clearApplicationShutdownIntent();
    } catch {
      recordDiagnosticEvent({
        executionId: randomUUID(),
        module: 'desktop.lifecycle',
        operation: 'shutdown.intent.clear',
        status: 'failed',
        errorCode: 'shutdown_intent_clear_failed',
      });
    }
  }
  recordDiagnosticEvent({
    executionId: randomUUID(),
    module: 'desktop.lifecycle',
    operation: failed ? 'shutdown.failed' : 'shutdown.completed',
    status: failed ? 'failed' : 'completed',
    ...(failed ? { errorCode: 'service_shutdown_failed' } : {}),
    details: { reason },
  });
  shutdownComplete = true;
  unregisterRootIpc?.();
  desktopLifecycle?.dispose();
  try {
    rootStore?.close();
  } catch {
    // The host is exiting; the database owns its own close failure boundary.
  }
  app.quit();
}

type DesktopProbes = ReturnType<
  typeof import('../../test-support/electron/probes').createDesktopProbes
>;
// source-structure permits this test-support dynamic bridge only from main.ts.
async function runDesktopProbe<K extends keyof DesktopProbes>(
  name: K,
  ...args: Parameters<DesktopProbes[K]>
): Promise<Awaited<ReturnType<DesktopProbes[K]>>> {
  const { createDesktopProbes } =
    await import('../../test-support/electron/probes');
  const probes = createDesktopProbes({
    mainWindow,
    restoreMainWindowForTest: () => desktopLifecycle?.restoreWindow() ?? false,
    socialAgentE2eModelRequests,
    socialChatService,
    openFollowupSourceForTest: developmentOptions.testUserFollowupLifecycle
      ? openUserFollowupSource
      : null,
    writeSmokeLog,
    options: developmentOptions,
  });
  const invoke = probes[name] as (
    ...args: Parameters<DesktopProbes[K]>
  ) => ReturnType<DesktopProbes[K]>;
  return (await invoke(...args)) as Awaited<ReturnType<DesktopProbes[K]>>;
}

app.on('before-quit', (event) => {
  desktopLifecycle?.markQuitting();
  if (shutdownComplete) return;
  event.preventDefault();
  void beginHostShutdown('application_exit');
});

app.on('will-quit', () => {
  desktopLifecycle?.dispose();
});
