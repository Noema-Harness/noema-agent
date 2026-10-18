import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatService } from '../src/social-chat-service.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';

test('social chat sends only the selected room transcript and persists the real streamed response', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = new SocialChatStore(db);
  const seenRequests = [];
  const events = [];
  const provider = {
    async *streamChat(input) {
      seenRequests.push(input);
      yield '从当前房间';
      yield '继续。';
    },
  };
  const service = new SocialChatService({
    store,
    provider,
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
    emit: (event) => events.push(event),
  });

  try {
    const privateTurn = service.sendMessage({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '仅私聊内容标记：黑麦',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-engineering-partner')?.done;

    assert.equal(seenRequests.length, 1);
    assert.equal(seenRequests[0].messages[0].role, 'system');
    assert.equal(
      seenRequests[0].messages[0].content.includes('工程搭档'),
      true,
    );
    assert.equal(
      seenRequests[0].messages.some((message) =>
        message.content.includes('黑麦'),
      ),
      true,
    );

    service.sendMessage({
      roomId: 'room-engineering-collaboration',
      agentId: 'engineering-partner',
      text: '群聊中的新问题。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-engineering-collaboration')?.done;

    assert.equal(seenRequests.length, 2);
    assert.equal(
      seenRequests[1].messages.some((message) =>
        message.content.includes('黑麦'),
      ),
      false,
    );
    const room = store.getRoomSnapshot('room-engineering-partner');
    const assistant = room.messages.find(
      (message) => message.id === privateTurn.messageId,
    );
    assert.equal(assistant?.content, '从当前房间继续。');
    assert.equal(assistant?.status, 'complete');
    assert.equal(
      events.some((event) => event.type === 'chat-message-delta'),
      true,
    );
    assert.equal(events.at(-1)?.type, 'chat-state-updated');
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('a user-created specialist receives only messages explicitly forwarded into the target room', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = new SocialChatStore(db);
  const created = store.createAgent({
    name: '游戏工程观察员',
    headline: '长期研究游戏项目结构与迭代验证',
    description: '先厘清目标，再用小步验证。',
  });
  const agentId = created.members[0].id;
  const group = store.createGroup({
    title: '游戏项目讨论',
    agentIds: ['noema', agentId],
  });
  const seenRequests = [];
  let providerReady = true;
  const provider = {
    async *streamChat(input) {
      seenRequests.push(input);
      yield '基于当前房间回应。';
    },
  };
  const service = new SocialChatService({
    store,
    provider,
    secretStore: { isConfigured: () => providerReady },
    getSelectedModel: () => (providerReady ? 'test-model' : null),
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
  });

  try {
    service.sendMessage({
      roomId: created.room.id,
      agentId,
      text: '仅私聊的观察标记：月桂。以后关于 OpenAI 官方发布更新请优先看一手来源。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get(created.room.id)?.done;
    const sourceMessage = store
      .getRoomSnapshot(created.room.id)
      .messages.find(
        (message) =>
          message.role === 'user' && message.content.includes('月桂'),
      );
    assert.ok(sourceMessage);
    const unrelatedTurn = store.beginTurn({
      roomId: created.room.id,
      agentId,
      text: '只在私聊中提到的无关标记：紫水晶',
      model: 'test-model',
    });
    store.appendAssistantDelta(
      unrelatedTurn.assistantMessageId,
      '这条无关内容不应随引用带入。',
    );
    store.completeReply(unrelatedTurn.assistantMessageId);
    providerReady = false;
    const forwardResult = service.forwardMessages({
      targetRoomId: group.room.id,
      sourceRoomId: created.room.id,
      sourceIds: [sourceMessage.id],
    });
    assert.equal(forwardResult.roomId, group.room.id);
    assert.equal(seenRequests.length, 1, 'forwarding must not call the model');
    const forwardedOnly = store
      .getRoomSnapshot(group.room.id)
      .messages.find((message) => message.id === forwardResult.messageId);
    assert.equal(forwardedOnly?.forwardedSources.length, 1);
    assert.equal(
      store
        .getRoomSnapshot(group.room.id)
        .messages.some(
          (message) =>
            message.turnId === forwardedOnly?.turnId &&
            message.role === 'assistant',
        ),
      false,
    );
    assert.match(
      store.getSnapshot().rooms.find((room) => room.id === group.room.id)
        ?.preview?.text ?? '',
      /转发了 1 条来自/u,
    );

    providerReady = true;
    service.sendMessage({
      roomId: group.room.id,
      agentId,
      text: '你怎么看这条记录？',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get(group.room.id)?.done;

    assert.equal(seenRequests.length, 2);
    for (const request of seenRequests) {
      assert.equal(request.messages[0].role, 'system');
      assert.match(request.messages[0].content, /游戏工程观察员/u);
      assert.match(
        request.messages[0].content,
        /长期研究游戏项目结构与迭代验证/u,
      );
      assert.match(request.messages[0].content, /先厘清目标，再用小步验证/u);
    }
    assert.equal(
      seenRequests[1].messages.some((message) =>
        message.content.includes('月桂'),
      ),
      true,
    );
    assert.equal(
      seenRequests[1].messages.some((message) =>
        message.content.includes('紫水晶'),
      ),
      false,
    );
    const forwardedMessage = seenRequests[1].messages.find((message) =>
      message.content.includes('用户转发的聊天消息'),
    );
    assert.match(forwardedMessage?.content ?? '', /来自「游戏工程观察员」/u);
    assert.equal(
      group.members.find((member) => member.id === agentId)?.id,
      agentId,
    );
    const savedGroupUser = store
      .getRoomSnapshot(group.room.id)
      .messages.find((message) => message.role === 'user');
    assert.equal(savedGroupUser?.forwardedSources.length, 1);
    assert.equal(savedGroupUser?.forwardedSources[0].id, sourceMessage.id);
    const reopenedStoreSnapshot = new SocialChatStore(db).getRoomSnapshot(
      group.room.id,
    );
    const reopenedUser = reopenedStoreSnapshot.messages.find(
      (message) => message.id === savedGroupUser.id,
    );
    assert.deepEqual(reopenedUser?.forwardedSources, [
      savedGroupUser.forwardedSources[0],
    ]);

    service.sendMessage({
      roomId: group.room.id,
      agentId,
      text: '请回复这条转发记录。',
      replyToMessageId: savedGroupUser.id,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get(group.room.id)?.done;
    assert.equal(seenRequests.length, 3);
    assert.match(
      seenRequests[2].messages.at(-1)?.content ?? '',
      /回复当前聊天中的你消息/u,
    );
    assert.match(
      seenRequests[2].messages.at(-1)?.content ?? '',
      /OpenAI 官方发布更新/u,
    );
    const replyUser = store
      .getRoomSnapshot(group.room.id)
      .messages.toReversed()
      .find(
        (message) =>
          message.role === 'user' &&
          message.id !== savedGroupUser.id &&
          message.replyTo?.id === savedGroupUser.id,
      );
    assert.equal(replyUser?.replyTo?.id, savedGroupUser.id);
    assert.throws(
      () =>
        service.sendMessage({
          roomId: created.room.id,
          agentId,
          text: '不能跨房间回复',
          replyToMessageId: savedGroupUser.id,
        }),
      /当前聊天/u,
    );
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('stop signal interrupts a live room reply and preserves partial text', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = new SocialChatStore(db);
  let release;
  const events = [];
  const provider = {
    async *streamChat({ signal }) {
      yield '部分文字';
      await new Promise((resolve, reject) => {
        release = resolve;
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          {
            once: true,
          },
        );
      });
    },
  };
  const service = new SocialChatService({
    store,
    provider,
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({}),
    emit: (event) => events.push(event),
  });

  try {
    const turn = service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '停止测试',
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(service.stopReply(turn.messageId), true);
    await service.active.get('room-noema')?.done;
    const message = store
      .getRoomSnapshot('room-noema')
      .messages.find((item) => item.id === turn.messageId);
    assert.equal(message?.status, 'interrupted');
    assert.equal(message?.content, '部分文字');
    assert.equal(
      events.some((event) => event.type === 'chat-turn-interrupted'),
      true,
    );
  } finally {
    release?.();
    await service.shutdown();
    db.close();
  }
});

test('social state does not expose the legacy root transcript to the social renderer', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = new SocialChatStore(db);
  const service = new SocialChatService({
    store,
    provider: { async *streamChat() {} },
    secretStore: { isConfigured: () => false },
    getSelectedModel: () => null,
    getRootState: async () => ({
      connected: false,
      checking: false,
      models: [],
      selectedModel: null,
      error: null,
      providerConfigured: false,
      providerBaseUrl: 'http://127.0.0.1:3001/v1',
      providerName: 'FreeLLMAPI',
      messages: [{ content: 'legacy transcript marker' }],
      workerTasks: [{ prompt: 'legacy worker marker' }],
    }),
  });
  try {
    const state = await service.getUiState();
    assert.equal(state.connected, false);
    assert.equal('messages' in state, false);
    assert.equal('workerTasks' in state, false);
    assert.equal(state.rooms.length, 3);
  } finally {
    db.close();
  }
});
