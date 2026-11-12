import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_HISTORY_ARCHIVE_CHANNELS,
  registerLegacyHistoryArchiveIpc,
} from '../../../src/main/ipc/legacy-history-archive-ipc.mjs';

function createIpcHarness() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: {
      handle: (channel, handler) =>
        handlers.set(channel, async (event, ...args) => {
          event.sender.mainFrame ??= { parent: null };
          return handler(
            {
              ...event,
              senderFrame: event.senderFrame ?? event.sender.mainFrame,
            },
            ...args,
          );
        }),
      removeHandler: (channel) => handlers.delete(channel),
    },
  };
}

test('legacy archive IPC exposes only fixed read operations to the trusted main frame', async () => {
  const harness = createIpcHarness();
  const trustedSender = {};
  const calls = [];
  const archiveService = {
    listCategories: () => [{ id: 'root-turns', count: 1 }],
    getExportPreview: (input) => {
      calls.push(['preview', input]);
      return { previewId: 'archive-preview' };
    },
    listPage: (input) => {
      calls.push(input);
      return { category: input.category, records: [], status: 'available' };
    },
  };
  let saveCalls = 0;
  const unregister = registerLegacyHistoryArchiveIpc({
    ipcMain: harness.ipcMain,
    archiveService,
    saveExport: async (previewId) => {
      saveCalls += 1;
      return { saved: true, previewId };
    },
    isTrustedSender: (sender) => sender === trustedSender,
  });
  const event = { sender: trustedSender };

  assert.deepEqual(
    await harness.handlers.get(LEGACY_HISTORY_ARCHIVE_CHANNELS.categories)(
      event,
    ),
    [{ id: 'root-turns', count: 1 }],
  );
  const pageRequest = {
    category: 'root-turns',
    cursor: 12,
    limit: 5,
  };
  assert.deepEqual(
    await harness.handlers.get(LEGACY_HISTORY_ARCHIVE_CHANNELS.page)(
      event,
      pageRequest,
    ),
    { category: 'root-turns', records: [], status: 'available' },
  );
  assert.deepEqual(calls, [pageRequest]);
  assert.deepEqual(
    await harness.handlers.get(LEGACY_HISTORY_ARCHIVE_CHANNELS.exportPreview)(
      event,
      { categories: ['root-turns'] },
    ),
    { previewId: 'archive-preview' },
  );
  assert.deepEqual(
    await harness.handlers.get(LEGACY_HISTORY_ARCHIVE_CHANNELS.exportSave)(
      event,
      'archive-preview',
    ),
    { saved: true, previewId: 'archive-preview' },
  );
  assert.equal(saveCalls, 1);
  await assert.rejects(
    harness.handlers.get(LEGACY_HISTORY_ARCHIVE_CHANNELS.page)(
      { sender: {} },
      pageRequest,
    ),
    /未授权/,
  );
  await assert.rejects(
    harness.handlers.get(LEGACY_HISTORY_ARCHIVE_CHANNELS.exportSave)(
      { sender: {} },
      'must-not-save',
    ),
    /未授权/,
  );
  await assert.rejects(
    harness.handlers.get(LEGACY_HISTORY_ARCHIVE_CHANNELS.page)(
      {
        sender: trustedSender,
        senderFrame: { parent: {} },
      },
      pageRequest,
    ),
    /未授权/,
  );
  assert.equal(saveCalls, 1);
  unregister();
  assert.equal(harness.handlers.size, 0);
});
