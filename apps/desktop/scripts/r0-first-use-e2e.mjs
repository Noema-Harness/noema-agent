import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RootStore } from '../src/root-store.mjs';
import { configureElectronRuntime } from './electron-runtime.mjs';

configureElectronRuntime();

if (process.platform !== 'win32') {
  throw new Error('R0 首次使用桌面 E2E 目前仅支持 Windows。');
}
const nodeVersion = /^v(\d+)\.(\d+)\.(\d+)/.exec(process.version);
if (
  !nodeVersion ||
  Number(nodeVersion[1]) !== 24 ||
  Number(nodeVersion[2]) < 21
) {
  throw new Error('请使用 Node.js 24.21.x 运行此检查。');
}

const appData = process.env.APPDATA;
if (!appData) throw new Error('找不到当前 Windows 用户的 AppData 路径。');
const credentialCandidates = ['Noema', 'noema'].map((name) =>
  path.join(appData, name, 'credentials', 'model-provider.key'),
);
credentialCandidates.push(
  ...['Noema', 'noema'].map((name) =>
    path.join(appData, name, 'credentials', 'freellmapi.key'),
  ),
);
const credentialPath = credentialCandidates.find(existsSync);
if (
  !credentialPath &&
  !process.env.NOEMA_MODEL_API_KEY &&
  !process.env.NOEMA_FREELLMAPI_API_KEY
) {
  throw new Error('本机未找到模型服务凭据，未启动真实模型流程。');
}

const runDirectory = mkdtempSync(path.join(tmpdir(), 'Noema-r0-first-use-'));
const useExistingProfile = process.env.NOEMA_E2E_USE_EXISTING_PROFILE === '1';
const appUserDataDirectory = useExistingProfile
  ? path.join(appData, 'Noema')
  : mkdtempSync(path.join(tmpdir(), 'Noema-r0-app-user-data-'));
const liveModel = process.env.NOEMA_E2E_MODEL?.trim() || 'auto:noema-free';
const keepOpen = process.env.NOEMA_E2E_KEEP_OPEN === '1';
const dshUserDataDirectory = path.join(runDirectory, 'dsh-home');
const databasePath = path.join(runDirectory, 'noema.sqlite3');
const resultPath = path.join(runDirectory, 'result.json');
const smokeLogPath = path.join(runDirectory, 'smoke-log.json');
const screenshotPath = path.join(
  tmpdir(),
  `Noema-r0-first-use-${Date.now()}.png`,
);
mkdirSync(dshUserDataDirectory, { recursive: true });
const seedDatabase = new Database(databasePath);
const seedRoot = new RootStore(seedDatabase);
seedRoot.setSelectedModel(liveModel);
seedDatabase.close();

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptDirectory, '..');
const child = spawn(process.execPath, ['scripts/start.mjs'], {
  cwd: appDirectory,
  env: {
    ...process.env,
    PATH: [path.dirname(process.execPath), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter),
    NOEMA_SMOKE_TEST: '1',
    NOEMA_SMOKE_USER_DATA_DIR: appUserDataDirectory,
    NOEMA_E2E_DATABASE_PATH: databasePath,
    NOEMA_E2E_DSH_USER_DATA_PATH: dshUserDataDirectory,
    NOEMA_E2E_SOCIAL_AGENT_WORKFLOW: '1',
    NOEMA_E2E_SOCIAL_AGENT_LIVE: '1',
    NOEMA_E2E_SOCIAL_AGENT_LIVE_MODEL: liveModel,
    NOEMA_E2E_SOCIAL_R0_FIRST_USE: '1',
    NOEMA_E2E_SOCIAL_AGENT_RESULT_PATH: resultPath,
    NOEMA_E2E_KEEP_OPEN: keepOpen ? '1' : '0',
    NOEMA_E2E_USE_EXISTING_PROFILE: process.env.NOEMA_E2E_USE_EXISTING_PROFILE,
    NOEMA_SMOKE_LOG_FILE: smokeLogPath,
  },
  stdio: 'ignore',
  windowsHide: true,
});

let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  if (child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
}, 8 * 60_000);
const exit = await new Promise((resolve, reject) => {
  let poll = null;
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (poll) clearInterval(poll);
    resolve({ code, signal });
  });
  if (keepOpen) {
    poll = setInterval(() => {
      if (!existsSync(resultPath)) return;
      if (poll) clearInterval(poll);
      resolve({ code: 0, signal: null, keptOpen: true });
    }, 250);
  }
});
clearTimeout(timeout);

let result = existsSync(resultPath)
  ? JSON.parse(readFileSync(resultPath, 'utf8'))
  : { outcome: 'missing_result' };
if (existsSync(path.join(runDirectory, 'r0-first-use.png'))) {
  renameSync(path.join(runDirectory, 'r0-first-use.png'), screenshotPath);
  if (result.workflow) result.workflow.screenshotPath = screenshotPath;
}
const summary = {
  ...result,
  childExitCode: exit.code,
  childSignal: exit.signal,
  timedOut,
  screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
  scratchDirectory: runDirectory,
  isolatedAppUserDataDirectory: appUserDataDirectory,
};
try {
  if (
    !keepOpen &&
    summary.outcome === 'passed' &&
    exit.code === 0 &&
    !timedOut
  ) {
    rmSync(runDirectory, { recursive: true, force: true });
    if (!useExistingProfile)
      rmSync(appUserDataDirectory, { recursive: true, force: true });
    delete summary.scratchDirectory;
    delete summary.isolatedAppUserDataDirectory;
  }
} catch {
  // Preserve the result so cleanup problems remain diagnosable.
}
console.log(JSON.stringify(summary, null, 2));
if (summary.outcome !== 'passed' || exit.code !== 0 || timedOut) {
  process.exitCode = 1;
}
