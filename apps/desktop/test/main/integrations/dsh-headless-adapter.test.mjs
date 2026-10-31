import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DshHeadlessAdapter,
  DshHeadlessError,
  makeNoemaDshWorkerPatch,
  normalizeDshReportedUsage,
  parseDshHeadlessEvent,
  parseDshRateLimitRetryAfterSeconds,
  resolveDshHeadlessRuntime,
} from '../../../src/main/integrations/dsh-headless-adapter.mjs';

const routerModel = 'auto:noema-free';

test('normalizes DSH cache buckets without guessing missing hit data', () => {
  assert.deepEqual(
    normalizeDshReportedUsage({
      inputTokens: 20,
      outputTokens: 7,
      totalTokens: 40,
      cacheReadTokens: 10,
      cacheWriteTokens: 3,
      reasoningTokens: 2,
    }),
    {
      usageReceived: true,
      inputTokens: 33,
      outputTokens: 7,
      cachedInputTokens: 10,
      cacheMissTokens: 23,
      cacheWriteTokens: 3,
      reasoningTokens: 2,
    },
  );
  assert.deepEqual(
    normalizeDshReportedUsage({
      inputTokens: 20,
      outputTokens: 7,
      totalTokens: 27,
    }),
    {
      usageReceived: true,
      inputTokens: 20,
      outputTokens: 7,
      cachedInputTokens: null,
      cacheMissTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
    },
  );
  assert.equal(
    normalizeDshReportedUsage({
      inputTokens: 20,
      outputTokens: 7,
      totalTokens: 40,
      cacheReadTokens: 11,
      cacheWriteTokens: 3,
    }).usageReceived,
    false,
  );
});

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;

  kill() {
    this.killed = true;
    this.emit('close', null, 'SIGTERM');
    return true;
  }
}

test('worker patch uses the selected model through a generic compatible provider', () => {
  const model = routerModel;
  const patch = makeNoemaDshWorkerPatch(model, 'http://127.0.0.1:31415/v1');
  assert.match(patch, /provider: noema-model/);
  assert.match(patch, /model: "auto:noema-free"/);
  assert.match(patch, /- id: llm-pi-ai[\s\S]*api: openai-completions/);
  assert.match(patch, /baseURL: "http:\/\/127\.0\.0\.1:31415\/v1"/);
  assert.match(patch, /defaultMaxTokens: 8192/);
  assert.doesNotMatch(patch, /provider: deepseek-official/);
  const selectedModelPatch = makeNoemaDshWorkerPatch(
    'deepseek-flash',
    'http://127.0.0.1:31415/v1',
  );
  assert.match(selectedModelPatch, /provider: noema-model/);
  assert.match(selectedModelPatch, /model: "deepseek-flash"/);
  assert.match(selectedModelPatch, /id: "deepseek-flash"/);
  assert.match(patch, /- id: tool-pwsh\n  disabled: false/);
  assert.match(patch, /- id: tool-jobs\n  disabled: true/);
  assert.match(patch, /- id: tool-web\n  disabled: true/);
  assert.match(patch, /- id: tool-subagent\n  disabled: true/);
  assert.throws(
    () => makeNoemaDshWorkerPatch('', 'http://127.0.0.1:31415/v1'),
    TypeError,
  );
  assert.match(
    makeNoemaDshWorkerPatch('free-router', 'http://127.0.0.1:31415/v1'),
    /model: "free-router"/,
  );
  assert.throws(
    () => makeNoemaDshWorkerPatch(model, 'not a URL'),
    (error) => error.code === 'model_provider_base_url_invalid',
  );
});

test('headless event parser rejects invalid protocol data', () => {
  assert.deepEqual(
    parseDshHeadlessEvent('{"type":"session","sessionId":"session-test"}'),
    { type: 'session', sessionId: 'session-test' },
  );
  assert.throws(() => parseDshHeadlessEvent('not-json'), DshHeadlessError);
  assert.throws(
    () => parseDshHeadlessEvent('{"message":"missing type"}'),
    DshHeadlessError,
  );
});

test('only retries explicit DSH rate limits with short cooldowns', () => {
  assert.equal(
    parseDshRateLimitRetryAfterSeconds(
      'RATE_LIMIT: all routes exhausted. Soonest reset ~31s.',
    ),
    31,
  );
  assert.equal(
    parseDshRateLimitRetryAfterSeconds(
      'RATE_LIMIT: all routes exhausted. Soonest reset ~120s.',
    ),
    120,
  );
  assert.equal(
    parseDshRateLimitRetryAfterSeconds(
      'RATE_LIMIT: all routes exhausted. Soonest reset ~121s.',
    ),
    null,
  );
  assert.equal(
    parseDshRateLimitRetryAfterSeconds('dsh process exited unexpectedly'),
    null,
  );
});

