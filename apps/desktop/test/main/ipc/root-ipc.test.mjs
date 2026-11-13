import assert from 'node:assert/strict';
import test from 'node:test';
import { CHANNELS, registerRootIpc } from '../../../src/main/ipc/root-ipc.mjs';

function createIpcHarness() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: {
      handle: (channel, handler) =>
        handlers.set(channel, (event, ...args) => {
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

test('retired Root and Quick Capture IPC is absent while shared provider IPC remains gated', async () => {
  const harness = createIpcHarness();
  const trustedSender = { mainFrame: { parent: null } };
  const calls = [];
  const rootAgent = {
    refreshModels: async () => (calls.push('refresh'), { models: [] }),
    configureProvider: async (configuration) => (
      calls.push('provider'),
      configuration
    ),
    configureWebSearch: async () => ({ webSearchConfigured: true }),
    clearWebSearch: async () => ({ webSearchConfigured: false }),
    setModel: async (model) => model,
  };
  const unregister = registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent,
    isTrustedSender: (sender) => sender === trustedSender,
  });
  const retiredChannels = [
    'noema:root-state',
    'noema:send-message',
    'noema:save-capture',
    'noema:update-capture',
    'noema:delete-capture',
    'noema:discuss-capture',
    'noema:retry-turn',
    'noema:stop-turn',
    'noema:choose-workspace',
    'noema:clear-workspace',
    'noema:stop-background-task',
    'noema:resume-background-task',
    'noema:retry-worker-event',
    'noema:list-codex-threads',
    'noema:preview-codex-thread',
    'noema:import-codex-thread',
    'noema:remove-context-import',
    'noema:add-social-interaction-adjustment',
    'noema:update-interaction-adjustment',
    'noema:withdraw-interaction-adjustment',
    'noema:quick-capture-request',
    'noema:quick-capture-shortcut-status',
    'noema:mark-quick-capture-ready',
    'noema:finish-quick-capture',
  ];
  for (const channel of retiredChannels) {
    assert.equal(
      harness.handlers.has(channel),
      false,
      `${channel} must be retired`,
    );
  }
  assert.equal(harness.handlers.has(CHANNELS.models), true);
  assert.equal(harness.handlers.has(CHANNELS.configureProvider), true);
  assert.equal(harness.handlers.has(CHANNELS.selectModel), true);
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.models)({ sender: trustedSender }),
    { models: [] },
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.configureProvider)(
      { sender: {} },
      { apiKey: 'nope' },
    ),
    /未授权/u,
  );
  assert.deepEqual(calls, ['refresh']);
  unregister();
  assert.equal(harness.handlers.size, 0);
});

test('execution file permissions default to ask and persist an explicit allow', async () => {
  const harness = createIpcHarness();
  const trustedSender = { mainFrame: { parent: null } };
  let permissions = { externalFiles: 'ask' };
  const unregister = registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent: {},
    getExecutionPermissions: () => permissions,
    setExecutionPermissions: (next) => {
      permissions = {
        externalFiles: next?.externalFiles === 'allow' ? 'allow' : 'ask',
      };
      return permissions;
    },
    isTrustedSender: (sender) => sender === trustedSender,
  });
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.executionPermissions)({
      sender: trustedSender,
    }),
    { externalFiles: 'ask' },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.setExecutionPermissions)(
      { sender: trustedSender },
      { externalFiles: 'allow' },
    ),
    { externalFiles: 'allow' },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.executionPermissions)({
      sender: trustedSender,
    }),
    { externalFiles: 'allow' },
  );
  unregister();
});

