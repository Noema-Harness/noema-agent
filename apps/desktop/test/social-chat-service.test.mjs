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

test('Noema can start existing project work from an explicit request while other turns stay ordinary chat', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = new SocialChatStore(db);
  const requests = [];
  const started = [];
  const provider = {
    async *streamChat(input) {
      requests.push(input);
      if (
        requests.length === 1 &&
        input.tools?.some((tool) => tool.function.name === 'start_project_work')
      ) {
        input.onToolCalls([
          {
            function: {
              name: 'start_project_work',
              arguments: JSON.stringify({
                task: '检查本地项目的依赖配置并修复可复现的问题。',
              }),
            },
          },
        ]);
      } else {
        yield '我们可以先讨论这个方向。';
      }
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
    getProjectWorkReadiness: () => ({ available: true, reason: null }),
    startProjectWorkFromNoema: async (input) => {
      started.push(input);
      return { accepted: true, taskId: 'work-1' };
    },
  });

  try {
    service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请检查本地项目的依赖配置并修复问题。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-noema')?.done;

    assert.equal(requests[0].tools?.length, 1);
    assert.deepEqual(started, [
      {
        roomId: 'room-noema',
        prompt: '检查本地项目的依赖配置并修复可复现的问题。',
        sourceMessageId: store
          .getRoomSnapshot('room-noema')
          .messages.find((message) => message.role === 'user').id,
      },
    ]);
    const first = store
      .getRoomSnapshot('room-noema')
      .messages.find((message) => message.role === 'assistant');
    assert.match(first.content, /已从这条对话启动项目工作/u);
    assert.equal(first.status, 'complete');

    service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '我们先聊聊有没有必要做这个。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-noema')?.done;
    assert.equal(requests[1].tools?.length, 1);
    assert.equal(started.length, 1);
    assert.match(
      store.getRoomSnapshot('room-noema').messages.at(-1)?.content ?? '',
      /先讨论这个方向/u,
    );
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('Noema chat injects only conversation-scoped adjustments and snapshots them per reply', async () => {
  const db = new Database(':memory:');
  const root = new RootStore(db);
  const store = new SocialChatStore(db);
  const source = store.beginTurn({
    roomId: 'room-noema',
    agentId: 'noema',
    text: '分享经历时请先接住我，再决定要不要分析。',
    model: 'seed-model',
  });
  store.appendAssistantDelta(source.assistantMessageId, '明白。');
  store.completeReply(source.assistantMessageId);
  const conversationAdjustment = root.addInteractionAdjustment({
    id: 'conversation-adjustment',
    sourceSurface: 'social',
    sourceRoomId: 'room-noema',
    sourceTurnId: source.turnId,
    scope: 'conversation',
    situation: '用户分享一段不愉快的经历',
    behavior: '先回应当下感受，再问是否需要一起分析。',
    sourceQuote: '先接住我',
  });
  const codingSource = store.beginTurn({
    roomId: 'room-noema',
    agentId: 'noema',
    text: '编码时先列清关键验收项。',
    model: 'seed-model',
  });
  store.appendAssistantDelta(codingSource.assistantMessageId, '记下了。');
  store.completeReply(codingSource.assistantMessageId);
  root.addInteractionAdjustment({
    id: 'coding-adjustment',
    sourceSurface: 'social',
    sourceRoomId: 'room-noema',
    sourceTurnId: codingSource.turnId,
    scope: 'coding',
    situation: '开始项目编码工作',
    behavior: '先明确可独立检查的验收项。',
    sourceQuote: '关键验收项',
  });
  const requests = [];
  const service = new SocialChatService({
    store,
    provider: {
      async *streamChat(input) {
        requests.push(input);
        yield '先聊这件事本身。';
      },
    },
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
    getInteractionAdjustments: () => root.getInteractionAdjustments(),
  });

  try {
    service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '今天和家人聊得不太顺。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-noema')?.done;

    const adjustmentContext = requests[0].messages.find((message) =>
      message.content.includes('用户明确保存给 Noema 的互动约定'),
    );
    assert.ok(adjustmentContext);
    assert.match(adjustmentContext.content, /先回应当下感受/);
    assert.doesNotMatch(adjustmentContext.content, /明确可独立检查的验收项/);
    const reply = store
      .getRoomSnapshot('room-noema')
      .messages.find(
        (message) =>
          message.role === 'assistant' &&
          message.content === '先聊这件事本身。',
      );
    assert.deepEqual(reply?.interactionAdjustmentIds, [
      conversationAdjustment.id,
    ]);
    assert.deepEqual(
      reply?.interactionAdjustmentAttempts[0].interactionAdjustmentIds,
      [conversationAdjustment.id],
    );

    service.sendMessage({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '请看看这个项目方案。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-engineering-partner')?.done;
    assert.equal(
      requests[1].messages.some((message) =>
        message.content.includes('互动约定'),
      ),
      false,
    );
    const socialState = await service.getUiState();
    assert.equal(
      socialState.interactionAdjustments.some(
        (adjustment) => adjustment.id === conversationAdjustment.id,
      ),
      true,
    );
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
