import { randomUUID } from 'node:crypto';

const MAX_PROVIDER_COST_JSON_LENGTH = 2_000;

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function shortText(value, fallback, limit) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, limit)
    : fallback;
}

function serializeProviderCost(value) {
  if (value === null || value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= MAX_PROVIDER_COST_JSON_LENGTH
      ? serialized
      : null;
  } catch {
    return null;
  }
}

/** Stores provider-reported usage metadata without conversation content. */
export class ModelUsageStore {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_usage_records (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        provider_host TEXT NOT NULL,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_status TEXT NOT NULL CHECK (request_status IN ('completed', 'failed', 'interrupted')),
        usage_received INTEGER NOT NULL CHECK (usage_received IN (0, 1)),
        input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
        output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
        cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
        cache_miss_tokens INTEGER CHECK (cache_miss_tokens IS NULL OR cache_miss_tokens >= 0),
        cache_write_tokens INTEGER CHECK (cache_write_tokens IS NULL OR cache_write_tokens >= 0),
        reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
        provider_cost_json TEXT,
        request_characters INTEGER CHECK (request_characters IS NULL OR request_characters >= 0),
        tool_definition_characters INTEGER CHECK (tool_definition_characters IS NULL OR tool_definition_characters >= 0),
        message_count INTEGER NOT NULL CHECK (message_count >= 0),
        tool_count INTEGER NOT NULL CHECK (tool_count >= 0)
      );
      CREATE INDEX IF NOT EXISTS model_usage_records_created
        ON model_usage_records(created_at DESC);
      CREATE INDEX IF NOT EXISTS model_usage_records_group
        ON model_usage_records(provider_host, model, operation, created_at);
    `);
    const columns = new Set(
      this.db
        .pragma('table_info(model_usage_records)')
        .map((column) => column.name),
    );
    if (!columns.has('cache_write_tokens')) {
      this.db.exec(`
        ALTER TABLE model_usage_records
        ADD COLUMN cache_write_tokens INTEGER
        CHECK (cache_write_tokens IS NULL OR cache_write_tokens >= 0)
      `);
    }
    if (!columns.has('tool_definition_characters')) {
      this.db.exec(`
        ALTER TABLE model_usage_records
        ADD COLUMN tool_definition_characters INTEGER
        CHECK (tool_definition_characters IS NULL OR tool_definition_characters >= 0)
      `);
    }
    this.insertRecord = this.db.prepare(`
      INSERT INTO model_usage_records (
        id, created_at, provider_host, model, operation, request_status, usage_received,
        input_tokens, output_tokens, cached_input_tokens, cache_miss_tokens,
        cache_write_tokens, reasoning_tokens, provider_cost_json, request_characters,
        tool_definition_characters, message_count, tool_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  /** @param {Record<string, unknown>} record */
  record(record) {
    if (!record || typeof record !== 'object') {
      throw new TypeError('Model usage record must be an object');
    }
    const row = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      providerHost: shortText(record.providerHost, 'unknown', 253),
      model: shortText(record.model, 'unknown', 200),
      operation: shortText(record.operation, 'unspecified', 80),
      requestStatus: ['completed', 'failed', 'interrupted'].includes(
        record.requestStatus,
      )
        ? record.requestStatus
        : 'completed',
      usageReceived: record.usageReceived === true ? 1 : 0,
      inputTokens: count(record.inputTokens),
      outputTokens: count(record.outputTokens),
      cachedInputTokens: count(record.cachedInputTokens),
      cacheMissTokens: count(record.cacheMissTokens),
      cacheWriteTokens: count(record.cacheWriteTokens),
      reasoningTokens: count(record.reasoningTokens),
      providerCostJson: serializeProviderCost(record.providerCost),
      requestCharacters: count(record.requestCharacters),
      toolDefinitionCharacters: count(record.toolDefinitionCharacters),
      messageCount: count(record.messageCount) ?? 0,
      toolCount: count(record.toolCount) ?? 0,
    };
    this.insertRecord.run(
      row.id,
      row.createdAt,
      row.providerHost,
      row.model,
      row.operation,
      row.requestStatus,
      row.usageReceived,
      row.inputTokens,
      row.outputTokens,
      row.cachedInputTokens,
      row.cacheMissTokens,
      row.cacheWriteTokens,
      row.reasoningTokens,
      row.providerCostJson,
      row.requestCharacters,
      row.toolDefinitionCharacters,
      row.messageCount,
      row.toolCount,
    );
    return row;
  }

