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
mkdirSync(workspacePath);
const withCorrection = process.argv.includes('--with-correction');
const withoutCorrection = process.argv.includes('--without-correction');
if (withCorrection && withoutCorrection) {
  throw new Error('Choose either --with-correction or --without-correction.');
}
const includeCorrection = withCorrection || !withoutCorrection;
const requestedModel = process.env.NOEMA_E2E_MODEL ?? 'auto:noema-free';
const allowedModels = new Set([
  'auto:noema-free',
  'free-router',
  'nvidia/nemotron-3-super-120b-a12b:free',
]);
if (!allowedModels.has(requestedModel)) {
  throw new Error(
    'Choose an E2E route already exposed by Noema: auto:noema-free, free-router, or nvidia/nemotron-3-super-120b-a12b:free.',
  );
}
const correction =
  '当任务要求创建指定文件时，先创建，再读取确认内容；不要把搜索未找到当作完成。';
const prompt = [
  '[NOEMA E2E] 仅在当前已选的合成测试工作区内执行此任务。',
  `创建 README.md，文件只需包含这一行：${marker}`,
  '请将这项明确的文件创建任务交给后台 DSH agent；Noema 会独立核验文件和内容。不要修改其它文件。',
].join('\n');

const store = new RootStore(databasePath);
store.setSelectedModel(requestedModel);
store.setWorkspaceDirectory(workspacePath);
if (includeCorrection) {
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
    NOEMA_E2E_WORKER_PROMPT: prompt,
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
const readmePath = path.join(workspacePath, 'README.md');
const fileExists = existsSync(readmePath);
const fileMatches =
  fileExists && readFileSync(readmePath, 'utf8').trim() === marker;
const summary = {
  correctionInjected: includeCorrection,
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
  verificationStatus: rootResult.task?.verificationStatus ?? null,
  task: rootResult.task,
  readmeExists: fileExists,
  readmeMatchesMarker: fileMatches,
  scratchWorkspace: workspacePath,
  resultFile,
  childExitCode: exit.code,
  childSignal: exit.signal,
};
console.log(JSON.stringify(summary, null, 2));
if (
  rootResult.outcome !== 'worker_finished' ||
  rootResult.task?.status !== 'completed' ||
  rootResult.task?.verificationStatus !== 'verified' ||
  !fileMatches ||
  exit.code !== 0
) {
  process.exitCode = 1;
}
