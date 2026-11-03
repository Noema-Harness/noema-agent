import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { SocialChatApp } from './chat/social-chat-app';
const LegacyDesktopApp = lazy(() => import('./legacy/desktop-app'));
performance.mark('noema.renderer.entry-evaluated');
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
  return window.location.hash === '#legacy' ? (
    <Suspense fallback={null}>
      <LegacyDesktopApp />
    </Suspense>
  ) : (
    <SocialChatApp />
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
