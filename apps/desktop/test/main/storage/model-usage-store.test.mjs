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
    const [summary] = store.getSummary();
    assert.equal(summary.cacheHitRate, null);
    assert.equal(summary.cachedInputTokens, null);
    assert.equal(summary.cacheBreakdownRequests, 0);
    assert.equal(summary.failedRequests, 1);
  } finally {
    db.close();
  }
});
