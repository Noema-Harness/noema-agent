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
  | { kind: 'task'; key: string; time: string; task: NoemaBackgroundTask };

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

function taskStatusLabel(task: NoemaBackgroundTask) {
  if (task.status === 'starting') return '正在启动';
  if (task.status === 'running') return '后台执行中';
  if (task.status === 'completed') return '执行完成';
  if (task.status === 'interrupted') return '已停止';
  return '执行未完成';
}

function taskPhaseLabel(phase: string) {
  const labels: Record<string, string> = {
    starting: '正在启动 DSH',
    running: '正在处理任务',
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
  const conversationRef = useRef<HTMLDivElement>(null);
  const followConversationRef = useRef(true);

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
    return [...turnEntries, ...taskEntries].sort((left, right) =>
      left.time.localeCompare(right.time),
    );
  }, [turns, workerTasks]);
  const busy = Boolean(root?.activeTurnId);

  useLayoutEffect(() => {
    const node = conversationRef.current;
    if (node && followConversationRef.current)
      node.scrollTop = node.scrollHeight;
  }, [root?.messages]);

  useEffect(() => {
    const node = conversationRef.current;
    if (!node) return;
    const preserveLatestTurn = () => {
      if (followConversationRef.current) node.scrollTop = node.scrollHeight;
    };
    window.addEventListener('resize', preserveLatestTurn);
    return () => window.removeEventListener('resize', preserveLatestTurn);
  }, []);

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

  const sendMessage = async () => {
    const text = draft;
    if (!text.trim() || busy || sending) return;
    followConversationRef.current = true;
    setSending(true);
    setNotice('');
    try {
      await window.noema.sendMessage(text);
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
            <div
              className="workspace-label"
              title={root?.workspaceDirectory ?? ''}
            >
              <span className="workspace-mark" aria-hidden="true" />
              <span>
                {root?.workspaceDirectory
                  ? root.workspaceDirectory
                  : root?.dshWorkerError
                    ? 'DSH 后台运行环境不可用'
                    : '未选择后台工作区'}
              </span>
            </div>
            <button
              className="workspace-button"
              type="button"
              onClick={() => void chooseWorkspace()}
              disabled={!root?.dshAvailable || activeWorkerTasks.length > 0}
              title={root?.dshWorkerError ?? undefined}
            >
              {activeWorkerTasks.length > 0
                ? '任务运行中'
                : root?.workspaceDirectory
                  ? '更换工作区'
                  : '选择工作区'}
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
          {turns.length === 0 ? (
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
                if (entry.kind === 'task') {
                  const task = entry.task;
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
                                  : '查看执行结果'}
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
                            <p className="worker-response-error" role="status">
                              {task.noemaResponseError}
                            </p>
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
