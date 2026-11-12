import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  createDevelopmentDirectory,
  removeDevelopmentDirectory,
} from '../test-support/development-workspace.mjs';
import { RootStore } from '../src/main/storage/root-store.mjs';
import { configureElectronRuntime } from './electron-runtime.mjs';
import { connect } from './electron-cdp.mjs';

configureElectronRuntime();

if (process.platform !== 'win32') {
  throw new Error('The Noema live provider acceptance requires Windows.');
}
const nodeVersion = /^v(\d+)\.(\d+)\.(\d+)/.exec(process.version);
if (
  !nodeVersion ||
  Number(nodeVersion[1]) !== 24 ||
  Number(nodeVersion[2]) < 21
) {
  throw new Error('Run this check with Node.js 24.21.x.');
}

for (const name of [
  'NOEMA_MODEL_API_KEY',
  'NOEMA_MODEL_BASE_URL',
  'NOEMA_FREELLMAPI_API_KEY',
  'NOEMA_FREELLMAPI_BASE_URL',
]) {
  if (process.env[name]) {
    throw new Error(
      'Remove ambient model credential overrides; this check uses the saved Noema credential read-only.',
    );
  }
}

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repositoryRoot = path.resolve(appDirectory, '../..');
const require = createRequire(import.meta.url);

const appDataDirectory = process.env.APPDATA;
if (!appDataDirectory)
  throw new Error('The Windows user profile is unavailable.');
const originalProfile = path.join(appDataDirectory, 'Noema');
const credentialDirectory = path.join(originalProfile, 'credentials');
const originalLocalStatePath = path.join(originalProfile, 'Local State');
if (
  !['model-provider.key', 'freellmapi.key'].some((name) =>
    fs.existsSync(path.join(credentialDirectory, name)),
  )
) {
  throw new Error('No saved Noema model credential is available.');
}

const sourceDatabase = path.join(originalProfile, 'noema.sqlite3');
const selectedModelDatabase = new Database(sourceDatabase, {
  readonly: true,
  fileMustExist: true,
});
let model;
try {
  model = selectedModelDatabase
    .prepare("SELECT value FROM app_settings WHERE key = 'selected_model'")
    .get()?.value;
} finally {
  selectedModelDatabase.close();
}
if (typeof model !== 'string' || !model.trim() || model.length > 200) {
  throw new Error('Select a model in Noema before running this acceptance.');
}

const rendererPortServer = net.createServer();
await new Promise((resolve, reject) => {
  rendererPortServer.once('error', reject);
  rendererPortServer.listen(0, '127.0.0.1', resolve);
});
const rendererPort = rendererPortServer.address().port;
await new Promise((resolve) => rendererPortServer.close(resolve));
const rendererUrl = `http://127.0.0.1:${rendererPort}`;
const runDirectory = createDevelopmentDirectory('Noema-social-provider-live-');
const userDataDirectory = path.join(runDirectory, 'isolated-profile');
const databasePath = path.join(runDirectory, 'data', 'noema.sqlite3');
const dshUserDataPath = path.join(runDirectory, 'dsh-data');
const startupLogPath = path.join(runDirectory, 'electron-startup.json');
const environment = { ...process.env };
for (const name of Object.keys(environment)) {
  if (name.startsWith('NOEMA_E2E_') || name.startsWith('NOEMA_SMOKE_')) {
    delete environment[name];
  }
}
delete environment.ELECTRON_RUN_AS_NODE;
environment.NOEMA_E2E_DATABASE_PATH = databasePath;
environment.NOEMA_E2E_DSH_USER_DATA_PATH = dshUserDataPath;
environment.NOEMA_E2E_RENDERER_URL = rendererUrl;
environment.NOEMA_E2E_SOCIAL_PROVIDER_LIVE = '1';
environment.NOEMA_E2E_READ_ONLY_CREDENTIAL_DIRECTORY = credentialDirectory;
environment.NOEMA_SMOKE_LOG_FILE = startupLogPath;

let child = null;
let childExit = null;
let childOutput = '';
let cdp = null;
let database = null;
let seedStore = null;
let portServer = null;
let debugPort = null;
let interrupted = false;
let completedResult = null;
let failureCode = 'live_acceptance_failed';
let currentStep = 'fixture_setup';
let finalMainStep = 'unavailable';
let providerSummary = 'not_checked';
let childLaunchFailed = false;
let rendererServer = null;

