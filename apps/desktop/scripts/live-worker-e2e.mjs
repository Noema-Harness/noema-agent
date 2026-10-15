import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RootStore } from '../src/root-store.mjs';
import { configureElectronRuntime } from './electron-runtime.mjs';

configureElectronRuntime();

if (process.platform !== 'win32') {
  throw new Error('The live DSH worker check currently requires Windows.');
}
const nodeVersion = /^v(\d+)\.(\d+)\.(\d+)/.exec(process.version);
if (
  !nodeVersion ||
  Number(nodeVersion[1]) !== 24 ||
  Number(nodeVersion[2]) < 21
) {
  throw new Error('Run this check with Node.js 24.21.x.');
}

const configuredE2eRoot = process.env.NOEMA_E2E_ROOT_DIR ?? tmpdir();
if (!path.isAbsolute(configuredE2eRoot) || !existsSync(configuredE2eRoot)) {
  throw new Error('The isolated E2E root directory must already exist.');
}
const e2eRoot = path.resolve(configuredE2eRoot);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptDirectory, '..');
const workspacePath = path.join(
  mkdtempSync(path.join(e2eRoot, 'Noema-live-worker-e2e-')),
  'workspace',
);
const e2eDirectory = path.dirname(workspacePath);
const databasePath = path.join(e2eDirectory, 'root.sqlite3');
const dshUserDataPath = path.join(e2eDirectory, 'dsh-user-data');
const marker = `NOEMA-E2E-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const rootReplyMarker = `NOEMA-ROOT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
mkdirSync(workspacePath);
const rootOnly = process.argv.includes('--root-only');
const withCorrection = process.argv.includes('--with-correction');
const withoutCorrection = process.argv.includes('--without-correction');
const captureOwnerCorrection = process.argv.includes(
  '--capture-owner-correction',
);
if (
  Number(withCorrection) +
    Number(withoutCorrection) +
    Number(captureOwnerCorrection) >
  1
) {
  throw new Error(
    'Choose only one of --with-correction, --without-correction, or --capture-owner-correction.',
  );
}
const includeCorrection = withCorrection || (!withoutCorrection && !rootOnly);
if (captureOwnerCorrection && rootOnly) {
  throw new Error('--capture-owner-correction requires worker mode.');
}
const requestedModel = process.env.NOEMA_E2E_MODEL ?? 'auto:noema-free';
const allowedModels = new Set([
  'auto:noema-free',
  'free-router',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3.5-lightning',
  'cohere/north-mini-code',
  'nvidia/llama-3.2-11b-vision',
]);
if (!allowedModels.has(requestedModel)) {
  throw new Error(
    'Choose an E2E route already exposed by Noema: auto:noema-free, free-router, nvidia/nemotron-3-super-120b-a12b:free, nvidia/nemotron-3.5-lightning, cohere/north-mini-code, or nvidia/llama-3.2-11b-vision.',
  );
}
const correction =
  '当任务要求创建指定文件时，先创建，再读取确认内容；不要把搜索未找到当作完成。';
const ownerCorrectionQuote = '做完再停下汇报啊';
const ownerCorrectionText = [
  '[NOEMA E2E PREFACE] 仅在隔离测试数据库中记录此互动纠正。',
  '它适用于未来多阶段编码任务：除非真实阻塞或必须由用户决策，否则不要以中间进度汇报结束，应继续完成已明确的验收项。',
  `我的原话是：“${ownerCorrectionQuote}”。`,
  '请将它记录为适用于 coding 的互动调整。',
].join('\n');
const prompt = rootOnly
  ? [
      '[NOEMA E2E] This is a synthetic root-chat transport check only.',
      `Reply with exactly this text and nothing else: ${rootReplyMarker}`,
      'Do not call tools, delegate work, or modify files.',
    ].join('\n')
  : [
      '[NOEMA E2E] 仅在当前已选的合成测试工作区内执行此任务。',
      `创建 README.md，文件只需包含这一行：${marker}`,
      '请将这项明确的文件创建任务交给后台 DSH agent；Noema 会独立核验文件和内容。不要修改其它文件。',
    ].join('\n');

const store = new RootStore(databasePath);
store.setSelectedModel(requestedModel);
store.setWorkspaceDirectory(workspacePath);
if (includeCorrection && !captureOwnerCorrection) {
  const turn = store.beginTurn({
    text: correction,
    model: requestedModel,
  });
  store.appendAssistant({
    id: turn.id,
    attempt: turn.attempt,
    content: '我会在之后的文件任务中核对实际产物。',
  });
  store.completeTurn(turn.id, turn.attempt);
  store.addInteractionAdjustment({
    id: `e2e-adjustment-${Date.now()}`,
    sourceTurnId: turn.id,
    scope: 'coding',
    situation: '后台任务要求创建指定文件或写入指定内容',
    behavior: '提交任务后独立检查目标文件和内容，不能凭 agent 自述确认完成',
    sourceQuote: correction,
  });
}
store.close();

