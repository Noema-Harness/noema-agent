import { randomUUID } from 'node:crypto';

export const DIAGNOSTICS_EXPORT_SCHEMA_VERSION = 1;
export const MAX_DIAGNOSTIC_EXECUTIONS = 50;
export const MAX_DIAGNOSTIC_EVENTS = 500;
const PREVIEW_TTL_MS = 5 * 60 * 1000;

const EXPORT_EXCLUSIONS = Object.freeze([
  'prompts and message bodies',
  'task result text and file contents',
  'workspace paths and command text',
  'credentials and full error text',
  'OS child process IDs and per-row business-store writes',
  'RootAgent and DSH legacy execution paths',
]);

function safeTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    status: task.status,
    verificationStatus: task.verificationStatus ?? null,
    errorCode: task.errorCode ?? null,
    executionEngine: task.executionEngine ?? null,
    createdAt: task.createdAt ?? null,
    updatedAt: task.updatedAt ?? null,
    completedAt: task.completedAt ?? null,
    executionSteps: (task.executionSteps ?? []).slice(0, 200).map((step) => ({
      index: step.index ?? step.stepIndex ?? null,
      category: step.category ?? null,
      status: step.status ?? null,
      effectStatus: step.effectStatus ?? null,
      errorCode: step.errorCode ?? null,
    })),
  };
}

function safeExportUsage(usage) {
  return usage.map((row) => ({
    createdAt: row.createdAt,
    providerHost: row.providerHost,
    model: row.model,
    operation: row.operation,
    interactionId: row.interactionId,
    requestId: row.requestId,
    executionId: row.executionId,
    turnId: row.turnId,
    requestStatus: row.requestStatus,
    usageReceived: row.usageReceived,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedInputTokens: row.cachedInputTokens,
    cacheMissTokens: row.cacheMissTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    reasoningTokens: row.reasoningTokens,
  }));
}

function coverageFor(events, usage, task, hasMore) {
  const gaps = [];
  if (!events.length) gaps.push('no_persisted_events');
  if (
    events.some((event) => event.operation.startsWith('request.')) &&
    !usage.length
  )
    gaps.push('provider_usage_unavailable_or_unlinked');
  if (
    events.some((event) => event.operation.startsWith('request.')) &&
    usage.some((row) => !row.usageReceived)
  )
    gaps.push('provider_usage_not_reported');
  if (hasMore) gaps.push('timeline_truncated');
  if (!task && events.some((event) => event.taskId))
    gaps.push('task_owner_record_unavailable');
  gaps.push('os_child_process_lifecycle_not_recorded');
  gaps.push('business_store_row_writes_not_recorded');
  if (
    events.some(
      (event) => event.module === 'root.agent' || event.module === 'dsh',
    )
  )
    gaps.push('legacy_execution_coverage_partial');
  return [...new Set(gaps)];
}

/** Aggregates safe read DTOs while leaving event, usage, and task ownership intact. */
export class DiagnosticsQueryService {
  /**
   * @param {{eventStore:import('../storage/diagnostics-event-store.mjs').DiagnosticsEventStore,modelUsageStore:import('../storage/model-usage-store.mjs').ModelUsageStore,socialChatStore:import('../chat/social-chat-store.mjs').SocialChatStore|null,runtimeInfo?:Record<string,unknown>|null,recordDiagnosticEvent?:(event:Record<string,unknown>)=>boolean|void,now?:()=>number}} options
   */
  constructor({
    eventStore,
    modelUsageStore,
    socialChatStore,
    runtimeInfo = null,
    recordDiagnosticEvent = () => {},
    now = () => Date.now(),
  }) {
    this.eventStore = eventStore;
    this.modelUsageStore = modelUsageStore;
    this.socialChatStore = socialChatStore;
    this.runtimeInfo = runtimeInfo;
    this.recordDiagnosticEvent = recordDiagnosticEvent;
    this.now = now;
    this.exportPreviews = new Map();
  }

  listRecent(limit = 20) {
    const safeLimit = Math.max(
      1,
      Math.min(MAX_DIAGNOSTIC_EXECUTIONS, Math.floor(limit)),
    );
    const executions = this.eventStore.listRecentExecutions(safeLimit);
    const response = {
      available: true,
      runtime: this.runtimeInfo,
      diagnostics: this.eventStore.getStatus(),
      executions: executions.map((execution) => {
        const usage = this.modelUsageStore.getForDiagnostics({
          executionId: execution.executionId,
          taskId: execution.taskId,
          limit: MAX_DIAGNOSTIC_EVENTS,
        });
        const inputRows = usage.filter((row) => row.inputTokens !== null);
        const outputRows = usage.filter((row) => row.outputTokens !== null);
        return {
          ...execution,
          usageRequestCount: usage.length,
          inputTokens: inputRows.length
            ? inputRows.reduce((sum, row) => sum + row.inputTokens, 0)
            : null,
          outputTokens: outputRows.length
            ? outputRows.reduce((sum, row) => sum + row.outputTokens, 0)
            : null,
          usageReported: usage.some((row) => row.usageReceived),
        };
      }),
    };
    this.recordAction('query.recent', 'completed');
    return response;
  }

