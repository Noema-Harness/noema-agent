import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWorkspaceChecks } from '../src/workspace-verifier.mjs';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';
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
const syntheticAdapter = process.argv.includes('--synthetic');
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

// Seed two independently checked tasks so the real renderer-to-service run in
// room C exercises a candidate practice derived from a verified case transfer.
// Service tests separately cover model-proposed candidate generation.
const sourceCaseTaskId = 'e2e-room-a-verified-case';
const practiceSourceTaskId = 'e2e-room-b-practice-source';
const sourceCasePath = 'NOEMA-E2E-ROOM-A-CASE.txt';
const practiceSourcePath = 'NOEMA-E2E-ROOM-B-RESULT.txt';
writeFileSync(path.join(workspacePath, sourceCasePath), 'fixture-verified');
writeFileSync(
  path.join(workspacePath, practiceSourcePath),
  'practice-source-verified',
);
const sourceChecks = [
  { kind: 'file_contains', path: sourceCasePath, text: 'fixture-verified' },
];
const practiceSourceChecks = [
  {
    kind: 'file_contains',
    path: practiceSourcePath,
    text: 'practice-source-verified',
  },
];
const sourceVerification = verifyWorkspaceChecks(workspacePath, sourceChecks);
const practiceSourceVerification = verifyWorkspaceChecks(
  workspacePath,
  practiceSourceChecks,
);
if (
  sourceVerification.status !== 'verified' ||
  practiceSourceVerification.status !== 'verified'
) {
  throw new Error('Could not independently verify the room-A case fixture.');
}
const seedDatabase = new Database(databasePath);
new RootStore(seedDatabase);
const seedSocialStore = new SocialChatStore(seedDatabase);
seedSocialStore.createSocialWorkTask({
  id: sourceCaseTaskId,
  roomId: 'room-engineering-collaboration',
  agentId: 'engineering-partner',
  workspacePath,
  workspaceKey: path
    .normalize(workspacePath)
    .replaceAll('/', '\\')
    .toLocaleLowerCase('en-US'),
  taskPrompt: 'room A fixture：读取并按约定核对项目文档。',
  model: 'e2e-fixture',
  verificationChecks: sourceChecks,
});
seedSocialStore.finishSocialWorkTask(sourceCaseTaskId, {
  status: 'completed',
  resultText: 'room A fixture：结果记录已经写入并通过文件条件核验。',
  verificationStatus: 'verified',
  verificationResults: sourceVerification.checks,
  verificationAttempts: 0,
});
const basisCase = seedSocialStore.findReusableCase({
  agentId: 'engineering-partner',
  workspaceKey: path
    .normalize(workspacePath)
    .replaceAll('/', '\\')
    .toLocaleLowerCase('en-US'),
  excludeRoomId: 'room-engineering-partner',
});
if (!basisCase || basisCase.taskId !== sourceCaseTaskId) {
  throw new Error('Could not load the verified room-A case fixture.');
}
seedSocialStore.createSocialWorkTask({
  id: practiceSourceTaskId,
  roomId: 'room-engineering-partner',
  agentId: 'engineering-partner',
  workspacePath,
  workspaceKey: path
    .normalize(workspacePath)
    .replaceAll('/', '\\')
    .toLocaleLowerCase('en-US'),
  taskPrompt: 'room B fixture：依据已核验案例完成同项目中的相似文件检查。',
  model: 'e2e-fixture',
  verificationChecks: practiceSourceChecks,
  caseReuseRequested: true,
  caseSnapshot: basisCase,
});
seedSocialStore.finishSocialWorkTask(practiceSourceTaskId, {
  status: 'completed',
  resultText: 'room B fixture：按给定文件标记完成检查并通过 Noema 核验。',
  toolCallCount: 1,
  verificationStatus: 'verified',
  verificationResults: practiceSourceVerification.checks,
  verificationAttempts: 0,
});
if (!seedSocialStore.beginPracticeProposal(practiceSourceTaskId)) {
  throw new Error(
    'Could not put the room-B practice fixture into proposal state.',
  );
}
seedSocialStore.savePracticeCandidate(practiceSourceTaskId, {
  trigger:
    '当前任务要求在同一项目中新增一个指定路径的文件，并给出精确内容条件。',
  action: '先按相对路径写入文件，再通过读取或 Noema 文件核验确认指定标记存在。',
  limits:
    '仅适用于用户明确给出文件路径和内容条件的小型文件任务；不要据此扩大到其他目录或代码修改。',
  basisTaskId: sourceCaseTaskId,
  basisRoomId: basisCase.roomId,
  basisRoomTitle: basisCase.roomTitle,
  basisTaskPrompt: basisCase.taskPrompt,
});
seedDatabase.close();

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
    ...(syntheticAdapter ? { NOEMA_E2E_SOCIAL_WORK_SYNTHETIC: '1' } : {}),
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
  caseSnapshot: result.task?.caseSnapshot ?? null,
  practiceSnapshot: result.task?.practiceSnapshot ?? null,
  practiceCandidateStatus: result.task?.practiceCandidateStatus ?? null,
  expectedSourceCaseTaskId: sourceCaseTaskId,
  workspacePath,
  childExitCode: exit.code,
  executionMode: syntheticAdapter ? 'synthetic-adapter' : 'live-dsh',
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
  result.task?.caseSnapshot !== null ||
  result.task?.practiceSnapshot?.sourceTaskId !== practiceSourceTaskId ||
  result.task?.practiceSnapshot?.basisTaskId !== sourceCaseTaskId ||
  result.task?.practiceSnapshot?.roomId !== 'room-engineering-partner' ||
  result.task?.practiceSnapshot?.basisTaskPrompt?.includes('room A fixture') !==
    true ||
  independentVerification.status !== 'verified' ||
  !result.socialWorkUiSmoke?.desktop?.taskVisible ||
  !result.socialWorkUiSmoke?.desktop?.projectModeSelected ||
  !result.socialWorkUiSmoke?.desktop?.caseControlVisible ||
  !result.socialWorkUiSmoke?.desktop?.experienceReferenceVisible ||
  !result.socialWorkUiSmoke?.desktop?.experienceReferenceText?.includes(
    'room A fixture',
  ) ||
  !result.socialWorkUiSmoke?.desktop?.composerVisible ||
  !result.socialWorkUiSmoke?.desktop?.documentNoOverflow ||
  !result.socialWorkUiSmoke?.narrow?.taskVisible ||
  !result.socialWorkUiSmoke?.narrow?.projectModeSelected ||
  !result.socialWorkUiSmoke?.narrow?.caseControlVisible ||
  !result.socialWorkUiSmoke?.narrow?.experienceReferenceVisible ||
  !result.socialWorkUiSmoke?.narrow?.experienceReferenceText?.includes(
    'room A fixture',
  ) ||
  !result.socialWorkUiSmoke?.narrow?.composerVisible ||
  !result.socialWorkUiSmoke?.narrow?.documentNoOverflow ||
  !result.socialWorkUiSmoke?.candidateReview?.withdrawn ||
  result.socialWorkUiSmoke?.candidateReview?.trialVerification !== 'verified' ||
  exit.code !== 0
) {
  process.exitCode = 1;
}

// Keep failed scratch work for diagnosis. Remove only this script's unique
// temporary directory after a fully verified successful run.
if (process.exitCode !== 1) {
  rmSync(e2eRootDirectory, { recursive: true, force: true });
}
