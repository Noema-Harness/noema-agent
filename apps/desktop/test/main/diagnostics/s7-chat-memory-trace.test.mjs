import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SocialChatService } from '../../../src/main/chat/social-chat-service.mjs';
import { DiagnosticsQueryService } from '../../../src/main/diagnostics/diagnostics-query-service.mjs';
import { DiagnosticsEventStore } from '../../../src/main/storage/diagnostics-event-store.mjs';
import { ModelUsageStore } from '../../../src/main/storage/model-usage-store.mjs';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { createSocialTestStore } from '../../../test-support/social-team.mjs';

test('ordinary chat and memory keep one queryable identity without exporting content', async () => {
  const memoryBody = 'PRIVATE_S7_MEMORY_BODY_SENTINEL';
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const eventStore = new DiagnosticsEventStore(db);
  const modelUsageStore = new ModelUsageStore(db);
  const query = new DiagnosticsQueryService({
    eventStore,
    modelUsageStore,
    socialChatStore: store,
  });
  let requestCount = 0;
  const service = new SocialChatService({
    store,
    provider: {
      async *streamChat(input) {
        requestCount += 1;
        if (requestCount === 1) {
          input.onToolCalls?.([
            {
              id: 's7-memory-save',
              type: 'function',
              function: {
                name: 'manage_personal_memory',
                arguments: JSON.stringify({
                  operation: 'save',
                  content: memoryBody,
                }),
              },
            },
          ]);
          return;
        }
        yield '已记住。';
      },
    },
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
    recordDiagnosticEvent: (event) =>
      eventStore.record({ applicationExecutionId: 'app-s7', ...event }),
  });

  try {
    const sent = service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: `请记住：${memoryBody}`,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-noema')?.done;

    const saved = store.personalMemories.list().items[0];
    assert.ok(saved?.id);
    const timeline = query.getTimeline({ executionId: sent.turnId });
    const chatEvents = timeline.events.filter(
      (event) =>
        event.module === 'social.chat' && event.operation.startsWith('reply.'),
    );
    assert.deepEqual(
      chatEvents.map((event) => event.operation),
      ['reply.started', 'reply.completed'],
    );
    assert.equal(chatEvents[0].details.assistantMessageId, sent.messageId);
    assert.equal(chatEvents[0].details.roomId, 'room-noema');
    assert.equal(chatEvents[0].details.memberAgentId, 'noema');
    const memoryEvent = timeline.events.find(
      (event) =>
        event.module === 'social.memory' && event.operation === 'memory.save',
    );
    assert.equal(memoryEvent?.details.itemId, saved.id);

    const preview = query.getExportPreview({ executionId: sent.turnId });
    assert.match(preview.reportJson, new RegExp(sent.messageId, 'u'));
    assert.match(preview.reportJson, new RegExp(saved.id, 'u'));
    assert.doesNotMatch(preview.reportJson, new RegExp(memoryBody, 'u'));
    assert.ok(
      preview.coverageGaps.includes('business_store_row_writes_not_recorded'),
    );
  } finally {
    await service.shutdown();
    db.close();
  }
});
