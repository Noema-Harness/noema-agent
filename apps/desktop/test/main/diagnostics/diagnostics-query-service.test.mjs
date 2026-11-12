import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { DiagnosticsQueryService } from '../../../src/main/diagnostics/diagnostics-query-service.mjs';
import { saveDiagnosticsExport } from '../../../src/main/diagnostics/save-diagnostics-export.mjs';
import { DiagnosticsEventStore } from '../../../src/main/storage/diagnostics-event-store.mjs';
import { ModelUsageStore } from '../../../src/main/storage/model-usage-store.mjs';

function createService({
  maxEvents = 20_000,
  task = null,
  now,
  recordDiagnosticEvent,
  runtimeInfo = null,
  rootStore = null,
} = {}) {
  const db = new Database(':memory:');
  const eventStore = new DiagnosticsEventStore(db, { maxEvents });
  const modelUsageStore = new ModelUsageStore(db);
  const service = new DiagnosticsQueryService({
    eventStore,
    modelUsageStore,
    recordDiagnosticEvent,
    socialChatStore: task ? { getSocialWorkTask: () => task } : null,
    rootStore,
    runtimeInfo,
    now,
  });
  return { db, eventStore, modelUsageStore, service };
}

test('personal memory diagnostics are queryable by execution identity without exporting content', () => {
  const memorySentinel = 'PRIVATE_MEMORY_BODY_SENTINEL';
  const querySentinel = 'PRIVATE_MEMORY_QUERY_SENTINEL';
  const sourceSentinel = 'PRIVATE_SOURCE_MESSAGE_SENTINEL';
  const { db, eventStore, service } = createService();
  try {
    eventStore.record({
      applicationExecutionId: 'app-memory',
      executionId: 'turn-memory-settings',
      module: 'social.memory',
      operation: 'settings.add',
      status: 'completed',
      details: {
        memoryText: memorySentinel,
        query: querySentinel,
        sourceMessage: sourceSentinel,
      },
    });
    eventStore.record({
      applicationExecutionId: 'app-memory',
      executionId: 'turn-memory-chat',
      turnId: 'turn-memory-chat',
      requestId: 'request-memory-chat',
      toolCallId: 'call-memory-chat',
      module: 'social.memory',
      operation: 'memory.retrieval',
      status: 'hit',
    });

    const timeline = service.getTimeline({
      executionId: 'turn-memory-chat',
    });
    assert.equal(timeline.events.length, 1);
    assert.equal(timeline.events[0].requestId, 'request-memory-chat');
    assert.equal(timeline.events[0].toolCallId, 'call-memory-chat');

    const preview = service.getExportPreview({
      executionId: 'turn-memory-settings',
    });
    assert.equal(preview.executionId, 'turn-memory-settings');
    assert.doesNotMatch(
      preview.reportJson,
      /PRIVATE_MEMORY_BODY_SENTINEL|PRIVATE_MEMORY_QUERY_SENTINEL|PRIVATE_SOURCE_MESSAGE_SENTINEL/u,
    );
  } finally {
    db.close();
  }
});

test('follow-up lifecycle query follows the stable execution and excludes reminder content', () => {
  const title = 'PRIVATE_FOLLOWUP_TITLE_SENTINEL';
  const body = 'PRIVATE_FOLLOWUP_BODY_SENTINEL';
  const source = 'PRIVATE_FOLLOWUP_SOURCE_SENTINEL';
  const { db, eventStore, service } = createService();
  try {
    eventStore.record({
      applicationExecutionId: 'app-followup',
      executionId: 'followup-execution-1',
      parentExecutionId: 'social-turn-1',
      turnId: 'social-turn-1',
      requestId: 'request-followup-1',
      toolCallId: 'call-followup-1',
      module: 'social.followup',
      operation: 'followup.schedule',
      status: 'created',
      details: { title, body, source },
    });
    eventStore.record({
      applicationExecutionId: 'app-followup',
      executionId: 'followup-execution-1',
      module: 'social.followup',
      operation: 'followup.delivery.claimed',
      status: 'claimed',
    });
    const timeline = service.getTimeline({
      executionId: 'followup-execution-1',
    });
    assert.deepEqual(
      timeline.events.map((event) => event.operation),
      ['followup.schedule', 'followup.delivery.claimed'],
    );
    assert.equal(timeline.events[0].parentExecutionId, 'social-turn-1');
    assert.equal(timeline.events[0].requestId, 'request-followup-1');
    const preview = service.getExportPreview({
      executionId: 'followup-execution-1',
    });
    assert.doesNotMatch(
      preview.reportJson,
      /PRIVATE_FOLLOWUP_(TITLE|BODY|SOURCE)_SENTINEL/u,
    );
  } finally {
    db.close();
  }
});

