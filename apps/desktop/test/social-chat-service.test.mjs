import { createSocialTestStore } from '../test-support/social-team.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatService } from '../src/social-chat-service.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';
import { SocialProjectStore } from '../src/social-project-store.mjs';

test('social chat sends only the selected room transcript and persists the real streamed response', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
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
    assert.equal(seenRequests[0].tools, undefined);
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

test('project member replies and retries preserve project scope and user-context authority', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const projectStore = new SocialProjectStore({ db, socialChatStore: store });
  const project = projectStore.createProject({
    title: 'E2E 价格追踪器',
    brief: '核对供应商价格并保留时间和来源。',
    agentIds: ['noema', 'engineering-partner'],
  });
  const projectSession = projectStore.getProjectSession(
    project.id,
    'engineering-partner',
  );
  const privateTurn = store.beginTurn({
    roomId: 'room-engineering-partner',
    agentId: 'engineering-partner',
    text: '不要带入私聊的葡萄柚标记。',
    model: 'test-model',
  });
  store.completeReply(privateTurn.assistantMessageId);
  const groupTurn = store.beginTurn({
    roomId: project.groupRoomId,
    agentId: 'noema',
    text: '群聊的珊瑚标记也不进入个人项目会话。',
    model: 'test-model',
  });
  store.completeReply(groupTurn.assistantMessageId);
  const seenRequests = [];
  const service = new SocialChatService({
    store,
    provider: {
      async *streamChat(input) {
        seenRequests.push(input);
        if (seenRequests.length === 1) throw new Error('临时传输失败。');
        yield '我会核对价格、时间和来源。';
      },
    },
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
    getProjectSessionContext: (roomId, agentId) =>
      projectStore.getProjectSessionContext(roomId, agentId),
  });

  try {
    const sent = service.sendMessage({
      roomId: projectSession.room.room.id,
      agentId: 'engineering-partner',
      text: '开始核对。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get(projectSession.room.room.id)?.done;

    assert.equal(seenRequests.length, 1);
    const prompt = seenRequests[0].messages
      .map((message) => message.content)
      .join('\n');
    assert.match(prompt, /E2E 价格追踪器/);
    assert.match(prompt, /核对供应商价格并保留时间和来源/);
    assert.match(prompt, /开始核对/);
    assert.doesNotMatch(prompt, /葡萄柚/);
    assert.doesNotMatch(prompt, /珊瑚标记/);
    assert.equal(
      seenRequests[0].messages.find((message) =>
        message.content.includes('"type":"noema_project_session"'),
      )?.role,
      'user',
    );
    assert.throws(
      () =>
        service.sendMessage({
          roomId: projectSession.room.room.id,
          agentId: 'noema',
          text: '越权检查。',
        }),
      /只属于其指定成员/,
    );
    assert.equal(store.getSocialMessage(sent.messageId)?.status, 'failed');
    projectStore.archiveProject(project.id);
    assert.throws(() => service.retryReply(sent.messageId), /项目已归档/);
    assert.equal(seenRequests.length, 1);
    projectStore.restoreProject(project.id);
    service.retryReply(sent.messageId);
    await service.active.get(projectSession.room.room.id)?.done;
    assert.equal(store.getSocialMessage(sent.messageId)?.status, 'complete');
    assert.equal(seenRequests.length, 2);
    const retriedPrompt = JSON.stringify(seenRequests[1].messages);
    assert.match(retriedPrompt, /核对供应商价格并保留时间和来源/);
    assert.doesNotMatch(retriedPrompt, /葡萄柚|珊瑚标记/);
    assert.throws(
      () => service.retryReply('missing-message'),
      /找不到这个聊天消息/,
    );
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('a project-group mention uses only that member project session plus public group context', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const projectStore = new SocialProjectStore({ db, socialChatStore: store });
  const researcher = store.createAgent({
    name: '研究员',
    headline: '资料研究',
    description: '核对项目资料与来源。',
  });
  const project = projectStore.createProject({
    title: '群聊上下文隔离检查',
    brief: '在群里 @ 成员后，继续它自己的项目工作上下文。',
    agentIds: ['noema', 'engineering-partner', researcher.members[0].id],
  });
  const target = projectStore.getProjectSession(
    project.id,
    'engineering-partner',
  );
  const other = projectStore.getProjectSession(
    project.id,
    researcher.members[0].id,
  );
  const priorTurns = [
    store.beginTurn({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '目标成员的常驻私聊：不应混入项目。',
      model: 'test-model',
    }),
    store.beginTurn({
      roomId: target.room.room.id,
      agentId: 'engineering-partner',
      text: '目标成员的项目记录：保留价格来源。',
      model: 'test-model',
    }),
    store.beginTurn({
      roomId: other.room.room.id,
      agentId: researcher.members[0].id,
      text: '其他成员的私有项目记录：不应泄露。',
      model: 'test-model',
    }),
    store.beginTurn({
      roomId: project.groupRoomId,
      agentId: 'noema',
      text: '群里的公开决定：保留原币种。',
      model: 'test-model',
    }),
  ];
  for (const turn of priorTurns) {
    store.appendAssistantDelta(turn.assistantMessageId, '已记录。');
    store.completeReply(turn.assistantMessageId);
  }
  const seenRequests = [];
  const service = new SocialChatService({
    store,
    provider: {
      async *streamChat(input) {
        seenRequests.push(input);
        yield '我会按群里的决定继续核对。';
      },
    },
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
    getProjectSessionContext: (roomId, agentId) =>
      projectStore.getProjectSessionContext(roomId, agentId),
  });

  try {
    service.sendMessage({
      roomId: project.groupRoomId,
      agentId: 'engineering-partner',
      text: '@工程搭档 请继续核对。',
    });
    await service.active.get(project.groupRoomId)?.done;

    const prompt = JSON.stringify(seenRequests[0]?.messages ?? []);
    assert.match(prompt, /目标成员的项目记录：保留价格来源/);
    assert.match(prompt, /群里的公开决定：保留原币种/);
    assert.match(prompt, /@工程搭档 请继续核对/);
    assert.doesNotMatch(prompt, /其他成员的私有项目记录/);
    assert.doesNotMatch(prompt, /目标成员的常驻私聊/);
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('Noema retrieves bounded, redacted history from its own threads only when the user refers to it', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const requests = [];
  const provider = {
    async *streamChat(input) {
      requests.push(input);
      const recall = input.messages.find((message) =>
        message.content.includes('"type":"noema_history_recall"'),
      );
      if (recall) {
        const result = JSON.parse(recall.content.split('\n').at(-1));
        assert.equal(result.status, 'found');
        assert.ok(
          result.sources.some((source) => source.roomTitle === '旧版面板'),
        );
        assert.equal(
          JSON.stringify(result.sources).includes('紫罗兰晶体私密标记'),
          false,
        );
        assert.ok(
          result.sources.some((source) =>
            source.snippet.includes('[已隐藏疑似凭据]'),
          ),
        );
      }
      input.onRouteMetadata?.('test-model');
      yield recall ? '当时说过用体素采样校准碰撞箱。' : '我会继续聊这件事。';
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
  });

  try {
    const prior = store.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'Minecraft 碰撞箱用体素化工具校准。api_key: abcdefghijklmnopqrstuvwxyz123456',
      model: 'test-model',
    });
    store.appendAssistantDelta(
      prior.assistantMessageId,
      '使用体素采样更稳定。',
    );
    store.completeReply(prior.assistantMessageId);
    const thread = store.createContinuationThread({
      sourceRoomId: 'room-noema',
      sourceIds: [prior.userMessageId],
      title: '旧版面板',
    });
    const threadedSource = store.beginTurn({
      roomId: thread.room.id,
      agentId: 'noema',
      text: 'Minecraft 碰撞箱的检修记录仍在主题旧版面板继续。',
      model: 'test-model',
    });
    store.appendAssistantDelta(threadedSource.assistantMessageId, '好的。');
    store.completeReply(threadedSource.assistantMessageId);

    const privateTurn = store.beginTurn({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '紫罗兰晶体私密标记，不属于 Noema 的历史范围。',
      model: 'test-model',
    });
    store.appendAssistantDelta(privateTurn.assistantMessageId, '收到。');
    store.completeReply(privateTurn.assistantMessageId);

    const ordinary = service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '我们先聊聊最近的构思。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-noema')?.done;
    assert.equal(
      requests[0].messages.some((message) =>
        message.content.includes('noema_history_recall'),
      ),
      false,
    );

    const recallTurn = service.sendMessage({
      roomId: thread.room.id,
      agentId: 'noema',
      text: '你还记得我们之前讨论 Minecraft 碰撞箱怎么校准吗？',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get(thread.room.id)?.done;

    assert.equal(requests.length, 2);
    const recall = requests[1].messages.find((message) =>
      message.content.includes('"type":"noema_history_recall"'),
    );
    assert.ok(recall);
    const reply = store
      .getRoomSnapshot(thread.room.id)
      .messages.find((message) => message.id === recallTurn.messageId);
    assert.equal(reply.historySearchStatus, 'found');
    assert.equal(reply.historySourcesIncluded, true);
    assert.ok(
      reply.historySources.some((source) => source.id === prior.userMessageId),
    );

    const specialist = service.sendMessage({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '你还记得我们之前讨论过什么吗？',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-engineering-partner')?.done;
    assert.equal(requests.length, 3);
    assert.equal(
      requests[2].messages.some((message) =>
        message.content.includes('noema_history_recall'),
      ),
      false,
    );
    assert.equal(
      JSON.stringify(requests[2].messages).includes('体素采样'),
      false,
    );
    assert.ok(ordinary.messageId);
    assert.ok(specialist.messageId);
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('Noema can start existing project work from an explicit request while other turns stay ordinary chat', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  store.createAgent({
    name: '软件审阅员',
    headline: '软件变更与回归验证',
    description: '优先检查实现差异、风险和回归行为。',
    projectWork: true,
  });
  const selectedExecutor = store
    .listAgents()
    .find((agent) => agent.name === '软件审阅员');
  assert.ok(selectedExecutor);
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
                agent_id: selectedExecutor.id,
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
    startProjectWork: async (input) => {
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

    assert.deepEqual(
      requests[0].tools?.map((tool) => tool.function.name),
      ['start_project_work', 'delegate_to_specialist'],
    );
    const workTool = requests[0].tools?.find(
      (tool) => tool.function.name === 'start_project_work',
    );
    assert.deepEqual(workTool?.function.parameters.properties.agent_id.enum, [
      'engineering-partner',
      selectedExecutor.id,
    ]);
    assert.match(workTool?.function.description ?? '', /软件变更与回归验证/u);
    assert.deepEqual(started, [
      {
        roomId: 'room-noema',
        agentId: selectedExecutor.id,
        dispatchFromNoema: true,
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
    assert.deepEqual(
      requests[1].tools?.map((tool) => tool.function.name),
      ['start_project_work', 'delegate_to_specialist'],
    );
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

test('specialists use file tools through ordinary messages, and revoked capabilities cannot dispatch work', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const dispatched = [];
  const requests = [];
  const service = new SocialChatService({
    store,
    provider: {
      async *streamChat(input) {
        requests.push(input);
        input.onToolCalls?.([
          {
            id: 'call-file-work',
            function: {
              name: 'start_project_work',
              arguments: JSON.stringify({
                agent_id: 'engineering-partner',
                task: '检查项目中的依赖配置。',
              }),
            },
          },
        ]);
        if (!input.tools) yield '可以先讨论需求。';
      },
    },
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
    getProjectWorkReadiness: () => ({ available: true, reason: null }),
    startProjectWork: async (input, signal) => {
      assert.equal(signal.aborted, false);
      dispatched.push(input);
      return { accepted: true, taskId: 'specialist-file-work' };
    },
  });
  try {
    const first = service.sendMessage({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '帮我检查一下项目的依赖。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-engineering-partner')?.done;
    assert.deepEqual(
      requests[0].tools.map((tool) => tool.function.name),
      ['start_project_work'],
    );
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].agentId, 'engineering-partner');
    assert.equal(dispatched[0].dispatchFromNoema, false);
    assert.equal(dispatched[0].roomId, 'room-engineering-partner');
    assert.equal(
      store.getSocialMessage(dispatched[0].sourceMessageId).role,
      'user',
    );
    assert.equal(store.getSocialMessage(first.messageId).status, 'complete');

    store.setAgentProjectWork('engineering-partner', false);
    service.sendMessage({
      roomId: 'room-engineering-partner',
      agentId: 'engineering-partner',
      text: '继续谈谈刚才的方案。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-engineering-partner')?.done;
    assert.equal(requests[1].tools, undefined);
    assert.equal(dispatched.length, 1);
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('Noema receives a bounded specialist report and writes its own final reply', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const requests = [];
  const visibleDeltas = [];
  const provider = {
    async *streamChat(input) {
      requests.push({ ...input, messages: [...input.messages] });
      if (requests.length === 1) {
        input.onToolCalls([
          {
            id: 'call-specialist-1',
            type: 'function',
            function: {
              name: 'delegate_to_specialist',
              arguments: JSON.stringify({
                agent_id: 'engineering-partner',
                task: '比较这两个方案的维护成本。',
              }),
            },
          },
        ]);
      } else if (requests.length === 2) {
        yield '方案 A 更易维护，因为变更边界更小。';
      } else {
        yield '我参考了工程搭档的报告，建议采用方案 A。';
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
    emit: (event) => {
      if (
        event.type === 'chat-message-delta' &&
        event.roomId === 'room-noema'
      ) {
        visibleDeltas.push(event.delta);
      }
    },
  });

  try {
    const sent = service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请结合刚才讨论的背景比较两个方案。上下文标记：主聊天机密。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-noema')?.done;

    assert.equal(requests.length, 3);
    const specialistTool = requests[0].tools?.find(
      (tool) => tool.function.name === 'delegate_to_specialist',
    );
    assert.deepEqual(
      specialistTool?.function.parameters.properties.agent_id.enum,
      ['engineering-partner'],
    );
    assert.match(requests[0].messages.at(-1).content, /主聊天机密/u);
    assert.deepEqual(
      requests[1].messages.map((message) => message.role),
      ['system', 'system', 'user'],
    );
    assert.match(requests[1].messages[0].content, /工程搭档/u);
    assert.equal(
      requests[1].messages.some((message) =>
        message.content.includes('主聊天机密'),
      ),
      false,
    );
    assert.equal(
      requests[1].messages.at(-1).content,
      '[Noema] 比较这两个方案的维护成本。',
    );
    const returnedReport = requests[2].messages.find(
      (message) => message.role === 'tool',
    );
    assert.equal(returnedReport?.tool_call_id, 'call-specialist-1');
    assert.match(returnedReport?.content ?? '', /方案 A 更易维护/u);
    assert.ok(
      requests[2].messages.some((message) =>
        message.content?.includes('主聊天机密'),
      ),
      'the internal report returns to Noema with its original room context',
    );
    const reply = store
      .getRoomSnapshot('room-noema')
      .messages.find((message) => message.id === sent.messageId);
    assert.match(reply?.content ?? '', /我参考了工程搭档的报告/u);
    assert.match(reply?.content ?? '', /建议采用方案 A/u);
    assert.equal(reply?.content, '我参考了工程搭档的报告，建议采用方案 A。');
    assert.equal(visibleDeltas.join(''), reply.content);
    assert.equal(reply?.content.includes('主聊天机密'), false);
    assert.equal(reply?.status, 'complete');

    const specialistMessages = store.getRoomSnapshot(
      'room-engineering-partner',
    ).messages;
    assert.equal(specialistMessages.at(-2).senderAgentId, 'noema');
    assert.equal(
      specialistMessages.at(-2).content,
      '比较这两个方案的维护成本。',
    );
    assert.equal(
      specialistMessages.at(-1).content,
      '方案 A 更易维护，因为变更边界更小。',
    );
    assert.equal(
      specialistMessages.at(-1).status,
      'complete',
      'the specialist result is a completed message in its resident chat',
    );
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('Noema does not overlap a busy specialist resident conversation', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const residentRoomId = store.getAgentResidentRoomId('engineering-partner');
  store.beginTurn({
    roomId: residentRoomId,
    agentId: 'engineering-partner',
    text: '用户已经在这个私聊中开始另一项工作。',
    model: 'test-model',
  });
  const requests = [];
  const provider = {
    async *streamChat(input) {
      requests.push({ ...input, messages: [...input.messages] });
      if (requests.length === 1) {
        input.onToolCalls([
          {
            id: 'call-busy-specialist',
            type: 'function',
            function: {
              name: 'delegate_to_specialist',
              arguments: JSON.stringify({
                agent_id: 'engineering-partner',
                task: '再检查一项独立问题。',
              }),
            },
          },
        ]);
      } else {
        yield '该联系人正在回复另一条消息，本次没有投递。';
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
  });

  try {
    service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请把这个问题交给工程搭档。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-noema')?.done;

    assert.equal(
      requests.length,
      2,
      'no second provider request reaches the busy agent',
    );
    const report = requests[1].messages.find(
      (message) => message.role === 'tool',
    );
    assert.match(report?.content ?? '', /"delivered":false/u);
    assert.match(report?.content ?? '', /本次交办未投递/u);
    const roomMessages = store.getRoomSnapshot(residentRoomId).messages;
    assert.equal(
      roomMessages.some(
        (message) => message.content === '再检查一项独立问题。',
      ),
      false,
    );
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('saved interaction notes are not injected as a separate system layer into ordinary chat', async () => {
  const db = new Database(':memory:');
  const root = new RootStore(db);
  const store = createSocialTestStore(db);
  const source = store.beginTurn({
    roomId: 'room-noema',
    agentId: 'noema',
    text: '分享经历时请先接住我，再决定要不要分析。',
    model: 'seed-model',
  });
  store.appendAssistantDelta(source.assistantMessageId, '明白。');
  store.completeReply(source.assistantMessageId);
  root.addInteractionAdjustment({
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
  });

  try {
    service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '今天和家人聊得不太顺。',
    });
    await new Promise((resolve) => setImmediate(resolve));
    await service.active.get('room-noema')?.done;

    assert.equal(
      requests[0].messages.some((message) =>
        message.content.includes('互动约定'),
      ),
      false,
    );
    const reply = store
      .getRoomSnapshot('room-noema')
      .messages.find(
        (message) =>
          message.role === 'assistant' &&
          message.content === '先聊这件事本身。',
      );
    assert.deepEqual(reply?.interactionAdjustmentIds, []);
    assert.deepEqual(reply?.interactionAdjustmentAttempts, [
      {
        attempt: 1,
        interactionAdjustmentIds: [],
        interactionAdjustmentSnapshots: [],
      },
    ]);

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
    assert.equal('interactionAdjustments' in socialState, false);
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('a user-created specialist receives only messages explicitly forwarded into the target room', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
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

test('stop immediately persists interruption and rejects late provider output', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  let release;
  const events = [];
  const provider = {
    async *streamChat() {
      yield '部分文字';
      await new Promise((resolve) => {
        release = resolve;
      });
      yield '迟到文字';
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
    const stopped = store
      .getRoomSnapshot('room-noema')
      .messages.find((item) => item.id === turn.messageId);
    assert.equal(stopped?.status, 'interrupted');
    assert.equal(stopped?.content, '部分文字');
    assert.equal(
      events.filter((event) => event.type === 'chat-turn-interrupted').length,
      1,
    );
    release();
    await service.active.get('room-noema')?.done;
    const message = store
      .getRoomSnapshot('room-noema')
      .messages.find((item) => item.id === turn.messageId);
    assert.equal(message?.status, 'interrupted');
    assert.equal(message?.content, '部分文字');
    assert.equal(
      events.filter((event) => event.type === 'chat-turn-interrupted').length,
      1,
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
  const store = createSocialTestStore(db);
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