const child = spawn(process.execPath, ['scripts/start.mjs'], {
  cwd: appDirectory,
  env: {
    ...process.env,
    NOEMA_E2E_DATABASE_PATH: databasePath,
    NOEMA_E2E_DSH_USER_DATA_PATH: dshUserDataPath,
    ...(captureOwnerCorrection
      ? { NOEMA_E2E_WORKER_PREFACE: ownerCorrectionText }
      : {}),
    NOEMA_E2E_WORKER_PROMPT: prompt,
    NOEMA_E2E_ROOT_ONLY: rootOnly ? '1' : '0',
  },
  stdio: 'inherit',
});

const timeoutMs = 22 * 60 * 1_000;
const timeout = setTimeout(() => {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
}, timeoutMs);

const exit = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});
clearTimeout(timeout);

const resultFile = readdirSync(e2eDirectory)
  .filter((name) => name.startsWith('worker-e2e-result-'))
  .map((name) => path.join(e2eDirectory, name))
  .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
if (!resultFile) {
  throw new Error(
    `No E2E result was written. Scratch workspace: ${workspacePath}`,
  );
}
const rootResult = JSON.parse(readFileSync(resultFile, 'utf8'));
const verificationStore = new RootStore(databasePath);
const capturedOwnerAdjustment = verificationStore
  .getInteractionAdjustments()
  .find(
    (adjustment) =>
      adjustment.status === 'active' &&
      adjustment.scope === 'coding' &&
      adjustment.sourceQuote === ownerCorrectionQuote,
  );
const persistedTask = rootResult.task
  ? verificationStore
      .getBackgroundTasks(50)
      .find((task) => task.id === rootResult.task.id)
  : null;
const ownerCorrectionUsedByTask = Boolean(
  persistedTask?.interactionAdjustmentSnapshots?.some(
    (snapshot) =>
      snapshot.scope === 'coding' &&
      snapshot.id === capturedOwnerAdjustment?.id &&
      snapshot.sourceQuote === ownerCorrectionQuote,
  ),
);
verificationStore.close();
const readmePath = path.join(workspacePath, 'README.md');
const fileExists = existsSync(readmePath);
const fileMatches =
  fileExists && readFileSync(readmePath, 'utf8').trim() === marker;
const summary = {
  mode: rootOnly ? 'root-only' : 'worker',
  correctionInjected: includeCorrection && !captureOwnerCorrection,
  adjustmentMode: rootOnly
    ? 'none'
    : captureOwnerCorrection
      ? 'live-owner-correction'
      : includeCorrection
        ? 'preseeded-synthetic-correction'
        : 'none',
  ownerCorrectionCaptured: Boolean(capturedOwnerAdjustment),
  ownerCorrectionUsedByTask,
  requestedModel,
  outcome: rootResult.outcome,
  turnStatus: rootResult.turnStatus,
  turnErrorCode: rootResult.turnErrorCode,
  assistantText: rootResult.assistantText,
  dshAvailable: rootResult.dshAvailable,
  dshWorkerError: rootResult.dshWorkerError ?? null,
  rootRouteMetadata: rootResult.rootRouteMetadata ?? {
    status: 'unknown',
    routedVia: [],
  },
  taskStatus: rootResult.task?.status ?? null,
  eventStatus: rootResult.task?.eventStatus ?? null,
  noemaResponseStatus: rootResult.task?.noemaResponseStatus ?? null,
  noemaResponseError: rootResult.task?.noemaResponseError ?? null,
  verificationStatus: rootResult.task?.verificationStatus ?? null,
  toolActionCategories: rootResult.task?.toolActionCategories ?? [],
  toolActionsTruncated: rootResult.task?.toolActionsTruncated ?? false,
  task: rootResult.task,
  readmeExists: fileExists,
  readmeMatchesMarker: fileMatches,
  scratchWorkspace: workspacePath,
  resultFile,
  childExitCode: exit.code,
  childSignal: exit.signal,
};
console.log(JSON.stringify(summary, null, 2));
const rootChatPassed =
  rootResult.rootOnly === true &&
  rootResult.outcome === 'no_worker_dispatched' &&
  rootResult.turnStatus === 'completed' &&
  rootResult.assistantText?.trim() === rootReplyMarker &&
  rootResult.rootRouteMetadata?.status === 'reported' &&
  exit.code === 0;
if (
  rootOnly
    ? !rootChatPassed
    : rootResult.outcome !== 'worker_finished' ||
      rootResult.task?.status !== 'completed' ||
      rootResult.task?.eventStatus !== 'delivered' ||
      rootResult.task?.noemaResponseStatus !== 'complete' ||
      rootResult.task?.verificationStatus !== 'verified' ||
      (captureOwnerCorrection && !ownerCorrectionUsedByTask) ||
      !fileMatches ||
      exit.code !== 0
) {
  process.exitCode = 1;
}
