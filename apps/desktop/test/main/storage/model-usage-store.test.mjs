import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ModelUsageStore } from '../../../src/main/storage/model-usage-store.mjs';

test('stores only usage metadata and reports cache hit rate by request operation', () => {
  const db = new Database(':memory:');
  try {
    const store = new ModelUsageStore(db);
    const record = store.record({
      providerHost: 'api.deepseek.com',
      model: 'deepseek-flash',
      operation: 'root_chat',
      interactionId: 'turn-1',
      usageReceived: true,
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 64,
      cacheMissTokens: 36,
      cacheWriteTokens: 0,
      reasoningTokens: 4,
      providerCost: { total: 0.001 },
      requestCharacters: 4_000,
      toolDefinitionCharacters: 2_100,
      messageCount: 9,
      toolCount: 2,
    });

    assert.equal(record.operation, 'root_chat');
    assert.equal(record.interactionId, 'turn-1');
    const rows = db.prepare('SELECT * FROM model_usage_records').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tool_definition_characters, 2_100);
    assert.equal(JSON.stringify(rows[0]).includes('prompt'), false);
    assert.equal(JSON.stringify(rows[0]).includes('response'), false);
    assert.equal(JSON.parse(rows[0].provider_cost_json).total, 0.001);

    const [summary] = store.getSummary();
    assert.equal(summary.requests, 1);
    assert.equal(summary.inputTokens, 100);
    assert.equal(summary.cachedInputTokens, 64);
    assert.equal(summary.cacheMissTokens, 36);
    assert.equal(summary.cacheWriteTokens, 0);
    assert.equal(summary.cacheBreakdownRequests, 1);
    assert.equal(summary.cacheHitRate, 0.64);
    assert.equal(store.getRecent()[0].providerCost.total, 0.001);
    assert.equal(store.getRecent()[0].toolDefinitionCharacters, 2_100);
    assert.equal(store.getRecent()[0].interactionId, 'turn-1');
    assert.equal(store.getInteractionSummary()[0].interactionId, 'turn-1');
  } finally {
    db.close();
  }
});

test('preserves missing and invalid usage as unknown rather than zero', () => {
  const db = new Database(':memory:');
  try {
    const store = new ModelUsageStore(db);
    store.record({
      model: 'model-a',
      operation: 'root_chat',
      requestStatus: 'failed',
      usageReceived: false,
      inputTokens: -1,
      outputTokens: Number.NaN,
      cachedInputTokens: undefined,
      cacheMissTokens: undefined,
      reasoningTokens: undefined,
      requestCharacters: null,
      messageCount: 1,
      toolCount: 0,
    });

    const [row] = store.getRecent();
    assert.equal(row.usageReceived, 0);
    assert.equal(row.requestStatus, 'failed');
    assert.equal(row.inputTokens, null);
    assert.equal(row.outputTokens, null);
    assert.equal(row.cachedInputTokens, null);
    assert.equal(row.cacheMissTokens, null);
    assert.equal(row.cacheWriteTokens, null);
    const [summary] = store.getSummary();
    assert.equal(summary.cacheHitRate, null);
    assert.equal(summary.cachedInputTokens, null);
    assert.equal(summary.cacheBreakdownRequests, 0);
    assert.equal(summary.failedRequests, 1);
  } finally {
    db.close();
  }
});

