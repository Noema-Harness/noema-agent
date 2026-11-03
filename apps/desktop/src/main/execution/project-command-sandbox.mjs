import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let sandboxManagerPromise;
let sandboxQueue = Promise.resolve();

export function windowsCommandSandboxSupport(platform, _release) {
  if (platform !== 'win32') return { supported: true };
  return {
    supported: false,
    reason: 'Windows 项目命令必须使用 Noema 原生 runner；旧命令后端已停用。',
  };
}

async function getSandboxRuntime() {
  sandboxManagerPromise ??= import('@anthropic-ai/sandbox-runtime');
  return sandboxManagerPromise;
}

function serialized(operation) {
  const run = sandboxQueue.then(operation, operation);
  sandboxQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function throwIfAborted(signal) {
  if (!signal.aborted) return;
  const error = new Error('命令在沙箱准备期间已取消；没有启动命令进程。');
  error.name = 'AbortError';
  error.effectStatus = 'not_applied';
  throw error;
}

function markSandboxUnavailable(error, effectStatus = 'not_applied') {
  const failure =
    error instanceof Error ? error : new Error('项目命令沙箱不可用。');
  failure.code ??= 'command_sandbox_unavailable';
  failure.effectStatus ??= effectStatus;
  return failure;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function normalizedAccess(workspacePath, accessRequests) {
  if (accessRequests === undefined) return [];
  if (!Array.isArray(accessRequests) || accessRequests.length > 4) {
    throw new Error('额外路径授权最多包含 4 项。');
  }
  const workspace = fs.realpathSync(workspacePath);
  const result = [];
  for (const request of accessRequests) {
    if (
      !request ||
      typeof request !== 'object' ||
      typeof request.path !== 'string' ||
      request.path.length > 1_000 ||
      !path.isAbsolute(request.path) ||
      (process.platform === 'win32' && request.path.startsWith('\\\\')) ||
      !['read', 'write'].includes(request.access) ||
      typeof request.reason !== 'string' ||
      !request.reason.trim() ||
      request.reason.length > 400
    ) {
      throw new Error(
        '额外路径授权参数无效；需要绝对路径、读/写权限和用途说明。',
      );
    }
    const resolved = fs.realpathSync(request.path);
    const stats = fs.statSync(resolved);
    if (!stats.isDirectory() && !stats.isFile()) {
      throw new Error('额外路径必须是现存的文件或目录。');
    }
    if (isWithin(workspace, resolved)) continue;
    if (isWithin(resolved, workspace)) {
      throw new Error(
        '不能把工作区的父目录作为额外授权范围；请改为选择更窄的具体路径。',
      );
    }
    const volumeRoot = path.parse(resolved).root;
    if (
      path.win32.normalize(resolved).toLowerCase() ===
      path.win32.normalize(volumeRoot).toLowerCase()
    ) {
      throw new Error('不能授权整个磁盘根目录。');
    }
    result.push({
      path: resolved,
      access: request.access,
      reason: request.reason.trim(),
    });
  }
  return result;
}

export function buildFilesystemPolicy({ readRoots, writeRoots }) {
  return {
    allowRead: [...readRoots],
    allowWrite: [...writeRoots],
    denyRead: [],
    denyWrite: [],
  };
}

function runWrappedCommand(
  argv,
  env,
  workspacePath,
  signal,
  onChild,
  timeoutMs,
  commandId,
  manager,
) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: workspacePath,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      error.effectStatus = 'not_applied';
      reject(error);
      return;
    }
    onChild(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const append = (target, chunk) =>
      (target + chunk.toString('utf8')).slice(-48_000);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    const abort = () => terminateProcessTree(child);
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      onChild(null);
      error.effectStatus = 'not_applied';
      reject(error);
    });
    child.once('close', (code, killedSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      onChild(null);
      const annotated = manager.annotateStderrWithSandboxFailures(
        commandId,
        stderr,
      );
      resolve({
        output: [
          `退出码：${code ?? killedSignal ?? 'unknown'}`,
          timedOut &&
            `执行超时：已达到 ${timeoutMs} 毫秒上限；命令副作用状态需要核对。`,
          stdout,
          annotated && `错误输出：\n${annotated}`,
        ]
          .filter(Boolean)
          .join('\n'),
        effectStatus: timedOut || signal.aborted ? 'unknown' : 'applied',
        interrupted: signal.aborted || (code === null && !timedOut),
        timedOut,
      });
    });
    if (signal.aborted) abort();
  });
}

