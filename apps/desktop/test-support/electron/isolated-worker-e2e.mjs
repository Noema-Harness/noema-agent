import fs from 'node:fs';
import path from 'node:path';

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'interrupted']);
const DELIVERED_EVENT_STATUSES = new Set(['delivered']);
const FAILED_EVENT_STATUSES = new Set(['failed', 'interrupted']);

function isWithinDirectory(directory, candidate) {
  const relative = path.relative(
    path.resolve(directory),
    path.resolve(candidate),
  );
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function getAssistantText(store, turnId) {
  return (
    store
      .getSnapshot()
      .messages.filter(
        (message) => message.turnId === turnId && message.role === 'assistant',
      )
      .at(-1)
      ?.content.slice(0, 2_000) ?? ''
  );
}

function getAssistantRouteMetadata(store, turnId) {
  const message = store
    .getSnapshot()
    .messages.filter(
      (item) => item.turnId === turnId && item.role === 'assistant',
    )
    .at(-1);
  const allowedStatuses = new Set([
    'unknown',
    'pending',
    'reported',
    'not_reported',
  ]);
  const routedVia = Array.isArray(message?.routedVia)
    ? message.routedVia
        .filter((route) => typeof route === 'string' && route.trim())
        .slice(-16)
    : [];
  return {
    status: allowedStatuses.has(message?.routeMetadataStatus)
      ? message.routeMetadataStatus
      : 'unknown',
    routedVia,
  };
}

function summarizeTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    status: task.status,
    errorCode: task.errorCode,
    verificationStatus: task.verificationStatus,
    verificationResults: task.verificationResults,
    verificationAttempts: task.verificationAttempts,
    interactionAdjustmentIds: task.interactionAdjustmentIds,
    toolActionCategories: task.toolActionCategories,
    toolActionsTruncated: task.toolActionsTruncated,
    toolCallCount: task.toolCallCount,
    eventStatus: task.eventStatus,
    noemaResponseStatus: task.noemaResponseStatus,
    noemaResponseError: task.noemaResponseError ?? null,
  };
}

