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
  makeLocalWorkerEnvironment,
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
  const patch = makeNoemaDshWorkerPatch(model, 'http://127.0.0.1:31415/v1', {
    platform: 'win32',
  });
  assert.match(patch, /provider: noema-model/);
  assert.match(patch, /model: "auto:noema-free"/);
  assert.match(patch, /- id: llm-pi-ai[\s\S]*api: openai-completions/);
  assert.match(patch, /baseURL: "http:\/\/127\.0\.0\.1:31415\/v1"/);
  assert.match(patch, /defaultMaxTokens: 32768/);
  assert.doesNotMatch(patch, /provider: deepseek-official/);
  const selectedModelPatch = makeNoemaDshWorkerPatch(
    'deepseek-flash',
    'http://127.0.0.1:31415/v1',
  );
  assert.match(selectedModelPatch, /provider: noema-model/);
  assert.match(selectedModelPatch, /model: "deepseek-flash"/);
  assert.match(selectedModelPatch, /id: "deepseek-flash"/);
  assert.match(patch, /- id: tool-pwsh\n  disabled: false/);
  assert.doesNotMatch(patch, /- id: tool-jobs\n  disabled: true/);
  assert.doesNotMatch(patch, /- id: tool-subagent\n  disabled: true/);
  assert.match(patch, /- id: tool-web\n  disabled: true/);
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

test('worker patch disables direct file tools for product chat profiles', () => {
  const patch = makeNoemaDshWorkerPatch(
    routerModel,
    'http://127.0.0.1:31415/v1',
    { profile: 'noema', platform: 'win32' },
  );
  assert.match(patch, /- id: tool-pwsh\n  disabled: false/);
  assert.match(patch, /- id: tool-fs\n  disabled: true/);
  assert.doesNotMatch(patch, /tool-str-replace-editor/);
});

test('worker patch enables only the host platform shell', () => {
  const mac = makeNoemaDshWorkerPatch(
    routerModel,
    'http://127.0.0.1:31415/v1',
    {
      platform: 'darwin',
    },
  );
  assert.match(mac, /- id: tool-bash\n  disabled: false/);
  assert.doesNotMatch(mac, /tool-pwsh/);
  const windows = makeNoemaDshWorkerPatch(
    routerModel,
    'http://127.0.0.1:31415/v1',
    { platform: 'win32' },
  );
  assert.match(windows, /- id: tool-pwsh\n  disabled: false/);
  assert.doesNotMatch(windows, /tool-bash/);
});

test('worker environment keeps only the host platform allowlist', () => {
  const parent = {
    HOME: '/Users/someone',
    TMPDIR: '/var/folders/x/T/',
    PATH: '/opt/homebrew/bin:/usr/bin:/bin',
    LANG: 'zh_CN.UTF-8',
    SHELL: '/bin/zsh',
    USERPROFILE: 'C:\\Users\\someone',
    AWS_SECRET_ACCESS_KEY: 'leak',
    OPENAI_API_KEY: 'leak',
  };
  const mac = makeLocalWorkerEnvironment({
    parent,
    userDataPath: '/tmp/noema',
    apiKey: 'model-key',
    platform: 'darwin',
  });
  assert.equal(mac.HOME, '/Users/someone');
  assert.equal(mac.TMPDIR, '/var/folders/x/T/');
  assert.equal(mac.PATH, '/opt/homebrew/bin:/usr/bin:/bin');
  assert.equal(mac.SHELL, '/bin/zsh');
  assert.equal(mac.USERPROFILE, undefined);
  assert.equal(mac.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(mac.OPENAI_API_KEY, undefined);
  assert.equal(mac.NOEMA_MODEL_API_KEY, 'model-key');
  const windows = makeLocalWorkerEnvironment({
    parent,
    userDataPath: 'C:\\noema',
    apiKey: 'model-key',
    platform: 'win32',
  });
  assert.equal(windows.USERPROFILE, 'C:\\Users\\someone');
  assert.equal(windows.HOME, undefined);
  assert.equal(windows.AWS_SECRET_ACCESS_KEY, undefined);
});

test('product chat profiles are forced into read-only permission mode', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-readonly-'));
  const child = new FakeChild();
  let launch;
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: path.join(directory, 'user-data'),
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      getPermissionMode: () => 'workspace-write',
      profile: 'noema',
      env: { PATH: 'C:\\node' },
      spawnImpl: (executable, args, options) => {
        launch = { executable, args, options };
        return child;
      },
    });
    const handle = await adapter.startTask({
      taskId: 'task-readonly',
      usageInteractionId: 'parent-result',
      workspacePath: path.join(directory, 'workspace'),
      task: 'Read a file.',
      model: routerModel,
    });
    assert.equal(launch.options.env.DSH_PERMISSION_MODE, 'read-only');
    child.emit('spawn');
    child.stdout.write('{"type":"session","sessionId":"session-readonly"}\n');
    handle.stop();
    child.emit('close', 1, null);
    await handle.done.catch(() => {});
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('worker patch attaches a loopback MCP server for Noema tools', () => {
  const patch = makeNoemaDshWorkerPatch(
    routerModel,
    'http://127.0.0.1:31415/v1',
    {
      mcpServers: [
        {
          serverName: 'noema',
          url: 'http://127.0.0.1:43917/mcp',
          headers: { Authorization: 'Bearer test-token' },
        },
      ],
    },
  );
  assert.match(patch, /- insert:\n    - id: mcp-noema/);
  assert.match(patch, /name: '@deepseek-ai\/dsh-mcp-client'/);
  assert.match(patch, /serverName: noema/);
  assert.match(patch, /transport: streamable-http/);
  assert.match(patch, /url: "http:\/\/127\.0\.0\.1:43917\/mcp"/);
  assert.match(patch, /Authorization: "Bearer test-token"/);
  assert.match(patch, /failOnStartupError: true/);
  assert.throws(
    () =>
      makeNoemaDshWorkerPatch(routerModel, 'http://127.0.0.1:31415/v1', {
        mcpServers: [{ serverName: 'bad name', url: 'http://127.0.0.1' }],
      }),
    TypeError,
  );
  assert.throws(
    () =>
      makeNoemaDshWorkerPatch(routerModel, 'http://127.0.0.1:31415/v1', {
        mcpServers: [{ serverName: 'noema', url: 'file:///tmp/mcp' }],
      }),
    TypeError,
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
    platform: 'win32',
    execFileImpl,
    readFileImpl: async () => '{"version":"0.1.0"}',
  });
  assert.deepEqual(runtime, {
    nodeExecutable: 'D:\\NoemaTools\\node-v24.21.0-win-x64\\node.exe',
    dshBin: 'C:\\fake-npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
    npmPrefix: 'C:\\fake-npm',
    version: '0.1.0',
    source: 'external',
  });
  assert.equal(
    calls.some((call) => call.args.includes('--profile')),
    false,
  );
});