function terminateProcessTree(child) {
  if (!child?.pid) {
    child?.kill();
    return;
  }
  try {
    const taskkill = spawn(
      'taskkill.exe',
      ['/PID', String(child.pid), '/T', '/F'],
      {
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    taskkill.once('error', () => child.kill());
    taskkill.once('close', (code) => {
      if (code !== 0) child.kill();
    });
  } catch {
    child.kill();
  }
}

/** Run one command under a fresh, least-privilege OS sandbox session. */
export function runProjectCommandInSandbox({
  command,
  workspacePath,
  signal,
  onChild = () => {},
  timeoutMs,
  additionalAccess = [],
  authorizeAdditionalAccess = async () => false,
  authorizeNetwork = async () => false,
  runtimeLoader = getSandboxRuntime,
  supportCheck = windowsCommandSandboxSupport,
  platform = process.platform,
  osRelease = os.release(),
}) {
  return serialized(async () => {
    if (platform === 'win32') {
      const error = new Error(
        'Windows 项目命令必须使用 Noema 原生 runner；旧命令后端已停用。',
      );
      error.code = 'command_sandbox_unavailable';
      error.effectStatus = 'not_applied';
      throw error;
    }
    if (
      typeof command !== 'string' ||
      !command.trim() ||
      command.length > 8_000
    ) {
      const error = new Error('命令为空或超过 8000 字符。');
      error.effectStatus = 'not_applied';
      throw error;
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      const error = new Error('命令超时配置无效。');
      error.effectStatus = 'not_applied';
      throw error;
    }
    const hostSupport = supportCheck(platform, osRelease);
    if (!hostSupport.supported) {
      const error = new Error(hostSupport.reason);
      error.code = 'command_sandbox_unavailable';
      error.effectStatus = 'not_applied';
      throw error;
    }
    throwIfAborted(signal);
    const workspace = fs.realpathSync(workspacePath);
    throwIfAborted(signal);
    const approvedAccess = normalizedAccess(workspace, additionalAccess);
    for (const item of approvedAccess) {
      const approved = await authorizeAdditionalAccess({ command, ...item });
      throwIfAborted(signal);
      if (!approved) {
        const error = new Error(
          `用户未批准本次命令访问 ${item.path}（${item.access}）。`,
        );
        error.effectStatus = 'not_applied';
        throw error;
      }
    }

    let sandboxRuntime;
    try {
      sandboxRuntime = await runtimeLoader();
    } catch (error) {
      throw markSandboxUnavailable(error);
    }
    throwIfAborted(signal);
    const { SandboxManager } = sandboxRuntime;
    const commandId = randomBytes(16).toString('base64url');
    const approvedHosts = new Set();
    const readRoots = new Set([workspace]);
    const writeRoots = new Set([workspace]);
    for (const item of approvedAccess) {
      readRoots.add(item.path);
      if (item.access === 'write') writeRoots.add(item.path);
    }
    const toolRoots = String(process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean);
    for (const entry of toolRoots) {
      try {
        const resolved = fs.realpathSync(entry);
        if (/[\\/]NoemaTools[\\/]/i.test(resolved)) {
          readRoots.add(resolved);
        }
      } catch {
        // A stale PATH entry is not a reason to widen this command's access.
      }
    }
    let result;
    let operationError;
    let initializationStarted = false;
    let commandStarted = false;
    try {
      await SandboxManager.reset();
      throwIfAborted(signal);
      initializationStarted = true;
      await SandboxManager.initialize(
        {
          filesystem: buildFilesystemPolicy({
            readRoots,
            writeRoots,
          }),
          network: {
            allowedDomains: [],
            deniedDomains: [],
            strictAllowlist: false,
            allowLocalBinding: false,
          },
        },
        async ({ host, port }) => {
          const normalizedHost = String(host || '').toLowerCase();
          const hostAndPort = `${normalizedHost}:${port}`;
          if (approvedHosts.has(hostAndPort)) return true;
          const approved = await authorizeNetwork({
            command,
            host: normalizedHost,
            port,
          });
          throwIfAborted(signal);
          if (approved) approvedHosts.add(hostAndPort);
          return approved;
        },
      );
      throwIfAborted(signal);
      const wrapped = await SandboxManager.wrapWithSandboxArgv(
        command,
        process.env.SHELL || '/bin/sh',
        undefined,
        signal,
        workspace,
        { commandId, commandText: command },
      );
      throwIfAborted(signal);
      commandStarted = true;
      result = await runWrappedCommand(
        wrapped.argv,
        wrapped.env,
        workspace,
        signal,
        onChild,
        timeoutMs,
        commandId,
        SandboxManager,
      );
    } catch (error) {
      if (!signal.aborted && error?.name !== 'AbortError') {
        markSandboxUnavailable(
          error,
          commandStarted ? 'unknown' : 'not_applied',
        );
      }
      if (
        error &&
        typeof error === 'object' &&
        error.effectStatus === undefined
      ) {
        error.effectStatus = result?.effectStatus ?? 'not_applied';
      }
      operationError = error;
    }

    let cleanupError;
    try {
      SandboxManager.unregisterCommandNetworkLists(commandId);
    } catch (error) {
      cleanupError = markSandboxUnavailable(error, 'unknown');
    }
    if (initializationStarted) {
      try {
        await SandboxManager.reset();
      } catch (error) {
        cleanupError ??= markSandboxUnavailable(error, 'unknown');
      }
    }
    if (cleanupError) {
      if (cleanupError && typeof cleanupError === 'object') {
        cleanupError.effectStatus =
          result?.effectStatus ?? operationError?.effectStatus ?? 'unknown';
        if (operationError)
          cleanupError.message = `命令执行或启动也失败：${operationError.message}。${cleanupError.message}`;
      }
      throw cleanupError;
    }
    if (operationError) throw operationError;
    return result;
  });
}

export function resolveRequestedCommandAccess(workspacePath, accessRequests) {
  return normalizedAccess(workspacePath, accessRequests);
}