test('project and member mutations reject untrusted or child frames before touching stores', async () => {
  const harness = createIpcHarness();
  const trustedSender = { mainFrame: { parent: null } };
  const calls = [];
  const unregister = registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent: {},
    isTrustedSender: (sender) => sender === trustedSender,
    socialProjectStore: {
      archiveProject: (projectId) => {
        calls.push(['archive', projectId]);
        return { id: projectId, groupRoomId: 'group' };
      },
      restoreProject: (projectId) => {
        calls.push(['restore', projectId]);
        return { id: projectId, groupRoomId: 'group' };
      },
    },
    socialChatService: {
      emit: () => {},
      setAgentArchived: (agentId, archived) => {
        calls.push(['agent-archive', agentId, archived]);
        return { id: agentId };
      },
    },
  });
  try {
    for (const event of [
      { sender: {} },
      {
        sender: trustedSender,
        senderFrame: { parent: trustedSender.mainFrame },
      },
    ]) {
      await assert.rejects(
        harness.handlers.get(CHANNELS.socialArchiveProject)(
          event,
          'project-forged',
        ),
        /未授权/u,
      );
      await assert.rejects(
        harness.handlers.get(CHANNELS.socialAgentArchive)(
          event,
          'agent-forged',
          true,
        ),
        /未授权/u,
      );
    }
    assert.deepEqual(calls, []);
    await harness.handlers.get(CHANNELS.socialArchiveProject)(
      { sender: trustedSender },
      'project-real',
    );
    await harness.handlers.get(CHANNELS.socialAgentArchive)(
      { sender: trustedSender },
      'agent-real',
      true,
    );
    assert.deepEqual(calls, [
      ['archive', 'project-real'],
      ['agent-archive', 'agent-real', true],
    ]);
  } finally {
    unregister();
  }
});

test('room history and scoped search IPC forward only bounded query inputs to the Social store', async () => {
  const harness = createIpcHarness();
  const trustedSender = { mainFrame: { parent: null } };
  const calls = [];
  const unregister = registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent: { getUiState: async () => ({}) },
    socialChatService: {
      store: {
        getRoomSnapshot: (roomId, options) => (
          calls.push(['room', roomId, options]),
          { room: { id: roomId }, messages: [] }
        ),
        searchRoomMessages: (roomId, query) => (
          calls.push(['search', roomId, query]),
          []
        ),
      },
    },
    isTrustedSender: (sender) => sender === trustedSender,
  });
  try {
    const invoke = (channel, ...args) =>
      harness.handlers.get(channel)({ sender: trustedSender }, ...args);
    await invoke(CHANNELS.socialRoom, 'room-noema');
    await invoke(CHANNELS.socialRoom, 'room-noema', {
      limit: 200,
      beforeSequence: 400,
    });
    await invoke(
      CHANNELS.socialSearchRoomMessages,
      'room-noema',
      'earlier text',
    );
    await assert.rejects(
      harness.handlers.get(CHANNELS.socialSearchRoomMessages)(
        {
          sender: trustedSender,
          senderFrame: { parent: trustedSender.mainFrame },
        },
        'room-noema',
        'forbidden frame',
      ),
      /未授权的应用窗口请求/u,
    );
    assert.deepEqual(calls, [
      ['room', 'room-noema', { limit: 200 }],
      ['room', 'room-noema', { limit: 200, beforeSequence: 400 }],
      ['search', 'room-noema', 'earlier text'],
    ]);
  } finally {
    unregister();
  }
});

test('Windows runner capability and setup IPC are main-frame gated', async () => {
  const harness = createIpcHarness();
  const trustedSender = {};
  const capability = {
    platform: 'win32',
    supported: false,
    status: 'unavailable',
    reasonCode: 'sandbox_setup_unavailable',
    backendId: 'noema-codex-windows',
    backendVersion: '0.1.0',
    protocolVersion: 7,
    setupStatus: 'unavailable',
  };
  let refreshes = 0;
  let setups = 0;
  const unregister = registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent: { getUiState: () => ({}) },
    isTrustedSender: (sender) => sender === trustedSender,
    getWindowsRunnerCapability: () => {
      refreshes += 1;
      return capability;
    },
    setupWindowsRunner: async () => {
      setups += 1;
      return { supported: true, canceled: false, reasonCode: null };
    },
  });

  assert.deepEqual(
    await harness.handlers.get(CHANNELS.windowsRunnerCapability)({
      sender: trustedSender,
    }),
    capability,
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.setupWindowsRunner)({
      sender: trustedSender,
    }),
    { supported: true, canceled: false, reasonCode: null },
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.setupWindowsRunner)({ sender: {} }),
    /未授权/u,
  );
  assert.equal(refreshes, 1);
  assert.equal(setups, 1);
  unregister();
});

