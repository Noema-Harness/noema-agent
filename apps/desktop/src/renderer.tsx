import type { NoemaBridge } from './noema-bridge.d.ts';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Route = 'model' | 'harness';
type Phase = 'ready' | 'running' | 'returned' | 'failed' | 'paused';
type Destination = 'DSH' | 'Claude Code';

function Icon({
  name,
  size = 17,
}: {
  name:
    | 'chat'
    | 'branch'
    | 'settings'
    | 'arrow'
    | 'check'
    | 'clock'
    | 'edit'
    | 'close'
    | 'file'
    | 'terminal'
    | 'swap'
    | 'refresh'
    | 'send';
  size?: number;
}) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  switch (name) {
    case 'chat':
      return (
        <svg {...props}>
          <path d="M20 11.2a7.2 7.2 0 0 1-7.5 7.2H7l-3.5 2 .8-4A7.2 7.2 0 1 1 20 11.2Z" />
          <path d="M8 11.3h.01M12 11.3h.01M16 11.3h.01" />
        </svg>
      );
    case 'branch':
      return (
        <svg {...props}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M8 6h3a4 4 0 0 1 4 4v4a4 4 0 0 0 3 4M6 8v10" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path
            d="m19.4 15 .1.1 1.1.9-1.4 2.4-1.4-.5a7.8 7.8 0 0 1-1.4.8l-.2 1.5h-2.8l-.2-1.5a7.8 7.8 0 0 1-1.4-.8l-1.4.5-1.4-2.4 1.1-.9a7 7 0 0 1 0-1.6l-1.1-.9 1.4-2.4 1.4.5a7.8 7.8 0 0 1 1.4-.8l.2-1.5h2.8l.2 1.5a7.8 7.8 0 0 1 1.4.8l1.4-.5 1.4 2.4-1.1.9a7 7 0 0 1-.1 1.5Z"
            transform="translate(-1 -1) scale(1.08)"
          />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...props}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case 'check':
      return (
        <svg {...props}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...props}>
          <path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" />
        </svg>
      );
    case 'close':
      return (
        <svg {...props}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case 'file':
      return (
        <svg {...props}>
          <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z" />
          <path d="M13 3v7h7M8 14h8M8 18h8" />
        </svg>
      );
    case 'terminal':
      return (
        <svg {...props}>
          <path d="m4 6 6 6-6 6M13 18h7" />
        </svg>
      );
    case 'swap':
      return (
        <svg {...props}>
          <path d="M16 3l4 4-4 4M4 7h16M8 21l-4-4 4-4M20 17H4" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...props}>
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M5.6 9A7 7 0 0 1 18 6l2 1M4 17l2-1a7 7 0 0 0 12.4-3" />
        </svg>
      );
    case 'send':
      return (
        <svg {...props}>
          <path d="m21 3-7.2 18-3.4-7.4L3 10.2 21 3Z" />
          <path d="M10.4 13.6 15 9" />
        </svg>
      );
  }
}