test('Noema workspace entry trace connects readiness, picker cancellation and created task without exposing task content', () => {
  const taskPrompt = 'PRIVATE_WORKSPACE_TASK_PROMPT_SENTINEL';
  const workspacePath = 'C:\\PRIVATE_WORKSPACE_PATH_SENTINEL';
  const { db, eventStore, service } = createService({
    task: {
      id: 'workspace-entry-task',
      status: 'completed',
      verificationStatus: 'verified',
      errorCode: null,
      executionEngine: 'noema',
      taskPrompt,
      workspacePath,
      resultText: 'PRIVATE_WORKSPACE_RESULT_SENTINEL',
      errorMessage: null,
      executionSteps: [],
    },
  });
  try {
    eventStore.record({
      applicationExecutionId: 'app-workspace-entry',
      executionId: 'app-workspace-entry',
      module: 'desktop.main',
      operation: 'entry.route_selected',
      status: 'observed',
    });
    eventStore.record({
      applicationExecutionId: 'app-workspace-entry',
      executionId: 'app-workspace-entry',
      module: 'desktop.main',
      operation: 'entry.capability_availability',
      status: 'available',
    });
    eventStore.record({
      applicationExecutionId: 'app-workspace-entry',
      parentExecutionId: 'app-workspace-entry',
      module: 'social.work',
      operation: 'workspace.selection',
      status: 'canceled',
      details: { reasonCode: 'user_cancelled' },
    });
    eventStore.record({
      applicationExecutionId: 'app-workspace-entry',
      executionId: 'workspace-entry-task',
      parentExecutionId: 'app-workspace-entry',
      taskId: 'workspace-entry-task',
      module: 'social.work',
      operation: 'task.created_from_entry',
      status: 'starting',
    });
    eventStore.record({
      applicationExecutionId: 'app-workspace-entry',
      executionId: 'workspace-entry-task',
      taskId: 'workspace-entry-task',
      module: 'social.work',
      operation: 'task.finished',
      status: 'completed',
    });

    const entryTimeline = service.getTimeline({
      executionId: 'app-workspace-entry',
    });
    assert.deepEqual(
      entryTimeline.events.map((event) => event.operation),
      [
        'entry.route_selected',
        'entry.capability_availability',
        'workspace.selection',
        'task.created_from_entry',
      ],
    );
    assert.equal(entryTimeline.task?.id, 'workspace-entry-task');
    assert.equal(entryTimeline.events[2].status, 'canceled');
    assert.equal(
      entryTimeline.events[3].parentExecutionId,
      'app-workspace-entry',
    );

    const taskTimeline = service.getTimeline({
      taskId: 'workspace-entry-task',
    });
    assert.equal(taskTimeline.events.at(-1)?.operation, 'task.finished');
    assert.ok(
      taskTimeline.events.every(
        (event) => event.applicationExecutionId === 'app-workspace-entry',
      ),
    );

    const preview = service.getExportPreview({
      executionId: 'app-workspace-entry',
    });
    assert.match(preview.reportJson, /workspace-entry-task/u);
    assert.doesNotMatch(
      preview.reportJson,
      /PRIVATE_WORKSPACE_(TASK_PROMPT|PATH|RESULT)_SENTINEL/u,
    );
  } finally {
    db.close();
  }
});

