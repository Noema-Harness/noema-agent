import { randomUUID } from 'node:crypto';
import { redactSensitiveText } from '../../shared/text/sensitive-text.ts';

export const DIAGNOSTIC_EVENT_SCHEMA_VERSION = 1;
export const DEFAULT_DIAGNOSTIC_EVENT_LIMIT = 20_000;
const MAX_DIAGNOSTIC_DETAILS_JSON_LENGTH = 16_384;

const DETAIL_KEYS = new Set([
  'route',
  'capability',
  'permissionMode',
  'decision',
  'reason',
  'requestStatus',
  'elapsedMs',
  'durationMs',
  'exitCode',
  'stdoutBytes',
  'stderrBytes',
  'stdoutTruncated',
  'stderrTruncated',
  'timedOut',
  'cleanupConfirmed',
  'toolName',
  'toolCategory',
  'effectStatus',
  'phase',
  'backendId',
  'backendVersion',
  'policyVersion',
  'protocolVersion',
  'backendReady',
  'capabilityStatus',
  'recoveryReason',
  'verificationStatus',
  'reasonCode',
  'schemaVersion',
  'attempt',
  'toolCallCount',
  'pluginId',
  'handoffId',
  'memberAgentId',
  'parentInteractionId',
  'projectId',
  'planRevision',
  'itemId',
  'submissionRevision',
  'reviewerIds',
  'outboxTurnId',
  'roomId',
  'assistantMessageId',
  'userMessageId',
]);

function boundedId(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 160)
    : null;
}

function boundedCode(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 120)
    : null;
}

function sanitizeDetails(details = {}) {
  const safe = {};
  let filtered = false;
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return { details: safe, filtered: true };
  }
  for (const [key, value] of Object.entries(details)) {
    if (!DETAIL_KEYS.has(key)) {
      filtered = true;
      continue;
    }
    if (typeof value === 'string') {
      const safeValue = redactSensitiveText(value).snippet.slice(0, 160);
      safe[key] = safeValue;
      filtered ||= safeValue !== value;
    } else if (
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      safe[key] = value;
    } else {
      filtered = true;
    }
  }
  return { details: safe, filtered };
}

function safeDetails(details = {}) {
  return JSON.stringify(sanitizeDetails(details).details);
}

function readSafeDetails(value) {
  if (
    typeof value !== 'string' ||
    value.length > MAX_DIAGNOSTIC_DETAILS_JSON_LENGTH
  ) {
    return { details: {}, status: 'unavailable' };
  }
  try {
    const details = JSON.parse(value);
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      return { details: {}, status: 'unavailable' };
    }
    const sanitized = sanitizeDetails(details);
    return {
      details: sanitized.details,
      status: sanitized.filtered ? 'filtered' : 'complete',
    };
  } catch {
    return { details: {}, status: 'unavailable' };
  }
}

