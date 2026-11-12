import { randomUUID } from 'node:crypto';

const MAX_PROVIDER_COST_JSON_LENGTH = 2_000;
const MESSAGE_SHAPE_ROLES = [
  'system',
  'developer',
  'user',
  'assistant',
  'tool',
  'other',
];

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

function normalizeMessageRoleCharacters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== MESSAGE_SHAPE_ROLES.length ||
    keys.some((key) => !MESSAGE_SHAPE_ROLES.includes(key))
  )
    return null;
  const normalized = {};
  for (const role of MESSAGE_SHAPE_ROLES) {
    const characters = count(value[role]);
    if (characters === null) return null;
    normalized[role] = characters;
  }
  return normalized;
}

function parseMessageRoleCharacters(value) {
  if (typeof value !== 'string') return null;
  try {
    return normalizeMessageRoleCharacters(JSON.parse(value));
  } catch {
    return null;
  }
}

/** Stores provider-reported usage metadata without conversation content. */
export class ModelUsageStore {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    this.db = db;
    const migrate = this.db.transaction(() => {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_usage_records (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        provider_host TEXT NOT NULL,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        interaction_id TEXT,
        request_id TEXT,
        execution_id TEXT,
        turn_id TEXT,
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
        message_role_characters_json TEXT,
        tool_definition_characters INTEGER CHECK (tool_definition_characters IS NULL OR tool_definition_characters >= 0),
        message_count INTEGER NOT NULL CHECK (message_count >= 0),
        tool_count INTEGER NOT NULL CHECK (tool_count >= 0)
      );
      CREATE INDEX IF NOT EXISTS model_usage_records_created
        ON model_usage_records(created_at DESC);
      CREATE INDEX IF NOT EXISTS model_usage_records_group
        ON model_usage_records(provider_host, model, operation, created_at);
      CREATE TABLE IF NOT EXISTS external_usage_records (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        service TEXT NOT NULL,
        operation TEXT NOT NULL,
        interaction_id TEXT,
        request_status TEXT NOT NULL CHECK (request_status IN ('completed', 'failed', 'interrupted')),
        usage_received INTEGER NOT NULL CHECK (usage_received IN (0, 1)),
        usage_units INTEGER CHECK (usage_units IS NULL OR usage_units >= 0),
        usage_unit TEXT,
        provider_request_id TEXT
      );
      CREATE INDEX IF NOT EXISTS external_usage_records_interaction
        ON external_usage_records(interaction_id, created_at DESC);
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
      if (!columns.has('message_role_characters_json')) {
        this.db.exec(
          'ALTER TABLE model_usage_records ADD COLUMN message_role_characters_json TEXT',
        );
      }
      if (!columns.has('interaction_id')) {
        this.db.exec(`
        ALTER TABLE model_usage_records
        ADD COLUMN interaction_id TEXT
      `);
      }
      for (const column of ['request_id', 'execution_id', 'turn_id']) {
        if (!columns.has(column)) {
          this.db.exec(
            `ALTER TABLE model_usage_records ADD COLUMN ${column} TEXT`,
          );
        }
      }
      this.db.exec(`
      CREATE INDEX IF NOT EXISTS model_usage_records_interaction
        ON model_usage_records(interaction_id, created_at DESC)
      ;
      CREATE INDEX IF NOT EXISTS model_usage_records_request
        ON model_usage_records(request_id)
    `);
    });
    migrate();
    this.insertRecord = this.db.prepare(`
      INSERT INTO model_usage_records (
        id, created_at, provider_host, model, operation, interaction_id,
        request_id, execution_id, turn_id, request_status, usage_received,
        input_tokens, output_tokens, cached_input_tokens, cache_miss_tokens,
        cache_write_tokens, reasoning_tokens, provider_cost_json, request_characters,
        message_role_characters_json, tool_definition_characters, message_count, tool_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertExternalUsage = this.db.prepare(`
      INSERT INTO external_usage_records (
        id, created_at, service, operation, interaction_id, request_status,
        usage_received, usage_units, usage_unit, provider_request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      interactionId: shortText(record.interactionId, null, 120),
      requestId: shortText(record.requestId, null, 120),
      executionId: shortText(record.executionId, null, 120),
      turnId: shortText(record.turnId, null, 120),
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
      messageRoleCharactersJson: (() => {
        const normalized = normalizeMessageRoleCharacters(
          record.messageRoleCharacters,
        );
        return normalized ? JSON.stringify(normalized) : null;
      })(),
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
      row.interactionId,
      row.requestId,
      row.executionId,
      row.turnId,
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
      row.messageRoleCharactersJson,
      row.toolDefinitionCharacters,
      row.messageCount,
      row.toolCount,
    );
    return row;
  }