test('timeline joins usage by stable request id and projects only safe task fields', () => {
  const secretPrompt = 'PRIVATE_PROMPT_SENTINEL';
  const secretPath = 'C:\\PRIVATE_PATH_SENTINEL';
  const secretResult = 'PRIVATE_RESULT_SENTINEL';
  const { db, eventStore, modelUsageStore, service } = createService({
    task: {
      id: 'task-1',
      status: 'completed',
      verificationStatus: 'verified',
      errorCode: null,
      executionEngine: 'noema',
      taskPrompt: secretPrompt,
      workspacePath: secretPath,
      resultText: secretResult,
      errorMessage: 'PRIVATE_ERROR_SENTINEL',
      executionSteps: [
        {
          index: 0,
          category: 'write',
          status: 'succeeded',
          effectStatus: 'applied',
          command: 'PRIVATE_COMMAND_SENTINEL',
          result: secretResult,
        },
      ],
    },
  });
  try {
    eventStore.record({
      applicationExecutionId: 'app-1',
      executionId: 'task-1',
      taskId: 'task-1',
      requestId: 'request-1',
      module: 'provider',
      operation: 'request.completed',
      status: 'completed',
    });
    eventStore.record({
      applicationExecutionId: 'app-1',
      executionId: 'task-1',
      taskId: 'task-1',
      toolCallId: 'call-1',
      module: 'executor',
      operation: 'tool.result',
      status: 'completed',
      details: { effectStatus: 'applied', path: secretPath },
    });
    modelUsageStore.record({
      requestId: 'request-1',
      executionId: 'task-1',
      interactionId: 'task-1',
      model: 'model-a',
      providerHost: 'api.example.test',
      operation: 'project_execution',
      requestStatus: 'completed',
      usageReceived: true,
      inputTokens: 70,
      outputTokens: 8,
      cachedInputTokens: 50,
      cacheMissTokens: 20,
      cacheWriteTokens: 3,
      requestCharacters: 4_000,
      messageRoleCharacters: {
        system: 1_000,
        developer: 100,
        user: 700,
        assistant: 1_200,
        tool: 1_000,
        other: 0,
      },
      toolDefinitionCharacters: 2_100,
      messageCount: 9,
      toolCount: 2,
    });
    modelUsageStore.record({
      requestId: 'request-legacy',
      executionId: 'task-1',
      interactionId: 'task-1',
      model: 'legacy-model',
      providerHost: 'api.example.test',
      operation: 'project_execution',
      requestStatus: 'completed',
      usageReceived: false,
    });

    const timeline = service.getTimeline({ taskId: 'task-1' });
    assert.equal(timeline.usage.length, 2);
    const currentUsage = timeline.usage.find(
      (row) => row.requestId === 'request-1',
    );
    const legacyUsage = timeline.usage.find(
      (row) => row.requestId === 'request-legacy',
    );
    assert.equal(currentUsage.inputTokens, 70);
    assert.equal(currentUsage.cacheWriteTokens, 3);
    assert.equal(currentUsage.requestCharacters, 4_000);
    assert.deepEqual(currentUsage.messageRoleCharacters, {
      system: 1_000,
      developer: 100,
      user: 700,
      assistant: 1_200,
      tool: 1_000,
      other: 0,
    });
    assert.equal(currentUsage.toolDefinitionCharacters, 2_100);
    assert.equal(currentUsage.messageCount, 9);
    assert.equal(currentUsage.toolCount, 2);
    assert.equal(legacyUsage.requestCharacters, null);
    assert.equal(legacyUsage.messageRoleCharacters, null);
    assert.equal(legacyUsage.toolDefinitionCharacters, null);
    assert.equal(legacyUsage.messageCount, null);
    assert.equal(legacyUsage.toolCount, null);
    assert.equal(timeline.task.status, 'completed');
    assert.equal(timeline.task.executionSteps[0].effectStatus, 'applied');
    assert.equal('taskPrompt' in timeline.task, false);
    assert.equal('workspacePath' in timeline.task, false);
    assert.equal('resultText' in timeline.task, false);
    assert.equal('command' in timeline.task.executionSteps[0], false);

    const preview = service.getExportPreview({ taskId: 'task-1' });
    assert.equal(preview.eventCount, 2);
    assert.equal(preview.usageCount, 2);
    assert.equal(preview.includesTestContext, false);
    const json = service.consumeExportPreview(preview.previewId);
    assert.equal(typeof json, 'string');
    assert.equal(preview.reportJson, json);
    assert.ok(
      JSON.parse(json).usage.some((usage) => usage.cacheWriteTokens === 3),
    );
    assert.equal(json.includes('requestCharacters'), false);
    assert.equal(json.includes('messageRoleCharacters'), false);
    assert.equal(JSON.parse(json).testContext, undefined);
    for (const sentinel of [
      secretPrompt,
      secretPath,
      secretResult,
      'PRIVATE_ERROR_SENTINEL',
      'PRIVATE_COMMAND_SENTINEL',
    ]) {
      assert.equal(json.includes(sentinel), false, sentinel);
    }
    assert.match(json, /business_store_row_writes_not_recorded/u);
    assert.equal(service.consumeExportPreview(preview.previewId), null);
  } finally {
    db.close();
  }
});

