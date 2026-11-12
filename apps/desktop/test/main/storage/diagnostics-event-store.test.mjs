import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { DiagnosticsEventStore } from '../../../src/main/storage/diagnostics-event-store.mjs';

test('diagnostic events use a versioned schema and only store allowlisted details', () => {
  const db = new Database(':memory:');
  try {
    const store = new DiagnosticsEventStore(db);
    assert.equal(
      store.record({
        applicationExecutionId: 'app-1',
        executionId: 'task-1',
        taskId: 'task-1',
        module: 'executor',
        operation: 'tool.result',
        status: 'failed',
        errorCode: 'tool_error',
        details: {
          toolName: 'run_command',
          pluginId: 'noema.sample.contract',
          reason: 'Bearer abcdefghijklmnopqrstuvwxyz012345',
          elapsedMs: 42,
          prompt: 'do not persist this prompt',
          path: 'C:\\private\\workspace',
        },
      }),
      true,
    );
    const events = store.query({ taskId: 'task-1' });
    assert.equal(events.length, 1);
    assert.equal(events[0].schemaVersion, 1);
    assert.equal(events[0].detailsStatus, 'complete');
    assert.equal(events[0].details.toolName, 'run_command');
    assert.equal(events[0].details.pluginId, 'noema.sample.contract');
    assert.equal(events[0].details.elapsedMs, 42);
    assert.match(events[0].details.reason, /已隐藏疑似凭据/u);
    assert.equal('prompt' in events[0].details, false);
    assert.equal('path' in events[0].details, false);
    assert.equal(store.getStatus().count, 1);
  } finally {
    db.close();
  }
});

test('request lifecycle events preserve only safe timing and status metadata', () => {
  const db = new Database(':memory:');
  try {
    const store = new DiagnosticsEventStore(db);
    store.record({
      applicationExecutionId: 'app-request-lifecycle',
      executionId: 'exec-request-lifecycle',
      turnId: 'turn-request-lifecycle',
      requestId: 'request-request-lifecycle',
      module: 'provider',
      operation: 'request.first_output',
      status: 'running',
      details: {
        requestStatus: 'running',
        elapsedMs: 18,
        backendId: 'noema-codex-windows',
        backendVersion: '0.1.0',
        policyVersion: 3,
        protocolVersion: 7,
        capabilityStatus: 'ready',
        path: 'C:\\private\\runner.exe',
        content: 'PRIVATE RESPONSE SENTINEL',
      },
    });
    const [event] = store.query({ executionId: 'exec-request-lifecycle' });
    assert.equal(event.operation, 'request.first_output');
    assert.equal(event.status, 'running');
    assert.equal(event.details.requestStatus, 'running');
    assert.equal(event.detailsStatus, 'complete');
    assert.equal(event.details.elapsedMs, 18);
    assert.equal(event.details.backendId, 'noema-codex-windows');
    assert.equal(event.details.backendVersion, '0.1.0');
    assert.equal(event.details.policyVersion, 3);
    assert.equal(event.details.protocolVersion, 7);
    assert.equal(event.details.capabilityStatus, 'ready');
    assert.equal('path' in event.details, false);
    assert.equal('content' in event.details, false);
  } finally {
    db.close();
  }
});

test('handoff diagnostics keep stable identity details and no task text', () => {
  const db = new Database(':memory:');
  const store = new DiagnosticsEventStore(db);
  try {
    store.record({
      applicationExecutionId: 'app-handoff',
      executionId: 'member-turn-1',
      parentExecutionId: 'parent-turn-1',
      turnId: 'member-turn-1',
      module: 'social.handoff',
      operation: 'handoff.completed',
      status: 'completed',
      details: {
        handoffId: 'handoff-user-1',
        memberAgentId: 'specialist-engineering',
        parentInteractionId: 'parent-message-1',
        task: 'PRIVATE TASK SENTINEL',
        report: 'PRIVATE REPORT SENTINEL',
      },
    });
    const events = store.query({ executionId: 'parent-turn-1' });
    assert.equal(events.length, 1);
    assert.equal(events[0].executionId, 'member-turn-1');
    assert.equal(events[0].parentExecutionId, 'parent-turn-1');
    assert.deepEqual(events[0].details, {
      handoffId: 'handoff-user-1',
      memberAgentId: 'specialist-engineering',
      parentInteractionId: 'parent-message-1',
    });
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE|SENTINEL/u);
  } finally {
    db.close();
  }
});