test('rejects IPC from a child frame hosted in the trusted window', async () => {
  const harness = createIpcHarness();
  const trustedSender = { mainFrame: { parent: null } };
  let diagnosticReads = 0;
  const unregister = registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent: { refreshModels: () => ({ models: [] }) },
    diagnosticsQueryService: {
      listRecent: () => {
        diagnosticReads += 1;
        return { executions: [] };
      },
    },
    isTrustedSender: (sender) => sender === trustedSender,
  });
  try {
    await assert.rejects(
      harness.handlers.get(CHANNELS.diagnosticsRecent)({
        sender: trustedSender,
        senderFrame: { parent: trustedSender.mainFrame },
      }),
      /未授权的应用窗口请求/u,
    );
    assert.equal(diagnosticReads, 0);
  } finally {
    unregister();
  }
});

test('personal memory management is exposed only through trusted desktop IPC', async () => {
  const harness = createIpcHarness();
  const trustedSender = {};
  const calls = [];
  const diagnosticEvents = [];
  const memories = {
    list: () => ({ enabled: true, items: [] }),
    setEnabled: (enabled) => (calls.push(['enabled', enabled]), enabled),
    add: (input) => (calls.push(['add', input]), { id: 'memory-1', ...input }),
    update: (input) => (
      calls.push(['update', input]),
      { id: input.id, ...input }
    ),
    delete: (id) => (calls.push(['delete', id]), true),
  };
  registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent: { getUiState: async () => ({}) },
    socialChatService: { store: { personalMemories: memories } },
    recordDiagnosticEvent: (event) => {
      diagnosticEvents.push(event);
      throw new Error('diagnostics unavailable');
    },
    isTrustedSender: (sender) => sender === trustedSender,
  });
  const invoke = (channel, ...args) =>
    harness.handlers.get(channel)({ sender: trustedSender }, ...args);

  assert.deepEqual(await invoke(CHANNELS.personalMemories), {
    enabled: true,
    items: [],
  });
  assert.equal(await invoke(CHANNELS.personalMemoryEnabled, false), false);
  assert.equal(
    (await invoke(CHANNELS.addPersonalMemory, '一条本地记忆。')).id,
    'memory-1',
  );
  await invoke(CHANNELS.updatePersonalMemory, {
    id: 'memory-1',
    content: '已修正。',
  });
  assert.equal(await invoke(CHANNELS.deletePersonalMemory, 'memory-1'), true);
  assert.deepEqual(calls, [
    ['enabled', false],
    ['add', { content: '一条本地记忆。' }],
    ['update', { id: 'memory-1', content: '已修正。' }],
    ['delete', 'memory-1'],
  ]);
  assert.deepEqual(
    diagnosticEvents.map(({ module, operation, status, details }) => ({
      module,
      operation,
      status,
      details,
    })),
    ['list', 'enabled', 'add', 'update', 'delete'].map((operation) => ({
      module: 'social.memory',
      operation: `settings.${operation}`,
      status: 'completed',
      details: undefined,
    })),
  );
  assert.doesNotMatch(JSON.stringify(diagnosticEvents), /一条本地记忆|已修正/u);
  await assert.rejects(
    harness.handlers.get(CHANNELS.personalMemories)({ sender: {} }),
    /未授权/u,
  );
});