test('runtime manifest is returned locally and included in the reviewed export', () => {
  const runtime = {
    applicationVersion: '0.1.0',
    electronVersion: '44.9.3',
    nodeVersion: '24.21.0',
    osVersion: '10.0.19045',
    platform: 'win32',
    architecture: 'x64',
    isPackaged: true,
    socialSchemaVersion: 33,
    diagnosticsSchemaVersion: 1,
  };
  const { db, eventStore, service } = createService({ runtimeInfo: runtime });
  try {
    eventStore.record({
      applicationExecutionId: 'app-1',
      executionId: 'task-1',
      taskId: 'task-1',
      module: 'social.work',
      operation: 'task.finished',
      status: 'completed',
    });
    assert.deepEqual(service.listRecent().runtime, runtime);
    const timeline = service.getTimeline({ executionId: 'task-1' });
    assert.deepEqual(timeline.runtime, runtime);
    const preview = service.getExportPreview({ executionId: 'task-1' });
    const report = JSON.parse(preview.reportJson);
    assert.deepEqual(report.runtime, runtime);
    assert.match(
      report.manifest.included.join(' '),
      /applied schema versions/u,
    );
    assert.doesNotMatch(
      preview.reportJson,
      /workspacePath|userDataPath|C:\\\\/u,
    );
  } finally {
    db.close();
  }
});

test('test context is opt-in, limited to the selected turn/task, and redacted', () => {
  const token = 'sk-abcdefghijklmnopqrstuvwxyz012345';
  const { db, eventStore, service } = createService({
    task: {
      id: 'task-1',
      status: 'failed',
      verificationStatus: 'unavailable',
      errorCode: 'verification_unavailable',
      executionEngine: 'noema',
      taskPrompt: `Check this test case; api_key=${token} ${'x'.repeat(17_000)}`,
      resultText: 'The command stopped before writing.',
      errorMessage: 'Expected one file.',
      workspacePath: 'C:\\PRIVATE_PATH',
      executionSteps: [],
    },
    rootStore: {
      getTurnMessagesForDiagnostics: () => [
        {
          role: 'user',
          status: 'complete',
          attempt: 1,
          content: 'Please reproduce the failure.',
        },
        {
          role: 'assistant',
          status: 'complete',
          attempt: 1,
          content: 'I found the cause.',
        },
      ],
    },
  });
  try {
    eventStore.record({
      applicationExecutionId: 'app-1',
      executionId: 'task-1',
      taskId: 'task-1',
      turnId: 'turn-1',
      module: 'social.work',
      operation: 'task.finished',
      status: 'failed',
    });
    const preview = service.getExportPreview({ taskId: 'task-1' });
    assert.equal(preview.includesTestContext, false);
    const contextPreview = service.getExportPreview({
      taskId: 'task-1',
      includeTestContext: true,
    });
    const report = JSON.parse(contextPreview.reportJson);
    assert.equal(contextPreview.includesTestContext, true);
    assert.equal(report.testContext.messages.length, 2);
    assert.equal(
      report.testContext.messages[0].content,
      'Please reproduce the failure.',
    );
    assert.match(report.testContext.task.prompt, /已隐藏疑似凭据/u);
    assert.equal(report.testContext.task.prompt.length, 16_000);
    assert.equal(contextPreview.testContextTruncated, true);
    assert.equal(
      report.testContext.task.result,
      'The command stopped before writing.',
    );
    assert.equal(report.testContext.redacted, true);
    assert.equal(report.task.taskPrompt, undefined);
    assert.equal(report.testContext.task.workspacePath, undefined);
    assert.equal(contextPreview.reportJson.includes(token), false);
    assert.equal(contextPreview.reportJson.includes('PRIVATE_PATH'), false);
    service.discardExportPreview(preview.previewId);
    service.discardExportPreview(contextPreview.previewId);
  } finally {
    db.close();
  }
});

