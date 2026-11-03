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
} = {}) {
  const db = new Database(':memory:');
  const eventStore = new DiagnosticsEventStore(db, { maxEvents });
  const modelUsageStore = new ModelUsageStore(db);
  const service = new DiagnosticsQueryService({
    eventStore,
    modelUsageStore,
    recordDiagnosticEvent,
    socialChatStore: task ? { getSocialWorkTask: () => task } : null,
    runtimeInfo,
    now,
  });
  return { db, eventStore, modelUsageStore, service };
}

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
    const json = service.consumeExportPreview(preview.previewId);
    assert.equal(typeof json, 'string');
    assert.equal(preview.reportJson, json);
    assert.equal(json.includes('requestCharacters'), false);
    assert.equal(json.includes('messageRoleCharacters'), false);
    for (const sentinel of [
      secretPrompt,
      secretPath,
      secretResult,
      'PRIVATE_ERROR_SENTINEL',
      'PRIVATE_COMMAND_SENTINEL',
    ]) {
      assert.equal(json.includes(sentinel), false, sentinel);
    }
    assert.match(json, /os_child_process_lifecycle_not_recorded/u);
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
      timeline.coverageGaps.includes('os_child_process_lifecycle_not_recorded'),
    );
    assert.ok(
      service
        .getTimeline({ taskId: 'missing-task' })
        .coverageGaps.includes('no_persisted_events'),
    );
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
