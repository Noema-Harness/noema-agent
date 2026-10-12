import type { NoemaBridge } from './noema-bridge.d.ts';
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

function App() {
  const bridge: NoemaBridge = window.noema;
  return (
    <main className="shell">
      <header className="topbar">
        <a className="wordmark" href="#home" aria-label="Noema 首页">
          <span className="mark" aria-hidden="true">
            N
          </span>
          <span>Noema</span>
        </a>
        <div className="topbar-meta">
          <span className="status-dot" />
          <span>本地工作区</span>
          <span className="divider" />
          <span className="version">v{bridge.appVersion}</span>
        </div>
      </header>

      <section className="welcome" id="home">
        <div className="eyebrow">
          <span>个人智能体</span>
          <span className="eyebrow-line" />
        </div>
        <h1>
          一个属于你的
          <br />
          <em>智能体，</em>从这里开始。
        </h1>
        <p className="intro">
          Noema 的基础运行环境已经就位。关于它如何理解、记住和陪伴，
          <br className="desktop-break" />
          我们会在真正需要时，一起把答案做出来。
        </p>
        <div className="foundation-card">
          <div className="card-icon" aria-hidden="true">
            <span />
          </div>
          <div className="card-copy">
            <strong>基础环境已就绪</strong>
            <span>当前仅运行桌面原型，尚未连接模型或外部服务。</span>
          </div>
          <span className="ready-label">
            <i />
            运行中
          </span>
        </div>
        <div className="quiet-note">
          <span className="note-mark">✳</span>
          <span>现在还没有预设好的答案，也不必急着决定它最终会是什么。</span>
        </div>
      </section>

      <footer className="footer">
        <span>
          NOEMA <span className="footer-separator">/</span> PERSONAL AGENT
        </span>
        <span>你的数据，只属于你</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