test('RootAgent timeline includes correlated DSH process and task evidence', () => {
  const dshTask = {
    id: 'dsh-task-1',
    sourceTurnId: 'turn-1',
    status: 'completed',
    harness: 'dsh',
    prompt: 'Create and verify the requested test fixture.',
    resultText: 'Fixture created and checked.',
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-11-04T01:00:00.000Z',
    updatedAt: '2026-11-04T01:00:02.000Z',
    completedAt: '2026-11-04T01:00:02.000Z',
  };
  const rootStore = {
    getTurnMessagesForDiagnostics: () => [
      {
        role: 'user',
        status: 'complete',
        attempt: 1,
        content: 'Please make a small test fixture.',
      },
      {
        role: 'assistant',
        status: 'complete',
        attempt: 1,
        content: 'The fixture is ready.',
      },
    ],
    getBackgroundTask: (id) => (id === dshTask.id ? dshTask : null),
    getBackgroundTaskForTurn: (id) => (id === 'turn-1' ? dshTask : null),
  };
  const { db, eventStore, modelUsageStore, service } = createService({
    rootStore,
  });
  try {
    for (const [operation, status, taskId] of [
      ['turn.started', 'started', null],
      ['task.started', 'started', dshTask.id],
      ['process.started', 'started', dshTask.id],
      ['process.exited', 'completed', dshTask.id],
      ['task.finished', 'completed', dshTask.id],
      ['turn.completed', 'completed', null],
    ]) {
      eventStore.record({
        applicationExecutionId: 'app-1',
        executionId: taskId ?? 'turn-1',
        parentExecutionId: taskId ? 'turn-1' : null,
        taskId,
        turnId: 'turn-1',
        module:
          operation.startsWith('process.') || taskId ? 'dsh' : 'root.agent',
        operation,
        status,
      });
    }
    modelUsageStore.record({
      interactionId: dshTask.id,
      model: 'test-model',
      providerHost: 'api.example.test',
      operation: 'dsh_worker_step',
      requestStatus: 'completed',
      usageReceived: true,
      inputTokens: 44,
      outputTokens: 11,
    });

    const timeline = service.getTimeline({ executionId: 'turn-1' });
    assert.equal(timeline.task.id, dshTask.id);
    assert.equal(timeline.task.executionEngine, 'dsh');
    assert.ok(
      timeline.events.some((event) => event.operation === 'process.exited'),
    );
    assert.equal(timeline.usage[0].interactionId, dshTask.id);
    assert.equal(
      timeline.coverageGaps.includes('os_child_process_lifecycle_not_recorded'),
      false,
    );
    const preview = service.getExportPreview({
      executionId: 'turn-1',
      includeTestContext: true,
    });
    const report = JSON.parse(preview.reportJson);
    assert.equal(report.testContext.task.prompt, dshTask.prompt);
    assert.equal(report.testContext.task.result, dshTask.resultText);
    service.discardExportPreview(preview.previewId);
  } finally {
    db.close();
  }
});

test('timeline marks empty and truncated data as coverage gaps', () => {
  const { db, eventStore, service } = createService();
  try {
    for (let index = 0; index < 3; index += 1) {
      eventStore.record({
        applicationExecutionId: 'app-1',
        executionId: 'task-1',
        taskId: 'task-1',
        module: 'social.work',
        operation: `task.phase-${index}`,
        status: 'observed',
        occurredAt: new Date(Date.UTC(2026, 10, 2, 0, index)).toISOString(),
      });
    }
    const timeline = service.getTimeline({ taskId: 'task-1', limit: 1 });
    assert.equal(timeline.truncated, true);
    assert.ok(timeline.coverageGaps.includes('timeline_truncated'));
    assert.ok(
      service
        .getTimeline({ taskId: 'missing-task' })
        .coverageGaps.includes('no_persisted_events'),
    );
  } finally {
    db.close();
  }
});

