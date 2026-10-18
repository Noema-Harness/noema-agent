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
const livePractice = process.argv.includes('--live-practice');
const liveEpisodes = process.argv.includes('--live-episodes');
if (
  (livePractice && (syntheticAdapter || liveEpisodes)) ||
  (liveEpisodes && syntheticAdapter)
) {
  throw new Error(
    'Live practice modes require the real FreeLLMAPI and DSH adapters and are mutually exclusive.',
  );
}
const relativePath = 'NOEMA-E2E-RESULT.txt';
const verificationChecks = [
  '## 恢复前',
  '## 执行恢复',
  '## 恢复后验证',
  marker,
].map((text) => ({ kind: 'file_contains', path: relativePath, text }));
const prompt = [
  '[NOEMA E2E] 仅在当前临时工作区完成一项小任务。',
  `创建 ${relativePath}，正文使用简体中文，写一份结构化恢复清单；必须逐字使用二级标题“## 恢复前”“## 执行恢复”“## 恢复后验证”，并逐字包含验收标记 ${marker}。`,
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
const practiceSourcePrompt =
  '[NOEMA E2E] 请在 RELEASE-CHECKLIST.md 用简体中文写一份 1.3.0 发布清单，逐字使用二级标题“## 发布前”“## 执行”“## 回滚”；回滚部分必须逐字包含“恢复上一版本”。只修改这个文件。';
const basisEpisodePrompt =
  '[NOEMA E2E] 请在 IMPORT-GUIDE.md 用简体中文写一份素材导入说明，逐字使用二级标题“## 开始前”“## 导入步骤”“## 失败恢复”；失败恢复部分必须逐字包含“重新校验来源文件”。只修改这个文件。';
const sourceCasePath = 'IMPORT-GUIDE.md';
const practiceSourcePath = 'RELEASE-CHECKLIST.md';
const sourceChecks = ['## 开始前', '## 导入步骤', '重新校验来源文件'].map(
  (text) => ({ kind: 'file_contains', path: sourceCasePath, text }),
);
const practiceSourceChecks = ['## 发布前', '## 执行', '恢复上一版本'].map(
  (text) => ({ kind: 'file_contains', path: practiceSourcePath, text }),
);
if (!liveEpisodes) {
  writeFileSync(
    path.join(workspacePath, sourceCasePath),
    '# 素材导入说明\n\n## 开始前\n确认来源文件可读。\n\n## 导入步骤\n按顺序导入并记录结果。\n\n## 失败恢复\n重新校验来源文件后再试。',
  );
  writeFileSync(
    path.join(workspacePath, practiceSourcePath),
    '# 1.3.0 发布清单\n\n## 发布前\n检查构建产物。\n\n## 执行\n发布并记录版本。\n\n## 回滚\n恢复上一版本并确认服务可用。',
  );
}
const sourceVerification = liveEpisodes
  ? null
  : verifyWorkspaceChecks(workspacePath, sourceChecks);
const practiceSourceVerification = liveEpisodes
  ? null
  : verifyWorkspaceChecks(workspacePath, practiceSourceChecks);
if (
  !liveEpisodes &&
  (sourceVerification?.status !== 'verified' ||
    practiceSourceVerification?.status !== 'verified')
) {
  throw new Error('Could not independently verify the room-A case fixture.');
}
const seedDatabase = new Database(databasePath);
new RootStore(seedDatabase);
const seedSocialStore = new SocialChatStore(seedDatabase);
if (!liveEpisodes) {
  seedSocialStore.createSocialWorkTask({
    id: sourceCaseTaskId,
    roomId: 'room-engineering-collaboration',
    agentId: 'engineering-partner',
    workspacePath,
    workspaceKey: path
      .normalize(workspacePath)
      .replaceAll('/', '\\')
      .toLocaleLowerCase('en-US'),
    taskPrompt:
      '请整理一份素材导入说明，逐字使用三个指定二级标题及失败恢复步骤。',
    model: 'e2e-fixture',
    verificationChecks: sourceChecks,
  });
  seedSocialStore.finishSocialWorkTask(sourceCaseTaskId, {
    status: 'completed',
    resultText: '素材导入说明已按指定标题和恢复步骤完成。',
    verificationStatus: 'verified',
    verificationResults: sourceVerification.checks,
    verificationAttempts: 0,
  });
  for (const category of ['read', 'write', 'read']) {
    seedSocialStore.recordSocialWorkTaskToolAction(sourceCaseTaskId, category);
  }
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
    taskPrompt: practiceSourcePrompt,
    model: 'e2e-fixture',
    verificationChecks: practiceSourceChecks,
    caseReuseRequested: true,
    caseSnapshot: basisCase,
  });
  seedSocialStore.finishSocialWorkTask(practiceSourceTaskId, {
    status: 'completed',
    resultText: '1.3.0 发布清单已按三个标题完成，回滚步骤包含恢复上一版本。',
    toolCallCount: 1,
    verificationStatus: 'verified',
    verificationResults: practiceSourceVerification.checks,
    verificationAttempts: 0,
  });
  for (const category of ['read', 'write', 'read']) {
    seedSocialStore.recordSocialWorkTaskToolAction(
      practiceSourceTaskId,
      category,
    );
  }
  if (!livePractice) {
    if (!seedSocialStore.beginPracticeProposal(practiceSourceTaskId)) {
      throw new Error(
        'Could not put the room-B practice fixture into proposal state.',
      );
    }
    seedSocialStore.savePracticeCandidate(practiceSourceTaskId, {
      trigger:
        '当前任务要求在同一项目中新增一个指定路径的文件，并给出精确内容条件。',
      action:
        '先按相对路径写入文件，再通过读取或 Noema 文件核验确认指定标记存在。',
      limits:
        '仅适用于用户明确给出文件路径和内容条件的小型文件任务；不要据此扩大到其他目录或代码修改。',
      basisTaskId: sourceCaseTaskId,
      basisRoomId: basisCase.roomId,
      basisRoomTitle: basisCase.roomTitle,
      basisTaskPrompt: basisCase.taskPrompt,
    });
  }
}
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
    NOEMA_E2E_SOCIAL_WORK_SOURCE_PROMPT: practiceSourcePrompt,
    NOEMA_E2E_SOCIAL_WORK_LIVE_EPISODES: liveEpisodes ? '1' : '0',
    NOEMA_E2E_SOCIAL_WORK_EPISODE_A_PROMPT: basisEpisodePrompt,
    NOEMA_E2E_SOCIAL_WORK_EPISODE_A_CHECKS: JSON.stringify(sourceChecks),
    NOEMA_E2E_SOCIAL_WORK_EPISODE_B_CHECKS:
      JSON.stringify(practiceSourceChecks),
    NOEMA_E2E_SOCIAL_WORK_WORKSPACE: workspacePath,
    NOEMA_E2E_SOCIAL_WORK_RESULT_PATH: resultPath,
    NOEMA_E2E_SOCIAL_WORK_CHECKS: JSON.stringify(verificationChecks),
    NOEMA_E2E_SOCIAL_WORK_CAPTURE_UI: '1',
    ...(syntheticAdapter ? { NOEMA_E2E_SOCIAL_WORK_SYNTHETIC: '1' } : {}),
    ...(livePractice
      ? {
          NOEMA_E2E_SOCIAL_WORK_PROPOSAL_SOURCE_ID: practiceSourceTaskId,
        }
      : {}),
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
  expectedSourceCaseTaskId:
    result.livePracticeProposal?.basisTaskId ?? sourceCaseTaskId,
  expectedPracticeSourceTaskId:
    result.livePracticeProposal?.sourceTaskId ?? practiceSourceTaskId,
  workspacePath,
  childExitCode: exit.code,
  executionMode: syntheticAdapter ? 'synthetic-adapter' : 'live-dsh',
  proposalMode: liveEpisodes
    ? 'real-dsh-episodes'
    : livePractice
      ? 'real-freellmapi-seeded'
      : 'seeded-fixture',
  livePracticeProposal: result.livePracticeProposal ?? null,
  practiceRouteMetadata: result.practiceRouteMetadata ?? [],
  liveEpisodeTasks: result.liveEpisodeTasks ?? null,
  childSignal: exit.signal,
  scratchDirectory: e2eRootDirectory,
  uiSmoke: result.socialWorkUiSmoke,
  desktopScreenshotPath,
  narrowScreenshotPath,
};
console.log(JSON.stringify(summary, null, 2));

