import { contextBridge, ipcRenderer } from 'electron';
import type {
  NoemaPersonalMemory,
  NoemaPersonalMemoryList,
  NoemaUserFollowupList,
  NoemaUserFollowup,
  NoemaModelStateEvent,
  NoemaProviderState,
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
  NoemaExecutionPermissions,
  NoemaWindowsRunnerCapability,
  NoemaLegacyHistoryCategory,
  NoemaLegacyHistoryCategoryInfo,
  NoemaLegacyHistoryPage,
  NoemaLegacyHistoryExportPreview,
  SocialConversationThread,
  SocialConversationBranch,
  SocialContinuityState,
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
  getLegacyHistoryCategories: (): Promise<NoemaLegacyHistoryCategoryInfo[]> =>
    ipcRenderer.invoke('noema:legacy-history-categories'),
  getLegacyHistoryPage: (input: {
    category: NoemaLegacyHistoryCategory;
    cursor?: number | null;
    limit?: number;
  }): Promise<NoemaLegacyHistoryPage> =>
    ipcRenderer.invoke('noema:legacy-history-page', input),
  previewLegacyHistoryExport: (input: {
    categories: NoemaLegacyHistoryCategory[];
  }): Promise<NoemaLegacyHistoryExportPreview> =>
    ipcRenderer.invoke('noema:legacy-history-export-preview', input),
  saveLegacyHistoryExport: (
    previewId: string,
  ): Promise<{ saved: boolean; canceled: boolean; errorCode: string | null }> =>
    ipcRenderer.invoke('noema:legacy-history-export-save', previewId),
  getSocialState: (): Promise<NoemaSocialState> =>
    ipcRenderer.invoke('noema:social-state'),
  getExecutionPermissions: (): Promise<NoemaExecutionPermissions> =>
    ipcRenderer.invoke('noema:execution-permissions'),
  setExecutionPermissions: (
    permissions: Partial<NoemaExecutionPermissions>,
  ): Promise<NoemaExecutionPermissions> =>
    ipcRenderer.invoke('noema:set-execution-permissions', permissions),
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
  getSocialRoom: (
    roomId: string,
    options?: {
      limit?: number;
      beforeSequence?: number;
      afterSequence?: number;
      aroundMessageId?: string;
    },
  ): Promise<NoemaSocialRoomState> =>
    ipcRenderer.invoke('noema:social-room', roomId, options),
  searchSocialMessages: (query: string): Promise<NoemaSocialSearchResult[]> =>
    ipcRenderer.invoke('noema:social-search-messages', query),
  searchSocialRoomMessages: (
    roomId: string,
    query: string,
  ): Promise<NoemaSocialSearchResult[]> =>
    ipcRenderer.invoke('noema:social-search-room-messages', roomId, query),
  createSocialGroup: (input: { title: string; agentIds: string[] }) =>
    ipcRenderer.invoke('noema:social-create-group', input),
  chooseProjectWorkspace: () =>
    ipcRenderer.invoke('noema:social-choose-project-workspace'),
  createSocialProject: (input: {
    title: string;
    brief: string;
    agentIds: string[];
    originRoomId?: string;
    sourceMessageId?: string | null;
    workspacePath?: string | null;
    workspaceIdentity?: unknown;
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
  completeSocialProject: (projectId: string) =>
    ipcRenderer.invoke('noema:social-complete-project', projectId),
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
  resetSocialChat: () =>
    ipcRenderer.invoke('noema:social-reset-chat') as Promise<boolean>,
  listSocialConversationThreads: (roomId: string) =>
    ipcRenderer.invoke('noema:social-conversation-threads', roomId) as Promise<
      SocialConversationThread[]
    >,
  getSocialContinuityState: (roomId: string) =>
    ipcRenderer.invoke(
      'noema:social-continuity-state',
      roomId,
    ) as Promise<SocialContinuityState>,
  listSocialContinuityBranches: (roomId: string) =>
    ipcRenderer.invoke('noema:social-continuity-branches', roomId) as Promise<
      SocialConversationBranch[]
    >,
  createSocialContinuityBranch: (input: {
    roomId?: string;
    fromTurnId?: string | null;
    title?: string | null;
  }) =>
    ipcRenderer.invoke(
      'noema:social-continuity-create-branch',
      input,
    ) as Promise<SocialConversationBranch>,
  switchSocialContinuityBranch: (input: {
    roomId?: string;
    branchId: string;
    expectedVersion?: number | null;
  }) =>
    ipcRenderer.invoke(
      'noema:social-continuity-switch-branch',
      input,
    ) as Promise<SocialContinuityState>,
  createSocialContinuityEditBranch: (input: {
    roomId?: string;
    messageId: string;
    title?: string | null;
  }) =>
    ipcRenderer.invoke(
      'noema:social-continuity-edit-branch',
      input,
    ) as Promise<SocialContinuityState>,
  rewindSocialMessage: (roomId: string, messageId: string) =>
    ipcRenderer.invoke(
      'noema:social-rewind-message',
      roomId,
      messageId,
    ) as Promise<{
      removed: number;
    }>,
  editSocialAssistantMessage: (
    roomId: string,
    messageId: string,
    content: string,
  ) =>
    ipcRenderer.invoke(
      'noema:social-edit-assistant-message',
      roomId,
      messageId,
      content,
    ) as Promise<{ updated: number }>,
  latestSocialArchive: (roomId: string) =>
    ipcRenderer.invoke('noema:social-latest-archive', roomId) as Promise<{
      id: string;
      reason: string;
      createdAt: string;
    } | null>,
  restoreSocialArchive: (archiveId: string) =>
    ipcRenderer.invoke('noema:social-restore-archive', archiveId) as Promise<{
      roomId: string;
      messages: number;
      turns: number;
      archiveId: string;
    }>,
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
  continueSocialWorkTask: (taskId: string) =>
    ipcRenderer.invoke('noema:social-work-continue', taskId),
  getSocialWorkUsage: (taskId: string) =>
    ipcRenderer.invoke('noema:social-work-usage', taskId),
  getSocialWorkStepDetail: (taskId: string, stepId: string) =>
    ipcRenderer.invoke('noema:social-work-step-detail', taskId, stepId),
  getSocialWorkTouchedFiles: (taskId: string) =>
    ipcRenderer.invoke('noema:social-work-touched-files', taskId),
  exportWorkTicket: (taskId: string) =>
    ipcRenderer.invoke('noema:social-work-export', taskId),
  exportConversation: (roomId: string) =>
    ipcRenderer.invoke('noema:social-export', roomId),
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
  listWorkspaceFiles: (input: {
    workspacePath: string;
    relativePath?: string;
  }) => ipcRenderer.invoke('noema:workspace-files', input),
  readWorkspaceFile: (input: { workspacePath: string; relativePath: string }) =>
    ipcRenderer.invoke('noema:workspace-file', input),
  searchWorkspaceFiles: (input: { workspacePath: string; query: string }) =>
    ipcRenderer.invoke('noema:workspace-search', input),
  readWorkspaceImage: (input: {
    workspacePath: string;
    relativePath: string;
  }) => ipcRenderer.invoke('noema:workspace-image', input),
  openWorkspaceFolder: (input: { workspacePath: string }) =>
    ipcRenderer.invoke('noema:workspace-open-folder', input),
  refreshModels: (): Promise<NoemaProviderState> =>
    ipcRenderer.invoke('noema:refresh-models'),
  configureProvider: (configuration: {
    baseUrl: string;
    apiKey: string;
  }): Promise<Partial<NoemaProviderState>> =>
    ipcRenderer.invoke('noema:configure-provider', configuration),
  configureWebSearch: (configuration: { apiKey: string }) =>
    ipcRenderer.invoke('noema:configure-web-search', configuration),
  clearWebSearch: () => ipcRenderer.invoke('noema:clear-web-search'),
  selectModel: (model: string) =>
    ipcRenderer.invoke('noema:select-model', model),
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
    includeTestContext?: boolean;
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
  onModelStateChanged: (listener: (event: NoemaModelStateEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: NoemaModelStateEvent,
    ) => listener(payload);
    ipcRenderer.on('noema:model-state-event', handler);
    return () => ipcRenderer.removeListener('noema:model-state-event', handler);
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
};

const socialWorkRaceProbeBridge = process.argv.includes(
  '--noema-social-work-reverse-snapshot-probe',
)
  ? {
      testArmSocialWorkReverseSnapshot: (
        roomId: string,
        taskId: string,
      ): Promise<boolean> =>
        ipcRenderer.invoke(
          'noema:test-arm-social-work-reverse-snapshot',
          roomId,
          taskId,
        ),
      testGetSocialWorkReverseSnapshotStatus: (): Promise<{
        firstRequested: boolean;
        firstReturned: boolean;
        secondReturned: boolean;
      }> =>
        ipcRenderer.invoke('noema:test-social-work-reverse-snapshot-status'),
    }
  : {};

contextBridge.exposeInMainWorld('noema', {
  ...bridge,
  ...socialWorkRaceProbeBridge,
});
