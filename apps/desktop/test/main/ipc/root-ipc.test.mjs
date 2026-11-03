import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHANNELS,
  createImportAwareSendMessage,
  registerRootIpc,
} from '../../../src/main/ipc/root-ipc.mjs';

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

test('registers only named root-agent actions and rejects non-window senders', async () => {
  const harness = createIpcHarness();
  const rootAgent = {
    getUiState: async () => ({ messages: [] }),
    refreshModels: async () => ({ models: [] }),
    configureProvider: async (configuration) => configuration,
    setModel: async (model) => model,
    sendMessage: ({ text }) => ({ turnId: text }),
    saveCapture: (text) => ({ id: text }),
    updateCapture: (id, text) => ({ id, content: text }),
    deleteCapture: (id) => id === 'capture-1',
    discussCapture: (id) => ({ turnId: id }),
    retryTurn: ({ turnId }) => ({ turnId }),
    stopTurn: async () => true,
    setWorkspaceDirectory: (directory) => directory,
    clearWorkspaceDirectory: () => null,
    stopBackgroundTask: async () => true,
    resumeBackgroundTask: async (taskId) => ({ accepted: true, taskId }),
    retryBackgroundEvent: async (taskId) => ({
      accepted: true,
      completed: true,
      taskId,
    }),
    listCodexThreads: async () => [],
    previewCodexThread: async (threadId) => ({ threadId }),
    importCodexThread: async (input) => input,
    removeContextImport: () => true,
    addSocialInteractionAdjustment: async (input) => input,
    updateInteractionAdjustment: async (input) => input,
    withdrawInteractionAdjustment: (id) => id === 'adjustment-1',
  };
  const trustedSender = {};
  let quickCaptureFinished = 0;
  let quickCaptureReady = 0;
  let socialChatReady = 0;
  const authorizationEvents = [];
  const diagnosticCalls = [];
  const unregister = registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent,
    diagnosticsQueryService: {
      listRecent: (limit) => {
        diagnosticCalls.push(['recent', limit]);
        return { executions: [] };
      },
      getTimeline: (input) => {
        diagnosticCalls.push(['timeline', input]);
        return { events: [] };
      },
      getExportPreview: (input) => {
        diagnosticCalls.push(['preview', input]);
        return { previewId: 'preview-1' };
      },
    },
    getDiagnosticsDatabaseHealth: () => 'healthy',
    openUserDataDirectory: async () => ({
      opened: true,
      errorCode: null,
    }),
    saveDiagnosticsExport: async (previewId) => {
      diagnosticCalls.push(['save', previewId]);
      return { saved: true };
    },
    isTrustedSender: (sender) => sender === trustedSender,
    recordAuthorization: (...event) => authorizationEvents.push(event),
    chooseWorkspace: async () => 'D:\\Scratch',
    finishQuickCapture: () => {
      quickCaptureFinished += 1;
      return true;
    },
    getQuickCaptureShortcutStatus: () => ({
      accelerator: 'Control+Alt+N',
      registered: true,
    }),
    markQuickCaptureReady: () => {
      quickCaptureReady += 1;
      return true;
    },
    markSocialChatReady: () => {
      socialChatReady += 1;
      return true;
    },
  });

  assert.deepEqual(
    [...harness.handlers.keys()].sort(),
    [
      CHANNELS.models,
      CHANNELS.configureProvider,
      CHANNELS.configureWebSearch,
      CHANNELS.clearWebSearch,
      CHANNELS.retry,
      CHANNELS.selectModel,
      CHANNELS.send,
      CHANNELS.saveCapture,
      CHANNELS.updateCapture,
      CHANNELS.deleteCapture,
      CHANNELS.discussCapture,
      CHANNELS.state,
      CHANNELS.stop,
      CHANNELS.chooseWorkspace,
      CHANNELS.clearWorkspace,
      CHANNELS.stopWorker,
      CHANNELS.resumeWorker,
      CHANNELS.retryWorkerEvent,
      CHANNELS.listCodexThreads,
      CHANNELS.previewCodexThread,
      CHANNELS.importCodexThread,
      CHANNELS.removeContextImport,
      CHANNELS.addSocialInteractionAdjustment,
      CHANNELS.updateInteractionAdjustment,
      CHANNELS.withdrawInteractionAdjustment,
      CHANNELS.quickCaptureShortcutStatus,
      CHANNELS.markQuickCaptureReady,
      CHANNELS.markSocialChatReady,
      CHANNELS.finishQuickCapture,
      CHANNELS.diagnosticsRecent,
      CHANNELS.diagnosticsTimeline,
      CHANNELS.diagnosticsDatabaseHealth,
      CHANNELS.openUserDataDirectory,
      CHANNELS.diagnosticsExportPreview,
      CHANNELS.diagnosticsExportSave,
      CHANNELS.windowsRunnerCapability,
      CHANNELS.setupWindowsRunner,
    ].sort(),
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.send)(
      { sender: trustedSender },
      'hello',
    ),
    {
      turnId: 'hello',
    },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.saveCapture)(
      { sender: trustedSender },
      'note',
    ),
    { id: 'note' },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.updateCapture)(
      { sender: trustedSender },
      'capture-1',
      'edited',
    ),
    { id: 'capture-1', content: 'edited' },
  );
  assert.equal(
    await harness.handlers.get(CHANNELS.deleteCapture)(
      { sender: trustedSender },
      'capture-1',
    ),
    true,
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.discussCapture)(
      { sender: trustedSender },
      'capture-1',
    ),
    { turnId: 'capture-1' },
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
  assert.deepEqual(authorizationEvents, [
    ['legacy_workspace_access', 'revoked'],
  ]);
  assert.equal(
    await harness.handlers.get(CHANNELS.removeContextImport)({
      sender: trustedSender,
    }),
    true,
  );
  assert.deepEqual(authorizationEvents, [
    ['legacy_workspace_access', 'revoked'],
    ['imported_context_transmission', 'revoked'],
  ]);
  assert.equal(
    await harness.handlers.get(CHANNELS.withdrawInteractionAdjustment)(
      { sender: trustedSender },
      'adjustment-1',
    ),
    true,
  );
  const socialAdjustment = {
    sourceTurnId: 'social-turn-1',
    sourceRoomId: 'room-noema',
    scope: 'conversation',
    situation: '用户分享一段经历',
    behavior: '先自然回应，再继续交流。',
    sourceQuote: '继续交流',
  };
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.addSocialInteractionAdjustment)(
      { sender: trustedSender },
      socialAdjustment,
    ),
    socialAdjustment,
  );
  assert.equal(
    await harness.handlers.get(CHANNELS.finishQuickCapture)({
      sender: trustedSender,
    }),
    true,
  );
  assert.equal(quickCaptureFinished, 1);
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.quickCaptureShortcutStatus)({
      sender: trustedSender,
    }),
    { accelerator: 'Control+Alt+N', registered: true },
  );
  assert.equal(
    await harness.handlers.get(CHANNELS.markQuickCaptureReady)({
      sender: trustedSender,
    }),
    true,
  );
  assert.equal(quickCaptureReady, 1);
  assert.equal(
    await harness.handlers.get(CHANNELS.markSocialChatReady)({
      sender: trustedSender,
    }),
    true,
  );
  assert.equal(socialChatReady, 1);
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.updateInteractionAdjustment)(
      { sender: trustedSender },
      {
        id: 'adjustment-1',
        scope: 'both',
        situation: 'test situation',
        behavior: 'test behavior',
      },
    ),
    {
      id: 'adjustment-1',
      scope: 'both',
      situation: 'test situation',
      behavior: 'test behavior',
    },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.resumeWorker)(
      { sender: trustedSender },
      'task-1',
    ),
    { accepted: true, taskId: 'task-1' },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.retryWorkerEvent)(
      { sender: trustedSender },
      'task-1',
    ),
    { accepted: true, completed: true, taskId: 'task-1' },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.diagnosticsRecent)(
      { sender: trustedSender },
      12,
    ),
    { executions: [] },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.diagnosticsTimeline)(
      { sender: trustedSender },
      { taskId: 'task-1' },
    ),
    { events: [] },
  );
  assert.equal(
    await harness.handlers.get(CHANNELS.diagnosticsDatabaseHealth)({
      sender: trustedSender,
    }),
    'healthy',
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.openUserDataDirectory)(
      { sender: trustedSender },
      'C:\\attacker-selected-path',
    ),
    { opened: true, errorCode: null },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.diagnosticsExportPreview)(
      { sender: trustedSender },
      { taskId: 'task-1' },
    ),
    { previewId: 'preview-1' },
  );
  assert.deepEqual(
    await harness.handlers.get(CHANNELS.diagnosticsExportSave)(
      { sender: trustedSender },
      'preview-1',
    ),
    { saved: true },
  );
  assert.deepEqual(diagnosticCalls, [
    ['recent', 12],
    ['timeline', { taskId: 'task-1' }],
    ['preview', { taskId: 'task-1' }],
    ['save', 'preview-1'],
  ]);
  await assert.rejects(
    harness.handlers.get(CHANNELS.state)({ sender: {} }),
    /未授权/,
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.diagnosticsRecent)({ sender: {} }),
    /未授权/,
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.openUserDataDirectory)({ sender: {} }),
    /未授权/,
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.finishQuickCapture)({ sender: {} }),
    /未授权/,
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.quickCaptureShortcutStatus)({ sender: {} }),
    /未授权/,
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.markQuickCaptureReady)({ sender: {} }),
    /未授权/,
  );
  await assert.rejects(
    harness.handlers.get(CHANNELS.updateInteractionAdjustment)(
      { sender: {} },
      {
        id: 'adjustment-1',
        scope: 'both',
        situation: 'unauthorized edit',
        behavior: 'must not be saved',
      },
    ),
    /未授权/,
  );
  unregister();
  assert.equal(harness.handlers.size, 0);
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
    protocolVersion: 6,
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
    rootAgent: { getUiState: () => ({ messages: [] }) },
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
      harness.handlers.get(CHANNELS.state)({
        sender: trustedSender,
        senderFrame: { parent: trustedSender.mainFrame },
      }),
      /未授权的应用窗口请求/u,
    );
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