test('unavailable event details remain a visible timeline and export gap', () => {
  const { db, eventStore, service } = createService();
  try {
    eventStore.record({
      applicationExecutionId: 'app-1',
      executionId: 'task-damaged-details',
      taskId: 'task-damaged-details',
      module: 'social.work',
      operation: 'task.finished',
      status: 'completed',
      details: { route: 'social' },
    });
    db.prepare(
      'UPDATE diagnostic_events SET details_json = ? WHERE execution_id = ?',
    ).run('{PRIVATE_PROMPT_SENTINEL', 'task-damaged-details');

    const timeline = service.getTimeline({ taskId: 'task-damaged-details' });
    assert.equal(timeline.events.length, 1);
    assert.equal(timeline.events[0].detailsStatus, 'unavailable');
    assert.ok(
      timeline.coverageGaps.includes('diagnostic_event_details_unavailable'),
    );
    assert.equal(JSON.stringify(timeline).includes('PRIVATE_PROMPT'), false);

    const preview = service.getExportPreview({
      taskId: 'task-damaged-details',
    });
    assert.equal(preview.schemaVersion, 3);
    assert.ok(
      preview.coverageGaps.includes('diagnostic_event_details_unavailable'),
    );
    assert.ok(
      preview.reportJson.includes('diagnostic_event_details_unavailable'),
    );
    assert.equal(preview.reportJson.includes('PRIVATE_PROMPT'), false);
  } finally {
    db.close();
  }
});

test('timeline retains ordered provider request lifecycle phases by request identity', () => {
  const { db, eventStore, modelUsageStore, service } = createService();
  try {
    const phases = [
      ['request.started', 'running'],
      ['request.first_output', 'running'],
      ['request.usage_missing', 'unknown'],
      ['request.completed', 'completed'],
    ];
    for (const [index, [operation, status]] of phases.entries()) {
      eventStore.record({
        applicationExecutionId: 'app-lifecycle',
        executionId: 'task-lifecycle',
        taskId: 'task-lifecycle',
        turnId: 'turn-lifecycle',
        requestId: 'request-lifecycle',
        module: 'provider',
        operation,
        status,
        occurredAt: new Date(Date.UTC(2026, 10, 2, 0, 0, index)).toISOString(),
        details: { elapsedMs: index * 12 },
      });
    }
    modelUsageStore.record({
      requestId: 'request-lifecycle',
      executionId: 'task-lifecycle',
      interactionId: 'task-lifecycle',
      turnId: 'turn-lifecycle',
      requestStatus: 'completed',
      usageReceived: false,
    });

    const timeline = service.getTimeline({ taskId: 'task-lifecycle' });
    assert.deepEqual(
      timeline.events.map((event) => event.operation),
      phases.map(([operation]) => operation),
    );
    assert.ok(
      timeline.events.every((event) => event.requestId === 'request-lifecycle'),
    );
    assert.equal(timeline.usage[0].usageReceived, false);
    assert.equal(timeline.usage[0].inputTokens, null);
  } finally {
    db.close();
  }
});

test('task diagnostics and export group provider usage across distinct resume segments', () => {
  const { db, eventStore, modelUsageStore, service } = createService();
  try {
    for (const [index, executionId] of [
      'segment-initial',
      'segment-resume-1',
    ].entries()) {
      const requestId = `request-${executionId}`;
      eventStore.record({
        applicationExecutionId: 'app-resume-trace',
        executionId,
        parentExecutionId: 'task-resume-trace',
        taskId: 'task-resume-trace',
        turnId: 'source-turn-resume-trace',
        requestId,
        module: 'provider',
        operation: 'request.completed',
        status: 'completed',
        details: {
          prompt: `PRIVATE_PROMPT_${executionId}`,
          workspacePath: `PRIVATE_PATH_${executionId}`,
          commandText: `PRIVATE_COMMAND_${executionId}`,
        },
        occurredAt: new Date(Date.UTC(2026, 10, 6, 0, 0, index)).toISOString(),
      });
      modelUsageStore.record({
        requestId,
        executionId,
        interactionId: 'task-resume-trace',
        turnId: 'source-turn-resume-trace',
        operation: 'project_execution',
        requestStatus: 'completed',
        usageReceived: true,
        inputTokens: 41 + index,
        outputTokens: 9,
      });
    }

    const taskTimeline = service.getTimeline({ taskId: 'task-resume-trace' });
    assert.deepEqual(
      taskTimeline.events.map((event) => event.executionId),
      ['segment-initial', 'segment-resume-1'],
    );
    assert.deepEqual(
      taskTimeline.usage.map((row) => row.executionId),
      ['segment-initial', 'segment-resume-1'],
    );
    assert.ok(
      taskTimeline.usage.every(
        (row) =>
          row.interactionId === 'task-resume-trace' &&
          row.turnId === 'source-turn-resume-trace',
      ),
    );

    const segmentTimeline = service.getTimeline({
      executionId: 'segment-resume-1',
    });
    assert.equal(segmentTimeline.taskId, 'task-resume-trace');
    assert.deepEqual(
      segmentTimeline.usage.map((row) => row.requestId),
      ['request-segment-resume-1'],
    );

    const preview = service.getExportPreview({ taskId: 'task-resume-trace' });
    const report = JSON.parse(preview.reportJson);
    assert.equal(preview.usageCount, 2);
    assert.deepEqual(
      report.usage.map((row) => row.executionId),
      ['segment-initial', 'segment-resume-1'],
    );
    assert.ok(
      report.usage.every((row) => row.turnId === 'source-turn-resume-trace'),
    );
    assert.doesNotMatch(
      preview.reportJson,
      /PRIVATE_PROMPT|PRIVATE_PATH|PRIVATE_COMMAND/u,
    );
  } finally {
    db.close();
  }
});