  getTimeline({ executionId = null, taskId = null, limit = 200 } = {}) {
    if (!executionId && !taskId)
      throw new TypeError('executionId 或 taskId 必须提供。');
    const boundedLimit = Math.max(
      1,
      Math.min(MAX_DIAGNOSTIC_EVENTS, Math.floor(limit)),
    );
    const events = this.eventStore.query({
      executionId,
      taskId,
      limit: boundedLimit,
    });
    const taskEvent = events.find((event) => event.taskId)?.taskId ?? taskId;
    let taskRecord = null;
    if (taskEvent && this.socialChatStore) {
      try {
        taskRecord = safeTask(
          this.socialChatStore.getSocialWorkTask(taskEvent),
        );
      } catch {
        taskRecord = null;
      }
    }
    const usage = this.modelUsageStore.getForDiagnostics({
      requestIds: events.map((event) => event.requestId).filter(Boolean),
      executionId,
      taskId: taskEvent,
      limit: MAX_DIAGNOSTIC_EVENTS,
    });
    const matchingEvents = this.eventStore.countMatching({
      executionId,
      taskId,
    });
    const hasMore = matchingEvents > events.length;
    const response = {
      available: true,
      runtime: this.runtimeInfo,
      executionId: executionId ?? events[0]?.executionId ?? taskEvent,
      taskId: taskEvent ?? null,
      events,
      usage,
      task: taskRecord,
      coverageGaps: coverageFor(events, usage, taskRecord, hasMore),
      truncated: hasMore,
      diagnostics: this.eventStore.getStatus(),
    };
    this.recordAction(
      'query.timeline',
      events.length ? 'completed' : 'empty',
      response.executionId,
    );
    return response;
  }

  getExportPreview({ executionId = null, taskId = null } = {}) {
    const timeline = this.getTimeline({
      executionId,
      taskId,
      limit: MAX_DIAGNOSTIC_EVENTS,
    });
    const report = {
      schemaVersion: DIAGNOSTICS_EXPORT_SCHEMA_VERSION,
      generatedAt: new Date(this.now()).toISOString(),
      executionId: timeline.executionId,
      taskId: timeline.taskId,
      runtime: timeline.runtime,
      events: timeline.events,
      usage: safeExportUsage(timeline.usage),
      task: timeline.task,
      manifest: {
        included: [
          'execution/event identifiers and timestamps',
          'allowlisted event status and error codes',
          'provider/model and token/cache usage metadata',
          'task verification and tool outcome metadata',
          'allowlisted app/runtime and applied schema versions',
        ],
        excluded: EXPORT_EXCLUSIONS,
        coverageGaps: timeline.coverageGaps,
        eventCount: timeline.events.length,
        usageCount: timeline.usage.length,
        truncated: timeline.truncated,
      },
    };
    const previewId = randomUUID();
    this.expirePreviews();
    this.exportPreviews.set(previewId, {
      expiresAt: this.now() + PREVIEW_TTL_MS,
      json: `${JSON.stringify(report, null, 2)}\n`,
      summary: {
        previewId,
        schemaVersion: report.schemaVersion,
        executionId: report.executionId,
        taskId: report.taskId,
        eventCount: report.manifest.eventCount,
        usageCount: report.manifest.usageCount,
        included: report.manifest.included,
        excluded: report.manifest.excluded,
        coverageGaps: report.manifest.coverageGaps,
        truncated: report.manifest.truncated,
        reportJson: `${JSON.stringify(report, null, 2)}\n`,
      },
    });
    const summary = this.exportPreviews.get(previewId).summary;
    this.recordAction('export.preview', 'prepared', timeline.executionId);
    return summary;
  }

  consumeExportPreview(previewId) {
    const json = this.getExportFileContent(previewId);
    if (json === null) return null;
    this.exportPreviews.delete(previewId);
    return json;
  }

  getExportFileContent(previewId) {
    this.expirePreviews();
    const preview = this.exportPreviews.get(previewId);
    if (!preview) return null;
    return preview.json;
  }

  discardExportPreview(previewId) {
    return this.exportPreviews.delete(previewId);
  }

  recordExportOutcome(previewId, status, errorCode = null) {
    const preview = this.exportPreviews.get(previewId);
    this.recordAction(
      'export.save',
      status,
      preview?.summary.executionId ?? null,
      errorCode,
    );
  }

  recordAction(operation, status, parentExecutionId = null, errorCode = null) {
    try {
      this.recordDiagnosticEvent({
        executionId: randomUUID(),
        parentExecutionId,
        module: 'diagnostics',
        operation,
        status,
        errorCode,
      });
    } catch {
      // Diagnostics actions are observational and must not affect their query or save.
    }
  }

  expirePreviews() {
    const now = this.now();
    for (const [id, preview] of this.exportPreviews) {
      if (preview.expiresAt <= now) this.exportPreviews.delete(id);
    }
    while (this.exportPreviews.size > 5) {
      this.exportPreviews.delete(this.exportPreviews.keys().next().value);
    }
  }
}