test('discovers DSH without launching its profile as a preflight side effect', async () => {
  const calls = [];
  const execFileImpl = async (executable, args) => {
    calls.push({ executable, args });
    if (executable === 'where.exe' && args[0] === 'dsh.cmd') {
      return { stdout: 'C:\\fake-npm\\dsh.cmd\r\n' };
    }
    if (executable === 'where.exe' && args[0] === 'node.exe') {
      throw Object.assign(new Error('node not on PATH'), { code: 'ENOENT' });
    }
    if (args[0] === '--version') return { stdout: 'v24.21.0' };
    assert.fail(`Unexpected probe: ${executable} ${args.join(' ')}`);
  };

  const runtime = await resolveDshHeadlessRuntime({
    env: {},
    execFileImpl,
    readFileImpl: async () => '{"version":"0.1.0"}',
  });
  assert.deepEqual(runtime, {
    nodeExecutable: 'D:\\NoemaTools\\node-v24.21.0-win-x64\\node.exe',
    dshBin: 'C:\\fake-npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
    npmPrefix: 'C:\\fake-npm',
    version: '0.1.0',
  });
  assert.equal(
    calls.some((call) => call.args.includes('--profile')),
    false,
  );
});

test('worker process streams safe status events and reports the final result', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-adapter-'));
  const workspace = path.join(directory, 'workspace');
  const userData = path.join(directory, 'user-data');
  const child = new FakeChild();
  let launch;
  const observed = [];
  const usageRecords = [];
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: userData,
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      onUsage: (record) => usageRecords.push(record),
      env: { PATH: 'C:\\node' },
      spawnImpl: (executable, args, options) => {
        launch = { executable, args, options };
        return child;
      },
    });
    const handle = await adapter.startTask({
      taskId: 'task-test',
      workspacePath: workspace,
      task: 'Create one file in the workspace.',
      model: routerModel,
      onEvent: (event) => observed.push(event),
    });
    assert.equal(launch.options.cwd, workspace);
    assert.equal(launch.options.env.DSH_HOME, path.join(userData, 'dsh-home'));
    assert.equal(launch.options.env.NOEMA_MODEL_API_KEY, 'test-free-key');
    assert.equal(launch.options.env.DEEPSEEK_API_KEY, undefined);
    assert.equal(launch.options.env.OPENAI_API_KEY, undefined);
    assert.equal(
      launch.args.some((argument) => argument.includes('test-free-key')),
      false,
    );
    assert.equal(launch.args.includes('--json'), true);
    const patchArg = launch.args[launch.args.indexOf('--patch') + 1];
    const patch = readFileSync(patchArg, 'utf8');
    assert.match(patch, /- id: llm-pi-ai[\s\S]*defaultMaxTokens: 8192/);
    assert.match(patch, /apiKeyEnv: NOEMA_MODEL_API_KEY/);
    assert.match(patch, /baseURL: "http:\/\/127\.0\.0\.1:31415\/v1"/);
    assert.match(patch, /tool-pwsh/);

    child.stdout.write(
      '{"type":"session","sessionId":"session-test"}\n' +
        '{"type":"status","phase":"turn_start"}\n' +
        '{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":20,"outputTokens":7,"totalTokens":40,"cacheReadTokens":10,"cacheWriteTokens":3,"reasoningTokens":2}}\n' +
        '{"type":"tool_call","callId":"call-write","tool":"write","input":{"path":"secret path omitted"}}\n' +
        '{"type":"tool_result","callId":"call-write","status":"completed","result":"omitted"}\n' +
        '{"type":"tool_call","tool":"tool-pwsh","input":{"command":"hidden command"}}\n' +
        '{"type":"tool_result","status":"completed","result":"omitted"}\n' +
        '{"type":"final","text":"Created file."}\n',
    );
    assert.deepEqual(await handle.started, { sessionId: 'session-test' });
    child.emit('close', 0, null);
    const result = await handle.done;
    assert.equal(result.status, 'completed');
    assert.equal(result.sessionId, 'session-test');
    assert.equal(result.result, 'Created file.');
    assert.equal(result.toolCallCount, 2);
    assert.deepEqual(
      observed.map((event) => event.type),
      [
        'session',
        'status',
        'status',
        'tool-call',
        'tool-result',
        'tool-call',
        'tool-result',
        'final',
      ],
    );
    assert.equal(observed[3].category, 'write');
    assert.equal(observed[3].hasSideEffect, true);
    assert.equal(observed[3].stepId, observed[4].stepId);
    assert.equal(observed[4].effectStatus, 'applied');
    assert.equal(observed[5].category, 'command');
    assert.equal(observed[5].hasSideEffect, true);
    assert.equal(observed[5].stepId, observed[6].stepId);
    assert.equal(observed[6].effectStatus, 'unknown');
    assert.deepEqual(usageRecords, [
      {
        providerHost: '127.0.0.1',
        model: routerModel,
        operation: 'dsh_worker_step',
        requestStatus: 'completed',
        usageReceived: true,
        inputTokens: 33,
        outputTokens: 7,
        cachedInputTokens: 10,
        cacheMissTokens: 23,
        cacheWriteTokens: 3,
        reasoningTokens: 2,
        requestCharacters: null,
        messageCount: 0,
        toolCount: 0,
      },
    ]);
    assert.equal(
      JSON.stringify(observed).includes('secret path omitted'),
      false,
    );
    assert.equal(JSON.stringify(observed).includes('hidden command'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a worker deadline stops the DSH process and reports a bounded timeout', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-timeout-'));
  const child = new FakeChild();
  const usageRecords = [];
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: path.join(directory, 'user-data'),
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      onUsage: (record) => usageRecords.push(record),
      spawnImpl: () => child,
    });
    const handle = await adapter.startTask({
      taskId: 'task-timeout',
      workspacePath: path.join(directory, 'workspace'),
      task: 'Complete a bounded task.',
      model: routerModel,
      timeoutMs: 10,
    });
    child.stdout.write(
      '{"type":"session","sessionId":"session-timeout"}\n' +
        '{"type":"status","phase":"step_start","turn":1,"step":1}\n',
    );
    await handle.started;
    child.stdout.write(
      '{"type":"tool_call","callId":"write-timeout","tool":"write","input":{"path":"README.md"}}\n',
    );

    const result = await handle.done;
    assert.equal(child.killed, true);
    assert.equal(result.status, 'interrupted');
    assert.equal(result.errorCode, 'dsh_task_timeout');
    assert.match(result.errorMessage, /超过允许的运行时间/u);
    assert.equal(result.workspaceMutationStatus, 'unknown');
    assert.equal(usageRecords.length, 1);
    assert.equal(usageRecords[0].requestStatus, 'interrupted');
    assert.equal(usageRecords[0].usageReceived, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stopping a running DSH worker terminates it and returns an interruption', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-stop-'));
  const child = new FakeChild();
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: path.join(directory, 'user-data'),
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      spawnImpl: () => child,
    });
    const handle = await adapter.startTask({
      taskId: 'task-stop',
      workspacePath: path.join(directory, 'workspace'),
      task: 'Wait for a stop request.',
      model: routerModel,
      timeoutMs: 10_000,
    });
    child.stdout.write('{"type":"session","sessionId":"session-stop"}\n');
    await handle.started;

    assert.equal(handle.stop(), true);
    const result = await handle.done;
    assert.equal(child.killed, true);
    assert.equal(result.status, 'interrupted');
    assert.equal(result.errorCode, null);
    assert.equal(result.workspaceMutationStatus, 'none');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('provider 4xx failures are classified as non-retryable request rejections', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-rejected-'));
  const workspace = path.join(directory, 'workspace');
  const userData = path.join(directory, 'user-data');
  const child = new FakeChild();
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: userData,
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      spawnImpl: () => child,
    });
    const handle = await adapter.startTask({
      taskId: 'task-rejected',
      workspacePath: workspace,
      task: 'Create a file.',
      model: routerModel,
      onEvent: () => {},
    });
    child.stdout.write('{"type":"session","sessionId":"session-rejected"}\n');
    await handle.started;
    child.stderr.write('INVALID_REQUEST: 400: provider rejected model route');
    child.emit('close', 1, null);

    const result = await handle.done;
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'dsh_provider_rejected');
    assert.match(result.errorMessage, /HTTP 400/);
    assert.doesNotMatch(result.errorMessage, /provider rejected model route/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('redacts the model provider key from DSH diagnostics', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-redaction-'));
  const child = new FakeChild();
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: directory,
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      spawnImpl: () => child,
    });
    const handle = await adapter.startTask({
      taskId: 'task-redaction',
      workspacePath: path.join(directory, 'workspace'),
      task: 'Inspect README.',
      model: routerModel,
    });
    child.stdout.write('{"type":"session","sessionId":"session-redaction"}\n');
    await handle.started;
    child.stderr.write('authorization failed for test-free-key');
    child.emit('close', 1, null);
    const result = await handle.done;
    assert.doesNotMatch(result.errorMessage, /test-free-key/);
    assert.doesNotMatch(result.stderrTail, /test-free-key/);
    assert.match(result.stderrTail, /已隐藏凭据/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('classifies only bounded explicit DSH cooldown hints as retryable', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-rate-limit-'));
  const child = new FakeChild();
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: directory,
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      spawnImpl: () => child,
    });
    const handle = await adapter.startTask({
      taskId: 'task-rate-limit',
      workspacePath: path.join(directory, 'workspace'),
      task: 'Finish the missing files.',
      model: routerModel,
    });
    child.stdout.write('{"type":"session","sessionId":"session-rate-limit"}\n');
    await handle.started;
    child.stderr.write(
      'dsh: RATE_LIMIT: All models exhausted. Soonest reset ~31s.\n',
    );
    child.emit('close', 1, null);
    const result = await handle.done;
    assert.equal(result.errorCode, 'dsh_rate_limited');
    assert.equal(result.retryAfterSeconds, 31);
    assert.equal(result.sessionId, 'session-rate-limit');
    assert.doesNotMatch(result.errorMessage, /test-free-key/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('does not retry a DSH rate limit whose cooldown exceeds the safe wait window', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-dsh-long-cooldown-'),
  );
  const child = new FakeChild();
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: directory,
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      spawnImpl: () => child,
    });
    const handle = await adapter.startTask({
      taskId: 'task-long-cooldown',
      workspacePath: path.join(directory, 'workspace'),
      task: 'Finish the missing files.',
      model: routerModel,
    });
    child.stdout.write(
      '{"type":"session","sessionId":"session-long-cooldown"}\n',
    );
    await handle.started;
    child.stderr.write(
      'RATE_LIMIT: all routes exhausted. Soonest reset ~121s.\n',
    );
    child.emit('close', 1, null);
    const result = await handle.done;
    assert.equal(result.errorCode, 'dsh_rate_limited');
    assert.equal(result.retryAfterSeconds, null);
    assert.match(result.errorMessage, /没有可安全采用的短时冷却窗口/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('refuses to start a worker without a model provider key', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-no-key-'));
  let spawned = false;
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: directory,
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => null,
      spawnImpl: () => {
        spawned = true;
        return new FakeChild();
      },
    });
    await assert.rejects(
      adapter.startTask({
        workspacePath: path.join(directory, 'workspace'),
        task: 'Run a small task.',
        model: 'free-router',
      }),
      (error) => error.code === 'model_provider_credentials_missing',
    );
    assert.equal(spawned, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('repeated identical tool calls stop a looping DSH run', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-loop-'));
  const child = new FakeChild();
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: directory,
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      spawnImpl: () => child,
    });
    const handle = await adapter.startTask({
      taskId: 'task-loop',
      workspacePath: path.join(directory, 'workspace'),
      task: 'Inspect one file.',
      model: routerModel,
    });
    child.stdout.write('{"type":"session","sessionId":"session-loop"}\n');
    await handle.started;
    const call = JSON.stringify({
      type: 'tool_call',
      tool: 'read',
      input: { path: 'README.md' },
    });
    child.stdout.write(`${call}\n${call}\n${call}\n`);
    const result = await handle.done;
    assert.equal(child.killed, true);
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'dsh_tool_loop');
    assert.equal(result.workspaceMutationStatus, 'none');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('identifies a repeated file edit loop rejected before workspace mutation', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-dsh-invalid-args-loop-'),
  );
  const child = new FakeChild();
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: directory,
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      spawnImpl: () => child,
    });
    const handle = await adapter.startTask({
      taskId: 'task-invalid-args-loop',
      workspacePath: path.join(directory, 'workspace'),
      task: 'Create README.md.',
      model: routerModel,
    });
    child.stdout.write(
      '{"type":"session","sessionId":"session-invalid-args-loop"}\n',
    );
    await handle.started;
    const call = (callId) =>
      JSON.stringify({
        type: 'tool_call',
        callId,
        tool: 'edit',
        input: {
          file_path: 'README.md',
          old_string: 'start',
          new_string: 'finish',
          replace_all: 'true',
        },
      });
    const rejected = (callId) =>
      JSON.stringify({
        type: 'tool_result',
        callId,
        status: 'error',
        result: 'Error: invalid arguments: "replace_all" must be a boolean',
      });
    child.stdout.write(
      `${call('edit-1')}\n${rejected('edit-1')}\n` +
        `${call('edit-2')}\n${rejected('edit-2')}\n` +
        `${call('edit-3')}\n`,
    );

    const result = await handle.done;
    assert.equal(result.errorCode, 'dsh_tool_loop');
    assert.equal(result.workspaceMutationStatus, 'invalid_args_only');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
