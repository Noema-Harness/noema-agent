import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createRoot } from 'react-dom/client';
import type {
  NoemaBackgroundTask,
  NoemaCodexPreview,
  NoemaCodexThread,
  NoemaContextImport,
  NoemaInteractionAdjustment,
  NoemaRootMessage,
  NoemaRootState,
} from './noema-bridge.d.ts';

type ConversationTurn = {
  id: string;
  messages: NoemaRootMessage[];
  latestAttempt: number;
};

type TimelineEntry =
  | { kind: 'turn'; key: string; time: string; turn: ConversationTurn }
  | { kind: 'task'; key: string; time: string; task: NoemaBackgroundTask }
  | { kind: 'context'; key: string; time: string; context: NoemaContextImport }
  | {
      kind: 'adjustment';
      key: string;
      time: string;
      adjustment: NoemaInteractionAdjustment;
    };

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    src ? (
      <a
        className="image-reference"
        href={src}
        target="_blank"
        rel="noreferrer noopener"
      >
        查看图片{alt ? `：${alt}` : '链接'}
      </a>
    ) : null,
  pre: ({ children }) => <pre className="code-block">{children}</pre>,
};

function groupTurns(messages: NoemaRootMessage[]): ConversationTurn[] {
  const groups = new Map<string, ConversationTurn>();
  for (const message of messages) {
    let group = groups.get(message.turnId);
    if (!group) {
      group = { id: message.turnId, messages: [], latestAttempt: 1 };
      groups.set(message.turnId, group);
    }
    group.messages.push(message);
    group.latestAttempt = Math.max(group.latestAttempt, message.attempt);
  }
  return [...groups.values()];
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatCodexTime(value: string | number | null) {
  if (value === null) return '时间未知';
  const milliseconds = typeof value === 'number' ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf())
    ? '时间未知'
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
}

function taskStatusLabel(task: NoemaBackgroundTask) {
  if (task.status === 'starting') return '正在启动';
  if (task.status === 'running') return '后台执行中';
  if (task.status === 'completed') {
    if (task.verificationStatus === 'verified') return 'Noema 核验通过';
    if (task.verificationStatus === 'unavailable') return '无法独立核验';
    return 'Agent 已结束';
  }
  if (task.errorCode === 'verification_failed') return '验收未通过';
  if (task.status === 'interrupted') return '已停止';
  return '执行未完成';
}

function taskPhaseLabel(phase: string) {
  const labels: Record<string, string> = {
    starting: '正在启动 DSH',
    running: '正在处理任务',
    verifying: 'Noema 正在核验文件',
    verification_repairing: 'Noema 正在修复未通过项',
    turn_start: '开始处理',
    step_start: '正在检查工作区',
    tool_call: '正在操作工作区文件',
    tool_result: '已收到文件操作结果',
    completed: '等待 Noema 接回结果',
    failed: '需要检查这次执行',
    interrupted: '进程已停止',
  };
  return labels[phase] ?? '后台处理中';
}

function verificationStatusLabel(task: NoemaBackgroundTask) {
  if (task.verificationStatus === 'verified') return 'Noema 本地核验通过';
  if (task.verificationStatus === 'failed')
    return 'Noema 核验未通过；任务未验收';
  if (task.verificationStatus === 'unavailable')
    return 'Noema 无法安全完成核验；不按已验收处理';
  if (task.verificationStatus === 'pending') return '等待 Noema 独立核验';
  return '未设置独立核验；下方为 DSH Agent 自述';
}

function verificationReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    file_exists: '文件存在',
    text_matches: '目标文本匹配',
    file_missing: '文件不存在',
    text_mismatch: '目标文本不匹配',
    not_a_file: '路径不是普通文件',
    parent_not_directory: '父路径不是目录',
    path_outside_workspace: '路径超出工作区',
    symlink_not_checked: '包含符号链接，未检查',
    file_too_large: '文件超过核验大小上限',
    file_unreadable: '文件无法读取',
    workspace_unavailable: '工作区不可用',
    path_unreadable: '路径无法读取',
  };
  return labels[reason] ?? reason;
}

function shortSessionId(sessionId: string | null) {
  return sessionId ? sessionId.replace(/^session-/, '').slice(0, 8) : '';
}