test('personal memory IPC keeps store behavior when diagnostics fail and redacts store errors', async () => {
  const harness = createIpcHarness();
  const trustedSender = {};
  const diagnosticEvents = [];
  registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent: { getUiState: async () => ({}) },
    socialChatService: {
      store: {
        personalMemories: {
          add: ({ content }) => {
            if (content === 'force failure')
              throw new Error('private memory body must not be logged');
            return { id: 'memory-1', content };
          },
        },
      },
    },
    recordDiagnosticEvent: (event) => {
      diagnosticEvents.push(event);
      throw new Error('diagnostics unavailable');
    },
    isTrustedSender: (sender) => sender === trustedSender,
  });
  const invoke = (channel, ...args) =>
    harness.handlers.get(channel)({ sender: trustedSender }, ...args);

  assert.deepEqual(
    await invoke(CHANNELS.addPersonalMemory, 'sensitive memory text'),
    { id: 'memory-1', content: 'sensitive memory text' },
  );
  await assert.rejects(
    invoke(CHANNELS.addPersonalMemory, 'force failure'),
    /private memory body must not be logged/u,
  );
  assert.deepEqual(
    diagnosticEvents.map(({ module, operation, status, errorCode }) => ({
      module,
      operation,
      status,
      errorCode,
    })),
    [
      {
        module: 'social.memory',
        operation: 'settings.add',
        status: 'completed',
        errorCode: undefined,
      },
      {
        module: 'social.memory',
        operation: 'settings.add',
        status: 'failed',
        errorCode: 'personal_memory_operation_failed',
      },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(diagnosticEvents),
    /sensitive memory text|private memory body/u,
  );
});

test('user follow-up settings IPC records content-free actions under separate execution IDs', async () => {
  const harness = createIpcHarness();
  const trustedSender = {};
  const diagnosticEvents = [];
  const calls = [];
  const followups = {
    list: () => ({ enabled: true, items: [] }),
    setEnabled: (enabled) => enabled,
    add: (input) => ({ id: 'followup-1', ...input }),
    update: (input) => ({ id: input.id, ...input }),
    cancel: () => false,
  };
  const unregister = registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent: { getUiState: async () => ({}) },
    socialChatService: {
      store: { userFollowups: followups },
      scheduleUserFollowups: () => calls.push('schedule'),
    },
    recordDiagnosticEvent: (event) => {
      diagnosticEvents.push(event);
      throw new Error('diagnostics unavailable');
    },
    isTrustedSender: (sender) => sender === trustedSender,
  });
  const invoke = (channel, ...args) =>
    harness.handlers.get(channel)({ sender: trustedSender }, ...args);
  try {
    await invoke(CHANNELS.userFollowups);
    await invoke(CHANNELS.userFollowupsEnabled, true);
    await invoke(CHANNELS.userFollowupsEnabled, false);
    await invoke(CHANNELS.addUserFollowup, {
      title: 'PRIVATE_FOLLOWUP_TITLE',
      body: 'PRIVATE_FOLLOWUP_BODY',
      dueAt: '2026-11-06T08:00:00.000Z',
    });
    await invoke(CHANNELS.updateUserFollowup, {
      id: 'followup-1',
      title: 'PRIVATE_FOLLOWUP_TITLE_UPDATED',
      body: 'PRIVATE_FOLLOWUP_BODY_UPDATED',
      dueAt: '2026-11-06T09:00:00.000Z',
    });
    assert.equal(
      await invoke(CHANNELS.cancelUserFollowup, 'followup-1'),
      false,
    );

    assert.deepEqual(
      diagnosticEvents.map(({ module, operation, status }) => ({
        module,
        operation,
        status,
      })),
      [
        ['list', 'completed'],
        ['enabled', 'completed'],
        ['enabled', 'completed'],
        ['add', 'completed'],
        ['update', 'completed'],
        ['cancel', 'no_effect'],
      ].map(([operation, status]) => ({
        module: 'social.followup',
        operation: `settings.${operation}`,
        status,
      })),
    );
    assert.equal(
      new Set(diagnosticEvents.map((event) => event.executionId)).size,
      diagnosticEvents.length,
    );
    assert.deepEqual(calls, ['schedule', 'schedule', 'schedule']);
    assert.doesNotMatch(
      JSON.stringify(diagnosticEvents),
      /PRIVATE_FOLLOWUP_TITLE|PRIVATE_FOLLOWUP_BODY|followup-1/u,
    );
  } finally {
    unregister();
  }
});

