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
const e2eRootDirectory = mkdtempSync(
  path.join(e2eRoot, 'Noema-live-worker-e2e-'),
);
const e2eDirectory = path.join(e2eRootDirectory, 'database');
const workspacePath = path.join(e2eDirectory, 'workspace');
const databasePath = path.join(e2eDirectory, 'root.sqlite3');
const dshUserDataPath = path.join(e2eDirectory, 'dsh-user-data');
const marker = `NOEMA-E2E-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const rootReplyMarker = `NOEMA-ROOT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const historyReplyMarker = `NOEMA-HISTORY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
mkdirSync(e2eDirectory);
mkdirSync(workspacePath);
const historyRecall = process.argv.includes('--history-recall');
const rootOnly = process.argv.includes('--root-only') || historyRecall;
const directWorker = process.argv.includes('--direct-worker');
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
if (directWorker && (rootOnly || captureOwnerCorrection)) {
  throw new Error(
    '--direct-worker cannot be combined with --root-only or --capture-owner-correction.',
  );
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
const prompt = historyRecall
  ? [
      '[NOEMA E2E] 这是隔离数据库中的历史回忆检查。',
      '请回忆我之前给出的测试标记是什么；必须依据旧对话原文，不要猜。',
      '不要委派后台任务。',
    ].join('\n')
  : rootOnly
    ? [
        '[NOEMA E2E] This is a synthetic root-chat transport check only.',
        `Reply with exactly this text and nothing else: ${rootReplyMarker}`,
        'Do not call tools, delegate work, or modify files.',
      ].join('\n')
    : directWorker
      ? [
          '[NOEMA E2E] 仅在当前隔离工作区完成这组双文件交付。',
          '请为 Noema 的“本机速记 → 用户选择后再讨论”切片写两份彼此匹配的文档：',
          '- DESIGN.md：简要说明本机保存、显式讨论和删除边界。',
          '- README.md：写给用户的实际操作说明。',
          `两个文件都必须包含同一个验收标记：${marker}`,
          '这是两个都必须完成的交付项；不要在第一个文件后停止或报告完成。仅使用可用的文件工具，不要尝试 shell/网络操作。',
        ].join('\n')
      : [
          '[NOEMA E2E] 仅在当前隔离工作区内完成这个小型 Node 功能；不要改工作区外的内容。',
          '实现一个 `toSlug` 文本规范化函数，并交付完整的小功能，而不只是先写一个文件：',
          '- `src/slug.mjs`：导出 `toSlug`，将输入首尾空白去除、转小写、连续空白变成连字符、去掉 ASCII 标点，并保留中文字符。',
          '- `test/slug.test.mjs`：使用 Node 内置测试 API，覆盖 ASCII 标点/空格和中英混合文本两个案例。不要声称已运行测试，因为后台只开放文件工具。',
          '- `README.md`：说明导入路径、函数行为和两个示例。',
          `三个文件都必须包含这个验收标记：${marker}`,
          '请把实现、测试和说明全部交给后台 DSH agent；让 Noema 为三个文件分别设置“包含验收标记”的本地核验条件。不要只完成一个阶段后汇报。',
        ].join('\n');

const store = new RootStore(databasePath);
store.setSelectedModel(requestedModel);
store.setWorkspaceDirectory(workspacePath);
let historySourceMessageId = null;
if (historyRecall) {
  const sourceTurn = store.beginTurn({
    text: `我之前给出的测试标记是 ${historyReplyMarker}。`,
    model: requestedModel,
  });
  const sourceUserMessage = store
    .getSnapshot()
    .messages.find(
      (message) => message.turnId === sourceTurn.id && message.role === 'user',
    );
  historySourceMessageId = sourceUserMessage?.id ?? null;
  store.appendAssistant({
    id: sourceTurn.id,
    attempt: sourceTurn.attempt,
    content: '我会保留这段隔离测试用的上下文。',
  });
  store.completeTurn(sourceTurn.id, sourceTurn.attempt);
  for (let index = 0; index < 10; index += 1) {
    const filler = store.beginTurn({
      text: `植物养护与地铁路线话题 ${index}。`,
      model: requestedModel,
    });
    store.appendAssistant({
      id: filler.id,
      attempt: filler.attempt,
      content: `日常回复 ${index}。`,
    });
    store.completeTurn(filler.id, filler.attempt);
  }
  if (!historySourceMessageId) {
    throw new Error('The synthetic history source was not saved.');
  }
}
if (includeCorrection && !captureOwnerCorrection) {
  const turn = store.beginTurn({
    text: directWorker ? ownerCorrectionQuote : correction,
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
    situation: directWorker
      ? '多阶段编码任务的中间进度汇报'
      : '后台任务要求创建指定文件或写入指定内容',
    behavior: directWorker
      ? '不要把阶段进度当作完成；除非真实阻塞或必须由用户决策，否则继续直到所有明确验收项通过后再汇报。'
      : '提交任务后独立检查目标文件和内容，不能凭 agent 自述确认完成',
    sourceQuote: directWorker ? ownerCorrectionQuote : correction,
  });
}
store.close();

const child = spawn(process.execPath, ['scripts/start.mjs'], {
  cwd: appDirectory,
  env: {
    ...process.env,
    NOEMA_SMOKE_TEST: '1',
    NOEMA_E2E_DATABASE_PATH: databasePath,
    NOEMA_E2E_DSH_USER_DATA_PATH: dshUserDataPath,
    ...(captureOwnerCorrection
      ? { NOEMA_E2E_WORKER_PREFACE: ownerCorrectionText }
      : {}),
    NOEMA_E2E_WORKER_PROMPT: prompt,
    NOEMA_E2E_ROOT_ONLY: rootOnly ? '1' : '0',
    NOEMA_E2E_HISTORY_RECALL: historyRecall ? '1' : '0',
    NOEMA_E2E_DIRECT_WORKER: directWorker ? '1' : '0',
    ...(directWorker
      ? {
          NOEMA_E2E_VERIFICATION_CHECKS: JSON.stringify([
            { kind: 'file_contains', path: 'DESIGN.md', text: marker },
            { kind: 'file_contains', path: 'README.md', text: marker },
          ]),
        }
      : {}),
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
const requiredArtifacts = directWorker
  ? ['DESIGN.md', 'README.md']
  : ['src/slug.mjs', 'test/slug.test.mjs', 'README.md'];
const artifacts = requiredArtifacts.map((relativePath) => {
  const absolutePath = path.join(workspacePath, relativePath);
  const exists = existsSync(absolutePath);
  return {
    path: relativePath,
    exists,
    containsMarker:
      exists && readFileSync(absolutePath, 'utf8').includes(marker),
  };
});
const readme = artifacts.find((artifact) => artifact.path === 'README.md');
const fileExists = Boolean(readme?.exists);
const fileMatches = Boolean(readme?.containsMarker);
const allArtifactsMatchMarker = artifacts.every(
  (artifact) => artifact.exists && artifact.containsMarker,
);
const summary = {
  mode: historyRecall
    ? 'history-recall'
    : rootOnly
      ? 'root-only'
      : directWorker
        ? 'direct-worker'
        : 'worker',
  historyRecall,
  syntheticHistorySourceId: historySourceMessageId,
  correctionInjected: includeCorrection && !captureOwnerCorrection,
  adjustmentMode: rootOnly
    ? 'none'
    : captureOwnerCorrection
      ? 'live-owner-correction'
      : includeCorrection
        ? directWorker
          ? 'preseeded-owner-correction'
          : 'preseeded-synthetic-correction'
        : 'none',
  ownerCorrectionCaptured: Boolean(capturedOwnerAdjustment),
  ownerCorrectionUsedByTask,
  requestedModel,
  outcome: rootResult.outcome,
  turnStatus: rootResult.turnStatus,
  turnErrorCode: rootResult.turnErrorCode,
  assistantText: rootResult.assistantText,
  historySources: rootResult.historySources ?? [],
  historySearchStatus: rootResult.historySearchStatus ?? 'not_searched',
  historySourcesIncluded: Boolean(rootResult.historySourcesIncluded),
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
  artifacts,
  allArtifactsMatchMarker,
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
const historyRecallPassed =
  historyRecall &&
  rootResult.rootOnly === true &&
  rootResult.historyRecall === true &&
  rootResult.outcome === 'no_worker_dispatched' &&
  rootResult.turnStatus === 'completed' &&
  rootResult.assistantText?.includes(historyReplyMarker) &&
  rootResult.historySources?.some(
    (source) => source.id === historySourceMessageId,
  ) &&
  rootResult.historySourcesIncluded === true &&
  rootResult.rootRouteMetadata?.status === 'reported' &&
  exit.code === 0;
const directWorkerPassed =
  directWorker &&
  rootResult.outcome === 'worker_direct_finished' &&
  rootResult.task?.status === 'completed' &&
  rootResult.task?.verificationStatus === 'verified' &&
  (!includeCorrection || ownerCorrectionUsedByTask) &&
  allArtifactsMatchMarker &&
  exit.code === 0;
if (
  historyRecall
    ? !historyRecallPassed
    : rootOnly
      ? !rootChatPassed
      : directWorker
        ? !directWorkerPassed
        : rootResult.outcome !== 'worker_finished' ||
          rootResult.task?.status !== 'completed' ||
          rootResult.task?.eventStatus !== 'delivered' ||
          rootResult.task?.noemaResponseStatus !== 'complete' ||
          rootResult.task?.verificationStatus !== 'verified' ||
          (captureOwnerCorrection && !ownerCorrectionUsedByTask) ||
          !allArtifactsMatchMarker ||
          exit.code !== 0
) {
  process.exitCode = 1;
}
