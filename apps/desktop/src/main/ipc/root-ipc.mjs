import { randomUUID } from 'node:crypto';
import { isMainFrameIpcEvent } from '../platform/window-security.ts';

const CHANNELS = Object.freeze({
  models: 'noema:refresh-models',
  configureProvider: 'noema:configure-provider',
  configureWebSearch: 'noema:configure-web-search',
  clearWebSearch: 'noema:clear-web-search',
  selectModel: 'noema:select-model',
  markSocialChatReady: 'noema:mark-social-chat-ready',
  modelStateEvent: 'noema:model-state-event',
  socialEvent: 'noema:social-event',
  socialState: 'noema:social-state',
  executionPermissions: 'noema:execution-permissions',
  setExecutionPermissions: 'noema:set-execution-permissions',
  personalMemories: 'noema:personal-memories',
  personalMemoryEnabled: 'noema:personal-memory-enabled',
  addPersonalMemory: 'noema:add-personal-memory',
  updatePersonalMemory: 'noema:update-personal-memory',
  deletePersonalMemory: 'noema:delete-personal-memory',
  userFollowups: 'noema:user-followups',
  userFollowupsEnabled: 'noema:user-followups-enabled',
  addUserFollowup: 'noema:add-user-followup',
  updateUserFollowup: 'noema:update-user-followup',
  cancelUserFollowup: 'noema:cancel-user-followup',
  socialRoom: 'noema:social-room',
  socialConversationThreads: 'noema:social-conversation-threads',
  socialContinuityState: 'noema:social-continuity-state',
  socialContinuityBranches: 'noema:social-continuity-branches',
  socialContinuityCreateBranch: 'noema:social-continuity-create-branch',
  socialContinuitySwitchBranch: 'noema:social-continuity-switch-branch',
  socialContinuityEditBranch: 'noema:social-continuity-edit-branch',
  socialRewindMessage: 'noema:social-rewind-message',
  socialEditAssistantMessage: 'noema:social-edit-assistant-message',
  socialLatestArchive: 'noema:social-latest-archive',
  socialRestoreArchive: 'noema:social-restore-archive',
  testArmSocialWorkReverseSnapshot:
    'noema:test-arm-social-work-reverse-snapshot',
  testSocialWorkReverseSnapshotStatus:
    'noema:test-social-work-reverse-snapshot-status',
  socialSearchMessages: 'noema:social-search-messages',
  socialSearchRoomMessages: 'noema:social-search-room-messages',
  socialCreateGroup: 'noema:social-create-group',
  socialCreateProject: 'noema:social-create-project',
  socialChooseProjectWorkspace: 'noema:social-choose-project-workspace',
  socialProjectSession: 'noema:social-project-session',
  socialProjectPlan: 'noema:social-project-plan',
  socialProjectPlanEvidence: 'noema:social-project-plan-evidence',
  socialReopenProjectPlanEvidence: 'noema:social-reopen-project-plan-evidence',
  socialReplaceProjectPlan: 'noema:social-replace-project-plan',
  socialUpdateProjectPlanItem: 'noema:social-update-project-plan-item',
  socialUpdateProjectPlanPhase: 'noema:social-update-project-plan-phase',
  socialCompleteProject: 'noema:social-complete-project',
  socialArchiveProject: 'noema:social-archive-project',
  socialRestoreProject: 'noema:social-restore-project',
  socialRetryProjectGrowthMember: 'noema:social-retry-project-growth-member',
  socialCreateContinuationThread: 'noema:social-create-continuation-thread',
  socialSetContinuationThreadClosed:
    'noema:social-set-continuation-thread-closed',
  socialDeleteContinuationThread: 'noema:social-delete-continuation-thread',
  socialCreateAgent: 'noema:social-create-agent',
  socialUpdateAgentProfile: 'noema:social-update-agent-profile',
  socialAgentProjectWork: 'noema:social-agent-project-work',
  socialAgentArchive: 'noema:social-agent-archive',
  socialResetChat: 'noema:social-reset-chat',
  socialSend: 'noema:social-send',
  socialForward: 'noema:social-forward',
  socialStop: 'noema:social-stop',
  socialRetry: 'noema:social-retry',
  socialWorkStop: 'noema:social-work-stop',
  socialWorkResume: 'noema:social-work-resume',
  socialWorkContinue: 'noema:social-work-continue',
  socialWorkUsage: 'noema:social-work-usage',
  socialWorkStepDetail: 'noema:social-work-step-detail',
  socialWorkTouchedFiles: 'noema:social-work-touched-files',
  socialWorkFileChange: 'noema:social-work-file-change',
  socialWorkExport: 'noema:social-work-export',
  socialExport: 'noema:social-export',
  workspaceFiles: 'noema:workspace-files',
  workspaceFile: 'noema:workspace-file',
  workspaceSearch: 'noema:workspace-search',
  workspaceImage: 'noema:workspace-image',
  workspaceOpenFolder: 'noema:workspace-open-folder',
  socialWorkGitReview: 'noema:social-work-git-review',
  socialWorkCaseEligible: 'noema:social-work-case-eligible',
  socialPracticeWithdraw: 'noema:social-practice-withdraw',
  diagnosticsRecent: 'noema:diagnostics-recent',
  diagnosticsTimeline: 'noema:diagnostics-timeline',
  diagnosticsDatabaseHealth: 'noema:diagnostics-database-health',
  openUserDataDirectory: 'noema:open-user-data-directory',
  diagnosticsExportPreview: 'noema:diagnostics-export-preview',
  diagnosticsExportSave: 'noema:diagnostics-export-save',
  windowsRunnerCapability: 'noema:windows-runner-capability',
  setupWindowsRunner: 'noema:setup-windows-runner',
});

