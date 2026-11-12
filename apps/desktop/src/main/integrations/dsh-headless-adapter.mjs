import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_TASK_LENGTH = 40_000;
const MAX_EVENT_LINE_BYTES = 512_000;
const MAX_FINAL_TEXT_LENGTH = 100_000;
const MAX_TOOL_CALLS = 40;
const MAX_REPEAT_TOOL_CALLS = 3;
const INVALID_ARGUMENT_REPAIR_THRESHOLD = MAX_REPEAT_TOOL_CALLS - 1;
const DSH_WORKER_MAX_TOKENS = 32_768;

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
 * A pinned runtime inside the application resources wins over PATH so a
 * consumer install never depends on a separately installed DSH or Node.
 * @param {{env?:NodeJS.ProcessEnv,platform?:NodeJS.Platform,execFileImpl?:typeof execFileAsync,readFileImpl?:typeof readFile,accessImpl?:typeof access,resourcesPath?:string}} [options]
 */
export async function resolveDshHeadlessRuntime({
  env = process.env,
  platform = process.platform,
  execFileImpl = execFileAsync,
  readFileImpl = readFile,
  accessImpl = access,
  resourcesPath = process.resourcesPath,
} = {}) {
  if (platform !== 'win32') {
    throw new DshHeadlessError(
      'dsh_platform_unsupported',
      'Noema 的首个 DSH 连接目前只支持 Windows 上的 DSH CLI。',
    );
  }

  const bundledRoot = env.NOEMA_DSH_BUNDLE_DIR
    ? path.resolve(env.NOEMA_DSH_BUNDLE_DIR)
    : resourcesPath
      ? path.join(resourcesPath, 'dsh-runtime')
      : null;
  if (bundledRoot) {
    const bundled = await resolveBundledDshRuntime({
      root: bundledRoot,
      execFileImpl,
      readFileImpl,
      accessImpl,
    });
    if (bundled) return bundled;
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
      '没有找到 DSH CLI。安装 DSH 后重启 Noema，或继续只用对话功能。',
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
      await readFileImpl(packagePath, 'utf8'),
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
        return {
          nodeExecutable: candidate,
          dshBin,
          npmPrefix,
          version: packageVersion,
          source: 'external',
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

async function resolveBundledDshRuntime({
  root,
  execFileImpl,
  readFileImpl,
  accessImpl,
}) {
  const nodeExecutable = path.join(root, 'node.exe');
  const npmPrefix = root;
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
  try {
    await Promise.all([accessImpl(nodeExecutable), accessImpl(dshBin)]);
    const packageVersion = JSON.parse(
      await readFileImpl(packagePath, 'utf8'),
    ).version;
    if (typeof packageVersion !== 'string' || !packageVersion.trim()) {
      return null;
    }
    const { stdout } = await execFileImpl(nodeExecutable, ['--version'], {
      encoding: 'utf8',
      timeout: 3_000,
      windowsHide: true,
    });
    if (!supportsDshNodeVersion(stdout)) return null;
    return {
      nodeExecutable,
      dshBin,
      npmPrefix,
      version: packageVersion,
      source: 'bundled',
    };
  } catch {
    // A missing or incomplete bundle falls back to the developer runtime.
    return null;
  }
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

function isDshInvalidArgumentsResult(result) {
  return (
    typeof result === 'string' &&
    result.length <= 2_000 &&
    /^Error: invalid arguments:/iu.test(result.trimStart())
  );
}

function normalizeDshToolCategory(tool) {
  const name =
    typeof tool === 'string'
      ? tool
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '')
      : '';
  if (
    ['write', 'write_file', 'file_write', 'writefile', 'create_file'].includes(
      name,
    )
  ) {
    return 'write';
  }
  if (
    ['edit', 'edit_file', 'file_edit', 'patch', 'apply_patch'].includes(name)
  ) {
    return 'edit';
  }
  if (/(read|open|list|stat|inspect|fetch)/.test(name)) return 'read';
  if (/(search|grep|find|glob|query)/.test(name)) return 'search';
  if (/(shell|terminal|command|exec|pwsh|bash)/.test(name)) return 'command';
  return 'other';
}

export function parseDshRateLimitRetryAfterSeconds(stderr) {
  if (typeof stderr !== 'string' || !/\bRATE_LIMIT\b/i.test(stderr)) {
    return null;
  }
  const match = /Soonest reset\s*~\s*(\d{1,3})s\b/i.exec(stderr);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 120
    ? seconds
    : null;
}

/**
 * This worker profile uses DSH's file tools only. Route values are JSON-quoted
 * YAML scalars so a local gateway URL cannot change the patch structure.
 * @param {string} model
 * @param {string} baseURL
 * @param {{mcpServers?:Array<{serverName:string,url:string,headers?:Record<string,string>}>,profile?:string}} [options]
 */
export function makeNoemaDshWorkerPatch(
  model,
  baseURL,
  { mcpServers = [], profile = 'executor' } = {},
) {
  if (typeof model !== 'string' || !model.trim() || model.length > 200) {
    throw new TypeError('DSH worker model must be a non-empty model name');
  }
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(baseURL);
  } catch {
    throw new DshHeadlessError(
      'model_provider_base_url_invalid',
      '模型服务地址无效，不能启动后台 agent。',
    );
  }
  if (
    !baseURL.endsWith('/v1') ||
    !['http:', 'https:'].includes(parsedBaseUrl.protocol)
  ) {
    throw new DshHeadlessError(
      'model_provider_base_url_invalid',
      '模型服务地址无效，不能启动后台 agent。',
    );
  }
  const modelScalar = JSON.stringify(model);
  const baseUrlScalar = JSON.stringify(baseURL);
  // Product profiles may inspect through the read-only shell, but only the
  // executor gets the filesystem mutation surface. The adapter also forces a
  // read-only permission mode for every non-executor profile.
  const fileAccessEnabled = profile === 'executor';
  const mcpEntries = [];
  for (const server of mcpServers) {
    const serverName =
      typeof server?.serverName === 'string' ? server.serverName : '';
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
      throw new TypeError('DSH MCP server name is invalid');
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(server.url);
    } catch {
      throw new TypeError('DSH MCP server URL is invalid');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new TypeError('DSH MCP server URL must use HTTP or HTTPS');
    }
    mcpEntries.push(
      `    - id: mcp-${serverName.toLowerCase()}`,
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      `        serverName: ${serverName}`,
      '        transport: streamable-http',
      `        url: ${JSON.stringify(server.url)}`,
    );
    const headers = Object.entries(server.headers ?? {}).filter(
      ([key, value]) => key && typeof value === 'string',
    );
    if (headers.length) {
      mcpEntries.push('        headers:');
      for (const [key, value] of headers) {
        mcpEntries.push(`          ${key}: ${JSON.stringify(value)}`);
      }
    }
    mcpEntries.push(
      '        failOnStartupError: true',
      '        toolCallTimeoutMs: 60000',
    );
  }
  const mcpPatch = mcpEntries.length ? ['- insert:', ...mcpEntries] : [];
  return [
    '- id: agent-default-model',
    '  config:',
    '    provider: noema-model',
    `    model: ${modelScalar}`,
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      noema-model:',
    '        displayName: Noema model provider',
    '        apiKeyEnv: NOEMA_MODEL_API_KEY',
    '        api: openai-completions',
    `        baseURL: ${baseUrlScalar}`,
    '        defaultContextWindow: 131072',
    `        defaultMaxTokens: ${DSH_WORKER_MAX_TOKENS}`,
    '        models:',
    `          - id: ${modelScalar}`,
    // dsh-base provides the sandbox-consuming PowerShell executor on Windows.
    // Product profiles keep the shell for bounded inspection under the forced
    // read-only permission mode; only the executor gets filesystem mutation.
    '- id: tool-pwsh',
    '  disabled: false',
    '- id: tool-fs',
    `  disabled: ${!fileAccessEnabled}`,
    '- id: web',
    '  disabled: true',
    '- id: web-search-deepseek',
    '  disabled: true',
    '- id: web-fetch-http',
    '  disabled: true',
    '- id: tool-web',
    '  disabled: true',
    ...mcpPatch,
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

function validUsageCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Normalize a DSH headless step's aggregate provider usage. DSH separates
 * uncached input, cache reads, and cache writes; Noema stores total prompt
 * tokens plus a miss bucket so the same hit-rate calculation works across
 * providers. Missing or inconsistent buckets remain unknown.
 * @param {unknown} value
 */
export function normalizeDshReportedUsage(value) {
  const unknown = {
    usageReceived: false,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    cacheMissTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return unknown;
  }

  const readCount = (key) => {
    if (!Object.hasOwn(value, key)) return { present: false, value: null };
    return validUsageCount(value[key])
      ? { present: true, value: value[key] }
      : { present: true, value: null, invalid: true };
  };
  const uncached = readCount('inputTokens');
  const output = readCount('outputTokens');
  const total = readCount('totalTokens');
  const cacheRead = readCount('cacheReadTokens');
  const cacheWrite = readCount('cacheWriteTokens');
  const reasoning = readCount('reasoningTokens');
  if (
    uncached.invalid ||
    output.invalid ||
    total.invalid ||
    cacheRead.invalid ||
    cacheWrite.invalid ||
    reasoning.invalid ||
    !uncached.present ||
    !output.present ||
    (reasoning.present && reasoning.value > output.value)
  ) {
    return unknown;
  }

  let read = cacheRead.value;
  let write = cacheWrite.value;
  let inputTokens = null;
  if (total.present) {
    const exactPromptTokens = total.value - output.value;
    const knownPromptTokens = uncached.value + (read ?? 0) + (write ?? 0);
    if (
      !validUsageCount(knownPromptTokens) ||
      exactPromptTokens < knownPromptTokens ||
      (cacheRead.present &&
        cacheWrite.present &&
        exactPromptTokens !== knownPromptTokens)
    ) {
      return unknown;
    }
    const unassigned = exactPromptTokens - knownPromptTokens;
    if (!cacheRead.present && cacheWrite.present) read = unassigned;
    else if (cacheRead.present && !cacheWrite.present) write = unassigned;
    // If both cache fields are absent, the exact total still cannot reveal hits.
    inputTokens = exactPromptTokens;
  } else if (cacheRead.present && cacheWrite.present) {
    inputTokens = uncached.value + read + write;
    if (!validUsageCount(inputTokens)) return unknown;
  }

  const cacheBreakdownAvailable = inputTokens !== null && read !== null;
  return {
    usageReceived: true,
    inputTokens,
    outputTokens: output.value,
    cachedInputTokens: read,
    cacheMissTokens: cacheBreakdownAvailable ? inputTokens - read : null,
    cacheWriteTokens: write,
    reasoningTokens: reasoning.value,
  };
}

/**
 * @param {{runtime:{nodeExecutable:string,dshBin:string},userDataPath:string,workspacePath:string,task:string,model:string,taskId?:string,usageInteractionId?:string,sessionId?:string,env?:NodeJS.ProcessEnv,spawnImpl?:typeof spawn,onEvent?:(event:object)=>void,timeoutMs?:number}} input
 */
export class DshHeadlessAdapter {
  /**
   * @param {{runtime:{nodeExecutable:string,dshBin:string},userDataPath:string,providerBaseUrl:string,getApiKey:()=>string|null,getPermissionMode?:()=>string,onUsage?:(usage:Record<string,unknown>)=>void,env?:NodeJS.ProcessEnv,spawnImpl?:typeof spawn,mcpServers?:Array<{serverName:string,url:string,headers?:Record<string,string>}>,profile?:string}} options
   */
  constructor({
    runtime,
    userDataPath,
    providerBaseUrl,
    getApiKey,
    getPermissionMode = () => 'workspace-write',
    onUsage = () => {},
    env = process.env,
    spawnImpl = spawn,
    mcpServers = [],
    profile = 'executor',
  }) {
    this.executionEngine = 'dsh';
    this.runtime = runtime;
    this.userDataPath = path.resolve(userDataPath);
    this.providerBaseUrl = providerBaseUrl;
    this.getApiKey = getApiKey;
    this.getPermissionMode = getPermissionMode;
    this.onUsage = typeof onUsage === 'function' ? onUsage : () => {};
    this.env = env;
    this.spawnImpl = spawnImpl;
    this.mcpServers = Array.isArray(mcpServers) ? mcpServers : [];
    this.profile = profile;
  }

  async startTask({
    workspacePath,
    task,
    model,
    taskId = randomUUID(),
    usageInteractionId = taskId,
    sessionId = null,
    onEvent = () => {},
    timeoutMs = 30 * 60 * 1000,
    mcpServers = this.mcpServers,
    profile = this.profile,
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
        'model_provider_credentials_missing',
        '模型服务凭据尚未配置，不能启动后台 agent。',
      );
    }
    if (
      typeof this.providerBaseUrl !== 'string' ||
      !this.providerBaseUrl.endsWith('/v1')
    ) {
      throw new DshHeadlessError(
        'model_provider_base_url_invalid',
        '模型服务地址无效，不能启动后台 agent。',
      );
    }

    const patchDirectory = path.join(this.userDataPath, 'dsh-worker-patches');
    await mkdir(patchDirectory, { recursive: true });
    const patchPath = path.join(patchDirectory, `${taskId}.cordis.patch.yml`);
    await writeFile(
      patchPath,
      makeNoemaDshWorkerPatch(model, this.providerBaseUrl, {
        mcpServers,
        profile,
      }),
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );

    const requestedPermissionMode = this.getPermissionMode?.();
    const permissionMode =
      requestedPermissionMode === 'danger-full-access'
        ? 'danger-full-access'
        : requestedPermissionMode === 'read-only'
          ? 'read-only'
          : 'workspace-write';
    // Product chat may read, search and inspect, but never mutate through a
    // shell or filesystem tool. Only the executor gets the user's workspace mode.
    const effectivePermissionMode =
      profile === 'executor' ? permissionMode : 'read-only';
    const processEnv = makeLocalWorkerEnvironment({
      parent: this.env,
      userDataPath: this.userDataPath,
      apiKey,
      permissionMode: effectivePermissionMode,
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
      model,
      usageInteractionId,
      providerHost: new URL(this.providerBaseUrl).hostname,
      onUsage: this.onUsage,
    });
  }
}

/** @param {{parent:NodeJS.ProcessEnv,userDataPath:string,apiKey:string,permissionMode?:string}} options */
function makeLocalWorkerEnvironment({
  parent,
  userDataPath,
  apiKey,
  permissionMode = 'workspace-write',
}) {
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
  env.DSH_PERMISSION_MODE = ['read-only', 'danger-full-access'].includes(
    permissionMode,
  )
    ? permissionMode
    : 'workspace-write';
  env.NOEMA_MODEL_API_KEY = apiKey;
  env.NO_PROXY = '127.0.0.1,localhost,::1';
  env.no_proxy = '127.0.0.1,localhost,::1';
  return env;
}

/** @param {{child:import('node:child_process').ChildProcess,task:string,taskId:string,usageInteractionId:string,sessionId:string|null,timeoutMs:number,onEvent:(event:object)=>void,patchPath:string,secret:string,model:string,providerHost:string,onUsage:(usage:Record<string,unknown>)=>void}} input */
function createRunHandle({
  child,
  task,
  taskId,
  sessionId: requestedSessionId,
  timeoutMs,
  onEvent,
  patchPath,
  secret,
  model,
  usageInteractionId,
  providerHost,
  onUsage,
}) {
  const startedAt = Date.now();
  let processSpawned = false;
  let timedOut = false;
  let sessionId = requestedSessionId;
  let finalText = '';
  let turnEndReason = null;
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
  const pendingExecutionSteps = new Map();
  const uncorrelatedExecutionSteps = [];
  const pendingWorkspaceMutations = new Map();
  const invalidArgumentWritesByRepeatKey = new Map();
  let workspaceMutationSucceeded = false;
  let workspaceMutationUnknown = false;
  let invalidArgumentsLoopDetected = false;
  let pendingModelSteps = 0;
  const getWorkspaceMutationStatus = () => {
    if (workspaceMutationSucceeded) return 'mutation_succeeded';
    if (workspaceMutationUnknown) return 'unknown';
    if (invalidArgumentsLoopDetected) return 'invalid_args_only';
    if (pendingWorkspaceMutations.size > 0) return 'unknown';
    return 'none';
  };
  const safeStderrTail = () =>
    secret ? stderrTail.replaceAll(secret, '[已隐藏凭据]') : stderrTail;
  const recordStepUsage = (requestStatus, usage) => {
    const normalized = normalizeDshReportedUsage(usage);
    try {
      onUsage({
        providerHost,
        model,
        operation: 'dsh_worker_step',
        interactionId: usageInteractionId,
        requestStatus,
        ...normalized,
        requestCharacters: null,
        messageCount: 0,
        toolCount: 0,
      });
    } catch (error) {
      console.warn('Noema could not save DSH usage metadata:', error?.message);
    }
  };
  const flushPendingModelSteps = (requestStatus) => {
    while (pendingModelSteps > 0) {
      pendingModelSteps -= 1;
      recordStepUsage(requestStatus, null);
    }
  };
  const started = new Promise((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const emit = (event) => {
    try {
      const { arguments: toolArguments, resultContent, ...visible } = event;
      const payload = { taskId, ...visible };
      // Tool payloads are for the local execution ledger, not diagnostics.
      // Keep them non-enumerable so event dumps cannot leak command content.
      if (toolArguments !== undefined) {
        Object.defineProperty(payload, 'arguments', {
          value: toolArguments,
          enumerable: false,
        });
      }
      if (resultContent !== undefined) {
        Object.defineProperty(payload, 'resultContent', {
          value: resultContent,
          enumerable: false,
        });
      }
      onEvent(payload);
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
      // DSH plugins and MCP clients may print diagnostics to stdout. The
      // headless protocol itself is JSON-lines; a plain-text line is not a
      // protocol event and must not abort a task that already produced work.
      if (!line.trimStart().startsWith('{')) {
        console.warn('Noema ignored a non-JSON DSH diagnostic line.');
        return;
      }
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
      case 'status': {
        const phase = typeof event.phase === 'string' ? event.phase : 'unknown';
        if (phase === 'step_start') pendingModelSteps += 1;
        if (phase === 'step_end') {
          pendingModelSteps = Math.max(0, pendingModelSteps - 1);
          recordStepUsage('completed', event.usage);
        }
        if (
          phase === 'turn_end' &&
          event.reason &&
          typeof event.reason === 'object'
        ) {
          turnEndReason = event.reason;
        }
        emit({
          type: 'status',
          phase,
        });
        break;
      }
      case 'tool_call': {
        toolCallCount += 1;
        const tool = typeof event.tool === 'string' ? event.tool : 'unknown';
        const callId =
          typeof event.callId === 'string' &&
          /^[A-Za-z0-9._:-]{1,200}$/.test(event.callId)
            ? event.callId
            : null;
        const stepId = randomUUID();
        const category = normalizeDshToolCategory(tool);
        const hasSideEffect = ['write', 'edit', 'command'].includes(category);
        const executionStep = { stepId, tool, category, hasSideEffect };
        if (callId) pendingExecutionSteps.set(callId, executionStep);
        else uncorrelatedExecutionSteps.push(executionStep);
        const inputSignature = createHash('sha256')
          .update(JSON.stringify(event.input ?? null))
          .digest('hex');
        const repeatKey = `${tool}:${inputSignature}`;
        const repeatCount = (toolCallRepeats.get(repeatKey) ?? 0) + 1;
        toolCallRepeats.set(repeatKey, repeatCount);
        const isWorkspaceMutation = ['write', 'edit'].includes(category);
        if (isWorkspaceMutation) {
          if (callId) pendingWorkspaceMutations.set(callId, repeatKey);
          else workspaceMutationUnknown = true;
        } else if (category === 'command') {
          workspaceMutationUnknown = true;
        }
        emit({
          type: 'tool-call',
          count: toolCallCount,
          tool,
          stepId,
          externalCallId: callId,
          category,
          hasSideEffect,
          arguments:
            event.input === undefined
              ? null
              : JSON.stringify(event.input).slice(0, 32_000),
        });
        if (
          toolCallCount > MAX_TOOL_CALLS ||
          repeatCount >= MAX_REPEAT_TOOL_CALLS
        ) {
          const matchingInvalidResults =
            invalidArgumentWritesByRepeatKey.get(repeatKey) ?? 0;
          if (
            repeatCount >= MAX_REPEAT_TOOL_CALLS &&
            isWorkspaceMutation &&
            callId &&
            pendingWorkspaceMutations.get(callId) === repeatKey &&
            matchingInvalidResults >= INVALID_ARGUMENT_REPAIR_THRESHOLD &&
            !workspaceMutationSucceeded &&
            !workspaceMutationUnknown &&
            pendingWorkspaceMutations.size === 1
          ) {
            invalidArgumentsLoopDetected = true;
          }
          stopForError(
            new DshHeadlessError(
              'dsh_tool_loop',
              '后台 agent 重复执行相同工具操作，Noema 已停止该任务。',
            ),
          );
        }
        break;
      }
      case 'tool_result': {
        const callId =
          typeof event.callId === 'string' &&
          /^[A-Za-z0-9._:-]{1,200}$/.test(event.callId)
            ? event.callId
            : null;
        let executionStep = callId ? pendingExecutionSteps.get(callId) : null;
        if (executionStep) {
          pendingExecutionSteps.delete(callId);
        } else if (!callId && uncorrelatedExecutionSteps.length === 1) {
          executionStep = uncorrelatedExecutionSteps.shift();
        }
        const repeatKey = callId ? pendingWorkspaceMutations.get(callId) : null;
        if (callId && repeatKey) {
          pendingWorkspaceMutations.delete(callId);
          if (event.status === 'completed') {
            workspaceMutationSucceeded = true;
          } else if (
            event.status === 'error' &&
            isDshInvalidArgumentsResult(event.result)
          ) {
            invalidArgumentWritesByRepeatKey.set(
              repeatKey,
              (invalidArgumentWritesByRepeatKey.get(repeatKey) ?? 0) + 1,
            );
          } else {
            workspaceMutationUnknown = true;
          }
        }
        emit({
          type: 'tool-result',
          status: typeof event.status === 'string' ? event.status : 'unknown',
          stepId: executionStep?.stepId ?? null,
          category: executionStep?.category ?? 'other',
          hasSideEffect: executionStep?.hasSideEffect ?? false,
          resultContent:
            typeof event.result === 'string'
              ? event.result.slice(0, 100_000)
              : JSON.stringify(event.result ?? null).slice(0, 100_000),
          effectStatus: !executionStep?.hasSideEffect
            ? 'none'
            : event.status === 'completed' &&
                ['write', 'edit'].includes(executionStep.category)
              ? 'applied'
              : event.status === 'error' &&
                  isDshInvalidArgumentsResult(event.result)
                ? 'not_applied'
                : 'unknown',
        });
        break;
      }
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
    timedOut = true;
    stopRequested = true;
    emit({ type: 'process.timeout' });
    stopForError(timeoutError);
  }, timeoutMs);

  child.on('spawn', () => {
    processSpawned = true;
    emit({ type: 'process.started' });
  });

  child.on('error', (error) => {
    if (!processSpawned) {
      emit({
        type: 'process.spawn_failed',
        errorCode:
          typeof error?.code === 'string' ? error.code : 'spawn_failed',
        elapsedMs: Date.now() - startedAt,
      });
    }
    flushPendingModelSteps('failed');
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
        workspaceMutationStatus: getWorkspaceMutationStatus(),
        stderrTail: safeStderrTail(),
        task,
      });
    }
  });

  child.on('close', (code, signal) => {
    clearTimeout(timeoutHandle);
    flushPendingModelSteps(stopRequested ? 'interrupted' : 'failed');
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
    if (processSpawned) {
      emit({
        type: 'process.exited',
        status: stopRequested
          ? 'interrupted'
          : code === 0 && finalText
            ? 'completed'
            : 'failed',
        exitCode: Number.isInteger(code) ? code : null,
        elapsedMs: Date.now() - startedAt,
        timedOut,
      });
    }
    if (doneResolved) return;
    doneResolved = true;

    const status = stopRequested
      ? 'interrupted'
      : code === 0 && finalText
        ? 'completed'
        : 'failed';
    const safeStderr = safeStderrTail().trim();
    const rateLimited = /\bRATE_LIMIT\b/i.test(safeStderr);
    const rejectedStatus =
      /\bHTTP[_ ](4\d{2})\b|\bINVALID_REQUEST:\s*(4\d{2})\b/i
        .exec(safeStderr)
        ?.slice(1)
        .find(Boolean);
    const providerRejected = Boolean(
      rejectedStatus && rejectedStatus !== '408' && rejectedStatus !== '429',
    );
    const retryAfterSeconds = parseDshRateLimitRetryAfterSeconds(safeStderr);
    const maxTokensExhausted = turnEndReason?.kind === 'max-tokens';
    resolveDone({
      status,
      sessionId,
      result: finalText,
      exitCode: code,
      signal,
      errorCode: maxTokensExhausted
        ? 'dsh_max_tokens'
        : (lineError?.code ??
          (rateLimited
            ? 'dsh_rate_limited'
            : providerRejected
              ? 'dsh_provider_rejected'
              : status === 'failed'
                ? 'dsh_process_failed'
                : null)),
      errorMessage: maxTokensExhausted
        ? `模型在单步中耗尽输出上限（${DSH_WORKER_MAX_TOKENS} tokens），未产生工具调用。可从检查点继续，或把任务拆小。`
        : (lineError?.message ??
          (rateLimited
            ? retryAfterSeconds
              ? `DSH 免费模型池限流；最早约 ${retryAfterSeconds} 秒后可续做。`
              : 'DSH 免费模型池仍在限流，但没有可安全采用的短时冷却窗口。'
            : providerRejected
              ? `模型服务拒绝请求（HTTP ${rejectedStatus}）；不会自动重试，以免重复消耗额度。`
              : status === 'failed'
                ? safeStderr.slice(-1_000) ||
                  `DSH 任务未完成（退出码 ${code ?? 'unknown'}）。`
                : null)),
      retryAfterSeconds,
      toolCallCount,
      workspaceMutationStatus: getWorkspaceMutationStatus(),
      stderrTail: safeStderr,
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
