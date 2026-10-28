const CHANNELS = Object.freeze({
  state: 'noema:root-state',
  models: 'noema:refresh-models',
  configureProvider: 'noema:configure-provider',
  configureWebSearch: 'noema:configure-web-search',
  clearWebSearch: 'noema:clear-web-search',
  selectModel: 'noema:select-model',
  send: 'noema:send-message',
  saveCapture: 'noema:save-capture',
  updateCapture: 'noema:update-capture',
  deleteCapture: 'noema:delete-capture',
  discussCapture: 'noema:discuss-capture',
  retry: 'noema:retry-turn',
  stop: 'noema:stop-turn',
  chooseWorkspace: 'noema:choose-workspace',
  clearWorkspace: 'noema:clear-workspace',
  stopWorker: 'noema:stop-background-task',
  resumeWorker: 'noema:resume-background-task',
  retryWorkerEvent: 'noema:retry-worker-event',
  listCodexThreads: 'noema:list-codex-threads',
  previewCodexThread: 'noema:preview-codex-thread',
  importCodexThread: 'noema:import-codex-thread',
  removeContextImport: 'noema:remove-context-import',
  addSocialInteractionAdjustment: 'noema:add-social-interaction-adjustment',
  updateInteractionAdjustment: 'noema:update-interaction-adjustment',
  withdrawInteractionAdjustment: 'noema:withdraw-interaction-adjustment',
  quickCaptureRequest: 'noema:quick-capture-request',
  quickCaptureShortcutStatus: 'noema:quick-capture-shortcut-status',
  markQuickCaptureReady: 'noema:mark-quick-capture-ready',
  finishQuickCapture: 'noema:finish-quick-capture',
  event: 'noema:root-event',
  socialEvent: 'noema:social-event',
  socialState: 'noema:social-state',
  firstMeetingProgress: 'noema:first-meeting-progress',
  socialRoom: 'noema:social-room',
  socialSearchMessages: 'noema:social-search-messages',
  socialCreateGroup: 'noema:social-create-group',
  socialCreateProject: 'noema:social-create-project',
  socialProjectSession: 'noema:social-project-session',
  socialProjectPlan: 'noema:social-project-plan',
  socialProjectPlanEvidence: 'noema:social-project-plan-evidence',
  socialReplaceProjectPlan: 'noema:social-replace-project-plan',
  socialUpdateProjectPlanItem: 'noema:social-update-project-plan-item',
  socialUpdateProjectPlanPhase: 'noema:social-update-project-plan-phase',
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
  socialSend: 'noema:social-send',
  socialForward: 'noema:social-forward',
  socialStop: 'noema:social-stop',
  socialRetry: 'noema:social-retry',
  socialWorkStop: 'noema:social-work-stop',
  socialWorkResume: 'noema:social-work-resume',
  socialWorkCaseEligible: 'noema:social-work-case-eligible',
  socialPracticeWithdraw: 'noema:social-practice-withdraw',
});

/**
 * Registers only the narrow root-conversation operations that the renderer needs.
 * @param {{ipcMain: {handle: Function, removeHandler: Function}, rootAgent: object, socialChatService?:object, socialProjectStore?:object, socialWorkService?:object, isTrustedSender: (sender: object) => boolean,chooseWorkspace?:()=>Promise<string|null>,sendMessage?:(text:string)=>Promise<object>|object,retryTurn?:(turnId:string,model:string|null)=>Promise<object>|object,finishQuickCapture?:()=>boolean,getQuickCaptureShortcutStatus?:()=>object|null,markQuickCaptureReady?:()=>boolean}} options
 */