test('an absent task owner record becomes a coverage gap, not a private exception', () => {
  const { db, eventStore, service } = createService({
    task: {
      id: 'different-task',
      get status() {
        throw new Error('PRIVATE_DATABASE_PATH');
      },
    },
  });
  try {
    eventStore.record({
      applicationExecutionId: 'app-1',
      executionId: 'task-1',
      taskId: 'task-1',
      module: 'social.work',
      operation: 'task.finished',
      status: 'completed',
    });
    const timeline = service.getTimeline({ taskId: 'task-1' });
    assert.equal(timeline.task, null);
    assert.ok(timeline.coverageGaps.includes('task_owner_record_unavailable'));
    assert.equal(
      JSON.stringify(timeline).includes('PRIVATE_DATABASE_PATH'),
      false,
    );
  } finally {
    db.close();
  }
});

test('export save cancellation writes nothing and failed writes keep the preview retryable', async () => {
  const { db, eventStore, service } = createService();
  try {
    eventStore.record({
      applicationExecutionId: 'app-1',
      executionId: 'turn-1',
      turnId: 'turn-1',
      module: 'provider',
      operation: 'request.failed',
      status: 'failed',
      errorCode: 'network_unavailable',
    });
    const canceledPreview = service.getExportPreview({ executionId: 'turn-1' });
    let writes = 0;
    const canceled = await saveDiagnosticsExport({
      previewId: canceledPreview.previewId,
      queryService: service,
      selectFile: async () => ({ canceled: true }),
      writeFile: async () => {
        writes += 1;
      },
    });
    assert.deepEqual(canceled, { saved: false, canceled: true });
    assert.equal(writes, 0);

    const failedPreview = service.getExportPreview({ executionId: 'turn-1' });
    const failed = await saveDiagnosticsExport({
      previewId: failedPreview.previewId,
      queryService: service,
      selectFile: async () => ({
        canceled: false,
        filePath: 'C:\\report.json',
      }),
      writeFile: async () => {
        throw new Error('PRIVATE_PATH_ERROR');
      },
    });
    assert.deepEqual(failed, { saved: false, errorCode: 'write_failed' });
    assert.equal(
      typeof service.getExportFileContent(failedPreview.previewId),
      'string',
    );
    assert.equal(JSON.stringify(failed).includes('PRIVATE_PATH_ERROR'), false);
  } finally {
    db.close();
  }
});

test('diagnostics queries create parent-linked local trace facts and isolate sink errors', () => {
  const events = [];
  const { db, eventStore, service } = createService({
    recordDiagnosticEvent: (event) => {
      events.push(event);
      throw new Error('sink failure');
    },
  });
  try {
    eventStore.record({
      applicationExecutionId: 'app-1',
      executionId: 'task-1',
      taskId: 'task-1',
      module: 'social.work',
      operation: 'task.finished',
      status: 'completed',
    });
    assert.equal(service.listRecent().executions.length, 1);
    assert.equal(service.getTimeline({ taskId: 'task-1' }).events.length, 1);
    service.getExportPreview({ taskId: 'task-1' });
    assert.deepEqual(
      events.map(({ operation, status }) => [operation, status]),
      [
        ['query.recent', 'completed'],
        ['query.timeline', 'completed'],
        ['query.timeline', 'completed'],
        ['export.preview', 'prepared'],
      ],
    );
    assert.equal(events[1].parentExecutionId, 'task-1');
  } finally {
    db.close();
  }
});
