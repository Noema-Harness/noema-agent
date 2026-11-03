import { contextBridge, ipcRenderer } from 'electron';
import type {
  NoemaQuickCaptureRequest,
  NoemaQuickCaptureShortcutStatus,
  NoemaPersonalMemory,
  NoemaPersonalMemoryList,
  NoemaUserFollowupList,
  NoemaUserFollowup,
  NoemaRootEvent,
  NoemaRootState,
  NoemaSocialEvent,
  NoemaSocialProjectSession,
  NoemaSocialSearchResult,
  NoemaSocialRoomState,
  NoemaSocialState,
  NoemaProjectPlan,
  NoemaProjectPlanWrite,
  NoemaProjectPlanItemUpdate,
  NoemaProjectPlanPhaseUpdate,
  NoemaDiagnosticExecution,
  NoemaDiagnosticTimeline,
  NoemaDiagnosticExportPreview,
  NoemaWindowsRunnerCapability,
} from '../shared/contracts/noema-bridge.d.ts';

const bridge = {
  controlWindow: (
    action: 'minimize' | 'maximize' | 'close' | 'state',
  ): Promise<boolean> => ipcRenderer.invoke('noema:window-control', action),
  onWindowStateChanged: (listener: (maximized: boolean) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
      listener(maximized);
    ipcRenderer.on('noema:window-state', handle);
    return () => ipcRenderer.removeListener('noema:window-state', handle);
  },
  appVersion: process.env.npm_package_version ?? '0.1.0',
  getRootState: (): Promise<NoemaRootState> =>
    ipcRenderer.invoke('noema:root-state'),
  getSocialState: (): Promise<NoemaSocialState> =>
    ipcRenderer.invoke('noema:social-state'),
  getWindowsRunnerCapability: (): Promise<NoemaWindowsRunnerCapability> =>
    ipcRenderer.invoke('noema:windows-runner-capability'),
  setupWindowsRunner: (): Promise<{
    supported: boolean;
    canceled: boolean;
    reasonCode: string | null;
  }> => ipcRenderer.invoke('noema:setup-windows-runner'),
  onWindowsRunnerCapabilityChanged: (
    listener: (state: NoemaWindowsRunnerCapability) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: NoemaWindowsRunnerCapability,
    ) => listener(state);
    ipcRenderer.on('noema:windows-runner-capability-changed', handler);
    return () =>
      ipcRenderer.removeListener(
        'noema:windows-runner-capability-changed',
        handler,
      );
  },
  getPersonalMemories: (): Promise<NoemaPersonalMemoryList> =>
    ipcRenderer.invoke('noema:personal-memories'),
  setPersonalMemoryEnabled: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('noema:personal-memory-enabled', enabled),
  addPersonalMemory: (content: string): Promise<NoemaPersonalMemory> =>
    ipcRenderer.invoke('noema:add-personal-memory', content),
  updatePersonalMemory: (input: {
    id: string;
    content: string;
  }): Promise<NoemaPersonalMemory> =>
    ipcRenderer.invoke('noema:update-personal-memory', input),
  deletePersonalMemory: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('noema:delete-personal-memory', id),
  getUserFollowups: (): Promise<NoemaUserFollowupList> =>
    ipcRenderer.invoke('noema:user-followups'),
  setUserFollowupsEnabled: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('noema:user-followups-enabled', enabled),
  addUserFollowup: (input: {
    title: string;
    body: string;
    dueAt: string;
  }): Promise<NoemaUserFollowup> =>
    ipcRenderer.invoke('noema:add-user-followup', input),
  updateUserFollowup: (input: {
    id: string;
    title: string;
    body: string;
    dueAt: string;
  }): Promise<NoemaUserFollowup> =>
    ipcRenderer.invoke('noema:update-user-followup', input),
  cancelUserFollowup: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('noema:cancel-user-followup', id),
  advanceFirstMeeting: (action: 'read' | 'enter') =>
    ipcRenderer.invoke('noema:first-meeting-progress', action),
  getSocialRoom: (roomId: string): Promise<NoemaSocialRoomState> =>
    ipcRenderer.invoke('noema:social-room', roomId),
  searchSocialMessages: (query: string): Promise<NoemaSocialSearchResult[]> =>
    ipcRenderer.invoke('noema:social-search-messages', query),
  createSocialGroup: (input: { title: string; agentIds: string[] }) =>
    ipcRenderer.invoke('noema:social-create-group', input),
  createSocialProject: (input: {
    title: string;
    brief: string;
    agentIds: string[];
    originRoomId?: string;
    sourceMessageId?: string | null;
  }) => ipcRenderer.invoke('noema:social-create-project', input),
  getSocialProjectSession: (projectId: string, agentId: string) =>
    ipcRenderer.invoke(
      'noema:social-project-session',
      projectId,
      agentId,
    ) as Promise<NoemaSocialProjectSession>,
  archiveSocialProject: (projectId: string) =>
    ipcRenderer.invoke('noema:social-archive-project', projectId),
  getSocialProjectPlan: (projectId: string) =>
    ipcRenderer.invoke('noema:social-project-plan', projectId),
  inspectSocialProjectPlanEvidence: (projectId: string, itemId: string) =>
    ipcRenderer.invoke('noema:social-project-plan-evidence', projectId, itemId),
  reopenSocialProjectPlanEvidence: (input: {
    projectId: string;
    itemId: string;
    expectedRevision: number;
  }): Promise<NoemaProjectPlan> =>
    ipcRenderer.invoke('noema:social-reopen-project-plan-evidence', input),
  replaceSocialProjectPlan: (input: NoemaProjectPlanWrite) =>
    ipcRenderer.invoke('noema:social-replace-project-plan', input),
  updateSocialProjectPlanItem: (input: NoemaProjectPlanItemUpdate) =>
    ipcRenderer.invoke('noema:social-update-project-plan-item', input),
  updateSocialProjectPlanPhase: (input: NoemaProjectPlanPhaseUpdate) =>
    ipcRenderer.invoke('noema:social-update-project-plan-phase', input),
  restoreSocialProject: (projectId: string) =>
    ipcRenderer.invoke('noema:social-restore-project', projectId),
  retrySocialProjectGrowthMember: (batchId: string, agentId: string) =>
    ipcRenderer.invoke(
      'noema:social-retry-project-growth-member',
      batchId,
      agentId,
    ),
  createSocialContinuationThread: (input: {
    sourceRoomId: string;
    sourceIds: string[];
    title: string;
  }) => ipcRenderer.invoke('noema:social-create-continuation-thread', input),
  setSocialContinuationThreadClosed: (roomId: string, closed: boolean) =>
    ipcRenderer.invoke(
      'noema:social-set-continuation-thread-closed',
      roomId,
      closed,
    ),
  deleteSocialContinuationThread: (roomId: string) =>
    ipcRenderer.invoke('noema:social-delete-continuation-thread', roomId),
  createSocialAgent: (input: {
    name: string;
    headline: string;
    description: string;
    projectWork: boolean;
  }) => ipcRenderer.invoke('noema:social-create-agent', input),
  updateSocialAgentProfile: (input: {
    agentId: string;
    name: string;
    headline: string;
    description: string;
  }) => ipcRenderer.invoke('noema:social-update-agent-profile', input),
  setSocialAgentProjectWork: (agentId: string, enabled: boolean) =>
    ipcRenderer.invoke('noema:social-agent-project-work', agentId, enabled),
  setSocialAgentArchived: (agentId: string, archived: boolean) =>
    ipcRenderer.invoke('noema:social-agent-archive', agentId, archived),
  sendSocialMessage: (input: {
    roomId: string;
    agentId: string;
    text: string;
    replyToMessageId?: string | null;
    reviewRequestId?: string | null;
  }) => ipcRenderer.invoke('noema:social-send', input),
  forwardSocialMessages: (input: {
    targetRoomId: string;
    sourceRoomId: string;
    sourceIds: string[];
  }) => ipcRenderer.invoke('noema:social-forward', input),
  stopSocialReply: (messageId: string) =>
    ipcRenderer.invoke('noema:social-stop', messageId),
  retrySocialReply: (messageId: string) =>
    ipcRenderer.invoke('noema:social-retry', messageId),
  stopSocialWorkTask: (taskId: string) =>
    ipcRenderer.invoke('noema:social-work-stop', taskId),
  resumeSocialWorkTask: (taskId: string) =>
    ipcRenderer.invoke('noema:social-work-resume', taskId),
  reviewSocialWorkFileChange: (input: {
    taskId: string;
    changeId: string;
    action: 'keep' | 'revert';
  }) => ipcRenderer.invoke('noema:social-work-file-change', input),
  reviewSocialWorkGitState: (taskId: string) =>
    ipcRenderer.invoke('noema:social-work-git-review', taskId),
  setSocialWorkCaseEligible: (taskId: string, eligible: boolean) =>
    ipcRenderer.invoke('noema:social-work-case-eligible', taskId, eligible),
  withdrawSocialPracticeCandidate: (taskId: string) =>
    ipcRenderer.invoke('noema:social-practice-withdraw', taskId),
  refreshModels: () => ipcRenderer.invoke('noema:refresh-models'),
  configureProvider: (configuration: { baseUrl: string; apiKey: string }) =>
    ipcRenderer.invoke('noema:configure-provider', configuration),
  configureWebSearch: (configuration: { apiKey: string }) =>
    ipcRenderer.invoke('noema:configure-web-search', configuration),
  clearWebSearch: () => ipcRenderer.invoke('noema:clear-web-search'),
  selectModel: (model: string) =>
    ipcRenderer.invoke('noema:select-model', model),
  sendMessage: (text: string) => ipcRenderer.invoke('noema:send-message', text),
  saveCapture: (text: string) => ipcRenderer.invoke('noema:save-capture', text),
  updateCapture: (id: string, text: string) =>
    ipcRenderer.invoke('noema:update-capture', id, text),
  deleteCapture: (id: string) => ipcRenderer.invoke('noema:delete-capture', id),
  discussCapture: (id: string) =>
    ipcRenderer.invoke('noema:discuss-capture', id),
  retryTurn: (turnId: string, model?: string | null) =>
    ipcRenderer.invoke('noema:retry-turn', turnId, model ?? null),
  stopTurn: (turnId: string) => ipcRenderer.invoke('noema:stop-turn', turnId),
  chooseWorkspace: () => ipcRenderer.invoke('noema:choose-workspace'),
  clearWorkspace: () => ipcRenderer.invoke('noema:clear-workspace'),
  stopBackgroundTask: (taskId: string) =>
    ipcRenderer.invoke('noema:stop-background-task', taskId),
  resumeBackgroundTask: (taskId: string) =>
    ipcRenderer.invoke('noema:resume-background-task', taskId),
  retryBackgroundEvent: (taskId: string) =>
    ipcRenderer.invoke('noema:retry-worker-event', taskId),
  listCodexThreads: (cursor?: string | null) =>
    ipcRenderer.invoke('noema:list-codex-threads', cursor ?? null),
  previewCodexThread: (threadId: string) =>
    ipcRenderer.invoke('noema:preview-codex-thread', threadId),
  importCodexThread: (input: {
    threadId: string;
    expectedSourceUpdatedAt: string | number | null;
  }) => ipcRenderer.invoke('noema:import-codex-thread', input),
  removeContextImport: () => ipcRenderer.invoke('noema:remove-context-import'),
  addSocialInteractionAdjustment: (input: {
    sourceTurnId: string;
    sourceRoomId: string;
    scope: 'conversation' | 'coding' | 'both';
    situation: string;
    behavior: string;
    sourceQuote: string;
  }) => ipcRenderer.invoke('noema:add-social-interaction-adjustment', input),
  updateInteractionAdjustment: (input: {
    id: string;
    scope: 'conversation' | 'coding' | 'both';
    situation: string;
    behavior: string;
  }) => ipcRenderer.invoke('noema:update-interaction-adjustment', input),
  withdrawInteractionAdjustment: (id: string) =>
    ipcRenderer.invoke('noema:withdraw-interaction-adjustment', id),
  getDiagnosticsRecent: (
    limit = 20,
  ): Promise<{
    available: boolean;
    executions: NoemaDiagnosticExecution[];
    diagnostics: Record<string, unknown>;
  }> => ipcRenderer.invoke('noema:diagnostics-recent', limit),
  getDiagnosticsDatabaseHealth: (): Promise<
    'healthy' | 'problem' | 'unavailable'
  > => ipcRenderer.invoke('noema:diagnostics-database-health'),
  openUserDataDirectory: (): Promise<{
    opened: boolean;
    errorCode: string | null;
  }> => ipcRenderer.invoke('noema:open-user-data-directory'),
  getDiagnosticsTimeline: (input: {
    executionId?: string | null;
    taskId?: string | null;
    limit?: number;
  }): Promise<NoemaDiagnosticTimeline> =>
    ipcRenderer.invoke('noema:diagnostics-timeline', input),
  previewDiagnosticsExport: (input: {
    executionId?: string | null;
    taskId?: string | null;
  }): Promise<NoemaDiagnosticExportPreview> =>
    ipcRenderer.invoke('noema:diagnostics-export-preview', input),
  saveDiagnosticsExport: (
    previewId: string,
  ): Promise<{
    saved: boolean;
    canceled?: boolean;
    fileName?: string;
    errorCode?: string;
  }> => ipcRenderer.invoke('noema:diagnostics-export-save', previewId),
  onRootEvent: (listener: (event: NoemaRootEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: NoemaRootEvent,
    ) => listener(payload);
    ipcRenderer.on('noema:root-event', handler);
    return () => ipcRenderer.removeListener('noema:root-event', handler);
  },
  onSocialEvent: (listener: (event: NoemaSocialEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: NoemaSocialEvent,
    ) => listener(payload);
    ipcRenderer.on('noema:social-event', handler);
    return () => ipcRenderer.removeListener('noema:social-event', handler);
  },
  markSocialChatReady: (): Promise<boolean> =>
    ipcRenderer.invoke('noema:mark-social-chat-ready'),
  onQuickCaptureRequested: (
    listener: (request: NoemaQuickCaptureRequest) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      request: NoemaQuickCaptureRequest,
    ) => listener(request);
    ipcRenderer.on('noema:quick-capture-request', handler);
    return () =>
      ipcRenderer.removeListener('noema:quick-capture-request', handler);
  },
  getQuickCaptureShortcutStatus:
    (): Promise<NoemaQuickCaptureShortcutStatus | null> =>
      ipcRenderer.invoke('noema:quick-capture-shortcut-status'),
  markQuickCaptureReady: () =>
    ipcRenderer.invoke('noema:mark-quick-capture-ready'),
  finishQuickCapture: () => ipcRenderer.invoke('noema:finish-quick-capture'),
};

contextBridge.exposeInMainWorld('noema', bridge);
