import { createSocialTestStore } from '../../../test-support/social-team.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { SocialChatService } from '../../../src/main/chat/social-chat-service.mjs';

function createService({ ensureAgentWorkspace }) {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const service = new SocialChatService({
    store,
    provider: { async *streamChat() {} },
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
      providerConfigured: true,
    }),
    ensureAgentWorkspace,
  });
  return { db, service };
}

test('creating a contact prepares the new agent workspace', async () => {
  const calls = [];
  const { db, service } = createService({
    ensureAgentWorkspace: (input) => calls.push(input),
  });
  try {
    const created = service.createAgent({
      name: '测试成员',
      headline: '核对交付证据',
      description: '按清单逐项核对并给出结论。',
      projectWork: false,
    });
    const agent = created.members[0];
    assert.equal(agent.kind, 'specialist');
    assert.deepEqual(calls, [{ agentId: agent.id, name: '测试成员' }]);
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('a failing workspace preparation does not block contact creation', async () => {
  const { db, service } = createService({
    ensureAgentWorkspace: () => {
      throw new Error('disk full');
    },
  });
  try {
    const created = service.createAgent({
      name: '测试成员',
      headline: '核对交付证据',
      description: '按清单逐项核对并给出结论。',
      projectWork: false,
    });
    assert.equal(created.members[0].name, '测试成员');
  } finally {
    await service.shutdown();
    db.close();
  }
});
