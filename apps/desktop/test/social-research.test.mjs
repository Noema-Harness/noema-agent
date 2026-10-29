import { createSocialTestStore } from '../test-support/social-team.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatService } from '../src/social-chat-service.mjs';
import { SocialProjectStore } from '../src/social-project-store.mjs';
test('authorized project research reads public pages and keeps source links in the shared report', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const projectStore = new SocialProjectStore({ db, socialChatStore: store });
  const researcher = store.createAgent({
    name: '行业研究员',
    headline: '公开资料研究',
    description: '通过外部资料和来源形成判断。',
  });
  const sourceTurn = store.beginTurn({
    roomId: 'room-noema',
    agentId: 'noema',
    text: '请组队研究公开资料，核查当前行业报告和来源。',
    model: 'test-model',
  });
  store.appendAssistantDelta(sourceTurn.assistantMessageId, '我来安排研究。');
  store.completeReply(sourceTurn.assistantMessageId);
  const project = projectStore.createProject({
    title: '行业现状研究',
    brief: '核查当前行业报告和来源。',
    sourceMessageId: sourceTurn.userMessageId,
    agentIds: ['noema', researcher.members[0].id],
  });
  const requests = [];
  const searchCalls = [];
  const service = new SocialChatService({
    store,
    provider: {
      async *streamChat(input) {
        requests.push(input);
        if (requests.length === 1) {
          assert.ok(
            input.tools.some(
              (tool) => tool.function.name === 'research_public_sources',
            ),
          );
          input.onToolCalls?.([
            {
              id: 'research-call',
              type: 'function',
              function: {
                name: 'research_public_sources',
                arguments: JSON.stringify({ query: '核查当前行业报告' }),
              },
            },
          ]);
          return;
        }
        const toolResult = input.messages.find(
          (message) => message.role === 'tool',
        );
        assert.match(toolResult.content, /权威报告正文/);
        yield '本轮找到一份可读取的行业报告，结论仍需结合其他材料判断。';
      },
    },
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
    projectStore,
    getProjectSessionContext: (roomId, agentId) =>
      projectStore.getProjectSessionContext(roomId, agentId),
    isWebSearchConfigured: () => true,
    searchPublicSources: async (query, signal, maxSources) => {
      searchCalls.push({ query, signal, maxSources });
      return {
        fetchedAt: '2026-10-30T00:00:00.000Z',
        totalCandidates: 1,
        results: [
          {
            status: 'read',
            candidate: {
              title: '行业报告候选',
              url: 'https://research.example/report',
            },
            source: {
              id: 's1',
              title: '权威报告',
              url: 'https://research.example/report',
              fetchedAt: '2026-10-30T00:00:00.000Z',
            },
            content: '权威报告正文',
          },
        ],
      };
    },
  });

  try {
    service.sendMessage({
      roomId: project.groupRoomId,
      agentId: researcher.members[0].id,
      text: '@行业研究员 请核查当前行业报告并查找公开来源。',
    });
    await service.active.get(project.groupRoomId)?.done;

    assert.equal(searchCalls.length, 1);
    assert.equal(searchCalls[0].query, '核查当前行业报告');
    assert.equal(searchCalls[0].signal instanceof AbortSignal, true);
    assert.equal(searchCalls[0].maxSources, 3);
    const publicReport = store
      .getRoomSnapshot(project.groupRoomId)
      .messages.find(
        (message) =>
          message.role === 'assistant' &&
          message.content.includes('本轮找到一份可读取的行业报告'),
      );
    assert.match(publicReport.content, /已读取来源/u);
    assert.match(
      publicReport.content,
      /\[权威报告\]\(https:\/\/research\.example\/report\)/u,
    );
    assert.equal(publicReport.status, 'complete');
  } finally {
    await service.shutdown();
    db.close();
  }
});
