import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWorkspaceChecks } from '../src/workspace-verifier.mjs';
import { configureElectronRuntime } from './electron-runtime.mjs';

configureElectronRuntime();

if (process.platform !== 'win32') {
  throw new Error('Noema social project-work E2E currently requires Windows.');
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
  path.join(e2eRoot, 'Noema-social-work-e2e-'),
);
const e2eDirectory = path.join(e2eRootDirectory, 'isolated');
const workspacePath = path.join(e2eDirectory, 'workspace');
const databasePath = path.join(e2eDirectory, 'noema.sqlite3');
const dshUserDataPath = path.join(e2eDirectory, 'dsh-home');
const resultPath = path.join(e2eDirectory, 'result.json');
const screenshotTag = Date.now();
const desktopScreenshotPath = path.join(
  e2eRoot,
  `Noema-social-work-desktop-${screenshotTag}.png`,
);
const narrowScreenshotPath = path.join(
  e2eRoot,
  `Noema-social-work-narrow-${screenshotTag}.png`,
);
const marker = `NOEMA-SOCIAL-WORK-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const relativePath = 'NOEMA-E2E-RESULT.txt';
const verificationChecks = [
  { kind: 'file_contains', path: relativePath, text: marker },
];
const prompt = [
  '[NOEMA E2E] 仅在当前临时工作区完成一项小任务。',
  `创建 ${relativePath}，文件内容必须原样包含验收标记 ${marker}。`,
  '只修改这个文件；不要读取、写入或运行工作区之外的内容。',
  `Noema 会在任务结束后独立检查：${JSON.stringify(verificationChecks)}`,
].join('\n');
mkdirSync(e2eDirectory, { recursive: true });
mkdirSync(workspacePath, { recursive: true });

const child = spawn(process.execPath, ['scripts/start.mjs'], {
  cwd: appDirectory,
  env: {
    ...process.env,
    PATH: [path.dirname(process.execPath), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter),
    NOEMA_SMOKE_TEST: '1',
    NOEMA_E2E_DATABASE_PATH: databasePath,
    NOEMA_E2E_DSH_USER_DATA_PATH: dshUserDataPath,
    NOEMA_E2E_SOCIAL_WORK_PROMPT: prompt,
    NOEMA_E2E_SOCIAL_WORK_WORKSPACE: workspacePath,
    NOEMA_E2E_SOCIAL_WORK_RESULT_PATH: resultPath,
    NOEMA_E2E_SOCIAL_WORK_CHECKS: JSON.stringify(verificationChecks),
    NOEMA_E2E_SOCIAL_WORK_CAPTURE_UI: '1',
    NOEMA_SMOKE_CAPTURE_SOCIAL_CHAT: '1',
    NOEMA_SMOKE_SOCIAL_PROJECT_WORK_PATH: desktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_PROJECT_WORK_NARROW_PATH: narrowScreenshotPath,
  },
  stdio: 'inherit',
  windowsHide: true,
});

const timeoutMs = 7 * 60 * 1_000;
const timeout = setTimeout(() => {
  if (child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
}, timeoutMs);
const exit = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});
clearTimeout(timeout);

if (!existsSync(resultPath)) {
  throw new Error(`No social-work E2E result was written in ${e2eDirectory}.`);
}
const result = JSON.parse(readFileSync(resultPath, 'utf8'));
const independentVerification = verifyWorkspaceChecks(
  workspacePath,
  verificationChecks,
);
const summary = {
  outcome: result.outcome,
  taskStatus: result.task?.status ?? null,
  verificationStatus: result.task?.verificationStatus ?? null,
  independentVerification: independentVerification.status,
  resultText: result.task?.resultText ?? '',
  errorCode: result.task?.errorCode ?? null,
  errorMessage: result.task?.errorMessage ?? result.errorMessage ?? null,
  toolCallCount: result.task?.toolCallCount ?? 0,
  workspacePath,
  childExitCode: exit.code,
  childSignal: exit.signal,
  scratchDirectory: e2eRootDirectory,
  uiSmoke: result.socialWorkUiSmoke,
  desktopScreenshotPath,
  narrowScreenshotPath,
};
console.log(JSON.stringify(summary, null, 2));

if (
  result.outcome !== 'finished' ||
  result.task?.status !== 'completed' ||
  result.task?.verificationStatus !== 'verified' ||
  independentVerification.status !== 'verified' ||
  !result.socialWorkUiSmoke?.desktop?.taskVisible ||
  !result.socialWorkUiSmoke?.desktop?.projectModeSelected ||
  !result.socialWorkUiSmoke?.desktop?.composerVisible ||
  !result.socialWorkUiSmoke?.desktop?.documentNoOverflow ||
  !result.socialWorkUiSmoke?.narrow?.taskVisible ||
  !result.socialWorkUiSmoke?.narrow?.projectModeSelected ||
  !result.socialWorkUiSmoke?.narrow?.composerVisible ||
  !result.socialWorkUiSmoke?.narrow?.documentNoOverflow ||
  exit.code !== 0
) {
  process.exitCode = 1;
}

// Keep failed scratch work for diagnosis. Remove only this script's unique
// temporary directory after a fully verified successful run.
if (process.exitCode !== 1) {
  rmSync(e2eRootDirectory, { recursive: true, force: true });
}
