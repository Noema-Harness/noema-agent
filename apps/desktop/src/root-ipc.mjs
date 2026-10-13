const CHANNELS = Object.freeze({
  state: 'noema:root-state',
  models: 'noema:refresh-models',
  configureProvider: 'noema:configure-provider',
  selectModel: 'noema:select-model',
  send: 'noema:send-message',
  retry: 'noema:retry-turn',
  stop: 'noema:stop-turn',
  chooseWorkspace: 'noema:choose-workspace',
  clearWorkspace: 'noema:clear-workspace',
  stopWorker: 'noema:stop-background-task',
  resumeWorker: 'noema:resume-background-task',
  listCodexThreads: 'noema:list-codex-threads',
  previewCodexThread: 'noema:preview-codex-thread',
  importCodexThread: 'noema:import-codex-thread',
  removeContextImport: 'noema:remove-context-import',
  event: 'noema:root-event',
});

/**
 * Registers only the narrow root-conversation operations that the renderer needs.
 * @param {{ipcMain: {handle: Function, removeHandler: Function}, rootAgent: object, isTrustedSender: (sender: object) => boolean,chooseWorkspace?:()=>Promise<string|null>,sendMessage?:(text:string)=>Promise<object>|object}} options
 */
export function registerRootIpc({
  ipcMain,
  rootAgent,
  isTrustedSender,
  chooseWorkspace = async () => null,
  sendMessage = (text) => rootAgent.sendMessage({ text }),
}) {
  const register = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event.sender))
        throw new Error('未授权的应用窗口请求');
      return handler(...args);
    });
  };

  register(CHANNELS.state, () => rootAgent.getUiState());
  register(CHANNELS.models, () => rootAgent.refreshModels());
  register(CHANNELS.configureProvider, (configuration) =>
    rootAgent.configureProvider(configuration),
  );
  register(CHANNELS.selectModel, (model) => rootAgent.setModel(model));
  register(CHANNELS.send, (text) => sendMessage(text));
  register(CHANNELS.retry, (turnId, model) =>
    rootAgent.retryTurn({ turnId, model }),
  );
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

  return () => {
    for (const channel of Object.values(CHANNELS)) {
      if (channel !== CHANNELS.event) ipcMain.removeHandler(channel);
    }
  };
}

/**
 * Requires explicit transmission consent before a selected external snapshot
 * can enter any FreeLLMAPI-backed root turn.
 * @param {object} rootAgent
 * @param {(snapshot:{title:string})=>Promise<boolean>} confirmTransmission
 */
export function createImportAwareSendMessage(rootAgent, confirmTransmission) {
  return async (text) => {
    const imported = rootAgent.getUnconsentedContextImport();
    if (imported) {
      if (!(await confirmTransmission(imported))) return { canceled: true };
      rootAgent.consentToContextImportTransmission();
    }
    return rootAgent.sendMessage({ text });
  };
}

export { CHANNELS };