const onInterrupt = () => {
  interrupted = true;
};
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onInterrupt);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readStartupStep() {
  try {
    const record = JSON.parse(fs.readFileSync(startupLogPath, 'utf8'));
    return typeof record?.step === 'string' ? record.step : 'unknown';
  } catch {
    return 'unavailable';
  }
}

function appendChildOutput(chunk) {
  childOutput = `${childOutput}${chunk}`.slice(-32_768);
}

function summarizeChildOutput() {
  const lines = childOutput
    .split(/\r?\n/)
    .filter((line) => /error|fatal|failed|cannot|unable|crash/i.test(line))
    .slice(-5)
    .map((line) =>
      line
        .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/(api[_-]?key["'=: ]+)[^,\s"']+/gi, '$1[redacted]')
        .slice(0, 280),
    );
  return lines.length ? lines.join(' | ') : 'no_filtered_output';
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error('interrupted');
    if (childLaunchFailed) throw new Error('client_launch_failed');
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error('client_exited');
    }
    const result = await predicate();
    if (result) return result;
    await delay(100);
  }
  throw new Error(description);
}

async function stopChildTree() {
  await stopProcessTree(child);
}

async function stopProcessTree(processHandle) {
  if (!processHandle || processHandle.exitCode !== null || !processHandle.pid)
    return;
  await new Promise((resolve) => {
    const killer = spawn(
      'taskkill',
      ['/pid', String(processHandle.pid), '/t', '/f'],
      { stdio: 'ignore', windowsHide: true },
    );
    killer.once('error', resolve);
    killer.once('exit', resolve);
  });
  const exited = await Promise.race([
    new Promise((resolve) => processHandle.once('exit', () => resolve(true))),
    delay(5_000).then(() => false),
  ]);
  if (!exited && processHandle.exitCode === null) processHandle.kill();
  if (!exited && processHandle.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => processHandle.once('exit', () => resolve(true))),
      delay(2_000),
    ]);
  }
  if (processHandle.exitCode === null) throw new Error('client_cleanup_failed');
}

