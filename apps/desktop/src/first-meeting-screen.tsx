import React, { useEffect, useRef, useState } from 'react';
import { FIRST_MEETING_LETTER } from './first-meeting.mjs';
import './first-meeting.css';

type Props = {
  initialStep: 'letter' | 'encounter';
  connected: boolean;
  onRead: () => Promise<void>;
  onEnter: (message: string) => Promise<void>;
  onConnect: () => void;
  onReturn?: () => void;
};

export function FirstMeeting({
  initialStep,
  connected,
  onRead,
  onEnter,
  onConnect,
  onReturn,
}: Props) {
  const [step, setStep] = useState(initialStep);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroll.current?.scrollTo(0, 0);
    heading.current?.focus();
  }, [step]);

  const move = async (text?: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (text === undefined) {
        await onRead();
        setStep('encounter');
      } else await onEnter(text);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '没有保存成功，请重试。',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`first-meeting first-meeting-${step}`}
      ref={scroll}
      aria-label="与 Noema 初次相遇"
    >
      <div className="meeting-page">
        <nav className="meeting-wayfinding" aria-label="开场导航">
          <span className="meeting-edition">
            NOEMA <span aria-hidden="true">/</span> 初次相遇
          </span>
          {onReturn ? (
            <button type="button" onClick={onReturn} disabled={busy}>
              回到对话 <span aria-hidden="true">↗</span>
            </button>
          ) : null}
        </nav>
        <div className="meeting-layout">
          <aside className="meeting-margin" aria-hidden="true">
            <span className="meeting-folio">
              {step === 'letter' ? '01' : '02'}
            </span>
            <span className="meeting-margin-label">
              {step === 'letter' ? '来自创作者' : '从你开始'}
            </span>
            <div className="meeting-sequence">
              <i className={step === 'letter' ? 'current' : ''} />
              <i className={step === 'encounter' ? 'current' : ''} />
            </div>
          </aside>
          {step === 'letter' ? (
            <article className="meeting-letter" aria-labelledby="meeting-title">
              <p className="meeting-byline">一封写在见面前的短笺</p>
              <h1 id="meeting-title" ref={heading} tabIndex={-1}>
                在见面之前
              </h1>
              <div className="meeting-letter-body">
                {FIRST_MEETING_LETTER.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              <p className="meeting-signature">
                Noema 的创作者<span>写于这个尝试的开始</span>
              </p>
              <div className="meeting-letter-footer">
                <span>下一页，把话留给你。</span>
                <button
                  className="meeting-primary"
                  type="button"
                  disabled={busy}
                  onClick={() => void move()}
                >
                  {busy ? '正在打开…' : '去见 Noema'}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </article>
          ) : (
            <section
              className="meeting-encounter"
              aria-labelledby="meeting-title"
            >
              <p className="meeting-byline">还没有共同的故事</p>
              <h1 id="meeting-title" ref={heading} tabIndex={-1}>
                第一句话，由你来。
              </h1>
              <p className="meeting-invitation">
                是什么让你想认识 Noema？
                <br />
                也可以不回答，从此刻想说的事开始。
              </p>
              <form
                className="meeting-first-message"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (message.trim() && connected) void move(message.trim());
                }}
              >
                <label
                  className="meeting-input-label"
                  htmlFor="meeting-message"
                >
                  你想对 Noema 说的话
                </label>
                <textarea
                  id="meeting-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="写在这里……"
                  maxLength={10000}
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      if (message.trim() && connected)
                        void move(message.trim());
                    }
                  }}
                />
                <div className="meeting-compose-footer">
                  <span>
                    {connected
                      ? '这句话会成为你们对话的开头'
                      : '读完开场不需要连接模型'}
                  </span>
                  <button
                    className="meeting-send"
                    aria-label="发送第一句话"
                    type="submit"
                    disabled={busy || !message.trim() || !connected}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 19V5m-6 6 6-6 6 6" />
                    </svg>
                  </button>
                </div>
              </form>
              {!connected ? (
                <div className="meeting-connection">
                  <span>开始交谈前，需要连接一个模型服务。</span>
                  <button type="button" onClick={onConnect}>
                    连接模型 <span aria-hidden="true">↗</span>
                  </button>
                </div>
              ) : null}
              <p className="meeting-data-note">
                发送后，内容会交给你配置的模型服务处理，对话记录保存在本机。
              </p>
              <div className="meeting-encounter-footer">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStep('letter')}
                >
                  <span aria-hidden="true">←</span> 重读短笺
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void move('')}
                >
                  暂时不写，先进去看看 <span aria-hidden="true">→</span>
                </button>
              </div>
            </section>
          )}
        </div>
        {error ? (
          <p className="meeting-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
