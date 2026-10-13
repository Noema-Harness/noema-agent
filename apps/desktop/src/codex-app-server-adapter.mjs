import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const RPC_TIMEOUT_MS = 12_000;
const MAX_THREAD_PAGE = 40;
const MAX_TURNS = 40;
const MAX_IMPORTED_CHARACTERS = 10_000;

function requireThreadId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new TypeError('Codex 会话标识无效。');
  }
  return value;
}

export function resolveCodexExecutable({
  platform = process.platform,
  env = process.env,
} = {}) {
  if (env.NOEMA_CODEX_EXECUTABLE) {
    const override = path.resolve(env.NOEMA_CODEX_EXECUTABLE);
    if (fs.existsSync(override) && fs.statSync(override).isFile())
      return override;
    return null;
  }
  if (platform !== 'win32' || !env.LOCALAPPDATA) return null;
  const binRoot = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
  try {
    const candidates = fs
      .readdirSync(binRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(binRoot, entry.name, 'codex.exe'))
      .filter((candidate) => fs.existsSync(candidate))
      .sort(
        (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs,
      );
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

function extractVisibleMessages(turns) {
  const allMessages = [];
  let omittedItems = 0;
  let omittedTurns = 0;
  for (const turn of turns) {
    if (turn.status === 'inProgress') {
      omittedTurns += 1;
      continue;
    }
    for (const item of turn.items ?? []) {
      if (item.type === 'userMessage' && Array.isArray(item.content)) {
        const text = item.content
          .filter(
            (part) => part?.type === 'text' && typeof part.text === 'string',
          )
          .map((part) => part.text)
          .join('');
        omittedItems += item.content.filter(
          (part) => part?.type !== 'text',
        ).length;
        if (text.trim()) allMessages.push({ role: 'user', content: text });
        continue;
      }
      if (item.type === 'agentMessage' && typeof item.text === 'string') {
        if (item.text.trim()) {
          allMessages.push({ role: 'assistant', content: item.text });
        }
        continue;
      }
      omittedItems += 1;
    }
  }

  const latestUserIndex = allMessages.findLastIndex(
    (message) => message.role === 'user',
  );
  if (latestUserIndex < 0) {
    throw new Error('所选会话没有可导入的完整用户文字消息。');
  }
  const requiredTail = allMessages.slice(latestUserIndex);
  const requiredCharacters = requiredTail.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
  if (requiredCharacters > MAX_IMPORTED_CHARACTERS) {
    throw new Error(
      '最近一条 Codex 用户消息及其后续回复超出导入上限。为避免丢掉当前问题，Noema 没有生成部分快照。',
    );
  }
  let selectedStart = latestUserIndex;
  let characterCount = requiredCharacters;
  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = allMessages[index];
    if (characterCount + message.content.length > MAX_IMPORTED_CHARACTERS) {
      break;
    }
    characterCount += message.content.length;
    selectedStart = index;
  }
  const selected = allMessages.slice(selectedStart);
  const omittedMessages = selectedStart;
  return {
    messages: selected,
    omittedItems,
    omittedTurns,
    omittedMessages,
    totalVisibleMessages: allMessages.length,
    characterCount,
  };
}

/** Read-only Codex App Server bridge. It never resumes a thread or starts a turn. */
export class CodexAppServerAdapter {
  constructor({
    executable = resolveCodexExecutable(),
    spawnProcess = spawn,
  } = {}) {
    this.executable = executable;
    this.spawnProcess = spawnProcess;
  }

  get available() {
    return Boolean(this.executable && fs.existsSync(this.executable));
  }

  async listThreads({ cwd, cursor = null } = {}) {
    const page = await this.request('thread/list', {
      limit: MAX_THREAD_PAGE,
      cursor,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false,
      useStateDbOnly: true,
      ...(typeof cwd === 'string' ? { cwd } : {}),
    });
    return {
      threads: (page.data ?? []).map((thread) => ({
        id: thread.id,
        title: thread.name || thread.preview || '未命名 Codex 会话',
        preview: thread.preview ?? '',
        cwd: thread.cwd ?? null,
        updatedAt: thread.updatedAt ?? null,
        modelProvider: thread.modelProvider ?? null,
        status: thread.status?.type ?? 'unknown',
      })),
      nextCursor: page.nextCursor ?? null,
    };
  }

  async previewThread(threadId) {
    requireThreadId(threadId);
    const before = await this.request('thread/read', {
      threadId,
      includeTurns: false,
    });
    const metadataBefore = before.thread;
    if (!metadataBefore?.id || metadataBefore.id !== threadId) {
      throw new Error('Codex 没有返回所选会话。');
    }

    const turnsPage = await this.request(
      'thread/turns/list',
      {
        threadId,
        limit: MAX_TURNS,
        sortDirection: 'desc',
        itemsView: 'full',
      },
      { experimental: true },
    );
    const turns = (turnsPage.data ?? []).reverse();
    const normalized = extractVisibleMessages(turns);
    const after = await this.request('thread/read', {
      threadId,
      includeTurns: false,
    });
    if (after.thread?.updatedAt !== metadataBefore.updatedAt) {
      throw new Error(
        '这条 Codex 会话在读取期间发生变化。请重新预览后再导入。',
      );
    }
    if (normalized.messages.length === 0) {
      throw new Error('所选会话没有可导入的完整可见文字消息。');
    }
    return {
      source: 'codex',
      threadId,
      title:
        metadataBefore.name || metadataBefore.preview || '未命名 Codex 会话',
      cwd: metadataBefore.cwd ?? null,
      sourceUpdatedAt: metadataBefore.updatedAt ?? null,
      capturedAt: new Date().toISOString(),
      messages: normalized.messages,
      omittedItems: normalized.omittedItems,
      omittedTurns: normalized.omittedTurns,
      omittedMessages: normalized.omittedMessages,
      totalVisibleMessages: normalized.totalVisibleMessages,
      characterCount: normalized.characterCount,
      hasMoreTurns: Boolean(turnsPage.nextCursor),
      sourceStatus: metadataBefore.status?.type ?? 'unknown',
    };
  }

  async request(method, params, { experimental = false } = {}) {
    if (!this.available) throw new Error('没有找到可用的 Codex 桌面程序。');
    const child = this.spawnProcess(
      this.executable,
      ['app-server', '--listen', 'stdio://', '-c', 'analytics.enabled=false'],
      {
        cwd: os.homedir(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    let nextId = 1;
    const lines = readline.createInterface({ input: child.stdout });
    const queue = [];
    const waiters = [];
    let closed = null;
    child.once('error', (error) => {
      closed = new Error(`无法启动 Codex 只读连接：${error.message}`);
      for (const wake of waiters.splice(0)) wake();
    });
    child.once('close', (code) => {
      closed ??= new Error(
        `Codex 只读连接已结束（退出码 ${code ?? 'unknown'}）。`,
      );
      for (const wake of waiters.splice(0)) wake();
    });
    lines.on('line', (line) => {
      let payload;
      try {
        payload = JSON.parse(line);
      } catch {
        closed = new Error(
          'Codex 返回了无法识别的协议数据；没有导入任何内容。',
        );
        for (const wake of waiters.splice(0)) wake();
        return;
      }
      queue.push(payload);
      for (const wake of waiters.splice(0)) wake();
    });

    const readResponse = async (id) => {
      const deadline = Date.now() + RPC_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const index = queue.findIndex((item) => item?.id === id);
        if (index !== -1) {
          const [response] = queue.splice(index, 1);
          if (response.error) {
            throw new Error(
              `Codex 暂不支持只读读取：${response.error.message ?? method}`,
            );
          }
          return response.result;
        }
        if (closed) throw closed;
        await new Promise((resolve) => {
          const timer = setTimeout(
            resolve,
            Math.min(100, deadline - Date.now()),
          );
          waiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      throw new Error('Codex 只读读取超时；没有开始模型请求。');
    };

    const send = async (requestMethod, requestParams) => {
      const id = nextId++;
      child.stdin.write(
        `${JSON.stringify({
          id,
          method: requestMethod,
          params: requestParams,
        })}\n`,
      );
      return readResponse(id);
    };

    try {
      await send('initialize', {
        clientInfo: { name: 'noema', title: 'Noema', version: '0.1.0' },
        capabilities: { experimentalApi: experimental },
      });
      child.stdin.write(
        `${JSON.stringify({ method: 'initialized', params: {} })}\n`,
      );
      return await send(method, params);
    } finally {
      lines.close();
      child.stdin.end();
      const killTimer = setTimeout(() => child.kill(), 250);
      killTimer.unref?.();
    }
  }
}

export { MAX_IMPORTED_CHARACTERS, extractVisibleMessages };