/**
 * Registers shared provider/model operations and Social-owned operations.
 * @param {{ipcMain: {handle: Function, removeHandler: Function}, rootAgent: object, socialChatService?:object, socialProjectStore?:object, socialTeamStore?:object, socialWorkService?:object, getWorkTaskUsage?:(taskId:string)=>{requests:number,usageReportedRequests:number,inputTokens:number|null,outputTokens:number|null,totalTokens:number|null,reasoningTokens:number|null,models:string[]}|null, getWorkTaskStepDetail?:(taskId:string,stepId:string)=>object|null, getWorkTaskTouchedFiles?:(taskId:string)=>Array<{path:string,toolName:string,ordinal:number}>, exportWorkTicket?:(taskId:string)=>Promise<{saved:boolean,path?:string,canceled?:boolean,errorCode?:string}>, exportConversation?:(roomId:string)=>Promise<{saved:boolean,path?:string,canceled?:boolean,errorCode?:string}>, workspaceFileService?:{list:(input:{workspacePath:string,relativePath?:string})=>Promise<object>,read:(input:{workspacePath:string,relativePath:string})=>Promise<object>,search:(input:{workspacePath:string,query:string})=>Promise<object>,readImage:(input:{workspacePath:string,relativePath:string})=>Promise<object>,openFolder:(input:{workspacePath:string})=>Promise<object>}|null, chooseProjectWorkspace?:()=>Promise<{workspacePath:string,identity:object}|null>, resetChatSession?:()=>Promise<boolean>|boolean, getExecutionPermissions?:()=>{externalFiles:'read-only'|'ask'|'allow'}, setExecutionPermissions?:(permissions:{externalFiles?:'read-only'|'ask'|'allow'})=>{externalFiles:'read-only'|'ask'|'allow'}, diagnosticsQueryService?:object, getDiagnosticsDatabaseHealth?:()=>string, openUserDataDirectory?:()=>Promise<object>,saveDiagnosticsExport?:(previewId:string)=>Promise<object>, getWindowsRunnerCapability?:()=>object,setupWindowsRunner?:()=>Promise<object>, shouldInjectDiagnosticsReadFailures?:()=>boolean, shouldInjectSocialWorkReverseSnapshot?:()=>boolean, isTrustedSender: (sender: object) => boolean,markSocialChatReady?:()=>boolean,recordSocialReadiness?:(readiness:{available:boolean,reasonCode:string|null,reason:string|null})=>void,recordDiagnosticEvent?:(event:Record<string,unknown>)=>boolean|void}} options
 */
