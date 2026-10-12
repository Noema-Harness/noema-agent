import type { NoemaBridge } from './noema-bridge.d.ts';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Phase = 'running' | 'returned' | 'failed' | 'stopped';
type Destination = 'DSH' | 'Claude Code';
type TimelineItem = {
  id: string;
  kind: 'user' | 'noema' | 'event';
  text: string;
  tone?: Phase;
  eventLabel?: string;
};
type WorkerEvent = Pick<TimelineItem, 'tone' | 'eventLabel' | 'text'> & {
  reply?: string;
};

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
    | 'send'
    | 'pause';
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
    case 'pause':
      return (
        <svg {...props}>
          <path d="M8 5v14M16 5v14" />
        </svg>
      );
  }
}

function App() {
  const bridge: NoemaBridge = window.noema ?? { appVersion: '0.1.0' };
  const [phase, setPhase] = useState<Phase>('running');
  const [destination, setDestination] = useState<Destination>('DSH');
  const [rootModel, setRootModel] = useState('DeepSeek Flash');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [taskNote, setTaskNote] = useState('');
  const [rootInput, setRootInput] = useState('');
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [rootBusy, setRootBusy] = useState(false);
  const [pendingTaskEvent, setPendingTaskEvent] = useState(false);
  const [notice, setNotice] = useState('');
  const [isNarrow, setIsNarrow] = useState(
    () => window.matchMedia('(max-width: 880px)').matches,
  );
  const [tasksOpen, setTasksOpen] = useState(false);
  const taskPaneRef = useRef<HTMLElement>(null);
  const closePaneRef = useRef<HTMLButtonElement>(null);
  const taskTriggerRef = useRef<HTMLElement | null>(null);
  const rootBusyRef = useRef(false);
  const pendingWorkerEventsRef = useRef<WorkerEvent[]>([]);
  const rootBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 880px)');
    const update = () => setIsNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (isNarrow && tasksOpen) {
      taskTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      closePaneRef.current?.focus();
      function keepFocus(event: KeyboardEvent) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setTasksOpen(false);
          return;
        }
        if (event.key !== 'Tab' || !taskPaneRef.current) return;
        const focusable = Array.from(
          taskPaneRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((item) => item.offsetParent !== null);
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
      document.addEventListener('keydown', keepFocus);
      return () => document.removeEventListener('keydown', keepFocus);
    }
    if (isNarrow && !tasksOpen && taskTriggerRef.current?.isConnected) {
      taskTriggerRef.current.focus();
      taskTriggerRef.current = null;
    }
  }, [isNarrow, tasksOpen]);

  function appendWorkerEvent(event: WorkerEvent) {
    setTimelineItems((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        kind: 'event',
        tone: event.tone,
        eventLabel: event.eventLabel,
        text: event.text,
      },
      ...(event.reply
        ? [
            {
              id: crypto.randomUUID(),
              kind: 'noema',
              text: event.reply,
            } as TimelineItem,
          ]
        : []),
    ]);
    setPendingTaskEvent(false);
    pendingWorkerEventsRef.current = [];
    setNotice(
      event.tone === 'returned'
        ? 'Noema 已接住后台结果事件。'
        : '后台状态事件已回到 Noema 主对话。',
    );
    requestAnimationFrame(() =>
      rootBottomRef.current?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      }),
    );
  }

  function deliverWorkerEvent(event: WorkerEvent) {
    if (rootBusyRef.current) {
      pendingWorkerEventsRef.current.push(event);
      setPendingTaskEvent(true);
      setNotice('后台结果已到；Noema 会在当前回复结束后接住它。');
      return;
    }
    appendWorkerEvent(event);
  }

  function finishTask() {
    setPhase('returned');
    deliverWorkerEvent({
      tone: 'returned',
      eventLabel: '后台任务结果',
      text: 'DSH 返回：trace 显示商品生产落在 village tick 的子计时步骤中。游戏内效果仍未验证。',
      reply:
        '结果回来了。我们可以先把这个结论放回当前讨论，再决定要不要继续查；Codex 的工具轨迹仍留在它自己的 session。',
    });
  }

  function failTask() {
    setPhase('failed');
    deliverWorkerEvent({
      tone: 'failed',
      eventLabel: '后台任务未能继续',
      text: `${destination} 没有成功接起任务；交接内容还在，可以重试或换一个目标。`,
      reply:
        '刚才的执行端没接起来，任务没有开始。我还在这里，我们可以换一个 agent 再试，或者先不管它继续聊。',
    });
  }

  function retryWith(target: Destination) {
    setDestination(target);
    setPhase('running');
    setNotice(`已将任务改交给 ${target}（原型模拟，没有启动真实 agent）。`);
    deliverWorkerEvent({
      tone: 'running',
      eventLabel: '任务已重新启动',
      text: `已重新交给 ${target}；它会在独立 session 中继续。`,
      reply: `换成 ${target} 继续了。你可以留在这条对话里，不用等它跑完。`,
    });
  }

  function stopTask() {
    setPhase('stopped');
    setNotice('后台任务已停止（原型模拟）。Noema 主对话仍可继续。');
    deliverWorkerEvent({
      tone: 'stopped',
      eventLabel: '后台任务已停止',
      text: `你已停止 ${destination} 的后台任务；Noema 主对话和此前交接内容仍保留。`,
      reply:
        '停下来了。我们可以先看现有结论，或者稍后再把剩下的部分交给别的执行端。',
    });
  }

  function sendRootMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = rootInput.trim();
    if (!text || rootBusyRef.current) return;
    setRootInput('');
    rootBusyRef.current = true;
    setRootBusy(true);
    setTimelineItems((items) => [
      ...items,
      { id: crypto.randomUUID(), kind: 'user', text },
    ]);
    setNotice('Noema 正在回复演示消息。');
    const reply =
      phase === 'running'
        ? '听到了。后台的诊断会继续跑，我们可以先把这件事想清楚；结果回来时我再把它带进这条对话。'
        : '收到。先不替你把它归纳成结论，我们可以从你最在意的那个部分接着聊。';
    window.setTimeout(() => {
      setTimelineItems((items) => [
        ...items,
        { id: crypto.randomUUID(), kind: 'noema', text: reply },
      ]);
      rootBusyRef.current = false;
      setRootBusy(false);
      const pendingEvents = pendingWorkerEventsRef.current;
      if (pendingEvents.length) {
        pendingWorkerEventsRef.current = [];
        setPendingTaskEvent(false);
        pendingEvents.forEach(appendWorkerEvent);
      } else {
        requestAnimationFrame(() =>
          rootBottomRef.current?.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth',
          }),
        );
        setNotice('静态原型：消息没有发送给模型。');
      }
    }, 1400);
  }

  function submitTaskNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskNote.trim()) return;
    setNotice(`补充说明已送入 ${destination} 的演示任务收件箱。`);
    deliverWorkerEvent({
      tone: 'running',
      eventLabel: '补充说明已送达',
      text: `给 ${destination} 追加了一条任务说明；它会保留在自己的 session 里。`,
    });
    setTaskNote('');
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
        <div className="side-section-label">你和 Noema</div>
        <button className="primary-nav active-nav">
          <span className="nav-symbol">
            <Icon name="chat" size={16} />
          </span>
          <span>
            <b>主对话</b>
            <small>持续在线</small>
          </span>
        </button>
        <div className="side-section-label task-label">
          后台工作{' '}
          <span className="count-badge">
            {phase === 'running' || pendingTaskEvent ? '1' : '0'}
          </span>
        </div>
        <button
          className="task-nav"
          onClick={() => {
            if (isNarrow) setTasksOpen(true);
            else taskPaneRef.current?.scrollIntoView({ block: 'nearest' });
          }}
        >
          <span className={`task-state-dot ${phase}`} />
          <span>
            <b>村庄生产性能诊断</b>
            <small>
              {phase === 'running'
                ? `正在由 ${destination} 处理`
                : phase === 'returned'
                  ? pendingTaskEvent
                    ? '结果已到 · 等主对话空闲'
                    : '结果已返回主对话'
                  : phase === 'failed'
                    ? '需要重试'
                    : '已停止'}
            </small>
          </span>
        </button>
        <div className="sidebar-spacer" />
        <button className="settings-row">
          <Icon name="settings" size={16} /> 设置与连接
        </button>
        <div className="local-state">
          <span /> 本机 · 演示数据
        </div>
      </aside>

      <main className="workspace">
        <header className="appbar">
          <div className="breadcrumbs">
            <span>Noema</span>
            <i>/</i>
            <strong>主对话</strong>
          </div>
          <div className="appbar-right">
            <span className="model-label">对话模型</span>
            <div className="model-picker-wrap">
              <button
                className="model-picker"
                aria-haspopup="listbox"
                aria-expanded={modelMenuOpen}
                onClick={() => setModelMenuOpen((open) => !open)}
              >
                <span className="model-indicator" />
                {rootModel}
                <span className="chevron">⌄</span>
              </button>
              {modelMenuOpen && (
                <div
                  className="model-menu"
                  role="listbox"
                  aria-label="Noema 对话模型"
                >
                  {['DeepSeek Flash', 'Qwen · 本地'].map((model) => (
                    <button
                      key={model}
                      role="option"
                      aria-selected={rootModel === model}
                      className={
                        rootModel === model
                          ? 'model-choice selected-model'
                          : 'model-choice'
                      }
                      onClick={() => {
                        setRootModel(model);
                        setModelMenuOpen(false);
                        setNotice(
                          `Noema 主对话已选择 ${model}（演示；没有发送模型请求）。后台任务不受影响。`,
                        );
                      }}
                    >
                      <span className="model-indicator" />
                      {model}
                      <small>演示 · 未连接</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="demo-label">
              <i />
              原型
            </span>
            <button className="thread-menu" aria-label="更多选项">
              •••
            </button>
          </div>
        </header>

        <div className="content-grid">
          <section className="conversation">
            <div className="thread-heading">
              <div className="thread-overline">
                <span className="live-mark" />
                Noema 持续对话 <span>·</span> 10 月 13 日
              </div>
              <h1>继续聊下去</h1>
              <div className="thread-facts">
                <span>
                  <Icon name="chat" size={14} />
                  这段对话不会被后台任务替换
                </span>
                <span className="fact-divider" />
                <span>
                  <i className={`task-state-dot ${phase}`} />
                  {phase === 'running'
                    ? '有后台任务正在运行'
                    : pendingTaskEvent
                      ? '后台结果等主对话空闲'
                      : '没有进行中的后台任务'}
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
                  Codex 额度用完了，村庄生产的诊断还没查完。你能让 DSH
                  在后台继续吗？我想先留在这里，接着聊 Noema
                  到底有没有独立存在的理由。
                </p>
              </article>

              <article className="message noema-message">
                <div className="message-meta">
                  <span className="avatar noema-avatar">N</span>
                  <b>Noema</b>
                  <time>15:43</time>
                  <span className="message-kind">主对话</span>
                </div>
                <p>
                  可以。我把诊断交给 DSH 的独立 session
                  跑，我们这条对话保持原样，不会被切成 DSH 的工作窗口。
                </p>
                <p>
                  交接里带任务目标、不能启动游戏的限制和仓库引用；Codex
                  的原生工具轨迹与待审批状态不会伪装成已经迁过去。任务有结果时，我会把它作为事件带回来。你可以继续说，我也可以随时停掉后台任务。
                </p>
              </article>

              <section
                className="system-event running"
                aria-label="后台任务已启动"
              >
                <div className="event-spine">
                  <span className="event-node">
                    <Icon name="terminal" size={14} />
                  </span>
                </div>
                <div className="event-content">
                  <div className="event-title-line">
                    <strong>后台任务已启动 · DSH</strong>
                    <span>15:44</span>
                  </div>
                  <p className="event-description">
                    DSH 正在自己的 session 和工作区中执行；Noema
                    主对话仍保持可用。
                  </p>
                </div>
              </section>

              <article className="message user-message followup-message">
                <div className="message-meta">
                  <span className="avatar user-avatar">你</span>
                  <b>你</b>
                  <time>15:45</time>
                </div>
                <p>
                  我还是担心它最后会变成一个多工具面板，所谓的“属于我”其实没有真正落到和我的相处上。
                </p>
              </article>
              <article className="message noema-message">
                <div className="message-meta">
                  <span className="avatar noema-avatar">N</span>
                  <b>Noema</b>
                  <time>15:46</time>
                  <span className="message-kind">主对话</span>
                </div>
                <p>
                  DSH + Relay 已经能把 Codex 和 Claude 放进一个 coding
                  workbench。要是 Noema 只是再加一个入口，就没理由单独做。
                </p>
                <p>
                  可能的差别是：你继续和我谈，我把任务交给后台的
                  agent，结果再回来。这个还没证明比在 DSH
                  里工作更值得，所以不能先按这个方向堆功能。
                </p>
              </article>
              {timelineItems.map((item) =>
                item.kind === 'event' ? (
                  <section
                    key={item.id}
                    className={`system-event ${item.tone ?? 'running'}`}
                    aria-label="后台任务状态事件"
                  >
                    <div className="event-spine">
                      <span className="event-node">
                        <Icon
                          name={
                            item.tone === 'returned'
                              ? 'check'
                              : item.tone === 'failed'
                                ? 'close'
                                : item.tone === 'stopped'
                                  ? 'pause'
                                  : 'terminal'
                          }
                          size={14}
                        />
                      </span>
                    </div>
                    <div className="event-content">
                      <div className="event-title-line">
                        <strong>
                          {item.eventLabel ??
                            (item.tone === 'returned'
                              ? '后台任务结果'
                              : item.tone === 'failed'
                                ? '后台任务未能继续'
                                : item.tone === 'stopped'
                                  ? '后台任务已停止'
                                  : '任务已重新启动')}
                        </strong>
                        <span>刚刚</span>
                      </div>
                      <p className="event-description">{item.text}</p>
                    </div>
                  </section>
                ) : item.kind === 'user' ? (
                  <article
                    key={item.id}
                    className="message user-message latest-message"
                  >
                    <div className="message-meta">
                      <span className="avatar user-avatar">你</span>
                      <b>你</b>
                      <time>刚刚</time>
                    </div>
                    <p>{item.text}</p>
                  </article>
                ) : (
                  <article
                    key={item.id}
                    className="message noema-message dynamic-reply"
                  >
                    <div className="message-meta">
                      <span className="avatar noema-avatar">N</span>
                      <b>Noema</b>
                      <time>刚刚</time>
                      <span className="message-kind">主对话</span>
                    </div>
                    <p>{item.text}</p>
                  </article>
                ),
              )}
              {rootBusy && (
                <div className="root-thinking" role="status">
                  <span className="thinking-indicator">
                    <i />
                    <i />
                    <i />
                  </span>
                  Noema 正在组织回应
                </div>
              )}
              {pendingTaskEvent && (
                <div className="queued-task-event" role="status">
                  <Icon name="clock" size={14} />
                  后台结果已到，等当前回复结束后带回主对话
                </div>
              )}
              <div ref={rootBottomRef} />
            </div>

            <form className="composer" onSubmit={sendRootMessage}>
              <textarea
                value={rootInput}
                onChange={(event) => setRootInput(event.target.value)}
                placeholder="接着和 Noema 聊，不必等后台任务结束……"
                rows={2}
                aria-label="与 Noema 继续对话"
              />
              <div className="composer-foot">
                <span>
                  <i />
                  {rootBusy
                    ? 'Noema 正在回复；后台事件会等这一轮结束'
                    : '后台执行不会占用这条对话'}
                </span>
                <button
                  type="submit"
                  disabled={!rootInput.trim() || rootBusy}
                  aria-label="发送给 Noema"
                >
                  <Icon name="send" size={16} />
                </button>
              </div>
            </form>
            <div className="prototype-disclaimer">
              <span>交互原型</span> · 模型、harness、事件均为模拟数据
            </div>
          </section>

          <aside
            ref={taskPaneRef}
            id="background-task-panel"
            className={`task-pane ${tasksOpen ? 'mobile-open' : ''}`}
            role={isNarrow && tasksOpen ? 'dialog' : 'complementary'}
            aria-label="后台任务"
            aria-modal={isNarrow && tasksOpen ? true : undefined}
            aria-hidden={isNarrow && !tasksOpen ? true : undefined}
            inert={isNarrow && !tasksOpen}
          >
            <div className="pane-head">
              <div>
                <span className="pane-kicker">执行状态</span>
                <h2>
                  后台任务{' '}
                  <span className="count-badge">
                    {phase === 'running' || pendingTaskEvent ? '1' : '0'}
                  </span>
                </h2>
              </div>
              <button
                ref={closePaneRef}
                className="pane-close"
                onClick={() => setTasksOpen(false)}
                aria-label="收起后台任务"
              >
                <Icon name="close" size={17} />
              </button>
            </div>

            <section className="active-task">
              <div className="task-name-line">
                <span className={`task-state-dot ${phase}`} />
                <strong>村庄生产性能诊断</strong>
                <button className="task-more" aria-label="任务选项">
                  •••
                </button>
              </div>
              <div className="task-origin">
                <span
                  className={`agent-mark ${destination === 'DSH' ? 'dsh-mark' : 'claude-mark'}`}
                >
                  {destination === 'DSH' ? 'D' : 'C'}
                </span>
                <span>
                  <b>{destination}</b>
                  <small>
                    {phase === 'running'
                      ? '正在独立 session 中处理'
                      : phase === 'returned'
                        ? pendingTaskEvent
                          ? '执行完成 · 等待主对话接手'
                          : '执行完成 · 结果已回传'
                        : phase === 'failed'
                          ? '启动失败 · 可更换目标'
                          : '已停止'}
                  </small>
                </span>
              </div>
              <div className="task-meter">
                <span className={phase} />
              </div>
              <div className="task-phase-label">
                <span>
                  {phase === 'running'
                    ? '正在检查代码调用记录'
                    : phase === 'returned'
                      ? pendingTaskEvent
                        ? '等待 Noema 当前回复结束'
                        : '已返回 Noema'
                      : phase === 'failed'
                        ? '等待恢复'
                        : '任务结束'}
                </span>
                <time>{phase === 'running' ? '刚刚更新' : '刚刚'}</time>
              </div>

              <button
                className="handoff-disclosure"
                aria-expanded={showHandoff}
                onClick={() => setShowHandoff((open) => !open)}
              >
                <span>
                  <Icon name="file" size={14} />
                  查看已交接的内容
                </span>
                <span>{showHandoff ? '收起 −' : '展开 +'}</span>
              </button>
              {showHandoff && (
                <div className="handoff-record">
                  <div>
                    <small>任务与限制</small>
                    <p>
                      继续定位村庄商品生产的性能开销；不要启动游戏，不改启动器设置。
                    </p>
                  </div>
                  <div>
                    <small>带入 Noema 已确认的信息</small>
                    <p>
                      已定位到 village tick
                      的商品生产子步骤；游戏内验证尚未进行。
                    </p>
                  </div>
                  <div>
                    <small>保留在 Codex</small>
                    <p>
                      Codex 原生 session、工具轨迹和待审批请求仍由 Codex
                      管理，未写入 DSH transcript。
                    </p>
                  </div>
                  <div>
                    <small>来源</small>
                    <p>Noema 主对话与对应工作区引用 · 原型示例</p>
                  </div>
                </div>
              )}

              {phase === 'running' && (
                <form className="task-steer" onSubmit={submitTaskNote}>
                  <label htmlFor="task-note">补充给后台执行者</label>
                  <div>
                    <input
                      id="task-note"
                      value={taskNote}
                      onChange={(event) => setTaskNote(event.target.value)}
                      placeholder="只补充这项任务需要的信息"
                    />
                    <button
                      type="submit"
                      disabled={!taskNote.trim()}
                      aria-label="发送补充说明"
                    >
                      <Icon name="send" size={14} />
                    </button>
                  </div>
                  <small>
                    会作为新指令追加到 DSH session，不会修改已发送的交接记录。
                  </small>
                </form>
              )}

              {phase === 'running' && (
                <div className="task-actions">
                  <button className="complete-demo" onClick={finishTask}>
                    模拟任务完成并返回 <Icon name="arrow" size={14} />
                  </button>
                  <button className="fail-demo" onClick={failTask}>
                    模拟目标连接失败
                  </button>
                  <button className="stop-task" onClick={stopTask}>
                    <Icon name="pause" size={13} />
                    停止后台任务
                  </button>
                </div>
              )}
              {phase === 'failed' && (
                <div className="task-actions">
                  <button
                    className="complete-demo"
                    onClick={() => retryWith('DSH')}
                  >
                    <Icon name="refresh" size={14} />
                    重试 DSH
                  </button>
                  <button
                    className="fail-demo"
                    onClick={() =>
                      retryWith(destination === 'DSH' ? 'Claude Code' : 'DSH')
                    }
                  >
                    切换到 {destination === 'DSH' ? 'Claude Code' : 'DSH'}
                  </button>
                </div>
              )}
              {phase === 'returned' && (
                <button
                  className="task-history"
                  onClick={() =>
                    setNotice('这条任务的演示记录仍挂在当前 Noema 主线。')
                  }
                >
                  <Icon name="branch" size={14} />
                  在主对话中查看结果
                </button>
              )}
              {phase === 'stopped' && (
                <button
                  className="task-history"
                  onClick={() => retryWith(destination)}
                >
                  <Icon name="refresh" size={14} />
                  重新启动这项任务
                </button>
              )}
            </section>

            <div className="event-rule">
              <span />
              任务完成会以系统事件回到主对话
              <span />
            </div>
            <div className="ownership-footer">
              <span className="ownership-dot" />
              <p>
                <b>Noema 主对话持续可用</b>
                <br />
                外部 session 和执行记录仍归对应 harness。
              </p>
            </div>
          </aside>
          {tasksOpen && (
            <button
              className="mobile-scrim"
              aria-label="关闭后台任务面板"
              onClick={() => setTasksOpen(false)}
            />
          )}
        </div>

        <footer className="statusbar">
          <span>
            <i />
            本地原型
          </span>
          <span>未连接模型 · 后台任务与事件均为模拟</span>
          <span>v{bridge.appVersion}</span>
          <button
            className="mobile-switch"
            aria-controls="background-task-panel"
            aria-expanded={tasksOpen}
            onClick={() => setTasksOpen((open) => !open)}
          >
            <Icon name="branch" size={14} />
            后台任务
          </button>
        </footer>
      </main>
      {modelMenuOpen && (
        <button
          className="dismiss-model-menu"
          aria-label="关闭模型菜单"
          onClick={() => setModelMenuOpen(false)}
        />
      )}
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