  /** @param {{since?:string|null}} [options] */
  getSummary({ since = null } = {}) {
    const rows = this.db
      .prepare(`
        SELECT provider_host AS providerHost,
          model,
          operation,
          COUNT(*) AS requests,
          SUM(CASE WHEN request_status = 'completed' THEN 1 ELSE 0 END) AS completedRequests,
          SUM(CASE WHEN request_status = 'failed' THEN 1 ELSE 0 END) AS failedRequests,
          SUM(CASE WHEN request_status = 'interrupted' THEN 1 ELSE 0 END) AS interruptedRequests,
          SUM(usage_received) AS usageReportedRequests,
          SUM(input_tokens) AS inputTokens,
          SUM(output_tokens) AS outputTokens,
          SUM(CASE WHEN cached_input_tokens IS NOT NULL AND cache_miss_tokens IS NOT NULL THEN cached_input_tokens ELSE 0 END) AS cachedInputTokens,
          SUM(CASE WHEN cached_input_tokens IS NOT NULL AND cache_miss_tokens IS NOT NULL THEN cache_miss_tokens ELSE 0 END) AS cacheMissTokens,
          SUM(cache_write_tokens) AS cacheWriteTokens,
          SUM(CASE WHEN cache_write_tokens IS NOT NULL THEN 1 ELSE 0 END) AS cacheWriteBreakdownRequests,
          SUM(CASE WHEN cached_input_tokens IS NOT NULL AND cache_miss_tokens IS NOT NULL THEN 1 ELSE 0 END) AS cacheBreakdownRequests,
          SUM(reasoning_tokens) AS reasoningTokens
        FROM model_usage_records
        WHERE (? IS NULL OR created_at >= ?)
        GROUP BY provider_host, model, operation
        ORDER BY requests DESC, providerHost, model, operation
      `)
      .all(since, since);
    return rows.map((row) => {
      const cacheTotal =
        row.cachedInputTokens === null || row.cacheMissTokens === null
          ? null
          : row.cachedInputTokens + row.cacheMissTokens;
      return {
        ...row,
        cachedInputTokens:
          row.cacheBreakdownRequests > 0 ? row.cachedInputTokens : null,
        cacheMissTokens:
          row.cacheBreakdownRequests > 0 ? row.cacheMissTokens : null,
        cacheWriteTokens:
          row.cacheWriteBreakdownRequests > 0 ? row.cacheWriteTokens : null,
        cacheHitRate:
          cacheTotal > 0 ? row.cachedInputTokens / cacheTotal : null,
      };
    });
  }

  getRecent(limit = 100) {
    const safeLimit = Math.max(1, Math.min(count(limit) ?? 100, 500));
    return this.db
      .prepare(`
        SELECT id, created_at AS createdAt, provider_host AS providerHost,
          model, operation, request_status AS requestStatus,
          usage_received AS usageReceived,
          input_tokens AS inputTokens, output_tokens AS outputTokens,
          cached_input_tokens AS cachedInputTokens,
          cache_miss_tokens AS cacheMissTokens,
          cache_write_tokens AS cacheWriteTokens,
          reasoning_tokens AS reasoningTokens,
          provider_cost_json AS providerCostJson,
          request_characters AS requestCharacters,
          tool_definition_characters AS toolDefinitionCharacters,
          message_count AS messageCount, tool_count AS toolCount
        FROM model_usage_records
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(safeLimit)
      .map((row) => {
        let providerCost = null;
        try {
          providerCost = JSON.parse(row.providerCostJson ?? 'null');
        } catch {
          providerCost = null;
        }
        const record = { ...row };
        delete record.providerCostJson;
        return { ...record, providerCost };
      });
  }
}
