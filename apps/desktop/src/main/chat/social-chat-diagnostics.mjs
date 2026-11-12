export class SocialChatDiagnostics {
  constructor({ recordDiagnosticEvent, getProjectPlan }) {
    this.recordDiagnosticEvent = recordDiagnosticEvent;
    this.getProjectPlan = getProjectPlan;
  }

  recordSocialToolEvent(run, trace, phase, status, details = {}) {
    try {
      this.recordDiagnosticEvent({
        executionId: run.turnId,
        turnId: run.turnId,
        requestId: trace.requestId,
        toolCallId: trace.toolCallId,
        module: 'social.chat',
        operation: `tool.${phase}`,
        status,
        errorCode: details.errorCode ?? null,
        details: {
          toolName: trace.toolName,
          toolCategory: trace.toolCategory,
          ...(details.durationMs === undefined
            ? {}
            : { durationMs: details.durationMs }),
          ...(details.effectStatus
            ? { effectStatus: details.effectStatus }
            : {}),
        },
      });
    } catch {
      // Diagnostic failures must never change Social tool behavior.
    }
  }

  recordSocialMemoryEvent(
    run,
    operation,
    status,
    errorCode = null,
    details = {},
  ) {
    const trace = run.pendingSocialToolTrace?.find(
      (item) => item.toolName === 'manage_personal_memory' && !item.terminal,
    );
    try {
      this.recordDiagnosticEvent({
        executionId: run.turnId,
        turnId: run.turnId,
        requestId: trace?.requestId ?? null,
        toolCallId: trace?.toolCallId ?? null,
        module: 'social.memory',
        operation,
        status,
        errorCode,
        details,
      });
    } catch {
      // Diagnostic failures must never change personal-memory behavior.
    }
  }

  recordSocialChatEvent(run, operation, status, errorCode = null) {
    try {
      this.recordDiagnosticEvent({
        executionId: run.turnId,
        turnId: run.turnId,
        module: 'social.chat',
        operation,
        status,
        errorCode,
        details: {
          roomId: run.roomId ?? null,
          assistantMessageId: run.assistantMessageId ?? null,
          userMessageId: run.userMessageId ?? null,
          memberAgentId: run.agentId ?? null,
        },
      });
    } catch {
      // Chat delivery and recovery do not depend on diagnostics availability.
    }
  }

  recordUserFollowupEvent({
    executionId,
    operation,
    status,
    errorCode = null,
    parentExecutionId = null,
    turnId = null,
    requestId = null,
    toolCallId = null,
  }) {
    try {
      this.recordDiagnosticEvent({
        executionId,
        parentExecutionId,
        turnId,
        requestId,
        toolCallId,
        module: 'social.followup',
        operation,
        status,
        errorCode,
      });
    } catch {
      // Follow-up delivery does not depend on diagnostics availability.
    }
  }

  recordSpecialistHandoffEvent({
    parentExecutionId,
    memberTurnId,
    handoffId = null,
    memberAgentId,
    parentInteractionId,
    operation,
    status,
    errorCode = null,
  }) {
    try {
      this.recordDiagnosticEvent({
        executionId: memberTurnId ?? parentExecutionId,
        parentExecutionId,
        turnId: memberTurnId,
        module: 'social.handoff',
        operation,
        status,
        errorCode,
        details: {
          handoffId,
          memberAgentId,
          parentInteractionId,
        },
      });
    } catch {
      // Specialist delivery and synthesis do not depend on diagnostics.
    }
  }

  recordProjectPlanEvent({
    run,
    projectId,
    operation,
    status,
    errorCode = null,
    itemId = null,
    submissionRevision = null,
    reviewerIds = [],
  }) {
    try {
      const trace = run?.pendingSocialToolTrace?.find(
        (entry) => entry.toolName === 'manage_project_plan' && !entry.terminal,
      );
      const plan = projectId ? this.getProjectPlan(projectId) : null;
      const item =
        itemId && plan ? plan.items.find((entry) => entry.id === itemId) : null;
      this.recordDiagnosticEvent({
        executionId: run?.turnId ?? null,
        turnId: run?.turnId ?? null,
        requestId: trace?.requestId ?? null,
        toolCallId: trace?.toolCallId ?? null,
        module: 'social.plan',
        operation,
        status,
        errorCode,
        details: {
          projectId,
          planRevision: plan?.revision ?? null,
          itemId,
          submissionRevision:
            submissionRevision ?? item?.submissionRevision ?? null,
          reviewerIds:
            (reviewerIds.length ? reviewerIds : (item?.reviewerIds ?? []))
              .slice(0, 30)
              .join(',') || null,
        },
      });
    } catch {
      // Plan writes and reviews do not depend on diagnostics availability.
    }
  }

  recordProjectOutboxEvent({
    projectId,
    turnId,
    agentId,
    planItemId = null,
    planSubmissionRevision = null,
    operation,
    status,
    errorCode = null,
  }) {
    try {
      this.recordDiagnosticEvent({
        executionId: turnId,
        turnId,
        module: 'social.outbox',
        operation,
        status,
        errorCode,
        details: {
          projectId,
          memberAgentId: agentId,
          itemId: planItemId,
          submissionRevision: planSubmissionRevision,
          outboxTurnId: turnId,
        },
      });
    } catch {
      // Delivery claims do not depend on diagnostics availability.
    }
  }

  recordSocialFollowupEvent(
    run,
    operation,
    status,
    errorCode = null,
    id = null,
  ) {
    const trace = run.pendingSocialToolTrace?.find(
      (item) => item.toolName === 'schedule_followup' && !item.terminal,
    );
    this.recordUserFollowupEvent({
      executionId: id ?? run.turnId,
      parentExecutionId: id ? run.turnId : null,
      turnId: run.turnId,
      requestId: trace?.requestId ?? null,
      toolCallId: trace?.toolCallId ?? null,
      operation,
      status,
      errorCode,
    });
  }

  beginSocialToolTrace(run, calls, requestId) {
    const startedAt = Date.now();
    const traces = calls
      .filter(
        (call) =>
          typeof call?.id === 'string' && /^[a-z0-9_-]{1,160}$/i.test(call.id),
      )
      .map((call) => {
        const rawToolName =
          typeof call.function?.name === 'string' ? call.function.name : '';
        const toolName = /^[a-z][a-z0-9_]{0,119}$/i.test(rawToolName)
          ? rawToolName
          : 'unknown';
        const normalizedName = toolName.toLowerCase();
        const toolCategory =
          normalizedName.includes('search') ||
          normalizedName.includes('source') ||
          normalizedName.includes('history')
            ? 'research'
            : normalizedName.includes('project') ||
                normalizedName.includes('team')
              ? 'project'
              : normalizedName.includes('specialist')
                ? 'delegation'
                : normalizedName.includes('memory') ||
                    normalizedName.includes('asset')
                  ? 'personal_data'
                  : normalizedName.includes('followup')
                    ? 'reminder'
                    : normalizedName.includes('calculate')
                      ? 'calculation'
                      : 'other';
        return {
          toolCallId: call.id.slice(0, 160),
          requestId:
            typeof requestId === 'string' && requestId.trim()
              ? requestId.slice(0, 160)
              : null,
          toolName,
          toolCategory,
          startedAt,
          terminal: false,
        };
      });
    run.pendingSocialToolTrace = traces;
    for (const trace of traces) {
      this.recordSocialToolEvent(run, trace, 'execution.started', 'running');
    }
  }

  skipSocialToolTrace(run, calls) {
    const skippedIds = new Set(
      calls
        .map((call) => call?.id)
        .filter((id) => typeof id === 'string' && id.trim()),
    );
    for (const trace of run.pendingSocialToolTrace ?? []) {
      if (trace.terminal || !skippedIds.has(trace.toolCallId)) continue;
      this.recordSocialToolEvent(run, trace, 'execution.terminal', 'denied', {
        durationMs: Math.max(0, Date.now() - trace.startedAt),
        effectStatus: 'not_dispatched',
        errorCode: 'tool_call_not_dispatched',
      });
      trace.terminal = true;
    }
    if (Array.isArray(run.pendingSocialToolTrace)) {
      run.pendingSocialToolTrace = run.pendingSocialToolTrace.filter(
        (trace) => !trace.terminal,
      );
    }
  }

  finishSocialToolTrace(
    run,
    messages,
    { interrupted = false, error = null, completedCallIds = [] } = {},
  ) {
    const traces = run.pendingSocialToolTrace;
    if (!Array.isArray(traces) || traces.length === 0) return;
    for (const trace of traces) {
      if (trace.terminal) continue;
      const toolMessage = messages?.find(
        (message) =>
          message.role === 'tool' && message.tool_call_id === trace.toolCallId,
      );
      let returnedErrorCode = null;
      let returnedError = false;
      let returnedResultClassified = false;
      if (toolMessage && typeof toolMessage.content === 'string') {
        if (toolMessage.content.length <= 16_384) {
          try {
            const result = JSON.parse(toolMessage.content);
            if (
              result &&
              typeof result === 'object' &&
              !Array.isArray(result)
            ) {
              returnedResultClassified = true;
              returnedError =
                (typeof result.error === 'string' && result.error.length > 0) ||
                result.ok === false ||
                result.created === false ||
                result.accepted === false ||
                result.completed === false ||
                result.updated === false ||
                result.deleted === false ||
                [
                  'failed',
                  'error',
                  'denied',
                  'interrupted',
                  'unreadable',
                ].includes(result.status);
              returnedErrorCode =
                typeof result.code === 'string' &&
                /^[a-z0-9_]{1,120}$/i.test(result.code)
                  ? result.code
                  : null;
            }
          } catch {
            // Tool result content is deliberately not retained in diagnostics.
          }
        }
      }
      const explicitlyCompleted = completedCallIds.includes(trace.toolCallId);
      let status;
      let effectStatus;
      let errorCode = null;
      if (toolMessage || explicitlyCompleted) {
        status = returnedError ? 'failed' : 'completed';
        effectStatus = returnedError
          ? 'returned_error'
          : explicitlyCompleted
            ? 'completed'
            : returnedResultClassified
              ? 'returned'
              : 'returned_unclassified';
        if (returnedError)
          errorCode = returnedErrorCode ?? 'tool_returned_error';
      } else {
        status = interrupted ? 'interrupted' : 'failed';
        effectStatus = interrupted
          ? 'no_result_interrupted'
          : 'no_result_failed';
        errorCode =
          error?.name === 'TimeoutError'
            ? 'tool_timeout'
            : typeof error?.code === 'string'
              ? error.code
              : interrupted
                ? 'tool_interrupted'
                : 'tool_execution_failed';
      }
      this.recordSocialToolEvent(run, trace, 'execution.terminal', status, {
        durationMs: Math.max(0, Date.now() - trace.startedAt),
        effectStatus,
        errorCode:
          typeof errorCode === 'string' && /^[a-z0-9_]{1,120}$/i.test(errorCode)
            ? errorCode
            : null,
      });
      trace.terminal = true;
    }
    run.pendingSocialToolTrace = null;
  }
}