test('prefers the pinned DSH runtime bundled with the app', async () => {
  const checked = [];
  const runtime = await resolveDshHeadlessRuntime({
    env: {},
    platform: 'win32',
    resourcesPath: 'C:\\app\\resources',
    accessImpl: async (candidate) => checked.push(candidate),
    readFileImpl: async () => '{"version":"0.1.7-rc.2"}',
    execFileImpl: async (executable, args) => {
      assert.equal(args[0], '--version');
      assert.equal(executable, 'C:\\app\\resources\\dsh-runtime\\node.exe');
      return { stdout: 'v24.21.0' };
    },
  });
  assert.deepEqual(runtime, {
    nodeExecutable: 'C:\\app\\resources\\dsh-runtime\\node.exe',
    dshBin:
      'C:\\app\\resources\\dsh-runtime\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
    npmPrefix: 'C:\\app\\resources\\dsh-runtime',
    version: '0.1.7-rc.2',
    source: 'bundled',
  });
  assert.equal(checked.length, 2);
});

test('macOS prefers the DSH runtime bundled with the app', async () => {
  const runtime = await resolveDshHeadlessRuntime({
    env: { PATH: '/usr/bin' },
    platform: 'darwin',
    resourcesPath: '/Applications/Noema.app/Contents/Resources',
    accessImpl: async () => {},
    readFileImpl: async () => '{"version":"0.2.2-rc.1"}',
    execFileImpl: async (executable, args) => {
      assert.deepEqual(args, ['--version']);
      assert.equal(
        executable,
        '/Applications/Noema.app/Contents/Resources/dsh-runtime/node',
      );
      return { stdout: 'v24.21.0' };
    },
  });
  assert.deepEqual(runtime, {
    nodeExecutable:
      '/Applications/Noema.app/Contents/Resources/dsh-runtime/node',
    dshBin:
      '/Applications/Noema.app/Contents/Resources/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
    npmPrefix: '/Applications/Noema.app/Contents/Resources/dsh-runtime',
    version: '0.2.2-rc.1',
    source: 'bundled',
  });
});

