import type { NoemaBridge } from './noema-bridge.d.ts';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Understanding = {
  text: string;
  source: string;
  updatedAt: string;
};

const defaultUnderstanding: Understanding = {
  text: '回应一个想法前，先弄清它背后的用途；不要把用户随口提出的方案直接当成最终规格。',
  source: '需求表达了我想要什么；业务表达的是我用它做什么。',
  updatedAt: '2026-10-11',
};

function readUnderstanding(): Understanding | null {
  try {
    const stored = localStorage.getItem('noema.prototype.understanding');
    return stored
      ? (JSON.parse(stored) as Understanding)
      : defaultUnderstanding;
  } catch {
    return defaultUnderstanding;
  }
}

function Icon({
  name,
  size = 18,
}: {
  name:
    | 'conversation'
    | 'understanding'
    | 'settings'
    | 'arrow'
    | 'close'
    | 'edit'
    | 'download'
    | 'upload'
    | 'quote'
    | 'check'
    | 'restore';
  size?: number;
}) {
  const common = {
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
    case 'conversation':
      return (
        <svg {...common}>
          <path d="M20 11.2a7.2 7.2 0 0 1-7.5 7.2H7l-3.5 2 .8-4A7.2 7.2 0 1 1 20 11.2Z" />
          <path d="M8 11.3h.01M12 11.3h.01M16 11.3h.01" />
        </svg>
      );
    case 'understanding':
      return (
        <svg {...common}>
          <path d="M12 3.5 14 9l5.5 2-5.5 2-2 5.5L10 13l-5.5-2L10 9l2-5.5Z" />
          <path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path
            d="m19.4 15 .1.1 1.1.9-1.4 2.4-1.4-.5a7.8 7.8 0 0 1-1.4.8l-.2 1.5h-2.8l-.2-1.5a7.8 7.8 0 0 1-1.4-.8l-1.4.5-1.4-2.4 1.1-.9a7 7 0 0 1 0-1.6l-1.1-.9 1.4-2.4 1.4.5a7.8 7.8 0 0 1 1.4-.8l.2-1.5h2.8l.2 1.5a7.8 7.8 0 0 1 1.4.8l1.4-.5 1.4 2.4-1.1.9a7 7 0 0 1-.1 1.5Z"
            transform="translate(-1 -1) scale(1.08)"
          />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...common}>
          <path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" />
        </svg>
      );
    case 'download':
      return (
        <svg {...common}>
          <path d="M12 3v11m-4-4 4 4 4-4M5 17v3h14v-3" />
        </svg>
      );
    case 'upload':
      return (
        <svg {...common}>
          <path d="M12 15V4m-4 4 4-4 4 4M5 17v3h14v-3" />
        </svg>
      );
    case 'quote':
      return (
        <svg {...common}>
          <path d="M9 11H5v7h6v-5c0-4 1-6 4-8M19 11h-4v7h6v-5c0-4 1-6 4-8" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case 'restore':
      return (
        <svg {...common}>
          <path d="M4 11a8 8 0 1 1 2.3 5.7M4 5v6h6" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
  }
}

function App() {
  const bridge: NoemaBridge = window.noema ?? { appVersion: '0.1.0' };
  const [understanding, setUnderstanding] = useState<Understanding | null>(
    readUnderstanding,
  );
  const [view, setView] = useState<'conversation' | 'understanding'>(
    'conversation',
  );
  const [showSource, setShowSource] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(understanding?.text ?? '');
  const [excluded, setExcluded] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [input, setInput] = useState('');

  useEffect(() => {
    if (understanding)
      localStorage.setItem(
        'noema.prototype.understanding',
        JSON.stringify(understanding),
      );
    else localStorage.removeItem('noema.prototype.understanding');
  }, [understanding]);

  function exportUnderstanding() {
    const payload = {
      format: 'noema-understanding',
      version: 1,
      exportedAt: new Date().toISOString(),
      contents: understanding
        ? [
            {
              ...understanding,
              kind: 'assistant-summary',
              certainty: 'tentative',
            },
          ]
        : [],
      note: 'This prototype export contains editable understanding and its source excerpt, not a full conversation or hidden reasoning.',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'noema-understanding.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('已导出理解条目和来源；原始对话没有包含在文件里。');
  }

  function importUnderstanding(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as {
          format?: string;
          version?: number;
          contents?: Understanding[];
        };
        if (
          data.format !== 'noema-understanding' ||
          data.version !== 1 ||
          !Array.isArray(data.contents)
        )
          throw new Error('unsupported');
        const item = data.contents[0];
        if (
          item &&
          typeof item.text === 'string' &&
          typeof item.source === 'string'
        ) {
          setUnderstanding({
            text: item.text,
            source: item.source,
            updatedAt: new Date().toISOString().slice(0, 10),
          });
          setDraft(item.text);
          setNotice('已载入理解条目。原始来源只保留了导出文件中携带的片段。');
        } else {
          setNotice('文件格式有效，但没有可载入的理解条目。');
        }
      } catch {
        setNotice('无法读取此文件。请选择 Noema 导出的理解 JSON。');
      }
    };
    reader.readAsText(file);
  }

  function saveEdit() {
    if (!draft.trim()) return;
    setUnderstanding((current) =>
      current
        ? {
            ...current,
            text: draft.trim(),
            updatedAt: new Date().toISOString().slice(0, 10),
          }
        : current,
    );
    setEditing(false);
    setNotice('已更新这条暂定理解。');
  }

  function revokeUnderstanding() {
    setUnderstanding(null);
    setEditing(false);
    setNotice('已撤回这条理解。');
  }

  function restoreUnderstanding() {
    setUnderstanding(defaultUnderstanding);
    setDraft(defaultUnderstanding.text);
    setNotice('已恢复演示中的原始理解。');
  }

  function sendDemoMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim()) return;
    setMessage(input.trim());
    setInput('');
    setNotice('这是静态原型：消息未发送到模型，也不会创建真实记忆。');
  }

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="主导航">
        <div className="brand-mark" aria-label="Noema">
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <path d="M9 25V11l18 14V11" />
            <circle cx="18" cy="18" r="15" />
          </svg>
        </div>
        <div className="rail-rule" />
        <button
          className={`rail-item ${view === 'conversation' ? 'selected' : ''}`}
          onClick={() => setView('conversation')}
          aria-current={view === 'conversation' ? 'page' : undefined}
        >
          <Icon name="conversation" />
          <span>对话</span>
        </button>
        <button
          className={`rail-item ${view === 'understanding' ? 'selected' : ''}`}
          onClick={() => setView('understanding')}
          aria-current={view === 'understanding' ? 'page' : undefined}
        >
          <Icon name="understanding" />
          <span>理解</span>
        </button>
        <div className="rail-spacer" />
        <div className="local-mark">
          <span />
          本地
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="crumb">
            <span>Noema</span>
            <i>/</i>
            <strong>{view === 'conversation' ? '持续对话' : '我的理解'}</strong>
          </div>
          <div className="top-actions">
            <span className="prototype-tag">
              <span />
              原型内容
            </span>
            <button
              className="export-button"
              onClick={exportUnderstanding}
              title="导出可迁移的理解条目"
            >
              <Icon name="download" size={16} />
              <span>导出理解</span>
            </button>
          </div>
        </header>

        {view === 'conversation' ? (
          <div className={`work-area ${showSource ? 'source-open' : ''}`}>
            <main className="conversation-pane">
              <div className="conversation-head">
                <div>
                  <p className="conversation-date">
                    10 月 13 日 · 继续昨天的话题
                  </p>
                  <h1>AI 的“灵魂”，究竟从哪里来？</h1>
                </div>
                <button
                  className="text-action"
                  onClick={() => setShowSource((value) => !value)}
                >
                  <span className="source-count">
                    {understanding ? '1' : '0'}
                  </span>
                  条理解参与了这次回答
                </button>
              </div>

              <section className="transcript" aria-label="对话内容">
                <article className="message user-message">
                  <div className="speaker">
                    <span className="speaker-dot user-dot" />你{' '}
                    <time>15:42</time>
                  </div>
                  <p>
                    我越来越觉得，给 AI
                    加一个人设并不能让它变得真实。真正让我在意的，是它有没有和我一起经历过什么。
                  </p>
                </article>

                <article className="message noema-message">
                  <div className="speaker">
                    <span className="speaker-dot noema-dot" />
                    Noema <time>15:43</time>
                    <span className="reply-kind">回应</span>
                  </div>
                  <p>人设只是先把它该怎么说写好，未必改变它怎么理解你。</p>
                  <p>
                    你之前提醒过我：需求只是表面，背后还有你真正要解决的事。这个提醒不该变成一句固定提示词，而应该在我急着替你出方案时，确实改变我接下来怎么理解。
                  </p>
                  {understanding ? (
                    <button
                      className="inline-citation"
                      onClick={() => setShowSource((value) => !value)}
                      aria-expanded={showSource}
                    >
                      <span className="citation-mark">↳</span>
                      <span>这段回应延续了你关于“需求与用途”的原话</span>
                      <Icon name="arrow" size={14} />
                    </button>
                  ) : (
                    <div className="citation-removed">
                      <span />
                      本次回答没有引用长期理解
                    </div>
                  )}
                </article>

                {message && (
                  <article className="message user-message latest-message">
                    <div className="speaker">
                      <span className="speaker-dot user-dot" />你{' '}
                      <time>刚刚</time>
                    </div>
                    <p>{message}</p>
                  </article>
                )}
              </section>

              <form className="composer" onSubmit={sendDemoMessage}>
                <textarea
                  aria-label="输入消息"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="接着聊下去……"
                  rows={2}
                />
                <div className="composer-bottom">
                  <span>演示交互 · 不会调用模型</span>
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    aria-label="发送演示消息"
                  >
                    <Icon name="arrow" size={17} />
                  </button>
                </div>
              </form>
              <p className="privacy-note">
                示例内容仅保存在这台设备的原型数据中。
              </p>
            </main>

            <aside
              className={`context-pane ${showSource ? 'expanded' : ''}`}
              aria-label="回答依据"
            >
              <div className="context-heading">
                <div>
                  <span className="context-kicker">回答旁注</span>
                  <h2>这句话从哪里来</h2>
                </div>
                <button
                  className="icon-button close-context"
                  onClick={() => setShowSource(false)}
                  aria-label="收起回答依据"
                >
                  <Icon name="close" size={17} />
                </button>
              </div>

              {!understanding ? (
                <div className="empty-context">
                  <span className="empty-orbit">
                    <i />
                  </span>
                  <strong>没有可用的理解</strong>
                  <p>这条理解已撤回。它不会再参与后续回答。</p>
                  <button
                    className="quiet-button"
                    onClick={restoreUnderstanding}
                  >
                    <Icon name="restore" size={15} />
                    恢复演示内容
                  </button>
                </div>
              ) : (
                <>
                  <div className="context-thread">
                    <span className="thread-node" />
                    <div className="context-block">
                      <div className="context-meta">
                        <span className="status-label">暂定理解</span>
                        <span>·</span>
                        <time>更新于 {understanding.updatedAt}</time>
                      </div>
                      {editing ? (
                        <div className="edit-area">
                          <label htmlFor="understanding-edit">
                            改写 Noema 对这段经历的理解
                          </label>
                          <textarea
                            id="understanding-edit"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            rows={5}
                          />
                          <div className="edit-actions">
                            <button
                              className="quiet-button"
                              onClick={() => {
                                setDraft(understanding.text);
                                setEditing(false);
                              }}
                            >
                              取消
                            </button>
                            <button className="save-button" onClick={saveEdit}>
                              保存修改
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="understanding-text">
                          {understanding.text}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="source-card">
                    <div className="source-card-head">
                      <Icon name="quote" size={15} />
                      <span>用户原话</span>
                      <span className="source-date">10 月 11 日</span>
                    </div>
                    <blockquote>“{understanding.source}”</blockquote>
                    <button
                      className="source-link"
                      onClick={() => setShowSource((value) => !value)}
                      aria-expanded={showSource}
                    >
                      {showSource ? '收起来源说明' : '查看来源与处理方式'}{' '}
                      <Icon name="arrow" size={14} />
                    </button>
                    {showSource && (
                      <div className="source-details">
                        <p>
                          <b>来源</b> 与 Noema 的对话 · “需求背后的业务”
                        </p>
                        <p>
                          <b>处理</b> Noema
                          根据原话形成的暂定概括；不是用户逐字确认的规则。
                        </p>
                        <p>
                          <b>作用</b>{' '}
                          仅作为相关话题中的参考，可随时改写、忽略或撤回。
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="context-actions">
                    <span>你可以决定它是否继续影响回答。</span>
                    <button
                      className="context-action"
                      onClick={() => {
                        setDraft(understanding.text);
                        setEditing(true);
                      }}
                    >
                      <Icon name="edit" size={15} />
                      改写这条理解
                    </button>
                    {!excluded ? (
                      <button
                        className="context-action"
                        onClick={() => {
                          setExcluded(true);
                          setNotice(
                            '已设置为后续回答不再采用。当前回答的历史来源仍保留。',
                          );
                        }}
                      >
                        <Icon name="close" size={15} />
                        后续回答暂不采用
                      </button>
                    ) : (
                      <button
                        className="context-action undo-action"
                        onClick={() => {
                          setExcluded(false);
                          setNotice('已恢复为可在后续相关话题中采用。');
                        }}
                      >
                        <Icon name="restore" size={15} />
                        撤销后续排除
                      </button>
                    )}
                    <button
                      className="context-action revoke-action"
                      onClick={revokeUnderstanding}
                    >
                      <Icon name="close" size={15} />
                      撤回这条理解
                    </button>
                  </div>
                  {excluded && (
                    <p className="excluded-state">
                      <Icon name="check" size={14} />
                      已设为后续不采用；不会改写已生成的回答。
                    </p>
                  )}
                  <div className="context-footnote">
                    <span className="footnote-symbol">i</span>
                    <span>
                      原始对话与系统概括分开保存。导出时可带走概括及来源片段。
                    </span>
                  </div>
                </>
              )}
            </aside>
          </div>
        ) : (
          <main className="understandings-page">
            <div className="understanding-page-head">
              <div>
                <p className="conversation-date">NOEMA / CONTEXT</p>
                <h1>不是记住一切，而是看清哪些理解正在生效。</h1>
                <p>
                  这里列出的不是完整对话记录，而是可能影响后续交流的暂定理解。每条都能追溯、修改、带走或撤回。
                </p>
              </div>
              <label className="import-button">
                <Icon name="upload" size={16} />
                导入理解
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) =>
                    importUnderstanding(event.target.files?.[0])
                  }
                />
              </label>
            </div>
            {understanding ? (
              <article className="understanding-record">
                <div className="record-index">
                  <span className="record-line" />
                  <span>01</span>
                </div>
                <div className="record-content">
                  <div className="context-meta">
                    <span className="status-label">暂定理解</span>
                    <span>·</span>
                    <time>更新于 {understanding.updatedAt}</time>
                  </div>
                  {editing ? (
                    <div className="edit-area">
                      <label htmlFor="understanding-edit-page">
                        改写 Noema 对这段经历的理解
                      </label>
                      <textarea
                        id="understanding-edit-page"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        rows={4}
                      />
                      <div className="edit-actions">
                        <button
                          className="quiet-button"
                          onClick={() => {
                            setDraft(understanding.text);
                            setEditing(false);
                          }}
                        >
                          取消
                        </button>
                        <button className="save-button" onClick={saveEdit}>
                          保存修改
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="record-text">{understanding.text}</p>
                  )}
                  <div className="record-source">
                    <span>来自你的原话</span>
                    <blockquote>“{understanding.source}”</blockquote>
                    <small>
                      对话 · 2026 年 10 月 11 日 · 由 Noema 概括，尚未由你确认
                    </small>
                  </div>
                  <div className="record-controls">
                    <button
                      className="quiet-button"
                      onClick={() => {
                        setDraft(understanding.text);
                        setEditing(true);
                      }}
                    >
                      <Icon name="edit" size={15} />
                      改写
                    </button>
                    <button
                      className="quiet-button revoke-action"
                      onClick={revokeUnderstanding}
                    >
                      <Icon name="close" size={15} />
                      撤回
                    </button>
                  </div>
                </div>
              </article>
            ) : (
              <div className="understanding-empty">
                <span className="empty-orbit">
                  <i />
                </span>
                <strong>目前没有正在生效的理解</strong>
                <p>导入一份理解文件，或回到对话继续交流。</p>
                <button
                  className="quiet-button"
                  onClick={() => setView('conversation')}
                >
                  回到对话 <Icon name="arrow" size={15} />
                </button>
              </div>
            )}
            <div className="portability-note">
              <div>
                <strong>理解应该属于你，而不是某个模型。</strong>
                <span>
                  导出文件包含理解条目与来源片段；不会包含整段聊天、模型私有推理或工具凭据。
                </span>
              </div>
              <button className="export-button" onClick={exportUnderstanding}>
                <Icon name="download" size={16} />
                导出理解
              </button>
            </div>
          </main>
        )}

        <footer className="statusbar">
          <span>
            <i />
            本地原型
          </span>
          <span>未连接模型 · 所有示例均为演示数据</span>
          <span>v{bridge.appVersion}</span>
        </footer>
      </div>

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