  /** @param {Record<string, unknown>} record */
  recordExternal(record) {
    if (!record || typeof record !== 'object') {
      throw new TypeError('External usage record must be an object');
    }
    const requestStatus = ['completed', 'failed', 'interrupted'].includes(
      record.requestStatus,
    )
      ? record.requestStatus
      : 'completed';
    const usageUnits = count(record.usageUnits);
    const row = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      service: shortText(record.service, 'unknown', 100),
      operation: shortText(record.operation, 'unspecified', 80),
      interactionId: shortText(record.interactionId, null, 120),
      requestStatus,
      usageReceived: usageUnits === null ? 0 : 1,
      usageUnits,
      usageUnit:
        usageUnits === null ? null : shortText(record.usageUnit, 'units', 40),
      providerRequestId: shortText(record.providerRequestId, null, 200),
    };
    this.insertExternalUsage.run(
      row.id,
      row.createdAt,
      row.service,
      row.operation,
      row.interactionId,
      row.requestStatus,
      row.usageReceived,
      row.usageUnits,
      row.usageUnit,
      row.providerRequestId,
    );
    return row;
  }

  /** @param {{limit?:number}} [options] */
  getExternalInteractionSummary({ limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(count(limit) ?? 100, 500));
    return this.db
      .prepare(`
        SELECT interaction_id AS interactionId,
          service,
          operation,
          usage_unit AS usageUnit,
          MIN(created_at) AS firstRequestAt,
          COUNT(*) AS requests,
          SUM(CASE WHEN request_status = 'completed' THEN 1 ELSE 0 END) AS completedRequests,
          SUM(CASE WHEN request_status = 'failed' THEN 1 ELSE 0 END) AS failedRequests,
          SUM(CASE WHEN request_status = 'interrupted' THEN 1 ELSE 0 END) AS interruptedRequests,
          SUM(usage_received) AS usageReportedRequests,
          SUM(usage_units) AS usageUnits,
          COUNT(provider_request_id) AS requestIdCount
        FROM external_usage_records
        WHERE interaction_id IS NOT NULL
        GROUP BY interaction_id, service, operation, usage_unit
        ORDER BY firstRequestAt DESC
        LIMIT ?
      `)
      .all(safeLimit);
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
          model, operation, interaction_id AS interactionId,
          request_id AS requestId, execution_id AS executionId, turn_id AS turnId,
          request_status AS requestStatus,
          usage_received AS usageReceived,
          input_tokens AS inputTokens, output_tokens AS outputTokens,
          cached_input_tokens AS cachedInputTokens,
          cache_miss_tokens AS cacheMissTokens,
          cache_write_tokens AS cacheWriteTokens,
          reasoning_tokens AS reasoningTokens,
          provider_cost_json AS providerCostJson,
          request_characters AS requestCharacters,
          message_role_characters_json AS messageRoleCharactersJson,
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
        record.messageRoleCharacters = parseMessageRoleCharacters(
          record.messageRoleCharactersJson,
        );
        delete record.messageRoleCharactersJson;
        return { ...record, providerCost };
      });
  }

  getForDiagnostics({
    requestIds = [],
    executionId = null,
    taskId = null,
    limit = 500,
  } = {}) {
    const safeLimit = Math.max(1, Math.min(count(limit) ?? 500, 500));
    const ids = [
      ...new Set(requestIds.filter((id) => typeof id === 'string')),
    ].slice(0, 500);
    const predicates = [];
    const values = [];
    if (ids.length) {
      predicates.push(`request_id IN (${ids.map(() => '?').join(', ')})`);
      values.push(...ids);
    }
    if (typeof executionId === 'string' && executionId) {
      predicates.push('execution_id = ?', 'turn_id = ?');
      values.push(executionId, executionId);
    }
    if (typeof taskId === 'string' && taskId) {
      predicates.push('interaction_id = ?');
      values.push(taskId);
    }
    if (!predicates.length) return [];
    return this.db
      .prepare(`
      SELECT created_at AS createdAt, provider_host AS providerHost,
        model, operation, interaction_id AS interactionId,
        request_id AS requestId, execution_id AS executionId, turn_id AS turnId,
        request_status AS requestStatus, usage_received AS usageReceived,
        input_tokens AS inputTokens, output_tokens AS outputTokens,
        cached_input_tokens AS cachedInputTokens,
        cache_miss_tokens AS cacheMissTokens,
        cache_write_tokens AS cacheWriteTokens,
        reasoning_tokens AS reasoningTokens,
        request_characters AS requestCharacters,
        message_role_characters_json AS messageRoleCharactersJson,
        tool_definition_characters AS toolDefinitionCharacters,
        message_count AS messageCount, tool_count AS toolCount
      FROM model_usage_records
      WHERE ${predicates.join(' OR ')}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `)
      .all(...values, safeLimit)
      .map((row) => {
        const hasRequestShape = row.requestCharacters !== null;
        const messageRoleCharacters = hasRequestShape
          ? parseMessageRoleCharacters(row.messageRoleCharactersJson)
          : null;
        delete row.messageRoleCharactersJson;
        return {
          ...row,
          messageRoleCharacters,
          usageReceived: row.usageReceived === 1,
          requestCharacters: hasRequestShape ? row.requestCharacters : null,
          toolDefinitionCharacters: hasRequestShape
            ? row.toolDefinitionCharacters
            : null,
          messageCount: hasRequestShape ? row.messageCount : null,
          toolCount: hasRequestShape ? row.toolCount : null,
        };
      });
  }

  /**
   * Aggregate provider usage for one work interaction without exposing prompts
   * or completion text.
   * @param {string} interactionId
   */
  getTaskUsage(interactionId) {
    const id =
      typeof interactionId === 'string'
        ? interactionId.trim().slice(0, 120)
        : '';
    if (!id) {
      return {
        requests: 0,
        usageReportedRequests: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        reasoningTokens: null,
        models: [],
      };
    }
    const rows = this.getForDiagnostics({ taskId: id });
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let usageReportedRequests = 0;
    let hasInput = false;
    let hasOutput = false;
    let hasReasoning = false;
    const models = new Set();
    for (const row of rows) {
      if (row.usageReceived) usageReportedRequests += 1;
      if (Number.isFinite(row.inputTokens)) {
        inputTokens += row.inputTokens;
        hasInput = true;
      }
      if (Number.isFinite(row.outputTokens)) {
        outputTokens += row.outputTokens;
        hasOutput = true;
      }
      if (Number.isFinite(row.reasoningTokens)) {
        reasoningTokens += row.reasoningTokens;
        hasReasoning = true;
      }
      if (row.model) models.add(row.model);
    }
    return {
      requests: rows.length,
      usageReportedRequests,
      inputTokens: hasInput ? inputTokens : null,
      outputTokens: hasOutput ? outputTokens : null,
      totalTokens: hasInput && hasOutput ? inputTokens + outputTokens : null,
      reasoningTokens: hasReasoning ? reasoningTokens : null,
      models: [...models],
    };
  }

  /** @param {{limit?:number}} [options] */
  getInteractionSummary({ limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(count(limit) ?? 100, 500));
    const tables = new Set(
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map(({ name }) => name),
    );
    const outcomes = [
      ['root_turns', 'root_turn'],
      ['social_messages', 'social_message'],
      ['social_work_tasks', 'project_work_task'],
      ['background_tasks', 'background_task'],
    ].filter(([table]) => tables.has(table));
    const outcomeKind = outcomes.length
      ? `CASE ${outcomes
          .map(
            ([table, kind]) =>
              `WHEN EXISTS (SELECT 1 FROM ${table} WHERE id = interaction_id) THEN '${kind}'`,
          )
          .join(' ')} ELSE NULL END`
      : 'NULL';
    const outcomeStatus = outcomes.length
      ? `COALESCE(${outcomes
          .map(
            ([table]) =>
              `(SELECT status FROM ${table} WHERE id = interaction_id)`,
          )
          .join(', ')})`
      : 'NULL';
    const verificationStatus = tables.has('social_work_tasks')
      ? '(SELECT verification_status FROM social_work_tasks WHERE id = interaction_id)'
      : 'NULL';
    const noemaResponseStatus = tables.has('background_tasks')
      ? '(SELECT noema_response_status FROM background_tasks WHERE id = interaction_id)'
      : 'NULL';
    return this.db
      .prepare(`
        SELECT interaction_id AS interactionId,
          ${outcomeKind} AS outcomeKind,
          ${outcomeStatus} AS outcomeStatus,
          ${verificationStatus} AS verificationStatus,
          ${noemaResponseStatus} AS noemaResponseStatus,
          provider_host AS providerHost,
          model,
          MIN(created_at) AS firstRequestAt,
          MAX(created_at) AS lastRequestAt,
          COUNT(*) AS requests,
          SUM(CASE WHEN request_status = 'completed' THEN 1 ELSE 0 END) AS completedRequests,
          SUM(CASE WHEN request_status = 'failed' THEN 1 ELSE 0 END) AS failedRequests,
          SUM(CASE WHEN request_status = 'interrupted' THEN 1 ELSE 0 END) AS interruptedRequests,
          SUM(usage_received) AS usageReportedRequests,
          SUM(input_tokens) AS inputTokens,
          SUM(output_tokens) AS outputTokens,
          SUM(CASE WHEN cached_input_tokens IS NOT NULL AND cache_miss_tokens IS NOT NULL THEN cached_input_tokens ELSE 0 END) AS cachedInputTokens,
          SUM(CASE WHEN cached_input_tokens IS NOT NULL AND cache_miss_tokens IS NOT NULL THEN cache_miss_tokens ELSE 0 END) AS cacheMissTokens,
          SUM(CASE WHEN cached_input_tokens IS NOT NULL AND cache_miss_tokens IS NOT NULL THEN 1 ELSE 0 END) AS cacheBreakdownRequests,
          SUM(cache_write_tokens) AS cacheWriteTokens,
          SUM(reasoning_tokens) AS reasoningTokens
        FROM model_usage_records
        WHERE interaction_id IS NOT NULL
        GROUP BY interaction_id, provider_host, model
        ORDER BY MAX(created_at) DESC
        LIMIT ?
      `)
      .all(safeLimit)
      .map((row) => {
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
          cacheHitRate:
            cacheTotal > 0 ? row.cachedInputTokens / cacheTotal : null,
        };
      });
  }
}
