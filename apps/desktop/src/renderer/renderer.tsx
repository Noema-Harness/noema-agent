import React from 'react';
import { createRoot } from 'react-dom/client';
import { FocusStyleManager } from '@blueprintjs/core';
import { CoreChatApp } from './chat/core-chat-app';
import { LegacyHistoryArchiveDialog } from './archive/legacy-history-archive-dialog';
performance.mark('noema.renderer.entry-evaluated');
FocusStyleManager.onlyShowFocusOnTabs();
if (import.meta.env.DEV && import.meta.env.VITE_NOEMA_SMOKE_HMR === '1') {
  void import('./hmr-smoke.css');
}
function App() {
  if (typeof window.noema?.getSocialState !== 'function')
    return (
      <main className="desktop-runtime-needed">
        <section
          className="desktop-runtime-card"
          aria-labelledby="desktop-runtime-title"
        >
          <p className="desktop-runtime-brand">noema</p>
          <h1 id="desktop-runtime-title">请在 Noema 桌面客户端中继续</h1>
          <p>
            当前浏览器页面没有连接本机对话服务，因此不会读取或保存对话，也不能发送消息。
          </p>
          <p>请启动 Noema 桌面客户端，再从那里继续使用。</p>
        </section>
      </main>
    );
  if (window.location.hash === '#legacy') {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
  }
  return window.location.hash === '#archive' ? (
    <LegacyArchiveRoute />
  ) : (
    <CoreChatApp />
  );
}

function LegacyArchiveRoute() {
  const [open, setOpen] = React.useState(true);
  return open ? (
    <LegacyHistoryArchiveDialog
      open
      onClose={() => {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}`,
        );
        setOpen(false);
      }}
    />
  ) : (
    <CoreChatApp />
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
