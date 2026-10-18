const CHANNELS = Object.freeze({
  state: 'noema:root-state',
  models: 'noema:refresh-models',
  configureProvider: 'noema:configure-provider',
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
  updateInteractionAdjustment: 'noema:update-interaction-adjustment',
  withdrawInteractionAdjustment: 'noema:withdraw-interaction-adjustment',
  quickCaptureRequest: 'noema:quick-capture-request',
  quickCaptureShortcutStatus: 'noema:quick-capture-shortcut-status',
  markQuickCaptureReady: 'noema:mark-quick-capture-ready',
  finishQuickCapture: 'noema:finish-quick-capture',
  event: 'noema:root-event',
  socialEvent: 'noema:social-event',
  socialState: 'noema:social-state',
  socialRoom: 'noema:social-room',
  socialCreateGroup: 'noema:social-create-group',
  socialCreateAgent: 'noema:social-create-agent',
  socialAgentProjectWork: 'noema:social-agent-project-work',
  socialAgentArchive: 'noema:social-agent-archive',
  socialSend: 'noema:social-send',
  socialForward: 'noema:social-forward',
  socialStop: 'noema:social-stop',
  socialRetry: 'noema:social-retry',
  socialWorkStart: 'noema:social-work-start',
  socialWorkStop: 'noema:social-work-stop',
  socialWorkCaseEligible: 'noema:social-work-case-eligible',
});

/**
 * Registers only the narrow root-conversation operations that the renderer needs.
 * @param {{ipcMain: {handle: Function, removeHandler: Function}, rootAgent: object, socialChatService?:object, socialWorkService?:object, isTrustedSender: (sender: object) => boolean,chooseWorkspace?:()=>Promise<string|null>,sendMessage?:(text:string)=>Promise<object>|object,retryTurn?:(turnId:string,model:string|null)=>Promise<object>|object,finishQuickCapture?:()=>boolean,getQuickCaptureShortcutStatus?:()=>object|null,markQuickCaptureReady?:()=>boolean}} options
 */
export function registerRootIpc({
  ipcMain,
  rootAgent,
  socialChatService = null,
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
    register(CHANNELS.socialState, () => socialChatService.getUiState());
    register(CHANNELS.socialRoom, (roomId) =>
      socialChatService.store.getRoomSnapshot(roomId),
    );
    register(CHANNELS.socialCreateGroup, (input) => {
      const room = socialChatService.store.createGroup(input);
      socialChatService.emit({
        type: 'chat-room-created',
        roomId: room.room.id,
      });
      return room;
    });
    register(CHANNELS.socialCreateAgent, (input) =>
      socialChatService.createAgent(input),
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
    register(CHANNELS.socialWorkStart, (input) =>
      socialWorkService.startTask(input),
    );
    register(CHANNELS.socialWorkStop, (taskId) =>
      socialWorkService.stopTask(taskId),
    );
    register(CHANNELS.socialWorkCaseEligible, (taskId, eligible) =>
      socialWorkService.setCaseEligible(taskId, eligible),
    );
  }
  register(CHANNELS.models, () => rootAgent.refreshModels());
  register(CHANNELS.configureProvider, (configuration) =>
    rootAgent.configureProvider(configuration),
  );
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