function App() {
  const bridge: NoemaBridge = window.noema ?? { appVersion: '0.1.0' };
  const [route, setRoute] = useState<Route>('harness');
  const [destination, setDestination] = useState<Destination>('DSH');
  const [model, setModel] = useState('DeepSeek Chat');
  const [phase, setPhase] = useState<Phase>('ready');
  const [includeDecisions, setIncludeDecisions] = useState(true);
  const [includeWorkspace, setIncludeWorkspace] = useState(true);
  const [goal, setGoal] = useState(
    '继续定位村庄商品生产的性能开销；不要启动游戏，不改启动器设置。',
  );
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [lastMessage, setLastMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [narrowOpen, setNarrowOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(
    () => window.matchMedia('(max-width: 880px)').matches,
  );
  const handoffPaneRef = useRef<HTMLElement>(null);
  const closePaneRef = useRef<HTMLButtonElement>(null);
  const paneTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 880px)');
    const update = () => setIsNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (isNarrow && narrowOpen) {
      paneTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      closePaneRef.current?.focus();
      function keepFocusInPane(event: KeyboardEvent) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setNarrowOpen(false);
          return;
        }
        if (event.key !== 'Tab' || !handoffPaneRef.current) return;
        const focusable = Array.from(
          handoffPaneRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      document.addEventListener('keydown', keepFocusInPane);
      return () => document.removeEventListener('keydown', keepFocusInPane);
    }
    if (isNarrow && !narrowOpen && paneTriggerRef.current?.isConnected) {
      paneTriggerRef.current.focus();
      paneTriggerRef.current = null;
    }
  }, [isNarrow, narrowOpen]);

  function chooseRoute(next: Route) {
    if (phase === 'running') return;
    setRoute(next);
    setPhase('ready');
    if (next === 'model') setNarrowOpen(true);
  }

  function beginHandoff() {
    if (route === 'model') {
      setPhase('returned');
      setNotice(
        '已切换对话模型。演示中保留当前可见对话；模型能力与工具权限会随目标端变化。',
      );
      return;
    }
    setPhase('running');
    setNotice(`已创建发往 ${destination} 的演示交接。尚未连接真实 harness。`);
  }

  function simulateReturn() {
    setPhase('returned');
    setNotice(
      `${destination} 的演示结果已回到 Noema 主线；原生执行日志仍归目标 harness。`,
    );
  }

  function simulateFailure() {
    setPhase('failed');
    setNotice(
      `无法连接 ${destination}（模拟失败）。交接内容仍保留，可重试或更换目标。`,
    );
  }

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim()) return;
    setLastMessage(input.trim());
    setInput('');
    setNotice('静态原型：消息未发送到模型。');
  }

  return (
    <div className="desktop">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <svg viewBox="0 0 34 34" aria-hidden="true">
              <path d="M9 24V10l16 14V10" />
              <circle cx="17" cy="17" r="15" />
            </svg>
          </div>
          <span>Noema</span>
        </div>
        <button className="new-thread">
          <span>＋</span> 开始一条新主线
        </button>
        <div className="side-section-label">
          最近主线 <button aria-label="更多主线">•••</button>
        </div>
        <button className="thread-row active-thread">
          <span className="thread-state active-state" />
          <span>
            <b>骑砍整合包诊断</b>
            <small>刚刚 · 执行端待切换</small>
          </span>
        </button>
        <button className="thread-row">
          <span className="thread-state done-state" />
          <span>
            <b>MC 模组碰撞箱</b>
            <small>昨天 · 继续原模型方案</small>
          </span>
        </button>
        <button className="thread-row">
          <span className="thread-state idle-state" />
          <span>
            <b>Noema 的方向</b>
            <small>10 月 11 日 · 设计讨论</small>
          </span>
        </button>
        <div className="sidebar-spacer" />
        <button className="settings-row">
          <Icon name="settings" size={16} /> 设置与连接
        </button>
        <div className="local-state">
          <span /> 本机 · 数据未同步
        </div>
      </aside>

      <main className="workspace">
        <header className="appbar">
          <div className="breadcrumbs">
            <span>主线</span>
            <i>/</i>
            <strong>骑砍整合包诊断</strong>
          </div>
          <div className="appbar-right">
            <span className="demo-label">
              <i />
              交互原型
            </span>
            <button className="thread-menu" aria-label="主线菜单">
              •••
            </button>
          </div>
        </header>

        <div className="content-grid">
          <section className="conversation">
            <div className="thread-heading">
              <div className="thread-overline">
                <span className="live-mark" />
                正在继续 <span>·</span> 10 月 13 日
              </div>
              <h1>骑砍整合包诊断</h1>
              <div className="thread-facts">
                <span>
                  <Icon name="branch" size={14} /> ModpackDiagnostics
                </span>
                <span className="fact-divider" />
                <span>
                  <i className="provider-dot codex-dot" />
                  上一执行端：Codex
                </span>
              </div>
            </div>

            <div className="timeline">
              <article className="message user-message">
                <div className="message-meta">
                  <span className="avatar user-avatar">你</span>
                  <b>你</b>
                  <time>15:42</time>
                </div>
                <p>
                  我还在查村庄生产的性能开销，Codex 额度用完了。换个 agent
                  接着查原来的代码，不要启动游戏，也别动启动器设置。
                </p>
              </article>

              <article className="message noema-message">
                <div className="message-meta">
                  <span className="avatar noema-avatar">N</span>
                  <b>Noema</b>
                  <time>15:43</time>
                  <span className="message-kind">主线回应</span>
                </div>
                <p>
                  可以继续，但不是把 Codex 的原生 session 假装搬进 DSH。Noema
                  这条主线会保留你说的话、已经确认的边界和任务进度；DSH
                  会有自己的 session、工具记录和运行环境。
                </p>
                <p>
                  我先把需要交接的内容列出来，你可以检查或修改。确认后才会启动目标
                  agent。
                </p>
              </article>

              <section
                className={`handoff-event ${phase}`}
                aria-label="执行端切换"
              >
                <div className="event-spine">
                  <span className="event-node">
                    <Icon
                      name={
                        phase === 'returned'
                          ? 'check'
                          : phase === 'failed'
                            ? 'close'
                            : 'swap'
                      }
                      size={14}
                    />
                  </span>
                </div>
                <div className="event-content">
                  <div className="event-title-line">
                    <strong>
                      {phase === 'ready'
                        ? 'Codex 额度用尽 · 等待继续方式'
                        : phase === 'running'
                          ? `已交接到 ${destination}`
                          : phase === 'failed'
                            ? `${destination} 暂时无法连接`
                            : route === 'model'
                              ? '已在同一主线切换对话模型'
                              : `${destination} 的结果已返回 Noema`}
                    </strong>
                    <span>{phase === 'ready' ? '15:44' : '刚刚'}</span>
                  </div>
                  <p className="event-description">
                    {phase === 'ready'
                      ? '尚未启动任何新执行端。选择只换对话模型，或将任务交给 coding agent。'
                      : phase === 'running'
                        ? 'Noema 主线保持不变；目标端拥有自己的原生会话和工具轨迹。'
                        : phase === 'failed'
                          ? '没有任务在目标端启动。交接包仍留在当前主线，可以重试或换一个目标。'
                          : route === 'model'
                            ? '可见对话被带入了新模型。仓库工具没有运行，执行端仍是 Codex。'
                            : '执行结果附在主线中，原始工具调用和工作区状态仍保留在目标端。'}
                  </p>
                  {phase === 'running' && (
                    <div className="execution-result">
                      <div className="result-meta">
                        <span
                          className={`agent-mark ${destination === 'DSH' ? 'dsh-mark' : 'claude-mark'}`}
                        >
                          {destination === 'DSH' ? 'D' : 'C'}
                        </span>
                        <b>{destination}</b>
                        <span>原生 session · 演示状态</span>
                      </div>
                      <p>
                        已确认商品生产的父级计时包含 23
                        个子步骤。下一步要对照现有 profiler trace 中的 village
                        tick 区段；目前没有启动游戏。
                      </p>
                      <button
                        className="return-result"
                        onClick={simulateReturn}
                      >
                        模拟执行完成并返回 <Icon name="arrow" size={14} />
                      </button>
                      <button
                        className="simulate-failure"
                        onClick={simulateFailure}
                      >
                        或模拟连接失败
                      </button>
                    </div>
                  )}
                  {phase === 'failed' && (
                    <div className="failure-actions">
                      <button onClick={() => setPhase('ready')}>
                        <Icon name="refresh" size={14} />
                        重新选择目标
                      </button>
                      <button
                        onClick={() => {
                          setDestination('Claude Code');
                          setPhase('ready');
                        }}
                      >
                        改用 Claude Code
                      </button>
                    </div>
                  )}
                  {phase === 'returned' && route === 'harness' && (
                    <div className="result-origin">
                      <Icon name="terminal" size={14} />
                      <span>结果来自 {destination} 原生 session</span>
                      <button onClick={() => setPhase('ready')}>
                        查看交接
                      </button>
                    </div>
                  )}
                </div>
              </section>

              {phase === 'returned' && route === 'harness' && (
                <article className="message noema-message returned-message">
                  <div className="message-meta">
                    <span className="avatar noema-avatar">N</span>
                    <b>Noema</b>
                    <time>15:51</time>
                    <span className="message-kind">回到主线</span>
                  </div>
                  <p>
                    结果回来了。现在确认到生产步骤落在 village tick
                    的子计时里；下一步是核对
                    trace，而不是改启动设置。你想先看这次交接的记录，还是直接接着讨论结果？
                  </p>
                </article>
              )}
              {lastMessage && (
                <article className="message user-message latest-message">
                  <div className="message-meta">
                    <span className="avatar user-avatar">你</span>
                    <b>你</b>
                    <time>刚刚</time>
                  </div>
                  <p>{lastMessage}</p>
                </article>
              )}
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="继续和 Noema 讨论这条主线……"
                rows={2}
                aria-label="发送给 Noema"
              />
              <div className="composer-foot">
                <span>
                  <i />
                  这条主线由 Noema 持续维护
                </span>
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="发送消息"
                >
                  <Icon name="send" size={16} />
                </button>
              </div>
            </form>
            <div className="prototype-disclaimer">
              <span>原型数据</span> · 没有连接模型或启动外部 agent
            </div>
          </section>

          <aside
            ref={handoffPaneRef}
            id="handoff-panel"
            className={`handoff-pane ${narrowOpen ? 'mobile-open' : ''}`}
            role={isNarrow && narrowOpen ? 'dialog' : 'complementary'}
            aria-label="切换方式与交接预览"
            aria-modal={isNarrow && narrowOpen ? true : undefined}
            aria-hidden={isNarrow && !narrowOpen ? true : undefined}
            inert={isNarrow && !narrowOpen}
          >
            <div className="pane-head">
              <div>
                <span className="pane-kicker">CONTINUE THIS THREAD</span>
                <h2>怎么继续</h2>
              </div>
              <button
                ref={closePaneRef}
                className="pane-close"
                onClick={() => setNarrowOpen(false)}
                aria-label="收起面板"
              >
                <Icon name="close" size={17} />
              </button>
            </div>

            <div
              className="route-switch"
              role="tablist"
              aria-label="选择继续方式"
            >
              <button
                role="tab"
                disabled={phase === 'running'}
                aria-selected={route === 'model'}
                className={
                  route === 'model'
                    ? 'route-option selected-route'
                    : 'route-option'
                }
                onClick={() => chooseRoute('model')}
              >
                <span className="route-icon model-icon">
                  <Icon name="chat" size={16} />
                </span>
                <span>
                  <b>换对话模型</b>
                  <small>留在此聊天线程</small>
                </span>
              </button>
              <button
                role="tab"
                disabled={phase === 'running'}
                aria-selected={route === 'harness'}
                className={
                  route === 'harness'
                    ? 'route-option selected-route'
                    : 'route-option'
                }
                onClick={() => chooseRoute('harness')}
              >
                <span className="route-icon harness-icon">
                  <Icon name="terminal" size={16} />
                </span>
                <span>
                  <b>换 coding agent</b>
                  <small>交接任务与工作区</small>
                </span>
              </button>
            </div>

            {route === 'model' ? (
              <div className="model-route-content">
                <div className="section-caption">
                  <span>选择模型</span>
                  <span>只改变谁来回答</span>
                </div>
                <button
                  className={
                    model === 'DeepSeek Chat'
                      ? 'destination-option selected-destination'
                      : 'destination-option'
                  }
                  onClick={() => setModel('DeepSeek Chat')}
                >
                  <span className="model-symbol deepseek-symbol">D</span>
                  <span>
                    <b>DeepSeek Chat</b>
                    <small>演示模型 · 尚未连接</small>
                  </span>
                  <span className="model-presence demo-presence" />
                </button>
                <button
                  className={
                    model === 'Qwen · 本地'
                      ? 'destination-option selected-destination'
                      : 'destination-option'
                  }
                  onClick={() => setModel('Qwen · 本地')}
                >
                  <span className="model-symbol qwen-symbol">Q</span>
                  <span>
                    <b>Qwen · 本地</b>
                    <small>演示模型 · 尚未连接</small>
                  </span>
                  <span className="model-presence demo-presence" />
                </button>
                <div className="boundary-note model-boundary">
                  <Icon name="check" size={15} />
                  <p>
                    <b>聊天上下文继续带入</b>
                    <br />
                    模型更换不等于 coding harness 更换。此路径不会启动或恢复
                    Codex/DSH 的工具会话。
                  </p>
                </div>
                <button className="primary-action" onClick={beginHandoff}>
                  用 {model} 继续 <Icon name="arrow" size={15} />
                </button>
              </div>
            ) : (
              <div className="agent-route-content">
                <div className="section-caption">
                  <span>执行目标</span>
                  <span>将创建独立原生 session</span>
                </div>
                <div className="destination-picker">
                  <button
                    disabled={phase === 'running'}
                    className={
                      destination === 'DSH'
                        ? 'destination-option selected-destination'
                        : 'destination-option'
                    }
                    onClick={() => setDestination('DSH')}
                  >
                    <span className="agent-mark dsh-mark">D</span>
                    <span>
                      <b>DeepSeek Harness</b>
                      <small>演示目标 · 尚未连接</small>
                    </span>
                    <span className="model-presence demo-presence" />
                  </button>
                  <button
                    disabled={phase === 'running'}
                    className={
                      destination === 'Claude Code'
                        ? 'destination-option selected-destination'
                        : 'destination-option'
                    }
                    onClick={() => setDestination('Claude Code')}
                  >
                    <span className="agent-mark claude-mark">C</span>
                    <span>
                      <b>Claude Code</b>
                      <small>演示目标 · 尚未连接</small>
                    </span>
                    <span className="model-presence demo-presence" />
                  </button>
                </div>

                <div className="packet-heading">
                  <div>
                    <span className="pane-kicker">HANDOFF PACKET</span>
                    <h3>交接前检查</h3>
                  </div>
                  <button
                    className="edit-packet"
                    onClick={() => setEditing((value) => !value)}
                  >
                    <Icon name="edit" size={14} />
                    {editing ? '完成' : '修改'}
                  </button>
                </div>
                <label className="field-label" htmlFor="handoff-goal">
                  任务与限制
                </label>
                {editing ? (
                  <textarea
                    id="handoff-goal"
                    className="goal-editor"
                    rows={3}
                    value={goal}
                    onChange={(event) => setGoal(event.target.value)}
                  />
                ) : (
                  <p className="goal-summary">{goal}</p>
                )}
                <label className="packet-toggle">
                  <input
                    type="checkbox"
                    checked={includeDecisions}
                    onChange={(event) =>
                      setIncludeDecisions(event.target.checked)
                    }
                  />
                  <span className="toggle-check">
                    <Icon name="check" size={12} />
                  </span>
                  <span>
                    <b>已确认结论</b>
                    <small>
                      生产步骤在 village tick 子计时内；尚未验证游戏内效果
                    </small>
                  </span>
                </label>
                <label className="packet-toggle">
                  <input
                    type="checkbox"
                    checked={includeWorkspace}
                    onChange={(event) =>
                      setIncludeWorkspace(event.target.checked)
                    }
                  />
                  <span className="toggle-check">
                    <Icon name="check" size={12} />
                  </span>
                  <span>
                    <b>仓库引用</b>
                    <small>ModpackDiagnostics · 演示引用，未读取真实路径</small>
                  </span>
                </label>

                <div className="boundary-block">
                  <div className="boundary-title">
                    <span className="boundary-glyph">!</span>
                    <b>不会伪装成同一个 session</b>
                  </div>
                  <ul>
                    <li>Codex 的工具调用、审批状态与隐藏上下文不会迁移。</li>
                    <li>目标 agent 会在自己的 harness 和工作区里运行。</li>
                    <li>
                      Noema 主线会记录交接包与回传结果；不是完整 transcript
                      镜像。
                    </li>
                  </ul>
                </div>

                {phase === 'ready' ||
                phase === 'paused' ||
                phase === 'failed' ? (
                  <button className="primary-action" onClick={beginHandoff}>
                    交接给 {destination} <Icon name="arrow" size={15} />
                  </button>
                ) : phase === 'running' ? (
                  <button
                    className="primary-action waiting-action"
                    onClick={simulateReturn}
                  >
                    <Icon name="clock" size={15} />
                    模拟 {destination} 返回结果
                  </button>
                ) : (
                  <button
                    className="primary-action"
                    onClick={() => setPhase('ready')}
                  >
                    <Icon name="refresh" size={15} />
                    查看另一种继续方式
                  </button>
                )}
                <button
                  className="cancel-handoff"
                  onClick={() => {
                    setPhase('paused');
                    setNotice(
                      '没有启动外部 agent。你可以直接在 Noema 里继续讨论。',
                    );
                  }}
                >
                  暂不交接，留在 Noema
                </button>
              </div>
            )}

            <div className="ownership-footer">
              <span className="ownership-dot" />
              <p>
                <b>主线归 Noema</b>
                <br />
                外部 agent 的执行记录仍归各自 harness。
              </p>
            </div>
          </aside>
          {narrowOpen && (
            <button
              className="mobile-scrim"
              aria-label="关闭交接面板"
              onClick={() => setNarrowOpen(false)}
            />
          )}
        </div>

        <footer className="statusbar">
          <span>
            <i />
            本地原型
          </span>
          <span>未连接模型 · 交接行为为模拟</span>
          <span>v{bridge.appVersion}</span>
          <button
            className="mobile-switch"
            aria-controls="handoff-panel"
            aria-expanded={narrowOpen}
            onClick={() => setNarrowOpen((value) => !value)}
          >
            <Icon name="swap" size={14} />
            切换方式
          </button>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="关闭提示">
            <Icon name="close" size={14} />
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
