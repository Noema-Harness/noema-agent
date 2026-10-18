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
import { configureElectronRuntime } from './electron-runtime.mjs';

configureElectronRuntime();

if (process.platform !== 'win32') {
  throw new Error('Noema social-agent E2E currently requires Windows.');
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
const e2eDirectory = mkdtempSync(path.join(e2eRoot, 'Noema-social-agents-'));
const databasePath = path.join(e2eDirectory, 'noema.sqlite3');
const dshUserDataPath = path.join(e2eDirectory, 'dsh-home');
const resultPath = path.join(e2eDirectory, 'result.json');
const smokeLogPath = path.join(e2eDirectory, 'smoke-log.json');
const screenshotTag = Date.now();
const desktopScreenshotPath = path.join(
  e2eRoot,
  `Noema-agent-create-desktop-${screenshotTag}.png`,
);
const narrowScreenshotPath = path.join(
  e2eRoot,
  `Noema-agent-create-narrow-${screenshotTag}.png`,
);
mkdirSync(dshUserDataPath, { recursive: true });

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
    NOEMA_E2E_DATABASE_PATH: databasePath,
    NOEMA_E2E_DSH_USER_DATA_PATH: dshUserDataPath,
    NOEMA_E2E_SOCIAL_AGENT_WORKFLOW: '1',
    NOEMA_E2E_SOCIAL_AGENT_RESULT_PATH: resultPath,
    NOEMA_SMOKE_LOG_FILE: smokeLogPath,
    NOEMA_SMOKE_SOCIAL_AGENT_CREATE_PATH: desktopScreenshotPath,
    NOEMA_SMOKE_SOCIAL_AGENT_CREATE_NARROW_PATH: narrowScreenshotPath,
  },
  stdio: 'inherit',
  windowsHide: true,
});

const timeout = setTimeout(() => {
  if (child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
}, 90_000);
const exit = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});
clearTimeout(timeout);

if (!existsSync(resultPath)) {
  const smokeLog = existsSync(smokeLogPath)
    ? readFileSync(smokeLogPath, 'utf8')
    : '(no smoke log)';
  throw new Error(
    `No social-agent E2E result was written in ${e2eDirectory}. ${smokeLog}`,
  );
}
const result = JSON.parse(readFileSync(resultPath, 'utf8'));
const summary = {
  ...result,
  childExitCode: exit.code,
  childSignal: exit.signal,
  scratchDirectory: e2eDirectory,
  desktopScreenshotPath,
  narrowScreenshotPath,
};
console.log(JSON.stringify(summary, null, 2));

if (
  result.outcome !== 'passed' ||
  !result.workflow?.cancelReturnedFocus ||
  !result.workflow?.initialDirectIsEmpty ||
  !result.workflow?.capabilitiesAreEmpty ||
  !result.workflow?.archived ||
  !result.workflow?.archivedInviteExcluded ||
  !result.workflow?.restored ||
  !result.workflow?.sameIdentityJoined ||
  !result.workflow?.groupDidNotImportDm ||
  !existsSync(desktopScreenshotPath) ||
  !existsSync(narrowScreenshotPath) ||
  exit.code !== 0
) {
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  rmSync(e2eDirectory, { recursive: true, force: true });
}
