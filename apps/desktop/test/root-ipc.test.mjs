import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHANNELS,
  createImportAwareSendMessage,
  registerRootIpc,
} from '../src/root-ipc.mjs';

function createIpcHarness() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
    },
  };
}

test('registers only named root-agent actions and rejects non-window senders', async () => {
  const harness = createIpcHarness();
  const rootAgent = {
    getUiState: async () => ({ messages: [] }),
    refreshModels: async () => ({ models: [] }),
    configureProvider: async (configuration) => configuration,
    setModel: async (model) => model,
    sendMessage: ({ text }) => ({ turnId: text }),
    retryTurn: ({ turnId }) => ({ turnId }),
    stopTurn: async () => true,
    setWorkspaceDirectory: (directory) => directory,
    clearWorkspaceDirectory: () => null,
    stopBackgroundTask: async () => true,
    resumeBackgroundTask: async (taskId) => ({ accepted: true, taskId }),
    retryBackgroundEvent: async (taskId) => ({
      accepted: true,
      completed: true,
      taskId,
    }),
    listCodexThreads: async () => [],
    previewCodexThread: async (threadId) => ({ threadId }),
    importCodexThread: async (input) => input,
    removeContextImport: () => true,
    updateInteractionAdjustment: async (input) => input,
    withdrawInteractionAdjustment: (id) => id === 'adjustment-1',
  };
  const trustedSender = {};
  const unregister = registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent,
    isTrustedSender: (sender) => sender === trustedSender,
    chooseWorkspace: async () => 'D:\\Scratch',
  });

  assert.deepEqual(
    [...harness.handlers.keys()].sort(),
    [
      CHANNELS.models,
      CHANNELS.configureProvider,
      CHANNELS.retry,
      CHANNELS.selectModel,
      CHANNELS.send,
      CHANNELS.state,
      CHANNELS.stop,
      CHANNELS.chooseWorkspace,
      CHANNELS.clearWorkspace,
      CHANNELS.stopWorker,
      CHANNELS.resumeWorker,
      CHANNELS.retryWorkerEvent,
      CHANNELS.listCodexThreads,
      CHANNELS.previewCodexThread,
      CHANNELS.importCodexThread,
      CHANNELS.removeContextImport,
      CHANNELS.updateInteractionAdjustment,
      CHANNELS.withdrawInteractionAdjustment,
    ].sort(),
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.send)(
      { sender: trustedSender },
      'hello',
    ),
    {
      turnId: 'hello',
    },
  );
  assert.equal(
    await harness.handlers.get(CHANNELS.chooseWorkspace)({
      sender: trustedSender,
    }),
    'D:\\Scratch',
  );
  assert.equal(
    await harness.handlers.get(CHANNELS.clearWorkspace)({
      sender: trustedSender,
    }),
    null,
  );
  assert.equal(
    await harness.handlers.get(CHANNELS.withdrawInteractionAdjustment)(
      { sender: trustedSender },
      'adjustment-1',
    ),
    true,
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.updateInteractionAdjustment)(
      { sender: trustedSender },
      {
        id: 'adjustment-1',
        scope: 'both',
        situation: 'test situation',
        behavior: 'test behavior',
      },
    ),
    {
      id: 'adjustment-1',
      scope: 'both',
      situation: 'test situation',
      behavior: 'test behavior',
    },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.resumeWorker)(
      { sender: trustedSender },
      'task-1',
    ),
    { accepted: true, taskId: 'task-1' },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.retryWorkerEvent)(
      { sender: trustedSender },
      'task-1',
    ),
    { accepted: true, completed: true, taskId: 'task-1' },
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.state)({ sender: {} }),
    /未授权/,
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.updateInteractionAdjustment)(
      { sender: {} },
      {
        id: 'adjustment-1',
        scope: 'both',
        situation: 'unauthorized edit',
        behavior: 'must not be saved',
      },
    ),
    /未授权/,
  );
  unregister();
  assert.equal(harness.handlers.size, 0);
});

test('Codex import sends nothing until transmission consent and remains revocable', async () => {
  let consented = false;
  let sends = 0;
  let prompts = 0;
  const rootAgent = {
    getUnconsentedContextImport: () =>
      consented ? null : { title: '测试会话' },
    consentToContextImportTransmission: () => {
      consented = true;
    },
    sendMessage: ({ text }) => {
      sends += 1;
      return { turnId: text };
    },
  };
  const cancel = createImportAwareSendMessage(rootAgent, async () => {
    prompts += 1;
    return false;
  });
  assert.deepEqual(await cancel('不应发送'), { canceled: true });
  assert.equal(sends, 0);
  assert.equal(consented, false);

  const approve = createImportAwareSendMessage(rootAgent, async (snapshot) => {
    prompts += 1;
    assert.equal(snapshot.title, '测试会话');
    return true;
  });
  assert.deepEqual(await approve('允许发送'), { turnId: '允许发送' });
  assert.equal(consented, true);
  assert.equal(sends, 1);

  assert.deepEqual(await approve('之后继续'), { turnId: '之后继续' });
  assert.equal(prompts, 2);
  assert.equal(sends, 2);
});