test('macOS finds an npm-global DSH on PATH without booting a profile', async () => {
  const calls = [];
  const runtime = await resolveDshHeadlessRuntime({
    // `relative` is not absolute and must be ignored; /usr/local/bin/dsh is a
    // different tool; /opt/homebrew/bin/dsh links to the npm package.
    env: {
      PATH: 'relative:/usr/local/bin:/opt/homebrew/bin:/usr/bin',
      NOEMA_DSH_NODE: '/old/node',
    },
    platform: 'darwin',
    resourcesPath: '/Applications/Noema.app/Contents/Resources',
    accessImpl: async (candidate) => {
      if (
        candidate === '/usr/local/bin/dsh' ||
        candidate === '/opt/homebrew/bin/dsh'
      )
        return;
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    realpathImpl: async (candidate) =>
      candidate === '/opt/homebrew/bin/dsh'
        ? '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js'
        : '/usr/local/Cellar/other-dsh/bin/dsh',
    readFileImpl: async (file) => {
      assert.equal(
        file,
        '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json',
      );
      return '{"version":"0.2.2-rc.1"}';
    },
    execFileImpl: async (executable, args) => {
      calls.push({ executable, args });
      assert.deepEqual(args, ['--version']);
      if (executable === '/old/node') return { stdout: 'v22.11.0' };
      if (executable === '/opt/homebrew/bin/node')
        return { stdout: 'v24.21.0' };
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
  });
  assert.deepEqual(runtime, {
    nodeExecutable: '/opt/homebrew/bin/node',
    dshBin: '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
    npmPrefix: '/opt/homebrew/lib',
    version: '0.2.2-rc.1',
    source: 'external',
  });
  assert.equal(
    calls.some((call) => call.args.includes('--profile')),
    false,
  );
});

test('macOS reports a missing DSH instead of an unsupported platform', async () => {
  await assert.rejects(
    resolveDshHeadlessRuntime({
      env: { PATH: '/usr/bin:/bin' },
      platform: 'darwin',
      resourcesPath: '/Applications/Noema.app/Contents/Resources',
      accessImpl: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      execFileImpl: async () => assert.fail('no process may start'),
    }),
    (error) =>
      error instanceof DshHeadlessError && error.code === 'dsh_not_found',
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
      platform: 'win32',
      spawnImpl: (executable, args, options) => {
        launch = { executable, args, options };
        return child;
      },
    });
    const handle = await adapter.startTask({
      taskId: 'task-test',
      usageInteractionId: 'parent-result',
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
    assert.match(patch, /- id: llm-pi-ai[\s\S]*defaultMaxTokens: 32768/);
    assert.match(patch, /apiKeyEnv: NOEMA_MODEL_API_KEY/);
    assert.match(patch, /baseURL: "http:\/\/127\.0\.0\.1:31415\/v1"/);
    assert.match(patch, /tool-pwsh/);

    child.emit('spawn');
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
        'process.started',
        'session',
        'status',
        'status',
        'tool-call',
        'tool-result',
        'tool-call',
        'tool-result',
        'final',
        'process.exited',
      ],
    );
    assert.equal(observed[0].pid, undefined);
    assert.equal(observed.at(-1).exitCode, 0);
    assert.equal(observed.at(-1).status, 'completed');
    assert.equal(observed[4].category, 'write');
    assert.equal(observed[4].hasSideEffect, true);
    assert.equal(observed[4].stepId, observed[5].stepId);
    assert.equal(observed[5].effectStatus, 'applied');
    assert.equal(observed[6].category, 'command');
    assert.equal(observed[6].hasSideEffect, true);
    assert.equal(observed[6].stepId, observed[7].stepId);
    assert.equal(observed[7].effectStatus, 'unknown');
    assert.deepEqual(usageRecords, [
      {
        providerHost: '127.0.0.1',
        model: routerModel,
        operation: 'dsh_worker_step',
        interactionId: 'parent-result',
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

test('full external-file permission lifts the DSH worker sandbox', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-permission-'));
  const child = new FakeChild();
  let spawnOptions = null;
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: path.join(directory, 'user-data'),
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      getPermissionMode: () => 'danger-full-access',
      spawnImpl: (_command, _args, options) => {
        spawnOptions = options;
        return child;
      },
    });
    const handle = await adapter.startTask({
      taskId: 'task-permission',
      workspacePath: path.join(directory, 'workspace'),
      task: 'Check permission mode.',
      model: routerModel,
      timeoutMs: 10_000,
    });
    child.stdout.write('{"type":"session","sessionId":"session-permission"}\n');
    await handle.started;

    assert.equal(spawnOptions.env.DSH_PERMISSION_MODE, 'danger-full-access');
    handle.stop();
    await handle.done;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('read-only permission reaches the DSH worker', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-read-only-'));
  const child = new FakeChild();
  let spawnOptions = null;
  try {
    const adapter = new DshHeadlessAdapter({
      runtime: { nodeExecutable: 'node.exe', dshBin: 'dsh/lib/bin.js' },
      userDataPath: path.join(directory, 'user-data'),
      providerBaseUrl: 'http://127.0.0.1:31415/v1',
      getApiKey: () => 'test-free-key',
      getPermissionMode: () => 'read-only',
      spawnImpl: (_command, _args, options) => {
        spawnOptions = options;
        return child;
      },
    });
    const handle = await adapter.startTask({
      taskId: 'task-read-only',
      workspacePath: path.join(directory, 'workspace'),
      task: 'Check read-only permission.',
      model: routerModel,
      timeoutMs: 10_000,
    });
    child.stdout.write('{"type":"session","sessionId":"session-read-only"}\n');
    await handle.started;

    assert.equal(spawnOptions.env.DSH_PERMISSION_MODE, 'read-only');
    handle.stop();
    await handle.done;
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
