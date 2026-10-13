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
import type { NoemaRootMessage, NoemaRootState } from './noema-bridge.d.ts';

type ConversationTurn = {
  id: string;
  messages: NoemaRootMessage[];
  latestAttempt: number;
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

function App() {
  const [root, setRoot] = useState<NoemaRootState | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
      setNotice('刷新失败。请检查 Ollama 是否在本机运行。');
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
        error instanceof Error ? error.message : '无法选择这个本机模型。',
      );
      await refreshRoot();
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
              aria-label="选择本机回复模型"
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
                  {root?.selectedModel}（本机未找到）
                </option>
              )}
              {!root?.selectedModel && <option value="">选择已安装模型</option>}
              {root?.models.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.name}
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
                ? '正在检查本机服务'
                : root.connected
                  ? root.models.length
                    ? 'Ollama 已连接'
                    : 'Ollama 暂无模型'
                  : 'Ollama 未连接'}
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
        </div>
      </header>

      <main className="conversation-page">
        <div className="page-heading">
          <div className="heading-copy">
            <h1>主对话</h1>
            <p>消息保存在这台设备。回复由所选本机模型生成。</p>
          </div>
        </div>

        {root && !root.connected && !root.checking && (
          <section className="connection-notice" role="status">
            <div>
              <strong>本机模型服务暂不可用</strong>
              <p>
                {root.error ??
                  '请启动 Ollama 后刷新模型列表。已发送的消息会保留，可恢复后重试。'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshModels()}
              disabled={refreshing}
            >
              {refreshing ? '检查中…' : '重新连接'}
            </button>
          </section>
        )}
        {root?.connected && !root.checking && root.models.length === 0 && (
          <section className="connection-notice" role="status">
            <div>
              <strong>Ollama 正在运行，但没有发现模型</strong>
              <p>安装一个本机模型后刷新列表。Noema 不会自动改用云端服务。</p>
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
                  选择一个本机模型开始。关闭并重开 Noema 后，这条对话会保留。
                </p>
              </div>
            </div>
          ) : (
            <div className="turn-list">
              {turns.map((turn) => {
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
                  <article className="turn" key={turn.id}>
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
                                正在等待本机模型的第一段回复…
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
                                      : '重试本机模型'}
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
                            正在等待本机模型…
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
            <span>本机运行</span>
            <span aria-hidden="true">·</span>
            <span>
              请求仅发送到已选择的 Ollama 模型；每轮最多带入最近 8 轮对话
            </span>
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
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
