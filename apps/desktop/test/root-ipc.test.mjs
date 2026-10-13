import assert from 'node:assert/strict';
import test from 'node:test';
import { CHANNELS, registerRootIpc } from '../src/root-ipc.mjs';

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
    ].sort(),
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.send)(
      { sender: trustedSender },
      'hello',
    ),
    { turnId: 'hello' },
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
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.resumeWorker)(
      { sender: trustedSender },
      'task-1',
    ),
    { accepted: true, taskId: 'task-1' },
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.state)({ sender: {} }),
    /未授权/,
  );
  unregister();
  assert.equal(harness.handlers.size, 0);
});