test('workspace selection cancellation creates no legacy workspace grant', async () => {
  const harness = createIpcHarness();
  const trustedSender = { mainFrame: { parent: null } };
  let workspaceChanges = 0;
  const unregister = registerRootIpc({
    ipcMain: harness.ipcMain,
    rootAgent: {
      getUiState: () => ({ messages: [] }),
      setWorkspaceDirectory: () => {
        workspaceChanges += 1;
      },
    },
    isTrustedSender: (sender) => sender === trustedSender,
    chooseWorkspace: async () => null,
  });
  try {
    assert.equal(
      await harness.handlers.get(CHANNELS.chooseWorkspace)({
        sender: trustedSender,
      }),
      null,
    );
    assert.equal(workspaceChanges, 0);
  } finally {
    unregister();
  }
});

test('personal memory management is exposed only through trusted desktop IPC', async () => {
  const harness = createIpcHarness();
  const trustedSender = {};
  const calls = [];
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
  await assert.rejects(
    harness.handlers.get(CHANNELS.personalMemories)({ sender: {} }),
    /未授权/u,
  );
});

test('Codex import sends nothing until transmission consent and remains revocable', async () => {
  let consented = false;
  let sends = 0;
  let prompts = 0;
  const rootAgent = {
    getUnconsentedContextImport: () =>
      consented ? null : { title: '测试会话' },
    consentToContextImportTransmission: () => {
      consented = true;
    },
    sendMessage: ({ text }) => {
      sends += 1;
      return { turnId: text };
    },
  };
  const cancel = createImportAwareSendMessage(rootAgent, async () => {
    prompts += 1;
    return false;
  });
  assert.deepEqual(await cancel('不应发送'), { canceled: true });
  assert.equal(sends, 0);
  assert.equal(consented, false);

  const approve = createImportAwareSendMessage(rootAgent, async (snapshot) => {
    prompts += 1;
    assert.equal(snapshot.title, '测试会话');
    return true;
  });
  assert.deepEqual(await approve('允许发送'), { turnId: '允许发送' });
  assert.equal(consented, true);
  assert.equal(sends, 1);

  assert.deepEqual(await approve('之后继续'), { turnId: '之后继续' });
  assert.equal(prompts, 2);
  assert.equal(sends, 2);
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
      projectWork: { available: false, reason: '执行器未就绪。' },
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
      projectWork: { available: false, reason: '执行器未就绪。' },
      projects: [project],
    },
  );
  assert.deepEqual(recordedReadiness, {
    available: false,
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
