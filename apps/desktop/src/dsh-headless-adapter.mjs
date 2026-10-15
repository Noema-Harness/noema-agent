import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_TASK_LENGTH = 40_000;
const MAX_EVENT_LINE_BYTES = 512_000;
const MAX_FINAL_TEXT_LENGTH = 100_000;
const MAX_TOOL_CALLS = 12;
const MAX_REPEAT_TOOL_CALLS = 3;
const DSH_WORKER_MAX_TOKENS = 8_192;
export const DSH_FREE_MODEL = 'auto:noema-free';

export class DshHeadlessError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'DshHeadlessError';
    this.code = code;
  }
}

/**
 * Returns the DSH CLI and a Node runtime capable of starting it.
 * @param {{env?:NodeJS.ProcessEnv,platform?:NodeJS.Platform,execFileImpl?:typeof execFileAsync}} [options]
 */
export async function resolveDshHeadlessRuntime({
  env = process.env,
  platform = process.platform,
  execFileImpl = execFileAsync,
} = {}) {
  if (platform !== 'win32') {
    throw new DshHeadlessError(
      'dsh_platform_unsupported',
      'Noema 的首个 DSH 连接目前只支持 Windows 上的 DSH CLI。',
    );
  }

  let shimPath;
  try {
    const { stdout } = await execFileImpl('where.exe', ['dsh.cmd'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    shimPath = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().endsWith('dsh.cmd'));
  } catch {
    shimPath = undefined;
  }
  if (!shimPath) {
    throw new DshHeadlessError(
      'dsh_not_found',
      '没有找到 DSH CLI。安装 DSH 后重启 Noema，或继续只用主对话。',
    );
  }

  const npmPrefix = path.dirname(shimPath);
  const dshBin = path.join(
    npmPrefix,
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib',
    'bin.js',
  );
  const packagePath = path.join(
    npmPrefix,
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'package.json',
  );
  let packageVersion;
  try {
    packageVersion = JSON.parse(
      await (await import('node:fs/promises')).readFile(packagePath, 'utf8'),
    ).version;
  } catch {
    throw new DshHeadlessError(
      'dsh_package_unreadable',
      '找到了 DSH 启动器，但无法读取安装版本。',
    );
  }

  const nodeCandidates = [
    env.NOEMA_DSH_NODE,
    'D:\\NoemaTools\\node-v24.21.0-win-x64\\node.exe',
  ];
  try {
    const { stdout } = await execFileImpl('where.exe', ['node.exe'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    nodeCandidates.push(
      ...stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    // An explicit D-drive runtime may still be available.
  }

  const seen = new Set();
  for (const candidate of nodeCandidates) {
    if (!candidate || seen.has(candidate.toLowerCase())) continue;
    seen.add(candidate.toLowerCase());
    try {
      const { stdout } = await execFileImpl(candidate, ['--version'], {
        encoding: 'utf8',
        timeout: 3_000,
        windowsHide: true,
      });
      if (supportsDshNodeVersion(stdout)) {
        const { stdout: help } = await execFileImpl(
          candidate,
          [dshBin, '--profile', 'headless', '--help'],
          { encoding: 'utf8', timeout: 10_000, windowsHide: true },
        );
        if (!help.includes('--json') || !help.includes('--session-id')) {
          continue;
        }
        return {
          nodeExecutable: candidate,
          dshBin,
          npmPrefix,
          version: packageVersion,
        };
      }
    } catch {
      // Skip stale, incompatible, or inaccessible Node installations.
    }
  }

  throw new DshHeadlessError(
    'dsh_node_unavailable',
    'Noema 找到了 DSH，但没有找到可运行它的 Node.js 24.21+。',
  );
}

function supportsDshNodeVersion(output) {
  const match = /v(\d+)\.(\d+)\.(\d+)/.exec(output);
  if (!match) return false;
  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  return (
    major > 24 || (major === 24 && (minor > 21 || (minor === 21 && patch >= 0)))
  );
}

/**
 * This worker profile uses DSH's file tools only. Model names are JSON-quoted
 * YAML scalars so punctuation in a FreeLLMAPI model id cannot change the patch.
 * @param {string} model
 */
export function makeNoemaDshWorkerPatch(model) {
  if (typeof model !== 'string' || !model.trim() || model.length > 200) {
    throw new TypeError('DSH worker model must be a non-empty model name');
  }
  if (model !== DSH_FREE_MODEL) {
    throw new DshHeadlessError(
      'dsh_model_not_allowlisted',
      '后台 agent 只能使用 Noema 已核验的 FreeLLMAPI 免费链。',
    );
  }
  const modelScalar = JSON.stringify(model);
  return [
    '- id: agent-default-model',
    '  config:',
    '    provider: deepseek-official',
    `    model: ${modelScalar}`,
    '- id: llm-deepseek',
    '  config:',
    // DSH's provider default is 256k output tokens; cap worker calls so a
    // gateway model with a smaller context window can still receive the task.
    `    maxTokens: ${DSH_WORKER_MAX_TOKENS}`,
    '- id: tool-pwsh',
    '  disabled: true',
    '- id: web',
    '  disabled: true',
    '- id: web-search-deepseek',
    '  disabled: true',
    '- id: web-fetch-http',
    '  disabled: true',
    '- id: tool-web',
    '  disabled: true',
    '- id: tool-subagent',
    '  disabled: true',
    '- id: tool-subagent-control',
    '  disabled: true',
    '- id: tool-subagent-list-agents',
    '  disabled: true',
    '- id: tool-subagent-fork',
    '  disabled: true',
    '- id: tool-jobs',
    '  disabled: true',
    '',
  ].join('\n');
}

/** @param {string} line */
export function parseDshHeadlessEvent(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    throw new DshHeadlessError(
      'dsh_invalid_json',
      'DSH headless 返回了无法解析的事件行。',
    );
  }
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
    throw new DshHeadlessError(
      'dsh_invalid_event',
      'DSH headless 返回了缺少类型的事件。',
    );
  }
  return event;
}

/**
 * @param {{runtime:{nodeExecutable:string,dshBin:string},userDataPath:string,workspacePath:string,task:string,model:string,taskId?:string,sessionId?:string,env?:NodeJS.ProcessEnv,spawnImpl?:typeof spawn,onEvent?:(event:object)=>void,timeoutMs?:number}} input
 */
export class DshHeadlessAdapter {
  constructor({
    runtime,
    userDataPath,
    providerBaseUrl,
    getApiKey,
    env = process.env,
    spawnImpl = spawn,
  }) {
    this.runtime = runtime;
    this.userDataPath = path.resolve(userDataPath);
    this.providerBaseUrl = providerBaseUrl;
    this.getApiKey = getApiKey;
    this.env = env;
    this.spawnImpl = spawnImpl;
  }

  async startTask({
    workspacePath,
    task,
    model,
    taskId = randomUUID(),
    sessionId = null,
    onEvent = () => {},
    timeoutMs = 30 * 60 * 1000,
  }) {
    if (
      typeof task !== 'string' ||
      !task.trim() ||
      task.length > MAX_TASK_LENGTH
    ) {
      throw new TypeError(`DSH task must be 1-${MAX_TASK_LENGTH} characters`);
    }
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
      throw new TypeError(
        'DSH worker requires an absolute workspace directory',
      );
    }
    if (
      sessionId !== null &&
      (typeof sessionId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId))
    ) {
      throw new TypeError('DSH session id has an unsupported format');
    }
    const apiKey = this.getApiKey?.();
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new DshHeadlessError(
        'freellmapi_credentials_missing',
        'FreeLLMAPI 尚未连接，不能启动后台 agent。',
      );
    }
    if (
      typeof this.providerBaseUrl !== 'string' ||
      !this.providerBaseUrl.endsWith('/v1')
    ) {
      throw new DshHeadlessError(
        'freellmapi_base_url_invalid',
        'FreeLLMAPI 地址无效，不能启动后台 agent。',
      );
    }

    const patchDirectory = path.join(this.userDataPath, 'dsh-worker-patches');
    await mkdir(patchDirectory, { recursive: true });
    const patchPath = path.join(patchDirectory, `${taskId}.cordis.patch.yml`);
    await writeFile(patchPath, makeNoemaDshWorkerPatch(model), {
      encoding: 'utf8',
      flag: 'wx',
    });

    const processEnv = makeLocalWorkerEnvironment({
      parent: this.env,
      userDataPath: this.userDataPath,
      apiKey,
      baseUrl: this.providerBaseUrl,
    });
    const args = [
      this.runtime.dshBin,
      '--profile',
      'headless',
      '--patch',
      patchPath,
      '--json',
      ...(sessionId ? ['--session-id', sessionId] : []),
    ];
    const child = this.spawnImpl(this.runtime.nodeExecutable, args, {
      cwd: workspacePath,
      env: processEnv,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return createRunHandle({
      child,
      task,
      taskId,
      sessionId,
      timeoutMs,
      onEvent,
      patchPath,
      secret: apiKey,
    });
  }
}

/** @param {{parent:NodeJS.ProcessEnv,userDataPath:string,apiKey:string,baseUrl:string}} options */
function makeLocalWorkerEnvironment({ parent, userDataPath, apiKey, baseUrl }) {
  const allowedNames = [
    'APPDATA',
    'COMSPEC',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'OS',
    'PATH',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'USERDOMAIN',
    'USERNAME',
    'USERPROFILE',
    'WINDIR',
  ];
  const env = {};
  for (const name of allowedNames) {
    if (parent[name]) env[name] = parent[name];
  }
  env.DSH_HOME = path.join(userDataPath, 'dsh-home');
  env.DSH_PERMISSION_MODE = 'workspace-write';
  env.DEEPSEEK_API_KEY = apiKey;
  env.DEEPSEEK_BASE_URL = baseUrl;
  env.NO_PROXY = '127.0.0.1,localhost,::1';
  env.no_proxy = '127.0.0.1,localhost,::1';
  return env;
}

/** @param {{child:import('node:child_process').ChildProcess,task:string,taskId:string,sessionId:string|null,timeoutMs:number,onEvent:(event:object)=>void,patchPath:string}} input */
function createRunHandle({
  child,
  task,
  taskId,
  sessionId: requestedSessionId,
  timeoutMs,
  onEvent,
  patchPath,
  secret,
}) {
  let sessionId = requestedSessionId;
  let finalText = '';
  let errorMessage = null;
  let stderrTail = '';
  let toolCallCount = 0;
  let lineBuffer = '';
  let stopRequested = false;
  let lineError = null;
  let timeoutHandle;
  let resolveStarted;
  let rejectStarted;
  let resolveDone;
  let startedResolved = false;
  let doneResolved = false;
  const toolCallRepeats = new Map();
  const safeStderrTail = () =>
    secret ? stderrTail.replaceAll(secret, '[已隐藏凭据]') : stderrTail;
  const started = new Promise((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const emit = (event) => {
    try {
      onEvent({ taskId, ...event });
    } catch (error) {
      console.error('Noema could not publish a DSH worker event:', error);
    }
  };

  const stopForError = (error) => {
    lineError ??= error;
    try {
      child.kill();
    } catch {
      // The close handler owns the final process state.
    }
  };

  const processLine = (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = parseDshHeadlessEvent(line);
    } catch (error) {
      stopForError(error);
      return;
    }
    switch (event.type) {
      case 'session': {
        if (
          typeof event.sessionId !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(event.sessionId)
        ) {
          stopForError(
            new DshHeadlessError(
              'dsh_invalid_session_id',
              'DSH 返回了格式不正确的 session id。',
            ),
          );
          return;
        }
        if (requestedSessionId && event.sessionId !== requestedSessionId) {
          stopForError(
            new DshHeadlessError(
              'dsh_session_mismatch',
              'DSH 返回的 session id 与请求恢复的会话不一致。',
            ),
          );
          return;
        }
        sessionId = event.sessionId;
        if (!startedResolved) {
          startedResolved = true;
          resolveStarted({ sessionId });
        }
        emit({ type: 'session', sessionId });
        break;
      }
      case 'status':
        emit({
          type: 'status',
          phase: typeof event.phase === 'string' ? event.phase : 'unknown',
        });
        break;
      case 'tool_call': {
        toolCallCount += 1;
        const tool = typeof event.tool === 'string' ? event.tool : 'unknown';
        const inputSignature = createHash('sha256')
          .update(JSON.stringify(event.input ?? null))
          .digest('hex');
        const repeatKey = `${tool}:${inputSignature}`;
        const repeatCount = (toolCallRepeats.get(repeatKey) ?? 0) + 1;
        toolCallRepeats.set(repeatKey, repeatCount);
        emit({
          type: 'tool-call',
          count: toolCallCount,
          tool,
        });
        if (
          toolCallCount > MAX_TOOL_CALLS ||
          repeatCount >= MAX_REPEAT_TOOL_CALLS
        ) {
          stopForError(
            new DshHeadlessError(
              'dsh_tool_loop',
              '后台 agent 重复执行相同工具操作，Noema 已停止该任务。',
            ),
          );
        }
        break;
      }
      case 'tool_result':
        emit({
          type: 'tool-result',
          status: typeof event.status === 'string' ? event.status : 'unknown',
        });
        break;
      case 'error':
        errorMessage =
          typeof event.message === 'string'
            ? redactSecret(event.message.slice(0, 1_000), secret)
            : 'DSH 返回了未说明原因的错误。';
        emit({ type: 'error', message: errorMessage });
        break;
      case 'final':
        finalText =
          typeof event.text === 'string'
            ? event.text.slice(0, MAX_FINAL_TEXT_LENGTH)
            : '';
        emit({ type: 'final', status: event.status ?? null });
        break;
      case 'session_status':
      case 'thinking':
      case 'text':
        // DSH reasoning/text projections are not copied into Noema's root thread.
        break;
      default:
        emit({ type: 'unrecognized-event', eventType: event.type });
    }
  };

  child.stdout?.on('data', (chunk) => {
    lineBuffer += chunk.toString('utf8');
    if (
      Buffer.byteLength(lineBuffer, 'utf8') > MAX_EVENT_LINE_BYTES &&
      !lineBuffer.includes('\n')
    ) {
      stopForError(
        new DshHeadlessError(
          'dsh_event_too_large',
          'DSH 返回的单条事件超过安全大小限制。',
        ),
      );
      return;
    }
    for (;;) {
      const newline = lineBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = lineBuffer.slice(0, newline);
      lineBuffer = lineBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_LINE_BYTES) {
        stopForError(
          new DshHeadlessError(
            'dsh_event_too_large',
            'DSH 返回的单条事件超过安全大小限制。',
          ),
        );
        continue;
      }
      processLine(line);
    }
  });
  child.stderr?.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4_000);
  });

  const timeoutError = new DshHeadlessError(
    'dsh_task_timeout',
    '后台 DSH 任务超过允许的运行时间，已停止。',
  );
  timeoutHandle = setTimeout(() => {
    stopRequested = true;
    stopForError(timeoutError);
  }, timeoutMs);

  child.on('error', (error) => {
    lineError ??= new DshHeadlessError(
      'dsh_process_error',
      `无法启动 DSH headless：${error.message}`.slice(0, 1_000),
    );
    if (!startedResolved) {
      startedResolved = true;
      rejectStarted(lineError);
    }
    if (!doneResolved) {
      doneResolved = true;
      clearTimeout(timeoutHandle);
      resolveDone({
        status: 'failed',
        sessionId,
        result: finalText,
        errorCode: lineError.code,
        errorMessage: lineError.message,
        toolCallCount,
        stderrTail: safeStderrTail(),
        task,
      });
    }
  });

  child.on('close', (code, signal) => {
    clearTimeout(timeoutHandle);
    if (!startedResolved) {
      startedResolved = true;
      rejectStarted(
        lineError ??
          new DshHeadlessError(
            'dsh_start_failed',
            safeStderrTail().trim() || 'DSH 没有启动到可接收任务的状态。',
          ),
      );
    }
    if (doneResolved) return;
    doneResolved = true;

    const status = stopRequested
      ? 'interrupted'
      : code === 0 && finalText
        ? 'completed'
        : 'failed';
    resolveDone({
      status,
      sessionId,
      result: finalText,
      exitCode: code,
      signal,
      errorCode:
        lineError?.code ?? (status === 'failed' ? 'dsh_process_failed' : null),
      errorMessage:
        lineError?.message ??
        (status === 'failed'
          ? safeStderrTail().trim().slice(-1_000) ||
            `DSH 任务未完成（退出码 ${code ?? 'unknown'}）。`
          : null),
      toolCallCount,
      stderrTail: safeStderrTail(),
      task,
    });
    void import('node:fs/promises').then(({ rm }) =>
      rm(patchPath, { force: true }).catch(() => {}),
    );
  });

  child.stdin?.end(task);

  return {
    started,
    done,
    stop() {
      stopRequested = true;
      if (!child.kill()) return false;
      return true;
    },
  };
}

function redactSecret(value, secret) {
  return secret ? value.replaceAll(secret, '[已隐藏凭据]') : value;
}
