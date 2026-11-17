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
  NoemaDiagnosticRuntimeInfo,
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
} from '../contracts/noema-bridge.d.ts';
import type { NoemaBridge } from '../contracts/noema-bridge.d.ts';
import type { BridgeTransport } from './transport.ts';

export interface CreateBridgeOptions {
  /** Shown in settings; the host owns where it comes from. */
  appVersion: string;
  /** Desktop-only probe channels used by the social-work E2E harness. */
  includeSocialWorkRaceProbe?: boolean;
}

/**
 * Builds the renderer-facing bridge API over any transport.
 *
 * The desktop host binds an Electron transport; a remote or companion host can
 * bind the same channels to its own message transport. Nothing below may import
 * Electron or touch a process global.
 */
export function createBridge(
  transport: BridgeTransport,
  options: CreateBridgeOptions,
): NoemaBridge {
  // Channels whose payload types are not declared in NoemaBridge keep the
  // previous any typing; annotate them in the contract and here as they get
  // typed. Everything declared in NoemaBridge is still checked on return.
  const call = (channel: string, ...args: unknown[]): Promise<any> =>
    transport.invoke(channel, ...args);

  const bridge = {
    controlWindow: (
      action: 'minimize' | 'maximize' | 'close' | 'state',
    ): Promise<boolean> => call('noema:window-control', action),
    onWindowStateChanged: (listener: (maximized: boolean) => void) =>
      transport.on('noema:window-state', listener),
    appVersion: options.appVersion,
    getLegacyHistoryCategories: (): Promise<NoemaLegacyHistoryCategoryInfo[]> =>
      call('noema:legacy-history-categories'),
    getLegacyHistoryPage: (input: {
      category: NoemaLegacyHistoryCategory;
      cursor?: number | null;
      limit?: number;
    }): Promise<NoemaLegacyHistoryPage> =>
      call('noema:legacy-history-page', input),
    previewLegacyHistoryExport: (input: {
      categories: NoemaLegacyHistoryCategory[];
    }): Promise<NoemaLegacyHistoryExportPreview> =>
      call('noema:legacy-history-export-preview', input),
    saveLegacyHistoryExport: (
      previewId: string,
    ): Promise<{
      saved: boolean;
      canceled: boolean;
      errorCode: string | null;
    }> => call('noema:legacy-history-export-save', previewId),
    getSocialState: (): Promise<NoemaSocialState> => call('noema:social-state'),
    getExecutionPermissions: (): Promise<NoemaExecutionPermissions> =>
      call('noema:execution-permissions'),
    setExecutionPermissions: (
      permissions: Partial<NoemaExecutionPermissions>,
    ): Promise<NoemaExecutionPermissions> =>
      call('noema:set-execution-permissions', permissions),
    getWindowsRunnerCapability: (): Promise<NoemaWindowsRunnerCapability> =>
      call('noema:windows-runner-capability'),
    setupWindowsRunner: (): Promise<{
      supported: boolean;
      canceled: boolean;
      reasonCode: string | null;
    }> => call('noema:setup-windows-runner'),
    onWindowsRunnerCapabilityChanged: (
      listener: (state: NoemaWindowsRunnerCapability) => void,
    ) => transport.on('noema:windows-runner-capability-changed', listener),
    getPersonalMemories: (): Promise<NoemaPersonalMemoryList> =>
      call('noema:personal-memories'),
    setPersonalMemoryEnabled: (enabled: boolean): Promise<boolean> =>
      call('noema:personal-memory-enabled', enabled),
    addPersonalMemory: (content: string): Promise<NoemaPersonalMemory> =>
      call('noema:add-personal-memory', content),
    updatePersonalMemory: (input: {
      id: string;
      content: string;
    }): Promise<NoemaPersonalMemory> =>
      call('noema:update-personal-memory', input),
    deletePersonalMemory: (id: string): Promise<boolean> =>
      call('noema:delete-personal-memory', id),
    getUserFollowups: (): Promise<NoemaUserFollowupList> =>
      call('noema:user-followups'),
    setUserFollowupsEnabled: (enabled: boolean): Promise<boolean> =>
      call('noema:user-followups-enabled', enabled),
    addUserFollowup: (input: {
      title: string;
      body: string;
      dueAt: string;
    }): Promise<NoemaUserFollowup> => call('noema:add-user-followup', input),
    updateUserFollowup: (input: {
      id: string;
      title: string;
      body: string;
      dueAt: string;
    }): Promise<NoemaUserFollowup> => call('noema:update-user-followup', input),
    cancelUserFollowup: (id: string): Promise<boolean> =>
      call('noema:cancel-user-followup', id),
    getSocialRoom: (
      roomId: string,
      options?: {
        limit?: number;
        beforeSequence?: number;
        afterSequence?: number;
        aroundMessageId?: string;
      },
    ): Promise<NoemaSocialRoomState> =>
      call('noema:social-room', roomId, options),
    searchSocialMessages: (query: string): Promise<NoemaSocialSearchResult[]> =>
      call('noema:social-search-messages', query),
    searchSocialRoomMessages: (
      roomId: string,
      query: string,
    ): Promise<NoemaSocialSearchResult[]> =>
      call('noema:social-search-room-messages', roomId, query),
    createSocialGroup: (input: { title: string; agentIds: string[] }) =>
      call('noema:social-create-group', input),
    chooseProjectWorkspace: () => call('noema:social-choose-project-workspace'),
    createSocialProject: (input: {
      title: string;
      brief: string;
      agentIds: string[];
      originRoomId?: string;
      sourceMessageId?: string | null;
      workspacePath?: string | null;
      workspaceIdentity?: unknown;
    }) => call('noema:social-create-project', input),
    getSocialProjectSession: (projectId: string, agentId: string) =>
      call(
        'noema:social-project-session',
        projectId,
        agentId,
      ) as Promise<NoemaSocialProjectSession>,
    archiveSocialProject: (projectId: string) =>
      call('noema:social-archive-project', projectId),
    getSocialProjectPlan: (projectId: string) =>
      call('noema:social-project-plan', projectId),
    inspectSocialProjectPlanEvidence: (projectId: string, itemId: string) =>
      call('noema:social-project-plan-evidence', projectId, itemId),
    reopenSocialProjectPlanEvidence: (input: {
      projectId: string;
      itemId: string;
      expectedRevision: number;
    }): Promise<NoemaProjectPlan> =>
      call('noema:social-reopen-project-plan-evidence', input),
    replaceSocialProjectPlan: (input: NoemaProjectPlanWrite) =>
      call('noema:social-replace-project-plan', input),
    updateSocialProjectPlanItem: (input: NoemaProjectPlanItemUpdate) =>
      call('noema:social-update-project-plan-item', input),
    updateSocialProjectPlanPhase: (input: NoemaProjectPlanPhaseUpdate) =>
      call('noema:social-update-project-plan-phase', input),
    completeSocialProject: (projectId: string) =>
      call('noema:social-complete-project', projectId),
    restoreSocialProject: (projectId: string) =>
      call('noema:social-restore-project', projectId),
    retrySocialProjectGrowthMember: (batchId: string, agentId: string) =>
      call('noema:social-retry-project-growth-member', batchId, agentId),
    createSocialContinuationThread: (input: {
      sourceRoomId: string;
      sourceIds: string[];
      title: string;
    }) => call('noema:social-create-continuation-thread', input),
    setSocialContinuationThreadClosed: (roomId: string, closed: boolean) =>
      call('noema:social-set-continuation-thread-closed', roomId, closed),
    deleteSocialContinuationThread: (roomId: string) =>
      call('noema:social-delete-continuation-thread', roomId),
    createSocialAgent: (input: {
      name: string;
      headline: string;
      description: string;
      projectWork: boolean;
    }) => call('noema:social-create-agent', input),
    updateSocialAgentProfile: (input: {
      agentId: string;
      name: string;
      headline: string;
      description: string;
    }) => call('noema:social-update-agent-profile', input),
    setSocialAgentProjectWork: (agentId: string, enabled: boolean) =>
      call('noema:social-agent-project-work', agentId, enabled),
    setSocialAgentArchived: (agentId: string, archived: boolean) =>
      call('noema:social-agent-archive', agentId, archived),
    resetSocialChat: () => call('noema:social-reset-chat') as Promise<boolean>,
    listSocialConversationThreads: (roomId: string) =>
      call('noema:social-conversation-threads', roomId) as Promise<
        SocialConversationThread[]
      >,
    getSocialContinuityState: (roomId: string) =>
      call(
        'noema:social-continuity-state',
        roomId,
      ) as Promise<SocialContinuityState>,
    listSocialContinuityBranches: (roomId: string) =>
      call('noema:social-continuity-branches', roomId) as Promise<
        SocialConversationBranch[]
      >,
    createSocialContinuityBranch: (input: {
      roomId?: string;
      fromTurnId?: string | null;
      title?: string | null;
    }) =>
      call(
        'noema:social-continuity-create-branch',
        input,
      ) as Promise<SocialConversationBranch>,
    switchSocialContinuityBranch: (input: {
      roomId?: string;
      branchId: string;
      expectedVersion?: number | null;
    }) =>
      call(
        'noema:social-continuity-switch-branch',
        input,
      ) as Promise<SocialContinuityState>,
    createSocialContinuityEditBranch: (input: {
      roomId?: string;
      messageId: string;
      title?: string | null;
    }) =>
      call(
        'noema:social-continuity-edit-branch',
        input,
      ) as Promise<SocialContinuityState>,
    rewindSocialMessage: (roomId: string, messageId: string) =>
      call('noema:social-rewind-message', roomId, messageId) as Promise<{
        removed: number;
      }>,
    editSocialAssistantMessage: (
      roomId: string,
      messageId: string,
      content: string,
    ) =>
      call(
        'noema:social-edit-assistant-message',
        roomId,
        messageId,
        content,
      ) as Promise<{
        updated: number;
      }>,
    latestSocialArchive: (roomId: string) =>
      call('noema:social-latest-archive', roomId) as Promise<{
        id: string;
        reason: string;
        createdAt: string;
      } | null>,
    restoreSocialArchive: (archiveId: string) =>
      call('noema:social-restore-archive', archiveId) as Promise<{
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
    }) => call('noema:social-send', input),
    forwardSocialMessages: (input: {
      targetRoomId: string;
      sourceRoomId: string;
      sourceIds: string[];
    }) => call('noema:social-forward', input),
    stopSocialReply: (messageId: string) =>
      call('noema:social-stop', messageId),
    retrySocialReply: (messageId: string) =>
      call('noema:social-retry', messageId),
    stopSocialWorkTask: (taskId: string) =>
      call('noema:social-work-stop', taskId),
    resumeSocialWorkTask: (taskId: string) =>
      call('noema:social-work-resume', taskId),
    continueSocialWorkTask: (taskId: string) =>
      call('noema:social-work-continue', taskId),
    getSocialWorkUsage: (taskId: string) =>
      call('noema:social-work-usage', taskId),
    getSocialWorkStepDetail: (taskId: string, stepId: string) =>
      call('noema:social-work-step-detail', taskId, stepId),
    getSocialWorkTouchedFiles: (taskId: string) =>
      call('noema:social-work-touched-files', taskId),
    exportWorkTicket: (taskId: string) =>
      call('noema:social-work-export', taskId),
    exportConversation: (roomId: string) => call('noema:social-export', roomId),
    reviewSocialWorkFileChange: (input: {
      taskId: string;
      changeId: string;
      action: 'keep' | 'revert';
    }) => call('noema:social-work-file-change', input),
    reviewSocialWorkGitState: (taskId: string) =>
      call('noema:social-work-git-review', taskId),
    setSocialWorkCaseEligible: (taskId: string, eligible: boolean) =>
      call('noema:social-work-case-eligible', taskId, eligible),
    withdrawSocialPracticeCandidate: (taskId: string) =>
      call('noema:social-practice-withdraw', taskId),
    listWorkspaceFiles: (input: {
      workspacePath: string;
      relativePath?: string;
    }) => call('noema:workspace-files', input),
    readWorkspaceFile: (input: {
      workspacePath: string;
      relativePath: string;
    }) => call('noema:workspace-file', input),
    searchWorkspaceFiles: (input: { workspacePath: string; query: string }) =>
      call('noema:workspace-search', input),
    readWorkspaceImage: (input: {
      workspacePath: string;
      relativePath: string;
    }) => call('noema:workspace-image', input),
    openWorkspaceFolder: (input: { workspacePath: string }) =>
      call('noema:workspace-open-folder', input),
    refreshModels: (): Promise<NoemaProviderState> =>
      call('noema:refresh-models'),
    configureProvider: (configuration: {
      baseUrl: string;
      apiKey: string;
    }): Promise<Partial<NoemaProviderState>> =>
      call('noema:configure-provider', configuration),
    configureWebSearch: (configuration: { apiKey: string }) =>
      call('noema:configure-web-search', configuration),
    clearWebSearch: () => call('noema:clear-web-search'),
    selectModel: (model: string) => call('noema:select-model', model),
    getDiagnosticsRecent: (
      limit = 20,
    ): Promise<{
      available: boolean;
      executions: NoemaDiagnosticExecution[];
      diagnostics: Record<string, unknown>;
      runtime: NoemaDiagnosticRuntimeInfo | null;
    }> => call('noema:diagnostics-recent', limit),
    getDiagnosticsDatabaseHealth: (): Promise<
      'healthy' | 'problem' | 'unavailable'
    > => call('noema:diagnostics-database-health'),
    openUserDataDirectory: (): Promise<{
      opened: boolean;
      errorCode: string | null;
    }> => call('noema:open-user-data-directory'),
    getDiagnosticsTimeline: (input: {
      executionId?: string | null;
      taskId?: string | null;
      limit?: number;
    }): Promise<NoemaDiagnosticTimeline> =>
      call('noema:diagnostics-timeline', input),
    previewDiagnosticsExport: (input: {
      executionId?: string | null;
      taskId?: string | null;
      includeTestContext?: boolean;
    }): Promise<NoemaDiagnosticExportPreview> =>
      call('noema:diagnostics-export-preview', input),
    saveDiagnosticsExport: (
      previewId: string,
    ): Promise<{
      saved: boolean;
      canceled?: boolean;
      fileName?: string;
      errorCode?: string;
    }> => call('noema:diagnostics-export-save', previewId),
    onModelStateChanged: (listener: (event: NoemaModelStateEvent) => void) =>
      transport.on('noema:model-state-event', listener),
    onSocialEvent: (listener: (event: NoemaSocialEvent) => void) =>
      transport.on('noema:social-event', listener),
    markSocialChatReady: (): Promise<boolean> =>
      call('noema:mark-social-chat-ready'),
  };

  const socialWorkRaceProbeBridge = options.includeSocialWorkRaceProbe
    ? {
        testArmSocialWorkReverseSnapshot: (
          roomId: string,
          taskId: string,
        ): Promise<boolean> =>
          call('noema:test-arm-social-work-reverse-snapshot', roomId, taskId),
        testGetSocialWorkReverseSnapshotStatus: (): Promise<{
          firstRequested: boolean;
          firstReturned: boolean;
          secondReturned: boolean;
        }> => call('noema:test-social-work-reverse-snapshot-status'),
      }
    : {};

  return { ...bridge, ...socialWorkRaceProbeBridge };
}