const proposalWasEmpty =
  (livePractice || liveEpisodes) && result.outcome === 'practice_proposal_none';
const liveEpisodeHistory = result.liveEpisodeTasks ?? [];
const liveEpisodeHistoryValid =
  !liveEpisodes ||
  (() => {
    if (liveEpisodeHistory.length < 2 || liveEpisodeHistory.length > 3) {
      return false;
    }
    const [episodeA, ...episodeBAttempts] = liveEpisodeHistory;
    const finalEpisodeB = episodeBAttempts.at(-1);
    const onlyRetryWasSafe = episodeBAttempts
      .slice(0, -1)
      .every(
        (task) =>
          task.status === 'failed' &&
          task.errorCode === 'dsh_rate_limited' &&
          task.toolCallCount === 0 &&
          task.verificationResults.length > 0 &&
          task.verificationResults.every((check) => check.status === 'failed'),
      );
    return (
      episodeA.status === 'completed' &&
      episodeA.verificationStatus === 'verified' &&
      episodeA.toolActionCategories.length > 0 &&
      finalEpisodeB.status === 'completed' &&
      finalEpisodeB.verificationStatus === 'verified' &&
      finalEpisodeB.toolActionCategories.length > 0 &&
      finalEpisodeB.caseSnapshot?.taskId === episodeA.id &&
      onlyRetryWasSafe
    );
  })();