function App() {
  const [root, setRoot] = useState<NoemaRootState | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const [retryingTurn, setRetryingTurn] = useState<string | null>(null);
  const [retryingWorkerEvent, setRetryingWorkerEvent] = useState<string | null>(
    null,
  );
  const [codexImportOpen, setCodexImportOpen] = useState(false);
  const [codexThreads, setCodexThreads] = useState<NoemaCodexThread[]>([]);
  const [codexPreview, setCodexPreview] = useState<NoemaCodexPreview | null>(
    null,
  );
  const [codexNextCursor, setCodexNextCursor] = useState<string | null>(null);
  const [loadingCodex, setLoadingCodex] = useState(false);
  const [importingCodex, setImportingCodex] = useState(false);
  const [codexError, setCodexError] = useState('');
  const conversationRef = useRef<HTMLDivElement>(null);
  const followConversationRef = useRef(true);
  const codexImportTriggerRef = useRef<HTMLButtonElement>(null);
  const codexImportCloseRef = useRef<HTMLButtonElement>(null);

  const refreshRoot = useCallback(async () => {
    try {
      setRoot(await window.noema.getRootState());
    } catch {
      setNotice('无法读取这台设备上的对话数据。请关闭并重新打开 Noema。');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = window.noema.onRootEvent((event) => {
      if (event.type === 'turn-delta') {
        setRoot((current) => {
          if (!current) return current;
          return {
            ...current,
            messages: current.messages.map((message) =>
              message.turnId === event.turnId &&
              message.role === 'assistant' &&
              message.attempt === event.attempt
                ? {
                    ...message,
                    content: message.content + event.delta,
                    status: 'streaming',
                  }
                : message,
            ),
            activeTurnId: event.turnId,
          };
        });
        return;
      }
      if (event.type === 'turn-started') {
        setRoot((current) =>
          current ? { ...current, activeTurnId: event.turnId } : current,
        );
      }
      void refreshRoot();
    });
    void refreshRoot();
    return unsubscribe;
  }, [refreshRoot]);

  const turns = useMemo(
    () => groupTurns(root?.messages ?? []),
    [root?.messages],
  );
  const workerTasks = root?.workerTasks ?? [];
  const activeWorkerTasks = workerTasks.filter((task) =>
    ['starting', 'running'].includes(task.status),
  );
  const contextImports = root?.contextImports ?? [];
  const interactionAdjustments = root?.interactionAdjustments ?? [];
  const timeline = useMemo<TimelineEntry[]>(() => {
    const turnEntries: TimelineEntry[] = turns.flatMap((turn) => {
      const userMessage = turn.messages.find(
        (message) => message.role === 'user',
      );
      return userMessage
        ? [
            {
              kind: 'turn',
              key: `turn:${turn.id}`,
              time: userMessage.createdAt,
              turn,
            },
          ]
        : [];
    });
    const taskEntries: TimelineEntry[] = workerTasks
      .filter((task) => !['starting', 'running'].includes(task.status))
      .map((task) => ({
        kind: 'task',
        key: `task:${task.id}`,
        time: task.eventCreatedAt ?? task.createdAt,
        task,
      }));
    const contextEntries: TimelineEntry[] = (root?.contextImports ?? []).map(
      (context) => ({
        kind: 'context',
        key: `context:${context.id}`,
        time: context.capturedAt,
        context,
      }),
    );
    const adjustmentEntries: TimelineEntry[] = (
      root?.interactionAdjustments ?? []
    ).map((adjustment) => ({
      kind: 'adjustment',
      key: `adjustment:${adjustment.id}`,
      time: adjustment.createdAt,
      adjustment,
    }));
    return [
      ...turnEntries,
      ...taskEntries,
      ...contextEntries,
      ...adjustmentEntries,
    ].sort((left, right) => left.time.localeCompare(right.time));
  }, [turns, workerTasks, root?.contextImports, interactionAdjustments]);
  const busy = Boolean(root?.activeTurnId);

  useLayoutEffect(() => {
    const node = conversationRef.current;
    if (node && followConversationRef.current)
      node.scrollTop = node.scrollHeight;
  }, [root?.messages, root?.contextImports, interactionAdjustments]);

  useEffect(() => {
    const node = conversationRef.current;
    if (!node) return;
    const preserveLatestTurn = () => {
      if (followConversationRef.current) node.scrollTop = node.scrollHeight;
    };
    window.addEventListener('resize', preserveLatestTurn);
    return () => window.removeEventListener('resize', preserveLatestTurn);
  }, []);

  useEffect(() => {
    if (codexImportOpen) codexImportCloseRef.current?.focus();
  }, [codexImportOpen]);

  const refreshModels = async () => {
    setRefreshing(true);
    setNotice('');
    try {
      await window.noema.refreshModels();
      await refreshRoot();
    } catch {
      setNotice('刷新失败。请检查 FreeLLMAPI 是否正在本机运行。');
    } finally {
      setRefreshing(false);
    }
  };

  const selectModel = async (model: string) => {
    if (!model) return;
    setNotice('');
    try {
      await window.noema.selectModel(model);
      await refreshRoot();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '无法选择这个免费模型。',
      );
      await refreshRoot();
    }
  };

  const openModelSettings = () => {
    setProviderBaseUrl(root?.providerBaseUrl ?? 'http://127.0.0.1:3001/v1');
    setProviderApiKey('');
    setModelSettingsOpen(true);
  };

  const closeModelSettings = () => {
    setProviderApiKey('');
    setModelSettingsOpen(false);
  };

  const saveProviderSettings = async () => {
    if (!providerApiKey.trim() || savingProvider) return;
    setSavingProvider(true);
    setNotice('');
    try {
      await window.noema.configureProvider({
        baseUrl: providerBaseUrl,
        apiKey: providerApiKey,
      });
      await refreshRoot();
      closeModelSettings();
      setNotice('FreeLLMAPI 设置已加密保存。');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'FreeLLMAPI 设置没有保存。',
      );
    } finally {
      setProviderApiKey('');
      setSavingProvider(false);
    }
  };

  const openCodexImport = async () => {
    setCodexImportOpen(true);
    setCodexPreview(null);
    setCodexError('');
    setLoadingCodex(true);
    try {
      const page = await window.noema.listCodexThreads();
      setCodexThreads(page.threads);
      setCodexNextCursor(page.nextCursor);
    } catch (error) {
      setCodexError(
        error instanceof Error ? error.message : '无法读取 Codex 会话列表。',
      );
    } finally {
      setLoadingCodex(false);
    }
  };

  const loadMoreCodexThreads = async () => {
    if (!codexNextCursor || loadingCodex) return;
    setCodexError('');
    setLoadingCodex(true);
    try {
      const page = await window.noema.listCodexThreads(codexNextCursor);
      setCodexThreads((current) => {
        const known = new Set(current.map((thread) => thread.id));
        return [
          ...current,
          ...page.threads.filter((thread) => !known.has(thread.id)),
        ];
      });
      setCodexNextCursor(page.nextCursor);
    } catch (error) {
      setCodexError(
        error instanceof Error ? error.message : '无法读取更早的 Codex 会话。',
      );
    } finally {
      setLoadingCodex(false);
    }
  };

  const closeCodexImport = () => {
    setCodexImportOpen(false);
    requestAnimationFrame(() => codexImportTriggerRef.current?.focus());
  };

  const previewCodexThread = async (threadId: string) => {
    setCodexPreview(null);
    setCodexError('');
    setLoadingCodex(true);
    try {
      setCodexPreview(await window.noema.previewCodexThread(threadId));
    } catch (error) {
      setCodexError(
        error instanceof Error ? error.message : '无法预览所选 Codex 会话。',
      );
    } finally {
      setLoadingCodex(false);
    }
  };

  const importCodexThread = async () => {
    if (!codexPreview || importingCodex || contextImports.length > 0) return;
    setImportingCodex(true);
    setCodexError('');
    try {
      await window.noema.importCodexThread({
        threadId: codexPreview.threadId,
        expectedSourceUpdatedAt: codexPreview.sourceUpdatedAt,
      });
      setCodexImportOpen(false);
      setCodexPreview(null);
      await refreshRoot();
      setNotice('Codex 可见对话已保存在本机；发送给模型前会再次征求同意。');
    } catch (error) {
      setCodexError(
        error instanceof Error ? error.message : 'Codex 快照没有导入。',
      );
      await refreshRoot();
    } finally {
      setImportingCodex(false);
    }
  };

  const removeContextImport = async () => {
    try {
      if (await window.noema.removeContextImport()) {
        await refreshRoot();
        setNotice('已从 Noema 移除 Codex 快照；不会影响 Codex 原会话。');
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '无法移除 Codex 快照。',
      );
    }
  };

  const withdrawInteractionAdjustment = async (id: string) => {
    try {
      if (await window.noema.withdrawInteractionAdjustment(id)) {
        await refreshRoot();
        setNotice('已撤回这条互动调整；之后的请求不再带入。');
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '无法撤回这条互动调整。',
      );
    }
  };

  const sendMessage = async () => {
    const text = draft;
    if (!text.trim() || busy || sending) return;
    followConversationRef.current = true;
    setSending(true);
    setNotice('');
    try {
      const result = await window.noema.sendMessage(text);
      if (result.canceled) {
        setNotice('本次发送已取消；导入内容没有发送给模型。');
        return;
      }
      setDraft('');
      await refreshRoot();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '消息没有发送。请重试。',
      );
      await refreshRoot();
    } finally {
      setSending(false);
    }
  };

  const stopReply = async () => {
    if (!root?.activeTurnId || stopping) return;
    setStopping(true);
    try {
      await window.noema.stopTurn(root.activeTurnId);
      await refreshRoot();
    } catch {
      setNotice('停止请求没有完成。');
    } finally {
      setStopping(false);
    }
  };

  const retryTurn = async (turnId: string) => {
    if (busy || retryingTurn) return;
    setRetryingTurn(turnId);
    setNotice('');
    followConversationRef.current = true;
    try {
      await window.noema.retryTurn(turnId, root?.selectedModel ?? null);
      await refreshRoot();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '重试没有启动。');
      await refreshRoot();
    } finally {
      setRetryingTurn(null);
    }
  };

  const chooseWorkspace = async () => {
    if (!root?.dshAvailable) {
      setNotice(root?.dshWorkerError ?? '当前没有可用的 DSH 后台运行环境。');
      return;
    }
    try {
      const directory = await window.noema.chooseWorkspace();
      if (!directory) return;
      await refreshRoot();
      setNotice('工作区已选定；后台任务只会使用此文件夹。');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '工作区没有设置成功。',
      );
    }
  };

  const clearWorkspace = async () => {
    try {
      await window.noema.clearWorkspace();
      await refreshRoot();
      setNotice('已撤销后台工作区；Noema 不再向 DSH 开放该文件夹。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '工作区没有移除。');
    }
  };

  const stopBackgroundTask = async (taskId: string) => {
    try {
      const stopped = await window.noema.stopBackgroundTask(taskId);
      if (!stopped) {
        setNotice('后台任务已结束或无法停止；请检查任务状态。');
      }
      await refreshRoot();
    } catch {
      setNotice('停止请求没有完成；后台任务可能已产生部分文件改动。');
    }
  };

  const resumeBackgroundTask = async (taskId: string) => {
    try {
      const result = await window.noema.resumeBackgroundTask(taskId);
      if (!result.accepted) {
        setNotice(result.errorMessage ?? '后台任务暂时无法续接。');
      } else {
        setNotice('已在原 DSH 会话中继续；已发生的文件改动不会回滚。');
      }
      await refreshRoot();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '后台任务续接失败。');
      await refreshRoot();
    }
  };

  const retryBackgroundEvent = async (taskId: string) => {
    setRetryingWorkerEvent(taskId);
    try {
      const result = await window.noema.retryBackgroundEvent(taskId);
      if (!result.accepted) {
        setNotice(result.errorMessage ?? '暂时无法重新接回这条结果。');
      } else if (result.completed) {
        setNotice('Noema 已接回这条后台结果。');
      } else {
        setNotice(
          result.errorMessage ??
            '结果仍已保留，但 Noema 暂时没有完成整理；可以稍后重试。',
        );
      }
      await refreshRoot();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : '结果仍已保留，但重新接回失败。',
      );
      await refreshRoot();
    } finally {
      setRetryingWorkerEvent(null);
    }
  };

  const onComposerKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void sendMessage();
    }
  };

  const selectedModelMissing = Boolean(
    root?.selectedModel &&
    !root.models.some((model) => model.name === root.selectedModel),
  );

  return (
    <div className="noema-app">
      <header className="topbar">
        <div className="brand-lockup" aria-label="Noema">
          <span className="brand-name">noema</span>
        </div>

        <div className="topbar-tools">
          <label className="model-control">
            <span>回复模型</span>
            <select
              aria-label="选择免费回复模型"
              value={
                selectedModelMissing
                  ? '__missing__'
                  : (root?.selectedModel ?? '')
              }
              onChange={(event) => void selectModel(event.target.value)}
              disabled={!root || root.models.length === 0}
            >
              {selectedModelMissing && (
                <option value="__missing__">
                  {root?.selectedModel}（当前不可用）
                </option>
              )}
              {!root?.selectedModel && <option value="">选择免费模型</option>}
              {root?.models.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <div
            className={`connection-state ${root?.connected ? (root.models.length ? 'connected' : 'empty-models') : 'disconnected'}`}
          >
            <span className="connection-symbol" aria-hidden="true" />
            <span>
              {!root || root.checking
                ? '正在检查 FreeLLMAPI'
                : root.connected
                  ? root.models.length
                    ? 'FreeLLMAPI 已连接'
                    : '暂无可用免费模型'
                  : 'FreeLLMAPI 未连接'}
            </span>
          </div>
          <button
            className="refresh-button"
            type="button"
            onClick={() => void refreshModels()}
            disabled={refreshing}
          >
            {refreshing ? '正在检查' : '刷新'}
          </button>
          <button
            className="refresh-button provider-settings-button"
            type="button"
            onClick={openModelSettings}
          >
            {root?.providerConfigured ? '模型设置' : '连接模型'}
          </button>
        </div>
      </header>

      <main className="conversation-page">
        <div className="page-heading">
          <div className="heading-copy">
            <h1>主对话</h1>
            <p>
              对话保存在这台设备；发送时由本机 FreeLLMAPI 转发到所选免费模型。
            </p>
          </div>
          <div className="workspace-control">
            <section className="scope-control" aria-label="历史对话导入">
              <span className="scope-control-heading">历史对话</span>
              <button
                ref={codexImportTriggerRef}
                className="workspace-button context-import-button"
                type="button"
                onClick={() => void openCodexImport()}
                disabled={
                  !root?.codexImportAvailable || contextImports.length > 0
                }
                title={
                  contextImports.length > 0
                    ? '先移除当前快照，再选择其他 Codex 会话。'
                    : root?.codexImportAvailable
                      ? '只读读取本机 Codex 的可见文字；不会在 Codex 中续聊。'
                      : '没有找到本机 Codex 桌面程序。'
                }
              >
                {contextImports.length > 0
                  ? '已导入 Codex 快照'
                  : '导入 Codex 对话'}
              </button>
              <span className="scope-control-note">
                只带入可见文字，不会在 Codex 中续聊
              </span>
            </section>
            <section className="scope-control" aria-label="代码任务目录">
              <span className="scope-control-heading">
                代码任务目录（可选）
              </span>
              <div
                className="workspace-label"
                title={root?.workspaceDirectory ?? ''}
              >
                <span className="workspace-mark" aria-hidden="true" />
                <span>
                  {root?.workspaceDirectory
                    ? root.workspaceDirectory
                    : root?.dshWorkerError
                      ? 'DSH 运行环境不可用'
                      : '尚未选择文件夹'}
                </span>
              </div>
              <div className="scope-control-actions">
                <button
                  className="workspace-button"
                  type="button"
                  onClick={() => void chooseWorkspace()}
                  disabled={!root?.dshAvailable || activeWorkerTasks.length > 0}
                  title={root?.dshWorkerError ?? undefined}
                >
                  {activeWorkerTasks.length > 0
                    ? '代码任务运行中'
                    : root?.workspaceDirectory
                      ? '更换文件夹'
                      : '选择文件夹'}
                </button>
                {root?.workspaceDirectory && (
                  <button
                    className="workspace-clear-button"
                    type="button"
                    onClick={() => void clearWorkspace()}
                    disabled={activeWorkerTasks.length > 0}
                  >
                    移除
                  </button>
                )}
              </div>
              <span className="scope-control-note">
                仅供后台 DSH 代码任务读写；普通聊天不需要
              </span>
            </section>
          </div>
        </div>

        {root && !root.connected && !root.checking && (
          <section className="connection-notice" role="status">
            <div>
              <strong>
                {root.providerConfigured
                  ? 'FreeLLMAPI 暂不可用'
                  : '还没有连接 FreeLLMAPI'}
              </strong>
              <p>
                {root.error ??
                  '连接本机 FreeLLMAPI 后，已发送的消息会保留，可恢复后重试。'}
              </p>
            </div>
            <button
              type="button"
              onClick={
                root.providerConfigured
                  ? () => void refreshModels()
                  : openModelSettings
              }
              disabled={refreshing}
            >
              {refreshing
                ? '检查中…'
                : root.providerConfigured
                  ? '重新连接'
                  : '连接设置'}
            </button>
          </section>
        )}
        {root?.connected && !root.checking && root.models.length === 0 && (
          <section className="connection-notice" role="status">
            <div>
              <strong>FreeLLMAPI 暂无可用免费模型</strong>
              <p>
                检查网关中的免费供应商与模型状态后刷新。Noema
                不会回退到本机模型。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshModels()}
              disabled={refreshing}
            >
              {refreshing ? '检查中…' : '刷新列表'}
            </button>
          </section>
        )}

        <div
          className="conversation-scroll"
          ref={conversationRef}
          onScroll={(event) => {
            const node = event.currentTarget;
            followConversationRef.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 140;
          }}
          aria-label="对话记录"
        >
          {timeline.length === 0 ? (
            <div className="empty-conversation">
              <div className="empty-thread" aria-hidden="true">
                <span />
              </div>
              <div className="empty-copy">
                <p className="empty-lead">这条对话还没有消息。</p>
                <p>
                  连接 FreeLLMAPI 并选择免费模型开始。关闭并重开 Noema
                  后，这条对话会保留。
                </p>
              </div>
            </div>
          ) : (
            <div className="turn-list">
              {timeline.map((entry) => {
                if (entry.kind === 'context') {
                  const context = entry.context;
                  return (
                    <article className="turn context-turn" key={entry.key}>
                      <div className="turn-gutter">
                        <time dateTime={context.capturedAt}>
                          {formatTime(entry.time)}
                        </time>
                        <span className="turn-spine" aria-hidden="true">
                          <span />
                        </span>
                      </div>
                      <div className="turn-body">
                        <section
                          className="context-card"
                          aria-label="导入的 Codex 会话上下文"
                        >
                          <div className="context-card-heading">
                            <div>
                              <strong>Codex 会话快照</strong>
                              <span>{context.title}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void removeContextImport()}
                            >
                              从 Noema 移除
                            </button>
                          </div>
                          <p
                            className="context-card-origin"
                            title={context.workingDirectory ?? ''}
                          >
                            {context.workingDirectory ?? '未记录工作目录'} ·{' '}
                            {context.messageCount} 条可见消息 ·{' '}
                            {context.characterCount.toLocaleString()} 字
                          </p>
                          {(context.omittedItems > 0 ||
                            context.omittedTurns > 0 ||
                            context.omittedMessages > 0 ||
                            context.hasMoreTurns) && (
                            <p className="context-card-omissions">
                              {context.hasMoreTurns &&
                                '只导入最近 40 个轮次，更早轮次未带入。 '}
                              有内容未带入：{context.omittedItems}{' '}
                              项工具/非文字记录、
                              {context.omittedTurns} 个进行中轮次、 较早历史中的{' '}
                              {context.omittedMessages} 条可见消息。
                            </p>
                          )}
                          <details className="context-preview-details">
                            <summary>查看实际导入的可见文字</summary>
                            <div className="context-preview-messages">
                              {context.messages.map((message, index) => (
                                <div
                                  className="context-preview-message"
                                  key={`${context.sourceThreadId}:${index}`}
                                >
                                  <span>
                                    {message.role === 'user'
                                      ? 'Codex 用户消息'
                                      : 'Codex 回复'}
                                  </span>
                                  <p>{message.content}</p>
                                </div>
                              ))}
                            </div>
                          </details>
                          <p
                            className={
                              context.consentedAt
                                ? 'context-transmission is-active'
                                : 'context-transmission'
                            }
                          >
                            {context.consentedAt
                              ? '已授权：这份快照会随 Noema 后续对话发送到 FreeLLMAPI，直到移除。'
                              : '仅保存在本机；下次发送时会先说明数据去向并征求同意。'}
                          </p>
                          <div className="context-card-footnote">
                            这是只读文字快照，不是完整 Codex 会话副本；Codex
                            中的工具状态与执行记录仍留在原应用，源会话后续变化也不会自动同步。
                          </div>
                        </section>
                      </div>
                    </article>
                  );
                }
                if (entry.kind === 'adjustment') {
                  const adjustment = entry.adjustment;
                  const scopeLabel =
                    adjustment.scope === 'conversation'
                      ? 'Noema 对话'
                      : adjustment.scope === 'coding'
                        ? '后台编码任务'
                        : 'Noema 对话与后台编码任务';
                  return (
                    <article className="turn adjustment-turn" key={entry.key}>
                      <div className="turn-gutter">
                        <time dateTime={adjustment.createdAt}>
                          {formatTime(entry.time)}
                        </time>
                        <span className="turn-spine" aria-hidden="true">
                          <span />
                        </span>
                      </div>
                      <div className="turn-body">
                        <section
                          className={`adjustment-event${adjustment.status === 'withdrawn' ? ' is-withdrawn' : ''}`}
                          aria-label="Noema 互动调整"
                        >
                          <div className="adjustment-heading">
                            <strong>
                              {adjustment.status === 'active'
                                ? '互动调整已记录'
                                : '互动调整已撤回'}
                            </strong>
                            {adjustment.status === 'active' && (
                              <button
                                type="button"
                                onClick={() =>
                                  void withdrawInteractionAdjustment(
                                    adjustment.id,
                                  )
                                }
                                aria-label={`撤回互动调整：${adjustment.situation}`}
                              >
                                撤回后续使用
                              </button>
                            )}
                          </div>
                          <p className="adjustment-change">
                            <span>适用：{scopeLabel}</span>
                            <span>{adjustment.situation}</span>
                            <span>期望做法：{adjustment.behavior}</span>
                          </p>
                          <details className="adjustment-source">
                            <summary>查看来源与数据范围</summary>
                            <blockquote>{adjustment.sourceQuote}</blockquote>
                            <p>
                              {adjustment.status === 'active'
                                ? '后续匹配情境时，这条记录会作为参考随请求发送到当前免费模型路由；这不保证模型每次都遵循。撤回只影响之后的请求，不能撤回已发送内容或 DSH 原生任务记录。'
                                : '撤回后，这条记录不会进入新的模型请求；原始对话仍保存在本机。'}
                            </p>
                          </details>
                        </section>
                      </div>
                    </article>
                  );
                }
                if (entry.kind === 'task') {
                  const task = entry.task;
                  const taskAdjustments = task.interactionAdjustmentIds
                    .map((id) =>
                      root?.interactionAdjustments.find(
                        (adjustment) => adjustment.id === id,
                      ),
                    )
                    .filter((item) => item !== undefined);
                  return (
                    <article className="turn worker-turn" key={entry.key}>
                      <div className="turn-gutter">
                        <time>{formatTime(entry.time)}</time>
                        <span className="turn-spine" aria-hidden="true">
                          <span />
                        </span>
                      </div>
                      <div className="turn-body">
                        <section
                          className={`worker-card worker-${task.status}`}
                          aria-label="后台任务返回事件"
                        >
                          <div className="worker-card-heading">
                            <div className="worker-title-group">
                              <strong>后台任务</strong>
                              <span>DSH · {task.model}</span>
                            </div>
                            <span
                              className={`worker-status status-${task.status}`}
                            >
                              {taskStatusLabel(task)}
                            </span>
                          </div>
                          <p className="worker-task-prompt">{task.prompt}</p>
                          <section
                            className={`worker-verification worker-verification-${task.verificationStatus}`}
                            aria-label="Noema 任务验收状态"
                            role={
                              ['failed', 'unavailable'].includes(
                                task.verificationStatus,
                              )
                                ? 'status'
                                : undefined
                            }
                          >
                            <strong>{verificationStatusLabel(task)}</strong>
                            {task.verificationChecks.length > 0 && (
                              <details>
                                <summary>
                                  查看 Noema 核验标准与结果（
                                  {task.verificationChecks.length} 项）
                                </summary>
                                <ul>
                                  {task.verificationChecks.map(
                                    (check, index) => {
                                      const result =
                                        task.verificationResults[index];
                                      const expected =
                                        check.kind === 'file_exists'
                                          ? '文件存在'
                                          : check.kind === 'file_equals'
                                            ? `文件内容等于「${check.text}」`
                                            : `文件包含「${check.text}」`;
                                      return (
                                        <li
                                          key={`${check.path}:${index}`}
                                          className={`verification-result verification-${result?.status ?? 'pending'}`}
                                        >
                                          <code>{check.path}</code> · {expected}
                                          {result && (
                                            <span>
                                              {' '}
                                              —{' '}
                                              {verificationReasonLabel(
                                                result.reason,
                                              )}
                                            </span>
                                          )}
                                        </li>
                                      );
                                    },
                                  )}
                                </ul>
                              </details>
                            )}
                          </section>
                          {task.interactionAdjustmentIds.length > 0 && (
                            <details className="adjustment-application-trace">
                              <summary>
                                本任务关联了{' '}
                                {task.interactionAdjustmentIds.length}{' '}
                                条互动纠正
                              </summary>
                              {taskAdjustments.length > 0 ? (
                                <ul>
                                  {taskAdjustments.map((adjustment) => (
                                    <li key={adjustment.id}>
                                      <strong>{adjustment.situation}</strong>
                                      <span>
                                        期望做法：{adjustment.behavior}
                                      </span>
                                      <blockquote>
                                        {adjustment.sourceQuote}
                                      </blockquote>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p>
                                  纠正记录已撤回或清理，当前无法显示其原文。
                                </p>
                              )}
                              <p className="adjustment-application-caveat">
                                这是 Noema
                                记录的会话关联，不证明模型成功接收或遵循。下方核验仅检查列出的任务条件；通过或失败都不能单独证明纠正造成了结果。
                              </p>
                            </details>
                          )}
                          <div className="worker-metadata">
                            <span title={task.workspacePath}>
                              工作区 · {task.workspacePath}
                            </span>
                            {task.sessionId && (
                              <span>
                                会话 · {shortSessionId(task.sessionId)}
                              </span>
                            )}
                            <span>文件操作 · {task.toolCallCount}</span>
                          </div>
                          {(task.resultText || task.errorMessage) && (
                            <details className="worker-output-details">
                              <summary>
                                {task.errorMessage
                                  ? '执行信息'
                                  : '查看 DSH Agent 报告'}
                              </summary>
                              <div className="worker-output">
                                {task.resultText || task.errorMessage}
                              </div>
                            </details>
                          )}
                          {task.status !== 'completed' &&
                            (task.status === 'interrupted' ||
                              task.toolCallCount > 0) && (
                              <p className="worker-side-effect-note">
                                任务未完整结束；停止前已发生的文件改动不会自动回滚。
                              </p>
                            )}
                          {task.noemaResponseStatus === 'streaming' && (
                            <p
                              className="worker-response-pending"
                              role="status"
                            >
                              Noema 正在接回这条系统事件…
                            </p>
                          )}
                          {task.noemaResponse && (
                            <div className="worker-noema-response">
                              <span>Noema 接回结果</span>
                              <p>{task.noemaResponse}</p>
                            </div>
                          )}
                          {task.noemaResponseError && (
                            <div className="worker-response-recovery">
                              <p
                                className="worker-response-error"
                                role="status"
                              >
                                {task.noemaResponseError}
                              </p>
                              {task.eventStatus === 'pending' &&
                                ['failed', 'interrupted'].includes(
                                  task.noemaResponseStatus,
                                ) && (
                                  <button
                                    className="worker-event-retry-button"
                                    type="button"
                                    onClick={() =>
                                      void retryBackgroundEvent(task.id)
                                    }
                                    disabled={
                                      busy || retryingWorkerEvent === task.id
                                    }
                                    title="只重新整理已保存的结果，不会重启 DSH 或重复文件操作。"
                                  >
                                    {retryingWorkerEvent === task.id
                                      ? '正在重试结果…'
                                      : '重试结果接回'}
                                  </button>
                                )}
                            </div>
                          )}
                          {['failed', 'interrupted'].includes(task.status) &&
                            task.sessionId && (
                              <button
                                className="worker-resume-button"
                                type="button"
                                onClick={() =>
                                  void resumeBackgroundTask(task.id)
                                }
                                disabled={busy || activeWorkerTasks.length > 0}
                              >
                                在原 DSH 会话中继续
                              </button>
                            )}
                          <div className="worker-return-caption">
                            结果作为后台系统事件返回；不是用户消息，也不是 DSH
                            完整会话副本。
                          </div>
                        </section>
                      </div>
                    </article>
                  );
                }
                const turn = entry.turn;
                const userMessage = turn.messages.find(
                  (message) => message.role === 'user',
                );
                const assistantMessages = turn.messages.filter(
                  (message) => message.role === 'assistant',
                );
                const currentAssistant = assistantMessages.find(
                  (message) => message.attempt === turn.latestAttempt,
                );
                const contextAdjustments = (
                  currentAssistant?.interactionAdjustmentIds ?? []
                )
                  .map((id) =>
                    root?.interactionAdjustments.find(
                      (adjustment) => adjustment.id === id,
                    ),
                  )
                  .filter((item) => item !== undefined);
                if (!userMessage) return null;
                return (
                  <article className="turn" key={entry.key}>
                    <div className="turn-gutter">
                      <time dateTime={userMessage.createdAt}>
                        {formatTime(userMessage.createdAt)}
                      </time>
                      <span className="turn-spine" aria-hidden="true">
                        <span />
                      </span>
                    </div>
                    <div className="turn-body">
                      <div className="user-entry">
                        <div className="entry-byline">
                          <span>你</span>
                        </div>
                        <div className="user-copy">{userMessage.content}</div>
                      </div>
                      {userMessage.contextOmittedTurns > 0 && (
                        <div className="context-coverage" role="note">
                          本轮带入最近 {userMessage.contextTurns} 轮；更早的{' '}
                          {userMessage.contextOmittedTurns}{' '}
                          轮仍保存在本机，但没有发送给模型。
                        </div>
                      )}
                      {assistantMessages.map((message) => {
                        const isLatestAttempt =
                          message.attempt === turn.latestAttempt;
                        const isStreaming = message.status === 'streaming';
                        return (
                          <section
                            className={`assistant-entry${isStreaming ? ' is-streaming' : ''}`}
                            key={message.id}
                            aria-busy={isStreaming}
                          >
                            <div className="entry-byline assistant-byline">
                              <strong>Noema</strong>
                              {message.model && (
                                <span className="message-model">
                                  {message.model}
                                </span>
                              )}
                              {message.attempt > 1 && (
                                <span className="attempt-label">
                                  重试 {message.attempt}
                                </span>
                              )}
                              {isLatestAttempt &&
                                message.interactionAdjustmentIds.length > 0 && (
                                  <details className="adjustment-application-trace root-adjustment-trace">
                                    <summary>
                                      本轮上下文列出{' '}
                                      {message.interactionAdjustmentIds.length}{' '}
                                      条互动纠正
                                    </summary>
                                    {contextAdjustments.length > 0 ? (
                                      <ul>
                                        {contextAdjustments.map(
                                          (adjustment) => (
                                            <li key={adjustment.id}>
                                              <strong>
                                                {adjustment.situation}
                                              </strong>
                                              <span>
                                                期望做法：{adjustment.behavior}
                                              </span>
                                              <blockquote>
                                                {adjustment.sourceQuote}
                                              </blockquote>
                                            </li>
                                          ),
                                        )}
                                      </ul>
                                    ) : (
                                      <p>
                                        纠正记录已撤回或清理，当前无法显示其原文。
                                      </p>
                                    )}
                                    <p className="adjustment-application-caveat">
                                      这只证明 Noema
                                      组装的请求包含这些纠正；不证明上游成功接收或模型遵循。
                                    </p>
                                  </details>
                                )}
                              <time>{formatTime(message.createdAt)}</time>
                            </div>
                            {message.content ? (
                              <div className="markdown-body">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={markdownComponents}
                                >
                                  {message.content}
                                </ReactMarkdown>
                                {isStreaming && (
                                  <span
                                    className="stream-caret"
                                    aria-hidden="true"
                                  />
                                )}
                              </div>
                            ) : isStreaming ? (
                              <p className="reply-waiting">
                                正在等待免费模型的第一段回复…
                              </p>
                            ) : null}
                            {message.status === 'interrupted' && (
                              <div className="attempt-note">
                                <span>
                                  {isLatestAttempt
                                    ? '本轮已停止，部分内容仍保留。'
                                    : '上一次回复已停止，部分内容仍保留。'}
                                </span>
                                {isLatestAttempt && (
                                  <button
                                    type="button"
                                    onClick={() => void retryTurn(turn.id)}
                                    disabled={busy || retryingTurn === turn.id}
                                  >
                                    {retryingTurn === turn.id
                                      ? '正在生成…'
                                      : '重新生成'}
                                  </button>
                                )}
                              </div>
                            )}
                            {message.status === 'failed' && (
                              <div
                                className="attempt-note failed-note"
                                role={isLatestAttempt ? 'alert' : undefined}
                              >
                                <span>
                                  {isLatestAttempt
                                    ? (message.errorMessage ?? '本轮没有完成。')
                                    : '上一次回复没有完成，部分内容仍保留。'}
                                </span>
                                {isLatestAttempt && (
                                  <button
                                    type="button"
                                    onClick={() => void retryTurn(turn.id)}
                                    disabled={busy || retryingTurn === turn.id}
                                  >
                                    {retryingTurn === turn.id
                                      ? '正在重试…'
                                      : '重新尝试免费模型'}
                                  </button>
                                )}
                              </div>
                            )}
                          </section>
                        );
                      })}
                      {busy &&
                        root?.activeTurnId === turn.id &&
                        !currentAssistant && (
                          <p className="reply-waiting" role="status">
                            正在等待免费模型…
                          </p>
                        )}
                    </div>
                  </article>
                );
              })}
              <div className="scroll-anchor" />
            </div>
          )}
        </div>

        {activeWorkerTasks.length > 0 && (
          <section className="worker-dock" aria-label="正在进行的后台任务">
            {activeWorkerTasks.map((task) => (
              <div className="worker-active-row" key={task.id}>
                <span className="worker-activity-pulse" aria-hidden="true" />
                <div className="worker-active-copy">
                  <div className="worker-active-heading">
                    <strong>{taskPhaseLabel(task.phase)}</strong>
                    <span>DSH · {task.toolCallCount} 次文件操作</span>
                  </div>
                  <p>{task.prompt}</p>
                  <small title={task.workspacePath}>{task.workspacePath}</small>
                </div>
                <button
                  className="worker-stop-button"
                  type="button"
                  onClick={() => void stopBackgroundTask(task.id)}
                >
                  停止任务
                </button>
              </div>
            ))}
          </section>
        )}

        <div className="composer-dock">
          <form
            className={`composer${busy ? ' composer-busy' : ''}`}
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage();
            }}
          >
            <label className="sr-only" htmlFor="message-input">
              发送消息给 Noema
            </label>
            <textarea
              id="message-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="接着说你正在想的事…"
              rows={2}
              maxLength={100_000}
              autoComplete="off"
              spellCheck
            />
            <div className="composer-footer">
              <span className="composer-hint">
                {busy
                  ? 'Noema 正在回复。可以停止后继续输入。'
                  : 'Ctrl + Enter 发送 · Enter 换行'}
              </span>
              {busy ? (
                <button
                  className="stop-button"
                  type="button"
                  onClick={() => void stopReply()}
                  disabled={stopping}
                >
                  {stopping ? '正在停止…' : '停止回复'}
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  disabled={!draft.trim() || sending}
                >
                  {sending ? '发送中…' : '发送'}
                </button>
              )}
            </div>
          </form>
          <div className="composer-disclosure">
            <span>本地保存</span>
            <span aria-hidden="true">·</span>
            <span>
              对话经 FreeLLMAPI 发送给所选免费模型；每轮最多带入最近 8 轮
            </span>
            {root?.workspaceDirectory && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  后台任务及读取文件会发送到第三方免费模型链；免费不代表私密
                </span>
              </>
            )}
          </div>
        </div>
      </main>

      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice('')}
            aria-label="关闭提示"
          >
            关闭
          </button>
        </div>
      )}

      {codexImportOpen && (
        <div className="modal-scrim codex-import-scrim" role="presentation">
          <section
            className="codex-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="codex-import-title"
            aria-describedby="codex-import-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                closeCodexImport();
                return;
              }
              if (event.key !== 'Tab') return;
              const focusable = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  'button:not(:disabled)',
                ),
              );
              if (focusable.length === 0) return;
              const first = focusable[0];
              const last = focusable.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="settings-heading">
              <div>
                <p className="settings-eyebrow">只读 · 本机 Codex</p>
                <h2 id="codex-import-title">导入 Codex 对话快照</h2>
              </div>
              <button
                ref={codexImportCloseRef}
                className="modal-close"
                type="button"
                onClick={closeCodexImport}
                aria-label="关闭 Codex 会话导入"
              >
                ×
              </button>
            </div>
            <p className="settings-description" id="codex-import-description">
              选择一条 Codex 会话，先检查将要带入的文字，再决定是否导入。
              这不会在 Codex
              中继续对话，也不会同步之后的变化。列表、读取和预览只访问本机数据，不会调用模型。
            </p>
            {contextImports.length > 0 && (
              <div className="codex-import-warning" role="status">
                当前已有一份快照。移除它后才能导入新的 Codex 会话。
              </div>
            )}
            {codexError && (
              <div className="codex-import-error" role="alert">
                {codexError}
              </div>
            )}
            <div className="codex-import-columns">
              <div
                className="codex-thread-list"
                aria-label="本机 Codex 会话列表"
              >
                {loadingCodex && (
                  <p className="codex-empty-state">正在只读读取会话…</p>
                )}
                {!loadingCodex && codexThreads.length === 0 && !codexError && (
                  <p className="codex-empty-state">
                    没有找到可导入的 Codex 会话。
                  </p>
                )}
                {codexThreads.map((thread) => (
                  <button
                    className={`codex-thread-option${codexPreview?.threadId === thread.id ? ' is-selected' : ''}`}
                    key={thread.id}
                    type="button"
                    aria-pressed={codexPreview?.threadId === thread.id}
                    onClick={() => void previewCodexThread(thread.id)}
                    disabled={loadingCodex}
                  >
                    <strong>{thread.title}</strong>
                    <span>{thread.cwd ?? '未记录工作目录'}</span>
                    <small>{formatCodexTime(thread.updatedAt)}</small>
                  </button>
                ))}
                {codexNextCursor && (
                  <button
                    className="codex-load-more"
                    type="button"
                    onClick={() => void loadMoreCodexThreads()}
                    disabled={loadingCodex}
                  >
                    {loadingCodex ? '正在读取…' : '加载更早的会话'}
                  </button>
                )}
              </div>
              <div className="codex-thread-preview">
                {!codexPreview && (
                  <p className="codex-empty-state">
                    选中左侧会话，查看将会带入的内容。
                  </p>
                )}
                {loadingCodex && codexPreview && (
                  <p className="codex-empty-state">正在重新读取预览…</p>
                )}
                {codexPreview && !loadingCodex && (
                  <>
                    <div className="codex-preview-heading">
                      <strong>{codexPreview.title}</strong>
                      <span>
                        {codexPreview.messages.length} 条消息 ·{' '}
                        {codexPreview.characterCount.toLocaleString()} 字
                      </span>
                    </div>
                    {codexPreview.hasMoreTurns && (
                      <p className="codex-preview-truncation">
                        只显示最近 40 个轮次；更早历史不会导入。
                      </p>
                    )}
                    {(codexPreview.omittedItems > 0 ||
                      codexPreview.omittedTurns > 0 ||
                      codexPreview.omittedMessages > 0) && (
                      <p className="codex-preview-truncation">
                        未导入 {codexPreview.omittedItems} 项工具/非文字记录、
                        {codexPreview.omittedTurns} 个进行中轮次、 较早历史中的{' '}
                        {codexPreview.omittedMessages} 条可见消息。
                      </p>
                    )}
                    <div className="codex-preview-scroll">
                      {codexPreview.messages.map((message, index) => (
                        <article
                          className="codex-preview-message"
                          key={`${codexPreview.threadId}:${index}`}
                        >
                          <span>
                            {message.role === 'user' ? '用户' : 'Codex'}
                          </span>
                          <p>{message.content}</p>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="codex-import-disclosure">
              导入只保存本机快照；不复制 reasoning、工具调用、文件内容或 Codex
              session
              状态，不会自动同步源会话后续变化，也不修改源会话。今后发送给 Noema
              时会先征求同意，再经 FreeLLMAPI 当前免费路由发送所选文字。
            </div>
            <div className="settings-actions">
              <button
                className="settings-cancel"
                type="button"
                onClick={closeCodexImport}
              >
                取消
              </button>
              <button
                className="settings-save"
                type="button"
                onClick={() => void importCodexThread()}
                disabled={
                  !codexPreview ||
                  loadingCodex ||
                  importingCodex ||
                  contextImports.length > 0
                }
              >
                {importingCodex ? '正在校验并保存…' : '导入这份快照'}
              </button>
            </div>
          </section>
        </div>
      )}

      {modelSettingsOpen && (
        <div className="modal-scrim" role="presentation">
          <section
            className="model-settings"
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-settings-title"
            aria-describedby="model-settings-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeModelSettings();
            }}
          >
            <div className="settings-heading">
              <div>
                <p className="settings-eyebrow">模型连接</p>
                <h2 id="model-settings-title">连接 FreeLLMAPI</h2>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={closeModelSettings}
                aria-label="关闭模型设置"
              >
                ×
              </button>
            </div>
            <p className="settings-description" id="model-settings-description">
              Noema 通过本机 FreeLLMAPI 使用免费模型。API Key
              只保存在这台设备，并由系统安全存储加密；不会发送到所选模型。
            </p>
            <label className="settings-field">
              <span>FreeLLMAPI 地址</span>
              <input
                type="url"
                value={providerBaseUrl}
                onChange={(event) => setProviderBaseUrl(event.target.value)}
                autoComplete="url"
                spellCheck={false}
                placeholder="http://127.0.0.1:3001/v1"
              />
            </label>
            <label className="settings-field">
              <span>统一 API Key</span>
              <input
                type="password"
                autoFocus
                value={providerApiKey}
                onChange={(event) => setProviderApiKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveProviderSettings();
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder="从 FreeLLMAPI 的 Keys 页面或托盘菜单复制"
              />
            </label>
            <p className="settings-footnote">
              仅接受本机地址。当前只列出 Noema
              已确认的免费路由，不会自动切换到本地模型或付费模型。
            </p>
            <div className="settings-actions">
              <button
                className="settings-cancel"
                type="button"
                onClick={closeModelSettings}
              >
                取消
              </button>
              <button
                className="settings-save"
                type="button"
                onClick={() => void saveProviderSettings()}
                disabled={!providerApiKey.trim() || savingProvider}
              >
                {savingProvider ? '连接中…' : '加密保存并连接'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