export function registerRootIpc({
  ipcMain,
  rootAgent,
  socialChatService = null,
  socialProjectStore = null,
  socialTeamStore = null,
  socialWorkService = null,
  getWorkTaskUsage = () => null,
  getWorkTaskStepDetail = () => null,
  getWorkTaskTouchedFiles = () => [],
  exportWorkTicket = async () => ({
    saved: false,
    errorCode: 'unavailable',
  }),
  exportConversation = async () => ({
    saved: false,
    errorCode: 'unavailable',
  }),
  workspaceFileService = null,
  chooseProjectWorkspace = async () => null,
  resetChatSession = null,
  getExecutionPermissions = () => ({ externalFiles: 'ask' }),
  setExecutionPermissions = () => ({ externalFiles: 'ask' }),
  diagnosticsQueryService = null,
  getDiagnosticsDatabaseHealth = () => 'unavailable',
  openUserDataDirectory = async () => ({
    opened: false,
    errorCode: 'data_directory_unavailable',
  }),
  saveDiagnosticsExport = async () => ({
    saved: false,
    errorCode: 'unavailable',
  }),
  isTrustedSender,
  markSocialChatReady = () => false,
  recordSocialReadiness = () => {},
  recordDiagnosticEvent = () => false,
  getWindowsRunnerCapability = () => ({
    platform: 'not_applicable',
    supported: false,
    backendReady: false,
    status: 'not_applicable',
    reasonCode: null,
    backendId: null,
    backendVersion: null,
    policyVersion: null,
    protocolVersion: null,
    setupStatus: 'not_applicable',
  }),
  setupWindowsRunner = async () => ({
    supported: false,
    canceled: false,
    reasonCode: 'runner_unavailable',
  }),
  shouldInjectDiagnosticsReadFailures = () => false,
  shouldInjectSocialWorkReverseSnapshot = () => false,
}) {
  let socialWorkReverseSnapshotProbe = null;
  const register = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event.sender) || !isMainFrameIpcEvent(event))
        throw new Error('未授权的应用窗口请求');
      return handler(...args);
    });
  };

  const recordPersonalMemoryIpc = (operation, callback) => {
    const executionId = randomUUID();
    try {
      const result = callback();
      try {
        recordDiagnosticEvent({
          executionId,
          module: 'social.memory',
          operation: `settings.${operation}`,
          status: 'completed',
        });
      } catch {
        // Personal memory behavior does not depend on diagnostics availability.
      }
      return result;
    } catch (error) {
      try {
        recordDiagnosticEvent({
          executionId,
          module: 'social.memory',
          operation: `settings.${operation}`,
          status: 'failed',
          errorCode: 'personal_memory_operation_failed',
        });
      } catch {
        // Keep the original store error visible to the trusted renderer.
      }
      throw error;
    }
  };

  const recordUserFollowupIpc = (operation, callback) => {
    const executionId = randomUUID();
    try {
      const result = callback();
      try {
        recordDiagnosticEvent({
          executionId,
          module: 'social.followup',
          operation: `settings.${operation}`,
          status:
            operation === 'cancel' && result === false
              ? 'no_effect'
              : 'completed',
        });
      } catch {
        // Follow-up data changes do not depend on diagnostics availability.
      }
      return result;
    } catch (error) {
      try {
        recordDiagnosticEvent({
          executionId,
          module: 'social.followup',
          operation: `settings.${operation}`,
          status: 'failed',
          errorCode: 'user_followup_operation_failed',
        });
      } catch {
        // Preserve the original store error for the trusted renderer.
      }
      throw error;
    }
  };

  register(CHANNELS.windowsRunnerCapability, () =>
    getWindowsRunnerCapability(),
  );
  register(CHANNELS.setupWindowsRunner, () => setupWindowsRunner());
  register(CHANNELS.executionPermissions, () => getExecutionPermissions());
  register(CHANNELS.setExecutionPermissions, (permissions) =>
    setExecutionPermissions(permissions),
  );

  if (socialChatService) {
    register(CHANNELS.socialState, async () => {
      const state = await socialChatService.getUiState();
      recordSocialReadiness(state.projectWork);
      return {
        ...state,
        projects:
          socialProjectStore?.listProjects({ includeArchived: true }) ?? [],
        teams: socialTeamStore?.listTeams({ includeArchived: true }) ?? [],
      };
    });
    register(CHANNELS.personalMemories, () =>
      recordPersonalMemoryIpc('list', () =>
        socialChatService.store.personalMemories.list(),
      ),
    );
    register(CHANNELS.personalMemoryEnabled, (enabled) =>
      recordPersonalMemoryIpc('enabled', () =>
        socialChatService.store.personalMemories.setEnabled(enabled),
      ),
    );
    register(CHANNELS.addPersonalMemory, (content) =>
      recordPersonalMemoryIpc('add', () =>
        socialChatService.store.personalMemories.add({ content }),
      ),
    );
    register(CHANNELS.updatePersonalMemory, ({ id, content }) =>
      recordPersonalMemoryIpc('update', () =>
        socialChatService.store.personalMemories.update({ id, content }),
      ),
    );
    register(CHANNELS.deletePersonalMemory, (id) =>
      recordPersonalMemoryIpc('delete', () =>
        socialChatService.store.personalMemories.delete(id),
      ),
    );
    register(CHANNELS.userFollowups, () =>
      recordUserFollowupIpc('list', () =>
        socialChatService.store.userFollowups.list(),
      ),
    );
    register(CHANNELS.userFollowupsEnabled, (enabled) => {
      return recordUserFollowupIpc('enabled', () => {
        const result =
          socialChatService.store.userFollowups.setEnabled(enabled);
        if (result) socialChatService.scheduleUserFollowups();
        return result;
      });
    });
    register(CHANNELS.addUserFollowup, (input) => {
      return recordUserFollowupIpc('add', () => {
        const item = socialChatService.store.userFollowups.add(input);
        socialChatService.scheduleUserFollowups();
        return item;
      });
    });
    register(CHANNELS.updateUserFollowup, (input) => {
      return recordUserFollowupIpc('update', () => {
        const item = socialChatService.store.userFollowups.update(input);
        socialChatService.scheduleUserFollowups();
        return item;
      });
    });
    register(CHANNELS.cancelUserFollowup, (id) =>
      recordUserFollowupIpc('cancel', () =>
        socialChatService.store.userFollowups.cancel(id),
      ),
    );
    register(CHANNELS.testArmSocialWorkReverseSnapshot, (roomId, taskId) => {
      if (
        !shouldInjectSocialWorkReverseSnapshot() ||
        typeof roomId !== 'string' ||
        typeof taskId !== 'string'
      )
        return false;
      socialWorkReverseSnapshotProbe = {
        roomId,
        taskId,
        firstRequested: false,
        firstReturned: false,
        secondReturned: false,
      };
      return true;
    });
    register(CHANNELS.testSocialWorkReverseSnapshotStatus, () => {
      if (!shouldInjectSocialWorkReverseSnapshot())
        return {
          firstRequested: false,
          firstReturned: false,
          secondReturned: false,
        };
      return {
        firstRequested: socialWorkReverseSnapshotProbe?.firstRequested === true,
        firstReturned: socialWorkReverseSnapshotProbe?.firstReturned === true,
        secondReturned: socialWorkReverseSnapshotProbe?.secondReturned === true,
      };
    });
    register(CHANNELS.socialRoom, async (roomId, options = { limit: 200 }) => {
      const snapshot = {
        ...socialChatService.store.getRoomSnapshot(roomId, options),
        projectReviews: socialProjectStore?.listReviewsForRoom(roomId) ?? [],
      };
      const probe = socialWorkReverseSnapshotProbe;
      if (
        !shouldInjectSocialWorkReverseSnapshot() ||
        !probe ||
        probe.roomId !== roomId ||
        !snapshot.workTasks?.some((task) => task.id === probe.taskId)
      )
        return snapshot;
      if (!probe.firstRequested) {
        probe.firstRequested = true;
        const stale = structuredClone(snapshot);
        const task = stale.workTasks.find(
          (candidate) => candidate.id === probe.taskId,
        );
        task.status = 'running';
        task.phase = 'model_request';
        await new Promise((resolve) => setTimeout(resolve, 500));
        probe.firstReturned = true;
        return stale;
      }
      if (!probe.secondReturned) probe.secondReturned = true;
      return snapshot;
    });
    register(CHANNELS.socialConversationThreads, (roomId) =>
      socialChatService.store.listConversationThreads(roomId),
    );
    register(CHANNELS.socialContinuityState, (roomId) =>
      socialChatService.store.continuityGetState(roomId),
    );
    register(CHANNELS.socialContinuityBranches, (roomId) =>
      socialChatService.store.continuityListBranches(roomId),
    );
    register(CHANNELS.socialContinuityCreateBranch, (input) =>
      socialChatService.store.continuityCreateBranch(input),
    );
    register(CHANNELS.socialContinuitySwitchBranch, (input) =>
      socialChatService.store.continuitySwitchBranch(input),
    );
    register(CHANNELS.socialContinuityEditBranch, (input) =>
      socialChatService.store.continuityCreateEditBranch(input),
    );
    register(CHANNELS.socialRewindMessage, (roomId, messageId) =>
      socialChatService.rewindConversationToMessage(roomId, messageId),
    );
    register(
      CHANNELS.socialEditAssistantMessage,
      (roomId, messageId, content) =>
        socialChatService.editAssistantMessage(roomId, messageId, content),
    );
    register(CHANNELS.socialLatestArchive, (roomId) =>
      socialChatService.latestConversationArchive(roomId),
    );
    register(CHANNELS.socialRestoreArchive, (archiveId) =>
      socialChatService.restoreConversationArchive(archiveId),
    );
    register(CHANNELS.socialSearchMessages, (query) =>
      socialChatService.store.searchMessages(query),
    );
    register(CHANNELS.socialSearchRoomMessages, (roomId, query) =>
      socialChatService.store.searchRoomMessages(roomId, query),
    );
    register(CHANNELS.socialCreateGroup, (input) => {
      const room = socialChatService.store.createGroup(input);
      socialChatService.emit({
        type: 'chat-room-created',
        roomId: room.room.id,
      });
      return room;
    });
    register(CHANNELS.socialChooseProjectWorkspace, () =>
      chooseProjectWorkspace(),
    );
    register(CHANNELS.socialCreateProject, (input) => {
      if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
      if (
        typeof input?.workspacePath !== 'string' ||
        !input.workspacePath.trim() ||
        input?.workspaceIdentity == null
      ) {
        throw new Error('请选择项目工作文件夹。');
      }
      const project = socialProjectStore.createProject(input);
      socialChatService.emit({
        type: 'chat-room-created',
        roomId: project.groupRoomId,
      });
      return project;
    });
    register(CHANNELS.socialProjectSession, (projectId, agentId) => {
      if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
      return socialProjectStore.getProjectSession(projectId, agentId);
    });
    register(CHANNELS.socialProjectPlan, (projectId) => {
      if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
      return socialProjectStore.plans.get(projectId);
    });
    register(CHANNELS.socialProjectPlanEvidence, (projectId, itemId) => {
      if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
      return socialProjectStore.plans.inspectEvidence(projectId, itemId);
    });
    const planChanged = (plan) => {
      socialChatService.onProjectPlanChanged?.(plan.projectId);
      const project = socialProjectStore.getProject(plan.projectId);
      socialChatService.emit({
        type: 'project-updated',
        projectId: project.id,
        groupRoomId: project.groupRoomId,
      });
      return plan;
    };
    register(
      CHANNELS.socialReopenProjectPlanEvidence,
      ({ projectId, itemId, expectedRevision }) => {
        if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
        return planChanged(
          socialProjectStore.plans.reopenEvidenceImpact({
            projectId,
            itemId,
            expectedRevision,
            actorAgentId: null,
          }),
        );
      },
    );
    register(
      CHANNELS.socialReplaceProjectPlan,
      ({ projectId, expectedRevision, reason, plan }) => {
        if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
        return planChanged(
          socialProjectStore.plans.replace({
            projectId,
            expectedRevision,
            reason,
            plan,
            actorAgentId: null,
          }),
        );
      },
    );
    register(
      CHANNELS.socialUpdateProjectPlanItem,
      ({
        projectId,
        expectedRevision,
        reason,
        itemId,
        status,
        evidence,
        evidenceSources,
        blocker,
      }) => {
        if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
        return planChanged(
          socialProjectStore.plans.updateItem({
            projectId,
            expectedRevision,
            reason,
            itemId,
            status,
            evidence,
            evidenceSources,
            blocker,
            actorAgentId: null,
          }),
        );
      },
    );
    register(
      CHANNELS.socialUpdateProjectPlanPhase,
      ({ projectId, expectedRevision, reason, phaseId, evidence, status }) => {
        if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
        return planChanged(
          socialProjectStore.plans.updatePhase({
            projectId,
            expectedRevision,
            reason,
            phaseId,
            evidence,
            status,
            actorAgentId: null,
          }),
        );
      },
    );
    register(CHANNELS.socialCompleteProject, (projectId) => {
      if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
      return socialChatService.completeProject(projectId);
    });
    register(CHANNELS.socialArchiveProject, (projectId) => {
      if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
      const project = socialProjectStore.archiveProject(projectId);
      socialChatService.emit({
        type: 'project-updated',
        projectId: project.id,
        groupRoomId: project.groupRoomId,
      });
      return project;
    });
    register(CHANNELS.socialRestoreProject, (projectId) => {
      if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
      const project = socialProjectStore.restoreProject(projectId);
      socialChatService.emit({
        type: 'project-updated',
        projectId: project.id,
        groupRoomId: project.groupRoomId,
      });
      return project;
    });
    register(CHANNELS.socialRetryProjectGrowthMember, (batchId, agentId) =>
      socialChatService.retryProjectGrowthMember(batchId, agentId),
    );
    register(CHANNELS.socialCreateContinuationThread, (input) =>
      socialChatService.createContinuationThread(input),
    );
    register(CHANNELS.socialSetContinuationThreadClosed, (roomId, closed) =>
      socialChatService.setContinuationThreadClosed(roomId, closed),
    );
    register(CHANNELS.socialDeleteContinuationThread, (roomId) =>
      socialChatService.deleteContinuationThread(roomId),
    );
    register(CHANNELS.socialCreateAgent, (input) =>
      socialChatService.createAgent(input),
    );
    register(CHANNELS.socialUpdateAgentProfile, (input) =>
      socialChatService.updateAgentProfile(input),
    );
    register(CHANNELS.socialAgentProjectWork, (agentId, enabled) =>
      socialChatService.setAgentProjectWork(agentId, enabled),
    );
    register(CHANNELS.socialAgentArchive, (agentId, archived) =>
      socialChatService.setAgentArchived(agentId, archived),
    );
    register(CHANNELS.socialResetChat, async () => {
      if (!resetChatSession) throw new Error('会话重置尚未就绪。');
      return resetChatSession();
    });
    register(CHANNELS.socialSend, (input) =>
      socialChatService.sendMessage(input),
    );
    register(CHANNELS.socialForward, (input) =>
      socialChatService.forwardMessages(input),
    );
    register(CHANNELS.socialStop, (messageId) =>
      socialChatService.stopReply(messageId),
    );
    register(CHANNELS.socialRetry, (messageId) =>
      socialChatService.retryReply(messageId),
    );
  }
  register(CHANNELS.socialWorkUsage, (taskId) => getWorkTaskUsage(taskId));
  register(CHANNELS.socialWorkStepDetail, (taskId, stepId) =>
    getWorkTaskStepDetail(taskId, stepId),
  );
  register(CHANNELS.socialWorkTouchedFiles, (taskId) =>
    getWorkTaskTouchedFiles(taskId),
  );
  register(CHANNELS.socialWorkExport, (taskId) => exportWorkTicket(taskId));
  register(CHANNELS.socialExport, (roomId) => exportConversation(roomId));
  if (socialWorkService) {
    register(CHANNELS.socialWorkStop, (taskId) =>
      socialWorkService.stopTask(taskId),
    );
    register(CHANNELS.socialWorkResume, (taskId) =>
      socialWorkService.resumeTask(taskId),
    );
    register(CHANNELS.socialWorkContinue, (taskId) =>
      socialWorkService.continueTicket(taskId),
    );
    register(CHANNELS.socialWorkFileChange, (input) =>
      socialWorkService.reviewFileChange(input),
    );
    register(CHANNELS.socialWorkGitReview, (taskId) =>
      socialWorkService.reviewGitState(taskId),
    );
    register(CHANNELS.socialWorkCaseEligible, (taskId, eligible) =>
      socialWorkService.setCaseEligible(taskId, eligible),
    );
    register(CHANNELS.socialPracticeWithdraw, (taskId) =>
      socialWorkService.revokePracticeCandidate(taskId),
    );
  }
  if (workspaceFileService) {
    register(CHANNELS.workspaceFiles, (input) =>
      workspaceFileService.list(input),
    );
    register(CHANNELS.workspaceFile, (input) =>
      workspaceFileService.read(input),
    );
    register(CHANNELS.workspaceSearch, (input) =>
      workspaceFileService.search(input),
    );
    register(CHANNELS.workspaceImage, (input) =>
      workspaceFileService.readImage(input),
    );
    register(CHANNELS.workspaceOpenFolder, (input) =>
      workspaceFileService.openFolder(input),
    );
  }
  if (diagnosticsQueryService) {
    let injectedRecentReadFailure = false;
    let injectedTimelineReadFailure = false;
    register(CHANNELS.diagnosticsRecent, (limit) => {
      if (shouldInjectDiagnosticsReadFailures() && !injectedRecentReadFailure) {
        injectedRecentReadFailure = true;
        throw new Error('e2e_recent_read_failure');
      }
      return diagnosticsQueryService.listRecent(limit);
    });
    register(CHANNELS.diagnosticsDatabaseHealth, () =>
      getDiagnosticsDatabaseHealth(),
    );
    register(CHANNELS.openUserDataDirectory, () => openUserDataDirectory());
    register(CHANNELS.diagnosticsTimeline, (input) => {
      if (
        shouldInjectDiagnosticsReadFailures() &&
        !injectedTimelineReadFailure
      ) {
        injectedTimelineReadFailure = true;
        throw new Error('e2e_timeline_read_failure');
      }
      return diagnosticsQueryService.getTimeline(input);
    });
    register(CHANNELS.diagnosticsExportPreview, (input) =>
      diagnosticsQueryService.getExportPreview(input),
    );
    register(CHANNELS.diagnosticsExportSave, (previewId) =>
      saveDiagnosticsExport(previewId),
    );
  }
  register(CHANNELS.models, () => rootAgent.refreshModels());
  register(CHANNELS.configureProvider, (configuration) =>
    rootAgent.configureProvider(configuration),
  );
  register(CHANNELS.configureWebSearch, (configuration) =>
    rootAgent.configureWebSearch(configuration),
  );
  register(CHANNELS.clearWebSearch, () => rootAgent.clearWebSearch());
  register(CHANNELS.selectModel, (model) => rootAgent.setModel(model));
  register(CHANNELS.markSocialChatReady, () => markSocialChatReady());

  return () => {
    for (const channel of Object.values(CHANNELS)) {
      if (channel !== CHANNELS.modelStateEvent) {
        ipcMain.removeHandler(channel);
      }
    }
  };
}

export { CHANNELS };