/** Local, bounded event ledger. A failed diagnostics write never escapes into the caller. */
export class DiagnosticsEventStore {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db, { maxEvents = DEFAULT_DIAGNOSTIC_EVENT_LIMIT } = {}) {
    this.db = db;
    this.maxEvents = Math.max(1, Math.floor(maxEvents));
    this.writeFailureCount = 0;
    this.lastWriteFailureAt = null;
    this.eventsSincePrune = 0;
    this.migrate();
    this.eventCount = this.db
      .prepare('SELECT COUNT(*) AS count FROM diagnostic_events')
      .get().count;
    this.insertEvent = this.db.prepare(`
      INSERT INTO diagnostic_events (
        event_id, schema_version, occurred_at, application_execution_id,
        execution_id, parent_execution_id, task_id, turn_id, request_id,
        tool_call_id, module, operation, status, error_code, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.deleteOldest = this.db.prepare(`
      DELETE FROM diagnostic_events WHERE event_id IN (
        SELECT event_id FROM diagnostic_events ORDER BY occurred_at ASC, rowid ASC LIMIT ?
      )
    `);
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS diagnostics_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const currentVersion =
      this.db
        .prepare(
          'SELECT MAX(version) AS version FROM diagnostics_schema_migrations',
        )
        .get()?.version ?? 0;
    if (currentVersion >= 1) {
      this.db.exec(`CREATE INDEX IF NOT EXISTS diagnostic_events_parent
        ON diagnostic_events(parent_execution_id, occurred_at)`);
      return;
    }
    const apply = this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE diagnostic_events (
          event_id TEXT PRIMARY KEY,
          schema_version INTEGER NOT NULL,
          occurred_at TEXT NOT NULL,
          application_execution_id TEXT NOT NULL,
          execution_id TEXT,
          parent_execution_id TEXT,
          task_id TEXT,
          turn_id TEXT,
          request_id TEXT,
          tool_call_id TEXT,
          module TEXT NOT NULL,
          operation TEXT NOT NULL,
          status TEXT NOT NULL,
          error_code TEXT,
          details_json TEXT NOT NULL
        );
        CREATE INDEX diagnostic_events_execution
          ON diagnostic_events(execution_id, occurred_at);
        CREATE INDEX diagnostic_events_task
          ON diagnostic_events(task_id, occurred_at);
        CREATE INDEX diagnostic_events_application
          ON diagnostic_events(application_execution_id, occurred_at);
        CREATE INDEX diagnostic_events_parent
          ON diagnostic_events(parent_execution_id, occurred_at);
        INSERT INTO diagnostics_schema_migrations(version, applied_at)
          VALUES (1, '${new Date().toISOString()}');
      `);
    });
    apply();
  }

  record(event) {
    try {
      const applicationExecutionId = boundedId(event?.applicationExecutionId);
      const module = boundedCode(event?.module);
      const operation = boundedCode(event?.operation);
      const status = boundedCode(event?.status);
      if (!applicationExecutionId || !module || !operation || !status) {
        this.writeFailureCount += 1;
        this.lastWriteFailureAt = new Date().toISOString();
        return false;
      }
      this.insertEvent.run(
        boundedId(event.eventId) ?? randomUUID(),
        DIAGNOSTIC_EVENT_SCHEMA_VERSION,
        boundedId(event.occurredAt) ?? new Date().toISOString(),
        applicationExecutionId,
        boundedId(event.executionId),
        boundedId(event.parentExecutionId),
        boundedId(event.taskId),
        boundedId(event.turnId),
        boundedId(event.requestId),
        boundedId(event.toolCallId),
        module,
        operation,
        status,
        boundedCode(event.errorCode),
        safeDetails(event.details),
      );
      this.eventCount += 1;
      this.eventsSincePrune += 1;
      if (this.eventCount > this.maxEvents) {
        const excess = this.eventCount - this.maxEvents;
        this.deleteOldest.run(excess);
        this.eventCount -= excess;
        this.eventsSincePrune = 0;
      } else if (this.eventsSincePrune >= 100) {
        this.prune();
      }
      return true;
    } catch {
      this.writeFailureCount += 1;
      this.lastWriteFailureAt = new Date().toISOString();
      return false;
    }
  }

  prune() {
    this.eventsSincePrune = 0;
    try {
      const count = this.db
        .prepare('SELECT COUNT(*) AS count FROM diagnostic_events')
        .get().count;
      const excess = count - this.maxEvents;
      if (excess > 0) this.deleteOldest.run(excess);
      this.eventCount = count - Math.max(0, excess);
      return Math.max(0, excess);
    } catch {
      this.writeFailureCount += 1;
      this.lastWriteFailureAt = new Date().toISOString();
      return 0;
    }
  }

  query({ executionId = null, taskId = null, limit = 200 } = {}) {
    if (!executionId && !taskId)
      throw new TypeError('executionId 或 taskId 必须提供。');
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows =
      executionId && taskId
        ? this.db
            .prepare(`SELECT * FROM diagnostic_events
          WHERE execution_id = ? OR task_id = ? OR parent_execution_id = ?
          ORDER BY occurred_at DESC, rowid DESC LIMIT ?`)
            .all(
              boundedId(executionId),
              boundedId(taskId),
              boundedId(executionId),
              boundedLimit,
            )
        : executionId
          ? this.db
              .prepare(`SELECT * FROM diagnostic_events
            WHERE execution_id = ? OR parent_execution_id = ?
            ORDER BY occurred_at DESC, rowid DESC LIMIT ?`)
              .all(boundedId(executionId), boundedId(executionId), boundedLimit)
          : this.db
              .prepare(`SELECT * FROM diagnostic_events
              WHERE task_id = ? ORDER BY occurred_at DESC, rowid DESC LIMIT ?`)
              .all(boundedId(taskId), boundedLimit);
    return rows.reverse().map((row) => {
      const safeDetails = readSafeDetails(row.details_json);
      return {
        eventId: row.event_id,
        schemaVersion: row.schema_version,
        occurredAt: row.occurred_at,
        applicationExecutionId: row.application_execution_id,
        executionId: row.execution_id,
        parentExecutionId: row.parent_execution_id,
        taskId: row.task_id,
        turnId: row.turn_id,
        requestId: row.request_id,
        toolCallId: row.tool_call_id,
        module: row.module,
        operation: row.operation,
        status: row.status,
        errorCode: row.error_code,
        details: safeDetails.details,
        detailsStatus: safeDetails.status,
      };
    });
  }

  listRecentExecutions(limit = 50) {
    const boundedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    return this.db
      .prepare(`
      SELECT latest.execution_id AS executionId,
        latest.task_id AS taskId,
        latest.turn_id AS turnId,
        latest.module,
        latest.operation,
        latest.status,
        latest.occurred_at AS occurredAt,
        grouped.event_count AS eventCount
      FROM (
        SELECT execution_id,
          MAX(occurred_at) AS newest_at,
          COUNT(*) AS event_count
        FROM diagnostic_events
        WHERE execution_id IS NOT NULL AND module <> 'diagnostics'
        GROUP BY execution_id
        ORDER BY newest_at DESC, execution_id DESC
        LIMIT ?
      ) AS grouped
      JOIN diagnostic_events AS latest
        ON latest.event_id = (
          SELECT event_id FROM diagnostic_events
          WHERE execution_id = grouped.execution_id
          ORDER BY occurred_at DESC, event_id DESC LIMIT 1
        )
      ORDER BY grouped.newest_at DESC, grouped.execution_id DESC
    `)
      .all(boundedLimit);
  }

  countMatching({ executionId = null, taskId = null } = {}) {
    if (!executionId && !taskId)
      throw new TypeError('executionId 或 taskId 必须提供。');
    const row =
      executionId && taskId
        ? this.db
            .prepare(`SELECT COUNT(*) AS count FROM diagnostic_events
          WHERE execution_id = ? OR task_id = ? OR parent_execution_id = ?`)
            .get(
              boundedId(executionId),
              boundedId(taskId),
              boundedId(executionId),
            )
        : executionId
          ? this.db
              .prepare(`SELECT COUNT(*) AS count FROM diagnostic_events
            WHERE execution_id = ? OR parent_execution_id = ?`)
              .get(boundedId(executionId), boundedId(executionId))
          : this.db
              .prepare(
                'SELECT COUNT(*) AS count FROM diagnostic_events WHERE task_id = ?',
              )
              .get(boundedId(taskId));
    return row.count;
  }

  getStatus() {
    try {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS count,
        MIN(occurred_at) AS oldestAt, MAX(occurred_at) AS newestAt
        FROM diagnostic_events`)
        .get();
      return {
        available: true,
        count: row.count,
        limit: this.maxEvents,
        oldestAt: row.oldestAt,
        newestAt: row.newestAt,
        writeFailureCount: this.writeFailureCount,
        lastWriteFailureAt: this.lastWriteFailureAt,
      };
    } catch {
      return {
        available: false,
        count: null,
        limit: this.maxEvents,
        oldestAt: null,
        newestAt: null,
        writeFailureCount: this.writeFailureCount + 1,
        lastWriteFailureAt: new Date().toISOString(),
      };
    }
  }
}