test('diagnostic query links execution/task ids and bounds its page size', () => {
  const db = new Database(':memory:');
  try {
    const store = new DiagnosticsEventStore(db);
    for (let index = 0; index < 3; index += 1) {
      store.record({
        applicationExecutionId: 'app-1',
        executionId: `execution-${index}`,
        taskId: index < 2 ? 'task-1' : null,
        module: 'provider',
        operation: 'request.completed',
        status: 'completed',
      });
    }
    assert.equal(store.query({ taskId: 'task-1' }).length, 2);
    assert.throws(() => store.query(), /executionId 或 taskId/u);
    store.record({
      applicationExecutionId: 'app-1',
      executionId: 'diagnostic-query-1',
      parentExecutionId: 'execution-2',
      module: 'diagnostics',
      operation: 'query.timeline',
      status: 'completed',
    });
    assert.equal(store.query({ executionId: 'execution-2' }).length, 2);
    assert.equal(store.countMatching({ executionId: 'execution-2' }), 2);
  } finally {
    db.close();
  }
});

test('recent execution list returns the latest safe event per execution with a hard limit', () => {
  const db = new Database(':memory:');
  try {
    const store = new DiagnosticsEventStore(db);
    for (let index = 0; index < 55; index += 1) {
      store.record({
        applicationExecutionId: 'app-1',
        executionId: `execution-${index}`,
        taskId: index === 54 ? 'task-54' : null,
        module: 'provider',
        operation: 'request.completed',
        status: 'completed',
        occurredAt: new Date(Date.UTC(2026, 10, 2, 0, index)).toISOString(),
      });
    }
    store.record({
      applicationExecutionId: 'app-1',
      executionId: 'execution-54',
      taskId: 'task-54',
      module: 'social.work',
      operation: 'task.finished',
      status: 'failed',
      occurredAt: new Date(Date.UTC(2026, 10, 2, 1, 0)).toISOString(),
    });
    store.record({
      applicationExecutionId: 'app-1',
      executionId: 'diagnostic-query-1',
      parentExecutionId: 'execution-54',
      module: 'diagnostics',
      operation: 'query.timeline',
      status: 'completed',
      occurredAt: new Date(Date.UTC(2026, 10, 2, 2, 0)).toISOString(),
    });
    const recent = store.listRecentExecutions(500);
    assert.equal(recent.length, 50);
    assert.equal(recent[0].executionId, 'execution-54');
    assert.equal(recent[0].operation, 'task.finished');
    assert.equal(recent[0].eventCount, 2);
  } finally {
    db.close();
  }
});

test('diagnostic retention stays within its configured event limit', () => {
  const db = new Database(':memory:');
  try {
    const store = new DiagnosticsEventStore(db, { maxEvents: 2 });
    for (let index = 0; index < 3; index += 1) {
      store.record({
        applicationExecutionId: 'app-1',
        executionId: `execution-${index}`,
        module: 'host',
        operation: 'test.event',
        status: 'observed',
        occurredAt: `2026-11-02T00:00:0${index}.000Z`,
      });
    }
    assert.equal(store.getStatus().count, 2);
    assert.deepEqual(store.query({ executionId: 'execution-0' }), []);
    assert.equal(store.query({ executionId: 'execution-2' }).length, 1);
  } finally {
    db.close();
  }
});

test('diagnostic write failures are counted and do not escape into agent work', () => {
  const db = new Database(':memory:');
  const store = new DiagnosticsEventStore(db);
  db.close();
  assert.equal(
    store.record({
      applicationExecutionId: 'app-1',
      module: 'provider',
      operation: 'request.failed',
      status: 'failed',
    }),
    false,
  );
  assert.equal(store.writeFailureCount, 1);
  assert.equal(typeof store.lastWriteFailureAt, 'string');
});