export function registerRootIpc({
  ipcMain,
  rootAgent,
  socialChatService = null,
  socialProjectStore = null,
  socialWorkService = null,
  isTrustedSender,
  chooseWorkspace = async () => null,
  sendMessage = (text) => rootAgent.sendMessage({ text }),
  retryTurn = (turnId, model) => rootAgent.retryTurn({ turnId, model }),
  finishQuickCapture = () => false,
  getQuickCaptureShortcutStatus = () => null,
  markQuickCaptureReady = () => false,
}) {
  const register = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event.sender))
        throw new Error('未授权的应用窗口请求');
      return handler(...args);
    });
  };

  register(CHANNELS.state, () => rootAgent.getUiState());
  if (socialChatService) {
    register(CHANNELS.firstMeetingProgress, (action) =>
      socialChatService.store.advanceFirstMeeting(action),
    );
    register(CHANNELS.socialState, async () => ({
      ...(await socialChatService.getUiState()),
      projects:
        socialProjectStore?.listProjects({ includeArchived: true }) ?? [],
    }));
    register(CHANNELS.socialRoom, (roomId) => ({
      ...socialChatService.store.getRoomSnapshot(roomId),
      projectReviews: socialProjectStore?.listReviewsForRoom(roomId) ?? [],
    }));
    register(CHANNELS.socialSearchMessages, (query) =>
      socialChatService.store.searchMessages(query),
    );
    register(CHANNELS.socialCreateGroup, (input) => {
      const room = socialChatService.store.createGroup(input);
      socialChatService.emit({
        type: 'chat-room-created',
        roomId: room.room.id,
      });
      return room;
    });
    register(CHANNELS.socialCreateProject, (input) => {
      if (!socialProjectStore) throw new Error('项目存储尚未初始化。');
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
  if (socialWorkService) {
    register(CHANNELS.socialWorkStop, (taskId) =>
      socialWorkService.stopTask(taskId),
    );
    register(CHANNELS.socialWorkResume, (taskId) =>
      socialWorkService.resumeTask(taskId),
    );
    register(CHANNELS.socialWorkCaseEligible, (taskId, eligible) =>
      socialWorkService.setCaseEligible(taskId, eligible),
    );
    register(CHANNELS.socialPracticeWithdraw, (taskId) =>
      socialWorkService.revokePracticeCandidate(taskId),
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
  register(CHANNELS.send, (text) => sendMessage(text));
  register(CHANNELS.saveCapture, (text) => rootAgent.saveCapture(text));
  register(CHANNELS.updateCapture, (id, text) =>
    rootAgent.updateCapture(id, text),
  );
  register(CHANNELS.deleteCapture, (id) => rootAgent.deleteCapture(id));
  register(CHANNELS.discussCapture, (id) => rootAgent.discussCapture(id));
  register(CHANNELS.retry, (turnId, model) => retryTurn(turnId, model));
  register(CHANNELS.stop, (turnId) => rootAgent.stopTurn(turnId));
  register(CHANNELS.chooseWorkspace, async () => {
    const directory = await chooseWorkspace();
    return directory ? rootAgent.setWorkspaceDirectory(directory) : null;
  });
  register(CHANNELS.stopWorker, (taskId) =>
    rootAgent.stopBackgroundTask(taskId),
  );
  register(CHANNELS.resumeWorker, (taskId) =>
    rootAgent.resumeBackgroundTask(taskId),
  );
  register(CHANNELS.retryWorkerEvent, (taskId) =>
    rootAgent.retryBackgroundEvent(taskId),
  );
  register(CHANNELS.clearWorkspace, () => rootAgent.clearWorkspaceDirectory());
  register(CHANNELS.listCodexThreads, (cursor) =>
    rootAgent.listCodexThreads(cursor ?? null),
  );
  register(CHANNELS.previewCodexThread, (threadId) =>
    rootAgent.previewCodexThread(threadId),
  );
  register(CHANNELS.importCodexThread, (input) =>
    rootAgent.importCodexThread(input),
  );
  register(CHANNELS.removeContextImport, () => rootAgent.removeContextImport());
  register(CHANNELS.addSocialInteractionAdjustment, (input) =>
    rootAgent.addSocialInteractionAdjustment(input),
  );
  register(CHANNELS.updateInteractionAdjustment, (input) =>
    rootAgent.updateInteractionAdjustment(input),
  );
  register(CHANNELS.withdrawInteractionAdjustment, (id) =>
    rootAgent.withdrawInteractionAdjustment(id),
  );
  register(CHANNELS.finishQuickCapture, () => finishQuickCapture());
  register(CHANNELS.quickCaptureShortcutStatus, () =>
    getQuickCaptureShortcutStatus(),
  );
  register(CHANNELS.markQuickCaptureReady, () => markQuickCaptureReady());

  return () => {
    for (const channel of Object.values(CHANNELS)) {
      if (
        channel !== CHANNELS.event &&
        channel !== CHANNELS.quickCaptureRequest
      ) {
        ipcMain.removeHandler(channel);
      }
    }
  };
}

/**
 * Requires explicit transmission consent before a selected external snapshot
 * can enter any FreeLLMAPI-backed root turn.
 * @param {object} rootAgent
 * @param {(snapshot:{title:string})=>Promise<boolean>} confirmTransmission
 */
export function createImportAwareAction(rootAgent, confirmTransmission) {
  return async (action) => {
    const imported = rootAgent.getUnconsentedContextImport();
    if (imported) {
      if (!(await confirmTransmission(imported))) return { canceled: true };
      rootAgent.consentToContextImportTransmission();
    }
    return action();
  };
}

/**
 * @param {object} rootAgent
 * @param {(snapshot:{title:string})=>Promise<boolean>} confirmTransmission
 * @returns {(text:string)=>Promise<object>|object}
 */
export function createImportAwareSendMessage(rootAgent, confirmTransmission) {
  const runWithConsent = createImportAwareAction(
    rootAgent,
    confirmTransmission,
  );
  return (text) => runWithConsent(() => rootAgent.sendMessage({ text }));
}

export { CHANNELS };