test('adds the cache-write bucket to an existing usage table without losing rows', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE model_usage_records (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        provider_host TEXT NOT NULL,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_status TEXT NOT NULL,
        usage_received INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cached_input_tokens INTEGER,
        cache_miss_tokens INTEGER,
        reasoning_tokens INTEGER,
        provider_cost_json TEXT,
        request_characters INTEGER,
        message_count INTEGER NOT NULL,
        tool_count INTEGER NOT NULL
      );
      INSERT INTO model_usage_records (
        id, created_at, provider_host, model, operation, request_status,
        usage_received, input_tokens, output_tokens, cached_input_tokens,
        cache_miss_tokens, reasoning_tokens, provider_cost_json,
        request_characters, message_count, tool_count
      ) VALUES ('existing', '2026-11-01T00:00:00.000Z', 'api.test', 'm',
        'root_chat', 'completed', 1, 10, 2, 4, 6, NULL, NULL, 20, 1, 0);
    `);

    const store = new ModelUsageStore(db);
    new ModelUsageStore(db);
    assert.equal(
      db
        .prepare(
          'SELECT cache_write_tokens FROM model_usage_records WHERE id = ?',
        )
        .get('existing').cache_write_tokens,
      null,
    );
    assert.equal(
      db
        .prepare('PRAGMA table_info(model_usage_records)')
        .all()
        .some((column) => column.name === 'tool_definition_characters'),
      true,
    );
    assert.equal(
      db
        .prepare('PRAGMA table_info(model_usage_records)')
        .all()
        .some((column) => column.name === 'interaction_id'),
      true,
    );
    const row = store.record({
      providerHost: 'api.test',
      model: 'm',
      operation: 'dsh_worker_step',
      usageReceived: true,
      inputTokens: 33,
      outputTokens: 7,
      cachedInputTokens: 10,
      cacheMissTokens: 23,
      cacheWriteTokens: 3,
    });
    assert.equal(row.cacheWriteTokens, 3);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM model_usage_records').get()
        .count,
      2,
    );
  } finally {
    db.close();
  }
});

test('groups related provider calls into one interaction summary', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE root_turns (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE social_messages (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE social_work_tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        verification_status TEXT NOT NULL
      );
      CREATE TABLE background_tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        noema_response_status TEXT NOT NULL
      );
      INSERT INTO root_turns VALUES ('turn-other', 'completed');
      INSERT INTO social_messages VALUES ('turn-shared', 'complete');
      INSERT INTO social_work_tasks VALUES ('work-task', 'completed', 'failed');
      INSERT INTO background_tasks VALUES ('background-task', 'completed', 'failed');
    `);
    const store = new ModelUsageStore(db);
    for (const record of [
      {
        interactionId: 'turn-shared',
        providerHost: 'api.deepseek.com',
        model: 'deepseek-flash',
        operation: 'social_turn',
        usageReceived: true,
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 40,
        cacheMissTokens: 60,
      },
      {
        interactionId: 'turn-shared',
        providerHost: 'api.deepseek.com',
        model: 'deepseek-flash',
        operation: 'social_specialist_followup',
        requestStatus: 'failed',
        usageReceived: false,
        inputTokens: null,
        outputTokens: null,
      },
      {
        interactionId: 'turn-other',
        providerHost: 'api.deepseek.com',
        model: 'deepseek-flash',
        operation: 'social_turn',
        usageReceived: true,
        inputTokens: 30,
        outputTokens: 8,
        cachedInputTokens: 0,
        cacheMissTokens: 30,
      },
      {
        interactionId: 'work-task',
        providerHost: 'api.deepseek.com',
        model: 'deepseek-flash',
        operation: 'project_execution',
        usageReceived: true,
        inputTokens: 200,
        outputTokens: 50,
        cachedInputTokens: 100,
        cacheMissTokens: 100,
      },
      {
        interactionId: 'background-task',
        providerHost: 'api.deepseek.com',
        model: 'deepseek-flash',
        operation: 'dsh_worker_step',
        usageReceived: true,
        inputTokens: 300,
        outputTokens: 60,
        cachedInputTokens: 150,
        cacheMissTokens: 150,
      },
    ]) {
      store.record(record);
    }

    const summary = store
      .getInteractionSummary()
      .find((row) => row.interactionId === 'turn-other');
    assert.equal(summary.interactionId, 'turn-other');
    assert.equal(summary.requests, 1);
    assert.equal(summary.inputTokens, 30);
    assert.equal(summary.cacheHitRate, 0);
    assert.equal(summary.outcomeKind, 'root_turn');
    assert.equal(summary.outcomeStatus, 'completed');

    const shared = store
      .getInteractionSummary()
      .find((row) => row.interactionId === 'turn-shared');
    assert.equal(shared.requests, 2);
    assert.equal(shared.completedRequests, 1);
    assert.equal(shared.failedRequests, 1);
    assert.equal(shared.usageReportedRequests, 1);
    assert.equal(shared.inputTokens, 100);
    assert.equal(shared.outputTokens, 20);
    assert.equal(shared.cachedInputTokens, 40);
    assert.equal(shared.cacheMissTokens, 60);
    assert.equal(shared.cacheHitRate, 0.4);
    assert.equal(shared.outcomeKind, 'social_message');
    assert.equal(shared.outcomeStatus, 'complete');

    const work = store
      .getInteractionSummary()
      .find((row) => row.interactionId === 'work-task');
    assert.equal(work.outcomeKind, 'project_work_task');
    assert.equal(work.outcomeStatus, 'completed');
    assert.equal(work.verificationStatus, 'failed');

    const background = store
      .getInteractionSummary()
      .find((row) => row.interactionId === 'background-task');
    assert.equal(background.outcomeKind, 'background_task');
    assert.equal(background.outcomeStatus, 'completed');
    assert.equal(background.noemaResponseStatus, 'failed');
  } finally {
    db.close();
  }
});