function writeResult(resultPath, result, e2eDirectory) {
  if (!isWithinDirectory(e2eDirectory, resultPath)) {
    throw new Error('E2E result path escaped the isolated directory.');
  }
  const temporaryPath = `${resultPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(result, null, 2), {
    encoding: 'utf8',
    flag: 'wx',
  });
  fs.renameSync(temporaryPath, resultPath);
}

/**
 * Run a real Noema -> DSH -> verifier scenario only against an isolated
 * database, DSH profile, and workspace. The default path includes root-model
 * dispatch; directWorker isolates DSH recovery from root-model availability.
 * No API credentials are copied or emitted; the caller supplies the app's
 * normal encrypted store.
 *
 * @param {{agent:import('./root-agent.mjs').RootAgent,store:import('./root-store.mjs').RootStore,databasePath:string,prefacePrompt?:string|null,prompt:string,resultPath:string,rootOnly?:boolean,historyRecall?:boolean,directWorker?:boolean,verificationChecks?:unknown,timeoutMs?:number}} input
 */
export async function runIsolatedWorkerE2E({
  agent,
  store,
  databasePath,
  prefacePrompt = null,
  prompt,
  resultPath,
  rootOnly = false,
  historyRecall = false,
  directWorker = false,
  verificationChecks = [],
  timeoutMs = 20 * 60 * 1_000,
}) {
  if (
    typeof databasePath !== 'string' ||
    !path.isAbsolute(databasePath) ||
    typeof resultPath !== 'string' ||
    !path.isAbsolute(resultPath) ||
    (prefacePrompt !== null &&
      (typeof prefacePrompt !== 'string' ||
        !prefacePrompt.startsWith('[NOEMA E2E PREFACE]') ||
        prefacePrompt.length > 4_000)) ||
    (rootOnly && directWorker) ||
    (historyRecall && !rootOnly) ||
    (directWorker && prefacePrompt !== null) ||
    typeof prompt !== 'string' ||
    !prompt.trim() ||
    prompt.length > 4_000 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 30 * 60 * 1_000
  ) {
    throw new TypeError('Isolated worker E2E parameters are invalid.');
  }
  const e2eDirectory = path.dirname(path.resolve(databasePath));
  const e2eRealDirectory = fs.realpathSync(e2eDirectory);
  const databaseRealPath = fs.realpathSync(databasePath);
  const workspacePath = store.getWorkspaceDirectory();
  const model = store.getSelectedModel();
  const workspaceRealPath = workspacePath
    ? fs.realpathSync(workspacePath)
    : null;
  if (
    !isWithinDirectory(e2eRealDirectory, databaseRealPath) ||
    !workspaceRealPath ||
    !isWithinDirectory(e2eRealDirectory, workspaceRealPath) ||
    workspaceRealPath === e2eRealDirectory ||
    !isWithinDirectory(e2eRealDirectory, resultPath)
  ) {
    throw new Error(
      'E2E workspace and result file must remain inside the isolated directory.',
    );
  }
  if (!model) throw new Error('An isolated E2E model must be selected.');
  if (rootOnly && prefacePrompt) {
    throw new TypeError('Root-only E2E does not accept a worker preface.');
  }

  // Keep a test-only trace of tool names. Do not record tool arguments or add
  // production persistence solely to prove a synthetic live probe used a tool.
  const rootToolCallNames = [];
  const originalStreamChat =
    rootOnly && typeof agent.provider?.streamChat === 'function'
      ? agent.provider.streamChat
      : null;
  if (originalStreamChat) {
    const streamChat = originalStreamChat.bind(agent.provider);
    agent.provider.streamChat = async function* (input) {
      yield* streamChat({
        ...input,
        onToolCalls(calls) {
          for (const call of calls ?? []) {
            const name = call?.function?.name;
            if (typeof name === 'string' && name.length <= 100) {
              rootToolCallNames.push(name);
            }
          }
          input.onToolCalls?.(calls);
        },
      });
    };
  }

  if (rootOnly) {
    agent.allowRootActions = false;
    agent.allowHistorySearch = historyRecall;
    agent.dshAdapter = null;
  }

  const dshAvailable = Boolean(agent.dshAdapter);
  const canDispatch =
    rootOnly ||
    (dshAvailable &&
      (typeof agent.canDelegateToDsh !== 'function' ||
        agent.canDelegateToDsh()));
  if (!canDispatch) {
    const result = {
      rootOnly,
      historyRecall,
      outcome: 'preflight_failed',
      turnStatus: 'not_started',
      turnErrorCode: 'dsh_unavailable',
      model,
      dshAvailable,
      dshWorkerError:
        agent.dshRuntimeError ??
        'Noema 尚未满足后台执行条件；没有发送模型请求。',
      task: null,
      assistantText: '',
      rootRouteMetadata: { status: 'unknown', routedVia: [] },
    };
    writeResult(resultPath, result, e2eDirectory);
    return result;
  }

  if (directWorker) {
    // This test-only path isolates DSH lifecycle behavior from a second root
    // model call; the normal product path still processes returned events.
    const originalEventProcessor = agent.processPendingWorkerEvent;
    agent.processPendingWorkerEvent = () => {};
    try {
      const sourceTurn = store.beginTurn({
        text: '[NOEMA E2E] 仅在隔离工作区执行下方后台文件任务。',
        model,
      });
      store.appendAssistant({
        id: sourceTurn.id,
        attempt: sourceTurn.attempt,
        content: '隔离测试直接验证 DSH 后台续做，不调用根模型派发。',
      });
      store.completeTurn(sourceTurn.id, sourceTurn.attempt);
      const dispatch = await agent.startBackgroundTask({
        sourceTurnId: sourceTurn.id,
        prompt,
        workspacePath,
        verificationChecks,
      });
      if (!dispatch.accepted) {
        const result = {
          rootOnly: false,
          historyRecall: false,
          directWorker: true,
          outcome: 'worker_rejected',
          turnStatus: store.getTurn(sourceTurn.id)?.status ?? 'missing',
          turnErrorCode: null,
          model,
          dshAvailable,
          dshWorkerError: agent.dshRuntimeError ?? null,
          task: null,
          assistantText: dispatch.errorMessage ?? '',
          rootRouteMetadata: { status: 'unknown', routedVia: [] },
        };
        writeResult(resultPath, result, e2eDirectory);
        return result;
      }

      await dispatch.completion;
      const task = store.getBackgroundTask(dispatch.taskId);
      const result = {
        rootOnly: false,
        historyRecall: false,
        directWorker: true,
        outcome:
          task?.status === 'completed'
            ? 'worker_direct_finished'
            : 'worker_direct_failed',
        turnStatus: store.getTurn(sourceTurn.id)?.status ?? 'missing',
        turnErrorCode: null,
        model,
        dshAvailable,
        dshWorkerError: agent.dshRuntimeError ?? null,
        task: summarizeTask(task),
        assistantText: '',
        rootRouteMetadata: { status: 'unknown', routedVia: [] },
      };
      writeResult(resultPath, result, e2eDirectory);
      return result;
    } finally {
      agent.processPendingWorkerEvent = originalEventProcessor;
    }
  }

  let prefaceTurn = null;
  if (prefacePrompt) {
    const { turnId: prefaceTurnId } = agent.sendMessage({
      text: prefacePrompt,
      model,
    });
    const activePreface = agent.active;
    if (activePreface?.turn.id === prefaceTurnId) await activePreface.done;
    prefaceTurn = store.getTurn(prefaceTurnId);
    if (!prefaceTurn || prefaceTurn.status !== 'completed') {
      const result = {
        rootOnly,
        outcome: 'preface_failed',
        turnStatus: prefaceTurn?.status ?? 'missing',
        turnErrorCode: prefaceTurn?.errorCode ?? null,
        model,
        dshAvailable,
        dshWorkerError: agent.dshRuntimeError ?? null,
        preface: {
          turnId: prefaceTurnId,
          status: prefaceTurn?.status ?? 'missing',
          errorCode: prefaceTurn?.errorCode ?? null,
        },
        task: null,
        assistantText: getAssistantText(store, prefaceTurnId),
        rootRouteMetadata: getAssistantRouteMetadata(store, prefaceTurnId),
      };
      writeResult(resultPath, result, e2eDirectory);
      return result;
    }
  }

  const { turnId } = agent.sendMessage({ text: prompt, model });
  const activeTurn = agent.active;
  if (activeTurn?.turn.id === turnId) await activeTurn.done;

  const deadline = Date.now() + timeoutMs;
  let task = null;
  let turn = store.getTurn(turnId);
  while (Date.now() < deadline) {
    task = store
      .getBackgroundTasks(50)
      .find((candidate) => candidate.sourceTurnId === turnId);
    turn = store.getTurn(turnId);
    const rootTurnTerminal = ['completed', 'failed', 'interrupted'].includes(
      turn?.status,
    );
    const workerTerminal =
      !task ||
      (TERMINAL_TASK_STATUSES.has(task.status) &&
        (DELIVERED_EVENT_STATUSES.has(task.eventStatus) ||
          FAILED_EVENT_STATUSES.has(task.noemaResponseStatus)));
    if (rootTurnTerminal && workerTerminal) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const assistantMessage = store
    .getSnapshot()
    .messages.find(
      (message) =>
        message.turnId === turnId &&
        message.role === 'assistant' &&
        message.attempt === store.getTurn(turnId)?.attempt,
    );
  const result = {
    rootOnly,
    historyRecall,
    outcome:
      Date.now() >= deadline
        ? 'timeout'
        : task
          ? DELIVERED_EVENT_STATUSES.has(task.eventStatus)
            ? 'worker_finished'
            : FAILED_EVENT_STATUSES.has(task.noemaResponseStatus)
              ? 'worker_event_response_failed'
              : 'worker_event_pending'
          : turn?.status === 'completed'
            ? 'no_worker_dispatched'
            : 'root_turn_failed',
    turnStatus: turn?.status ?? 'missing',
    turnErrorCode: turn?.errorCode ?? null,
    model,
    dshAvailable,
    dshWorkerError: agent.dshRuntimeError ?? null,
    preface: prefaceTurn
      ? { status: prefaceTurn.status, errorCode: prefaceTurn.errorCode ?? null }
      : null,
    task: summarizeTask(task),
    assistantText: getAssistantText(store, turnId),
    historySources: assistantMessage?.historySources ?? [],
    historySearchStatus:
      assistantMessage?.historySearchStatus ?? 'not_searched',
    historySourcesIncluded: Boolean(assistantMessage?.historySourcesIncluded),
    rootRouteMetadata: getAssistantRouteMetadata(store, turnId),
    rootToolCallNames,
  };
  if (originalStreamChat) agent.provider.streamChat = originalStreamChat;
  writeResult(resultPath, result, e2eDirectory);
  return result;
}
