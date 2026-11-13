import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
  Notification,
} from 'electron';
import { createMainWindow, createNoemaTray } from './app/window';
import { createProviderRuntime } from './app/provider-runtime';
import { scheduleRendererSmoke, writeSmokeLog } from './testing/renderer-smoke';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EncryptedSecretStore } from './platform/encrypted-secret-store.ts';
import { redactSensitiveText } from '../shared/text/sensitive-text.ts';
import { resolveElectronProxy } from './platform/electron-proxy.ts';
import { createPendingFollowupNavigationDelivery } from './platform/pending-followup-navigation.ts';
import { OpenAICompatibleClient } from './providers/openai-compatible-client.mjs';
import { registerRootIpc, CHANNELS } from './ipc/root-ipc.mjs';
import { WorkspaceFileService } from './execution/workspace-file-service.mjs';
import { registerLegacyHistoryArchiveIpc } from './ipc/legacy-history-archive-ipc.mjs';
import { RootAgent } from './agents/root-agent.mjs';
import { RootStore } from './storage/root-store.mjs';
import { LegacyHistoryArchiveService } from './archive/legacy-history-archive-service.mjs';
import { saveLegacyHistoryExport } from './archive/save-legacy-history-export.ts';
import { DiagnosticsEventStore } from './storage/diagnostics-event-store.mjs';
import { OfficialPluginStateStore } from './plugins/official-plugin-state-store.mjs';
import { OfficialPluginHost } from './plugins/official-plugin-host.mjs';
import { officialContractSample } from './plugins/official-contract-sample.ts';
import { DiagnosticsQueryService } from './diagnostics/diagnostics-query-service.mjs';
import { collectDiagnosticsRuntimeInfo } from './diagnostics/diagnostics-runtime-info.ts';
import { startupFailureDiagnostic } from './diagnostics/startup-failure-diagnostic.ts';
import {
  openNoemaDataDirectory,
  readDatabaseHealth,
  showDatabaseStartupFailure,
} from './diagnostics/database-recovery.ts';
import { saveDiagnosticsExport } from './diagnostics/save-diagnostics-export.ts';
import { SocialChatStore } from './chat/social-chat-store.mjs';
import { SOCIAL_SCHEMA_VERSION } from './chat/social-chat-schema.ts';
import { SocialProjectStore } from './projects/social-project-store.mjs';
import { SocialTeamStore } from './chat/social-team-store.ts';
import { SocialChatService } from './chat/social-chat-service.mjs';
import { searchAndReadWeb } from './tools/web-search.mjs';
import { SocialWorkService } from './execution/social-work-service.mjs';
import {
  createWindowsRunnerRuntime,
  type WindowsRunnerRuntime,
} from './app/windows-runner-runtime';
import {
  createSocialE2eRuntime,
  createSyntheticSocialChatProvider,
} from './testing/social-e2e-runtime';
import {
  createChatExportRuntime,
  createSocialStateRuntime,
  createSocialWorkDialogs,
  createSocialWorkServiceRuntime,
} from './app/social-runtime';
import { backupBeforeSocialChatMigration } from './chat/social-chat-migration-backup.ts';
import { resolveNoemaDatabasePath } from './platform/runtime-paths.ts';
import { createAgentRuntime } from './app/agent-runtime';
import { DshChatRuntime } from './runtime/dsh-chat-runtime.ts';
import { createNativeChatRuntime } from './runtime/chat-runtime.ts';
import { createChatRuntimeRegistry } from './runtime/chat-runtime-registry.ts';
import { createWorkRuntimeRegistry } from './runtime/work-runtime-registry.ts';
import { NoemaProjectExecutor } from './execution/noema-project-executor.mjs';
import { createNoemaToolRegistry } from './runtime/noema-tool-registry.ts';
import { NoemaToolSession } from './mcp/noema-tool-session.ts';
import { createChatTicketTool } from './chat/chat-ticket-tool.ts';
import { createProjectTeamTools } from './chat/project-team-tools.ts';
import { createNoemaReadTools } from './chat/noema-read-tools.mjs';
import { isMainFrameIpcEvent } from './platform/window-security.ts';
import {
  createSocialReplyNotificationHandler,
  createUserFollowupNotificationHandler,
} from './platform/desktop-notifications.ts';
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
let socialTeamStore: SocialTeamStore | null = null;
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
    const agentRuntime = await createAgentRuntime({
      rootStore,
      providerRuntime,
      userDataPath: app.getPath('userData'),
      getMainWindow: () => mainWindow,
      recordDiagnosticEvent,
    });
    const {
      dshProjectExecutor,
      rootAgent: agent,
      agentRuntimes,
    } = agentRuntime;
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
    socialTeamStore = new SocialTeamStore({ db: rootStore.db });
    const socialE2e = createSocialE2eRuntime({
      app,
      provider,
      isPathWithin,
      isIsolatedE2eDirectory,
      testDatabasePath,
      testWorkerPrompt,
      testSocialWorkPrompt,
      testSocialWorkSourcePrompt,
      testSocialWorkWorkspace,
      testSocialWorkResultPath,
      testDshUserDataPath,
      testSocialWorkProposalSourceId,
      testSocialWorkLiveEpisodes,
      testSocialWorkEpisodeAPrompt,
      testSocialWorkEpisodeAChecks,
      testSocialWorkEpisodeBChecks,
      testSocialWorkPracticeDecision,
      testSocialWorkEntry,
      testSocialWorkSynthetic,
      testSocialWorkChecksJson,
      testSocialAgentWorkflow,
      testSocialAgentR0FirstUse,
      testSocialAgentLiveE2e,
      socialAgentE2eResultPath,
    });
    if (!socialE2e) return;
    const {
      socialWorkE2eDirectory,
      socialWorkE2eValid,
      socialWorkEntryE2eValid,
      socialAgentE2eDirectory,
      socialAgentE2eValid,
      useSyntheticSocialWork,
      practiceRouteMetadata,
      practiceProvider,
      syntheticSocialWorkAdapter,
      practiceConfirmationEvidence,
    } = socialE2e;
    const nativeProjectExecutor = new NoemaProjectExecutor({ provider });
    const workRuntimes = createWorkRuntimeRegistry({
      dshRuntime: syntheticSocialWorkAdapter ?? dshProjectExecutor,
      nativeRuntime: nativeProjectExecutor,
    });
    const socialAgentE2eModel = 'e2e-local-spy';
    const { getSocialRootState, ensureAgentDirectory } =
      createSocialStateRuntime({
        app,
        getRootAgentState: () => agent.getUiState(),
        socialAgentE2eValid,
        socialWorkEntryE2eValid,
        testSocialAgentLiveE2e,
        e2eModel: socialAgentE2eModel,
      });

    const socialWorkDialogs = createSocialWorkDialogs({
      app,
      getMainWindow: () => mainWindow,
      socialChatStore,
      socialProjectStore,
      ensureAgentDirectory,
      beginWorkspaceAuthorization: () =>
        beginAuthorizationDecision('workspace_access'),
      recordProjectWorkspaceSelection: (status, source) =>
        recordDiagnosticEvent({
          executionId: randomUUID(),
          parentExecutionId: currentApplicationExecutionId,
          module: 'social.project',
          operation: 'workspace.selection',
          status,
          details: { source },
        }),
      socialWorkE2eValid,
      socialAgentE2eValid,
      socialAgentE2eDirectory,
      socialWorkEntryE2eValid,
      testSocialWorkWorkspace,
      testSocialWorkPracticeDecision: testSocialWorkPracticeDecision as
        | 'trial'
        | 'case'
        | 'cancel'
        | null,
      testSocialWorkLiveEpisodes,
      practiceConfirmationEvidence,
    });
    socialWorkService = createSocialWorkServiceRuntime({
      store: socialChatStore,
      projectStore: socialProjectStore,
      dialogs: socialWorkDialogs,
      adapter: workRuntimes.forTicket(),
      secretStore: useSyntheticSocialWork
        ? { isConfigured: () => true }
        : providerSecretStore,
      practiceProvider: useSyntheticSocialWork ? null : practiceProvider,
      getSelectedModel: () => rootStore?.getSelectedModel() ?? null,
      assertWorkAllowed: (roomId: string) =>
        socialProjectStore?.assertWorkAllowed(roomId),
      socialWorkE2eValid,
      testSocialWorkChecksJson,
      recordDiagnosticEvent: recordDiagnosticEvent as (
        event: Record<string, unknown>,
      ) => void,
      currentApplicationExecutionId,
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
    const socialChatProvider = createSyntheticSocialChatProvider({
      provider,
      store: socialChatStore,
      requests: socialAgentE2eModelRequests,
      e2eValid: socialAgentE2eValid || socialWorkEntryE2eValid,
      liveE2e: testSocialAgentLiveE2e,
      e2eModel: socialAgentE2eModel,
      historyRecallMarker: socialHistoryRecallMarker,
      composerQueueMarker: socialComposerQueueMarker,
      delegationMarker: socialAgentDelegationMarker,
      delegationTask: socialAgentDelegationTask,
      delegationResult: socialAgentDelegationResult,
    });
    const chooseProjectWorkspace = socialWorkDialogs.chooseProjectWorkspace;
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
            ...createProjectTeamTools({
              propose: (input: object) =>
                socialChatService!.proposeProjectTeamFromTool(input),
              decide: (input: object) =>
                socialChatService!.decideProjectTeamFromTool(input),
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
      agentRuntimes,
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
    const chatExportRuntime = createChatExportRuntime({
      getMainWindow: () => mainWindow,
      socialChatStore,
      modelUsageStore,
    });
    const unregisterRootHandlers = registerRootIpc({
      ipcMain,
      rootAgent: agent,
      socialChatService,
      socialProjectStore,
      socialTeamStore,
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
      exportConversation: chatExportRuntime.exportConversation,
      exportWorkTicket: chatExportRuntime.exportWorkTicket,
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