test('file requests use ordinary social messages; only task controls retain direct trusted IPC', async () => {
  const harness = createIpcHarness();
  const trustedSender = {};
  const calls = [];
  const socialChatService = {
    getUiState: async () => ({ projectWork: { available: true } }),
    store: { getRoomSnapshot: (roomId) => ({ room: { id: roomId } }) },
    createAgent: (input) => ({
      room: { id: 'room-created-agent' },
      agent: input,
    }),
    setAgentArchived: (agentId, archived) => ({
      id: agentId,
      archivedAt: archived ? 'now' : null,
    }),
    setAgentProjectWork: (agentId, enabled) => ({
      id: agentId,
      capabilities: enabled ? ['project-work'] : [],
    }),
    sendMessage: (input) => input,
    stopReply: () => true,
    retryReply: () => ({ accepted: true }),
  };
  const socialWorkService = {
    resumeTask: (taskId) => {
      calls.push(['resume', taskId]);
      return { accepted: true, taskId };
    },
    reviewFileChange: (input) => {
      calls.push(['file-change', input]);
      return { id: input.taskId, fileChanges: [] };
    },
    reviewGitState: (taskId) => {
      calls.push(['git-review', taskId]);
      return { available: false, reason: 'not_a_repository', files: [] };
    },
    stopTask: (taskId) => {
      calls.push(['stop', taskId]);
      return true;
    },
    setCaseEligible: (taskId, eligible) => {
      calls.push(['case-eligible', taskId, eligible]);
      return { id: taskId, caseEligible: eligible };
    },
  };
  registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent: { getUiState: async () => ({}) },
    socialChatService,
    socialWorkService,
    isTrustedSender: (sender) => sender === trustedSender,
  });
  assert.equal(harness.handlers.has('noema:social-work-start'), false);
  assert.equal(harness.handlers.has(CHANNELS.socialWorkStop), true);
  assert.equal(harness.handlers.has(CHANNELS.socialWorkResume), true);
  assert.equal(harness.handlers.has(CHANNELS.socialWorkFileChange), true);
  assert.equal(harness.handlers.has(CHANNELS.socialWorkGitReview), true);
  assert.equal(harness.handlers.has(CHANNELS.socialWorkCaseEligible), true);
  assert.equal(harness.handlers.has(CHANNELS.socialCreateAgent), true);
  assert.equal(harness.handlers.has(CHANNELS.socialAgentProjectWork), true);
  assert.equal(harness.handlers.has(CHANNELS.socialAgentArchive), true);
  const input = {
    roomId: 'room-engineering-collaboration',
    agentId: 'engineering-partner',
    text: '写一个明确的小改动。',
  };
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.socialSend)(
      { sender: trustedSender },
      input,
    ),
    input,
  );
  assert.equal(
    await harness.handlers.get(CHANNELS.socialWorkStop)(
      { sender: trustedSender },
      'task-1',
    ),
    true,
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.socialWorkResume)(
      { sender: trustedSender },
      'task-1',
    ),
    { accepted: true, taskId: 'task-1' },
  );
  const fileChangeInput = {
    taskId: 'task-1',
    changeId: 'change-1',
    action: 'revert',
  };
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.socialWorkFileChange)(
      { sender: trustedSender },
      fileChangeInput,
    ),
    { id: 'task-1', fileChanges: [] },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.socialWorkGitReview)(
      { sender: trustedSender },
      'task-1',
    ),
    { available: false, reason: 'not_a_repository', files: [] },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.socialWorkCaseEligible)(
      { sender: trustedSender },
      'task-1',
      false,
    ),
    { id: 'task-1', caseEligible: false },
  );
  const agentInput = {
    name: '图形观察员',
    headline: '长期观察游戏视觉与交互',
    description: '先和我厘清体验，再讨论如何验证。',
  };
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.socialCreateAgent)(
      { sender: trustedSender },
      agentInput,
    ),
    { room: { id: 'room-created-agent' }, agent: agentInput },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.socialAgentArchive)(
      { sender: trustedSender },
      'agent-created',
      true,
    ),
    { id: 'agent-created', archivedAt: 'now' },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.socialAgentProjectWork)(
      { sender: trustedSender },
      'agent-created',
      true,
    ),
    { id: 'agent-created', capabilities: ['project-work'] },
  );
  assert.deepEqual(calls, [
    ['stop', 'task-1'],
    ['resume', 'task-1'],
    ['file-change', fileChangeInput],
    ['git-review', 'task-1'],
    ['case-eligible', 'task-1', false],
  ]);
  await assert.rejects(
    harness.handlers.get(CHANNELS.socialWorkStop)({ sender: {} }, 'task-1'),
    /未授权/,
  );
});