test('diagnostic details retain bounded runner facts and discard command data', () => {
  const db = new Database(':memory:');
  const store = new DiagnosticsEventStore(db);
  try {
    assert.equal(
      store.record({
        applicationExecutionId: 'app-1',
        executionId: 'execution-1',
        requestId: 'request-1',
        module: 'windows_runner',
        operation: 'command_finished',
        status: 'complete',
        details: {
          phase: 'command',
          exitCode: 3,
          durationMs: 125,
          timedOut: false,
          cleanupConfirmed: true,
          effectStatus: 'applied',
          reasonCode: 'workspace_identity_changed',
          schemaVersion: 1,
          command: 'npm test --secret',
          path: 'C:\\Users\\private\\project',
          environment: 'OPENAI_API_KEY=secret',
          output: 'private output',
        },
      }),
      true,
    );
    const [event] = store.query({ executionId: 'execution-1' });
    assert.deepEqual(event.details, {
      phase: 'command',
      exitCode: 3,
      durationMs: 125,
      timedOut: false,
      cleanupConfirmed: true,
      effectStatus: 'applied',
      reasonCode: 'workspace_identity_changed',
      schemaVersion: 1,
    });
    assert.equal(JSON.stringify(event).includes('npm test'), false);
    assert.equal(JSON.stringify(event).includes('private'), false);
    assert.equal(JSON.stringify(event).includes('secret'), false);
  } finally {
    db.close();
  }
});

test('stored diagnostic details are re-sanitized and malformed JSON is ignored', () => {
  const db = new Database(':memory:');
  const store = new DiagnosticsEventStore(db);
  try {
    store.record({
      applicationExecutionId: 'app-1',
      executionId: 'tampered-details',
      module: 'provider',
      operation: 'request.completed',
      status: 'completed',
      details: { route: 'social' },
    });
    db.prepare(
      'UPDATE diagnostic_events SET details_json = ? WHERE execution_id = ?',
    ).run(
      JSON.stringify({
        route: 'social',
        prompt: 'PRIVATE PROMPT SENTINEL',
        reason: 'Bearer abcdefghijklmnopqrstuvwxyz012345',
      }),
      'tampered-details',
    );

    const sanitized = store.query({ executionId: 'tampered-details' })[0];
    assert.equal(sanitized.details.route, 'social');
    assert.equal(sanitized.detailsStatus, 'filtered');
    assert.equal('prompt' in sanitized.details, false);
    assert.match(sanitized.details.reason, /已隐藏疑似凭据/u);
    assert.equal(JSON.stringify(sanitized).includes('PRIVATE PROMPT'), false);
    assert.equal(
      JSON.stringify(sanitized).includes('abcdefghijklmnopqrstuvwxyz'),
      false,
    );

    db.prepare(
      'UPDATE diagnostic_events SET details_json = ? WHERE execution_id = ?',
    ).run('{malformed PRIVATE PROMPT SENTINEL', 'tampered-details');
    const malformed = store.query({ executionId: 'tampered-details' })[0];
    assert.deepEqual(malformed.details, {});
    assert.equal(malformed.detailsStatus, 'unavailable');
    assert.equal(JSON.stringify(malformed).includes('PRIVATE PROMPT'), false);

    db.prepare(
      'UPDATE diagnostic_events SET details_json = ? WHERE execution_id = ?',
    ).run('x'.repeat(16_385), 'tampered-details');
    const oversized = store.query({ executionId: 'tampered-details' })[0];
    assert.deepEqual(oversized.details, {});
    assert.equal(oversized.detailsStatus, 'unavailable');
  } finally {
    db.close();
  }
});

test('permission audit keeps decision facts and drops the requested path', () => {
  const db = new Database(':memory:');
  const store = new DiagnosticsEventStore(db);
  try {
    store.record({
      applicationExecutionId: 'app-permission',
      executionId: 'permission-1',
      module: 'social.permission',
      operation: 'external_access',
      status: 'completed',
      details: {
        permissionMode: 'ask',
        decision: 'denied',
        capability: 'dialog',
        path: 'C:\\private\\outside.txt',
      },
    });
    const [event] = store.query({ executionId: 'permission-1' });
    assert.deepEqual(event.details, {
      permissionMode: 'ask',
      decision: 'denied',
      capability: 'dialog',
    });
    assert.equal('path' in event.details, false);
  } finally {
    db.close();
  }
});
