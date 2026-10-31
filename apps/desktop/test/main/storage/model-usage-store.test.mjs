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
      usageReceived: true,
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 64,
      cacheMissTokens: 36,
      cacheWriteTokens: 0,
      reasoningTokens: 4,
      providerCost: { total: 0.001 },
      requestCharacters: 4_000,
      messageCount: 9,
      toolCount: 2,
    });

    assert.equal(record.operation, 'root_chat');
    const rows = db.prepare('SELECT * FROM model_usage_records').all();
    assert.equal(rows.length, 1);
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