test('project IPC exposes metadata and preserves lifecycle events for the renderer', async () => {
  const harness = createIpcHarness();
  const trustedSender = {};
  const events = [];
  let recordedReadiness = null;
  const project = {
    id: 'project-1',
    title: '版本定价观察',
    brief: '跟踪平台价格变化。',
    status: 'active',
    groupRoomId: 'room-project-1',
    members: [],
  };
  const socialChatService = {
    getUiState: async () => ({
      rooms: [],
      agents: [],
      projectWork: {
        available: false,
        reasonCode: 'executor_unavailable',
        reason: '执行器未就绪。',
      },
    }),
    emit: (event) => events.push(event),
  };
  const socialProjectStore = {
    listProjects: (options) => {
      assert.deepEqual(options, { includeArchived: true });
      return [project];
    },
    createProject: (input) => ({ ...project, ...input }),
    archiveProject: () => ({ ...project, status: 'archived' }),
    restoreProject: () => project,
    getProject: () => project,
    plans: {
      reopenEvidenceImpact: (input) => ({
        projectId: input.projectId,
        revision: input.expectedRevision + 1,
      }),
    },
    getProjectSession: (projectId, agentId) => ({
      project: { id: projectId, title: project.title },
      agentId,
      room: { room: { id: 'room-project-session' } },
    }),
  };
  registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent: { getUiState: async () => ({}) },
    socialChatService,
    socialProjectStore,
    isTrustedSender: (sender) => sender === trustedSender,
    recordSocialReadiness: (readiness) => {
      recordedReadiness = readiness;
    },
  });

  assert.deepEqual(
    await harness.handlers.get(CHANNELS.socialState)({ sender: trustedSender }),
    {
      rooms: [],
      agents: [],
      projectWork: {
        available: false,
        reasonCode: 'executor_unavailable',
        reason: '执行器未就绪。',
      },
      projects: [project],
      teams: [],
    },
  );
  assert.deepEqual(recordedReadiness, {
    available: false,
    reasonCode: 'executor_unavailable',
    reason: '执行器未就绪。',
  });
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.socialProjectSession)(
      { sender: trustedSender },
      project.id,
      'researcher',
    ),
    {
      project: { id: project.id, title: project.title },
      agentId: 'researcher',
      room: { room: { id: 'room-project-session' } },
    },
  );
  const created = await harness.handlers.get(CHANNELS.socialCreateProject)(
    { sender: trustedSender },
    {
      title: project.title,
      brief: project.brief,
      agentIds: ['noema', 'researcher'],
      workspacePath: 'C:\\noema-test-workspace',
      workspaceIdentity: { path: 'C:\\noema-test-workspace', key: 'test' },
    },
  );
  assert.equal(created.groupRoomId, project.groupRoomId);
  assert.deepEqual(events[0], {
    type: 'chat-room-created',
    roomId: project.groupRoomId,
  });
  assert.equal(
    (
      await harness.handlers.get(CHANNELS.socialArchiveProject)(
        { sender: trustedSender },
        project.id,
      )
    ).status,
    'archived',
  );
  assert.equal(
    (
      await harness.handlers.get(CHANNELS.socialRestoreProject)(
        { sender: trustedSender },
        project.id,
      )
    ).status,
    'active',
  );
  assert.deepEqual(events.slice(1), [
    {
      type: 'project-updated',
      projectId: project.id,
      groupRoomId: project.groupRoomId,
    },
    {
      type: 'project-updated',
      projectId: project.id,
      groupRoomId: project.groupRoomId,
    },
  ]);
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.socialReopenProjectPlanEvidence)(
      { sender: trustedSender },
      { projectId: project.id, itemId: 'source', expectedRevision: 4 },
    ),
    { projectId: project.id, revision: 5 },
  );
  assert.deepEqual(events.at(-1), {
    type: 'project-updated',
    projectId: project.id,
    groupRoomId: project.groupRoomId,
  });
});
