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
    toolCallCount: task.toolCallCount,
    eventStatus: task.eventStatus,
    noemaResponseStatus: task.noemaResponseStatus,
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
 * Run a real Noema root-model -> DSH -> verifier scenario only against an
 * isolated database, DSH profile, and workspace. No API credentials are
 * copied or emitted; the caller supplies the app's normal encrypted store.
 *
 * @param {{agent:import('./root-agent.mjs').RootAgent,store:import('./root-store.mjs').RootStore,databasePath:string,prompt:string,resultPath:string,timeoutMs?:number}} input
 */
export async function runIsolatedWorkerE2E({
  agent,
  store,
  databasePath,
  prompt,
  resultPath,
  timeoutMs = 20 * 60 * 1_000,
}) {
  if (
    typeof databasePath !== 'string' ||
    !path.isAbsolute(databasePath) ||
    typeof resultPath !== 'string' ||
    !path.isAbsolute(resultPath) ||
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

  const result = {
    outcome:
      Date.now() >= deadline
        ? 'timeout'
        : task
          ? 'worker_finished'
          : turn?.status === 'completed'
            ? 'no_worker_dispatched'
            : 'root_turn_failed',
    turnStatus: turn?.status ?? 'missing',
    turnErrorCode: turn?.errorCode ?? null,
    model,
    dshAvailable: Boolean(agent.dshAdapter),
    task: summarizeTask(task),
    assistantText: getAssistantText(store, turnId),
  };
  writeResult(resultPath, result, e2eDirectory);
  return result;
}