let validationFailed = exit.code !== 0;
if (proposalWasEmpty) {
  validationFailed ||=
    result.livePracticeProposal?.status !== 'none' ||
    result.task != null ||
    !liveEpisodeHistoryValid;
} else {
  const expectedPracticeSourceTaskId =
    result.livePracticeProposal?.sourceTaskId ?? practiceSourceTaskId;
  const expectedBasisTaskId =
    result.livePracticeProposal?.basisTaskId ?? sourceCaseTaskId;
  validationFailed ||=
    result.outcome !== 'finished' ||
    result.task?.status !== 'completed' ||
    result.task?.verificationStatus !== 'verified' ||
    result.task?.caseSnapshot !== null ||
    result.task?.practiceSnapshot?.sourceTaskId !==
      expectedPracticeSourceTaskId ||
    result.task?.practiceSnapshot?.basisTaskId !== expectedBasisTaskId ||
    result.task?.practiceSnapshot?.roomId !== 'room-engineering-partner' ||
    result.task?.practiceSnapshot?.basisTaskPrompt?.includes('素材导入说明') !==
      true ||
    independentVerification.status !== 'verified' ||
    !result.socialWorkUiSmoke?.desktop?.taskVisible ||
    !result.socialWorkUiSmoke?.desktop?.projectModeSelected ||
    !result.socialWorkUiSmoke?.desktop?.caseControlVisible ||
    !result.socialWorkUiSmoke?.desktop?.experienceReferenceVisible ||
    !result.socialWorkUiSmoke?.desktop?.experienceReferenceText?.includes(
      '素材导入说明',
    ) ||
    !result.socialWorkUiSmoke?.desktop?.composerVisible ||
    !result.socialWorkUiSmoke?.desktop?.documentNoOverflow ||
    !result.socialWorkUiSmoke?.narrow?.taskVisible ||
    !result.socialWorkUiSmoke?.narrow?.projectModeSelected ||
    !result.socialWorkUiSmoke?.narrow?.caseControlVisible ||
    !result.socialWorkUiSmoke?.narrow?.experienceReferenceVisible ||
    !result.socialWorkUiSmoke?.narrow?.experienceReferenceText?.includes(
      '素材导入说明',
    ) ||
    !result.socialWorkUiSmoke?.narrow?.composerVisible ||
    !result.socialWorkUiSmoke?.narrow?.documentNoOverflow ||
    !result.socialWorkUiSmoke?.candidateReview?.withdrawn ||
    result.socialWorkUiSmoke?.candidateReview?.trialVerification !== 'verified';
  if (livePractice || liveEpisodes) {
    validationFailed ||=
      result.livePracticeProposal?.status !== 'available' ||
      !result.livePracticeProposal?.candidate;
  }
  if (liveEpisodes) {
    validationFailed ||=
      !liveEpisodeHistoryValid ||
      result.livePracticeProposal?.sourceTaskId !==
        liveEpisodeHistory.at(-1)?.id ||
      result.livePracticeProposal?.basisTaskId !== liveEpisodeHistory[0]?.id;
  }
}
if (validationFailed) {
  process.exitCode = 1;
}

// Keep failed scratch work for diagnosis. Remove only this script's unique
// temporary directory after a fully verified successful run.
if (process.exitCode !== 1) {
  rmSync(e2eRootDirectory, { recursive: true, force: true });
}
