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
    setModel: async (model) => model,
    sendMessage: ({ text }) => ({ turnId: text }),
    retryTurn: ({ turnId }) => ({ turnId }),
    stopTurn: async () => true,
  };
  const trustedSender = {};
  const unregister = registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent,
    isTrustedSender: (sender) => sender === trustedSender,
  });

  assert.deepEqual(
    [...harness.handlers.keys()].sort(),
    [
      CHANNELS.models,
      CHANNELS.retry,
      CHANNELS.selectModel,
      CHANNELS.send,
      CHANNELS.state,
      CHANNELS.stop,
    ].sort(),
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.send)(
      { sender: trustedSender },
      'hello',
    ),
    { turnId: 'hello' },
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.state)({ sender: {} }),
    /未授权/,
  );
  unregister();
  assert.equal(harness.handlers.size, 0);
});