try {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(userDataDirectory, { recursive: true });
  fs.mkdirSync(dshUserDataPath, { recursive: true });
  if (!fs.existsSync(originalLocalStatePath)) {
    throw new Error('noema_encryption_profile_missing');
  }
  // Electron safeStorage on Windows needs the matching Chromium Local State
  // metadata to decrypt the saved credential. Keep the copy inside the
  // disposable profile, while reading the encrypted credential in place.
  fs.copyFileSync(
    originalLocalStatePath,
    path.join(userDataDirectory, 'Local State'),
    fs.constants.COPYFILE_EXCL,
  );
  seedStore = new RootStore(databasePath);
  seedStore.setSelectedModel(model);
  seedStore.db.close();
  seedStore = null;

  currentStep = 'renderer_startup';
  portServer = net.createServer();
  await new Promise((resolve, reject) => {
    portServer.once('error', reject);
    portServer.listen(0, '127.0.0.1', resolve);
  });
  debugPort = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  portServer = null;

  rendererServer = spawn(
    process.execPath,
    [
      path.join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--config',
      'vite.renderer.config.mts',
      '--host',
      '127.0.0.1',
      '--port',
      String(rendererPort),
      '--strictPort',
    ],
    {
      cwd: appDirectory,
      env: {
        ...process.env,
        NOEMA_SMOKE_TEST: '1',
        NOEMA_SMOKE_USER_DATA_DIR: userDataDirectory,
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  rendererServer.once('error', () => {
    childLaunchFailed = true;
  });
  await waitFor(
    async () => {
      try {
        const response = await fetch(rendererUrl, {
          signal: AbortSignal.timeout(1_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    60_000,
    'renderer_server_unavailable',
  );

  currentStep = 'client_startup';
  child = spawn(
    require('electron'),
    [
      '.',
      `--noema-e2e-user-data-dir=${userDataDirectory}`,
      `--noema-e2e-port=${debugPort}`,
    ],
    {
      cwd: appDirectory,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  child.stdout.on('data', appendChildOutput);
  child.stderr.on('data', appendChildOutput);
  child.once('exit', (code, signal) => {
    childExit = { code, signal };
  });
  child.once('error', () => {
    childLaunchFailed = true;
  });
  database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  const debugTarget = await waitFor(
    async () => {
      try {
        const response = await fetch(
          `http://127.0.0.1:${debugPort}/json/list`,
          {
            signal: AbortSignal.timeout(1_000),
          },
        );
        const targets = await response.json();
        return targets.find(
          (target) => target.type === 'page' && target.webSocketDebuggerUrl,
        );
      } catch {
        return null;
      }
    },
    60_000,
    'client_debugger_unavailable',
  );
  cdp = await connect(debugTarget.webSocketDebuggerUrl);
  await cdp.call('Runtime.enable');

  currentStep = 'renderer_bridge_ready';
  const bridgeState = await waitFor(
    async () => {
      const result = await cdp.call('Runtime.evaluate', {
        expression:
          "({bridge:typeof window.noema,refresh:typeof window.noema?.refreshModels,composer:Boolean(document.querySelector('#social-message-input'))})",
        returnByValue: true,
      });
      const value = result.result?.value;
      return value?.refresh === 'function' ? value : null;
    },
    60_000,
    'preload_bridge_unavailable',
  );

  currentStep = 'provider_connection';
  providerSummary = bridgeState
    ? `bridge=${bridgeState.bridge};refresh=${bridgeState.refresh};composer=${bridgeState.composer}`
    : 'bridge_probe_unavailable';
  const providerResult = await cdp.call('Runtime.evaluate', {
    expression:
      "window.noema.refreshModels().then(s=>({connected:Boolean(s.connected),providerConfigured:Boolean(s.providerConfigured),selectedModel:s.selectedModel??null,modelNames:Array.isArray(s.models)?s.models.map(m=>m.name):[],errorCode:typeof s.error==='string'?(s.error.toLowerCase().includes('decrypt')?'credential_decrypt_failed':/401|unauthori[sz]ed/.test(s.error.toLowerCase())?'provider_auth_failed':/network|fetch|timeout|connection/.test(s.error.toLowerCase())?'provider_transport_failed':'provider_unavailable'):null}))",
    awaitPromise: true,
    returnByValue: true,
  });
  const providerState = providerResult.result?.value;
  if (providerState) {
    providerSummary = `connected=${providerState.connected};configured=${providerState.providerConfigured};models=${providerState.modelNames?.length ?? 0};selected=${providerState.selectedModel === model};error=${providerState.errorCode ?? 'none'}`;
  } else {
    const exceptionText =
      providerResult.exceptionDetails?.text?.toLowerCase() ?? '';
    providerSummary = exceptionText.includes('window.noema')
      ? 'bridge_unavailable'
      : exceptionText.includes('refreshmodels')
        ? 'refresh_method_unavailable'
        : providerResult.exceptionDetails?.exception?.className
          ? `runtime_exception_${providerResult.exceptionDetails.exception.className.toLowerCase()}`
          : 'state_unavailable';
  }
  if (!providerState?.connected) {
    throw new Error(providerState?.errorCode ?? 'provider_unavailable');
  }
  assert.ok(providerState.modelNames.includes(model));

  currentStep = 'social_composer_ready';
  const inputReady = await waitFor(
    () =>
      cdp
        .call('Runtime.evaluate', {
          expression:
            "Boolean(document.querySelector('#social-message-input')&&!document.querySelector('#social-message-input').disabled)",
          returnByValue: true,
        })
        .then((result) => result.result?.value === true),
    60_000,
    'social_composer_unavailable',
  );
  assert.equal(inputReady, true);

  const marker = `NOEMA-LIVE-CHECK-${randomUUID()}`;
  const prompt = `请只回复“已连接”。本次验收标记：${marker}`;
  currentStep = 'submit_prompt';
  await cdp.call('Runtime.evaluate', {
    expression: `(()=>{const input=document.querySelector('#social-message-input');if(!input)throw Error('composer_missing');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(prompt)});input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#social-message-input').closest('form').requestSubmit();})()`,
    returnByValue: true,
  });

  currentStep = 'persist_user_message';
  const userTurn = await waitFor(
    () =>
      database
        .prepare(
          "SELECT id, turn_id AS turnId FROM social_messages WHERE room_id='room-noema' AND role='user' AND content=? ORDER BY seq DESC LIMIT 1",
        )
        .get(prompt),
    15_000,
    'user_message_not_saved',
  );
  currentStep = 'provider_reply';
  const assistantReply = await waitFor(
    () => {
      const reply = database
        .prepare(
          "SELECT status, content FROM social_messages WHERE turn_id=? AND role='assistant' ORDER BY seq DESC LIMIT 1",
        )
        .get(userTurn.turnId);
      if (reply && ['failed', 'interrupted'].includes(reply.status)) {
        failureCode = 'provider_request_failed';
        throw new Error(failureCode);
      }
      return reply?.status === 'complete' && reply.content.trim()
        ? reply
        : null;
    },
    210_000,
    'provider_reply_timeout',
  );

  currentStep = 'request_usage_diagnostics';
  const providerEvents = database
    .prepare(
      "SELECT request_id AS requestId, operation, status, error_code AS errorCode FROM diagnostic_events WHERE turn_id=? AND module='provider' AND operation LIKE 'request.%' ORDER BY occurred_at, event_id",
    )
    .all(userTurn.turnId);
  const requestIds = [
    ...new Set(providerEvents.map((event) => event.requestId)),
  ];
  assert.equal(requestIds.length, 1, 'a plain prompt must use one request');
  const requestId = requestIds[0];
  assert.ok(
    providerEvents.some(
      (event) =>
        event.requestId === requestId && event.operation === 'request.started',
    ),
    'request start must be recorded',
  );
  assert.ok(
    providerEvents.some(
      (event) =>
        event.requestId === requestId &&
        event.operation === 'request.completed' &&
        event.status === 'completed',
    ),
    'request completion must be recorded',
  );
  const usage = database
    .prepare(
      'SELECT request_status AS requestStatus, usage_received AS usageReceived, input_tokens AS inputTokens, output_tokens AS outputTokens, cached_input_tokens AS cachedInputTokens, cache_miss_tokens AS cacheMissTokens FROM model_usage_records WHERE request_id=?',
    )
    .get(requestId);
  assert.ok(usage, 'provider usage row must share the request ID');
  assert.equal(usage.requestStatus, 'completed');
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM diagnostic_events WHERE turn_id=? AND module='social.chat' AND operation LIKE 'tool.%'",
      )
      .get(userTurn.turnId).count,
    0,
    'the plain chat acceptance must not execute tools',
  );
  const persistedDiagnostics = JSON.stringify({ providerEvents, usage });
  assert.ok(!persistedDiagnostics.includes(marker));
  assert.ok(assistantReply.content.trim());
  completedResult = {
    outcome: 'passed',
    model,
    requestCount: 1,
    requestStatus: 'completed',
    usageReceived: Boolean(usage.usageReceived),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheMissTokens: usage.cacheMissTokens,
    responseCharacters: assistantReply.content.length,
  };
} catch (error) {
  const messageCode =
    typeof error?.message === 'string' &&
    /^[a-z][a-z0-9_]{0,79}$/.test(error.message)
      ? error.message
      : null;
  failureCode =
    messageCode ??
    (error?.message === 'Debugger timeout: Runtime.evaluate'
      ? 'debugger_runtime_evaluate_timeout'
      : error?.message?.startsWith('Debugger timeout:')
        ? 'debugger_command_timeout'
        : error?.code === 'ERR_ASSERTION'
          ? 'assertion_failed'
          : error?.name === 'SqliteError'
            ? 'sqlite_error'
            : error?.name === 'TypeError'
              ? 'type_error'
              : 'unexpected_error');
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onInterrupt);
  let cleanupFailed = false;
  if (portServer?.listening) {
    await new Promise((resolve) => portServer.close(resolve)).catch(() => {
      cleanupFailed = true;
    });
  }
  try {
    seedStore?.db.close();
  } catch {
    cleanupFailed = true;
  }
  try {
    await cdp?.call('Browser.close');
  } catch {
    /* the client may already have exited */
  }
  cdp?.close();
  try {
    database?.close();
  } catch {
    cleanupFailed = true;
  }
  try {
    await stopChildTree();
  } catch {
    cleanupFailed = true;
  }
  try {
    await stopProcessTree(rendererServer);
  } catch {
    cleanupFailed = true;
  }
  finalMainStep = readStartupStep();
  try {
    removeDevelopmentDirectory(runDirectory);
  } catch {
    cleanupFailed = true;
  }
  if (cleanupFailed) {
    completedResult = null;
    failureCode = 'cleanup_failed';
    process.exitCode = 1;
  }
}

if (completedResult) {
  console.log(JSON.stringify(completedResult));
} else {
  console.error(
    `Noema live provider acceptance failed at ${currentStep}: ${failureCode}; provider=${providerSummary}; main=${finalMainStep}; electronExit=${childExit ? `${childExit.code ?? 'null'}/${childExit.signal ?? 'none'}` : 'unknown'}; log=${summarizeChildOutput()}`,
  );
}
