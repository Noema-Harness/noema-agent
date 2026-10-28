import React, { useEffect, useRef, useState } from 'react';
import { FIRST_MEETING_LETTER } from './first-meeting.mjs';
import arrivalArtwork from './noema-arrival-art.svg?url';

type Props = {
  onRead: () => Promise<void>;
  onEnter: () => Promise<void>;
  onReturn?: () => void;
};
export function FirstMeeting({ onRead, onEnter, onReturn }: Props) {
  const [letterOpen, setLetterOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const letterButton = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  const enter = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onEnter();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '没有打开成功，请重试。',
      );
    } finally {
      setBusy(false);
    }
  };
  const toggleLetter = async () => {
    if (letterOpen) {
      setLetterOpen(false);
      return;
    }
    setLetterOpen(true);
    try {
      await onRead();
    } catch {
      setError('创作者说明已打开，但本机阅读状态尚未保存。');
    }
  };
  return (
    <section
      className={`first-meeting arrival${letterOpen ? ' letter-open' : ''}`}
      aria-labelledby="arrival-title"
    >
      {!letterOpen ? (
        <div className="arrival-art" aria-hidden="true">
          <img src={arrivalArtwork} alt="" />
        </div>
      ) : null}
      <div className="arrival-inner">
        <div className="arrival-identity">
          <div className="arrival-name">
            <svg
              className="arrival-mark"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M5 18V9a5 5 0 0 1 10 0v9M9 18V9m10 9V6" />
            </svg>
            <h1 id="arrival-title" ref={title} tabIndex={-1}>
              noema
            </h1>
          </div>
          <p className="arrival-description">一个与你长期相处的 AI。</p>
          <div className="arrival-actions">
            <button
              className="arrival-enter"
              type="button"
              disabled={busy}
              onClick={() => void enter()}
            >
              {busy ? '正在打开…' : '进入 Noema'}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14m-5-5 5 5-5 5" />
              </svg>
            </button>
            <button
              className="arrival-letter-toggle"
              type="button"
              ref={letterButton}
              aria-expanded={letterOpen}
              aria-controls="arrival-letter"
              onClick={() => void toggleLetter()}
            >
              创作者的话<span aria-hidden="true">{letterOpen ? '−' : '+'}</span>
            </button>
          </div>
          {onReturn ? (
            <button className="arrival-return" type="button" onClick={onReturn}>
              返回当前对话
            </button>
          ) : null}
        </div>
        {letterOpen ? (
          <article
            id="arrival-letter"
            className="arrival-letter"
            aria-label="创作者的话"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setLetterOpen(false);
                letterButton.current?.focus();
              }
            }}
          >
            <div className="arrival-letter-heading">
              <span>关于这个开始</span>
              <button
                type="button"
                aria-label="收起创作者的话"
                onClick={() => {
                  setLetterOpen(false);
                  letterButton.current?.focus();
                }}
              >
                ×
              </button>
            </div>
            {FIRST_MEETING_LETTER.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <footer>Noema 的创作者</footer>
          </article>
        ) : null}
      </div>
      <div className="arrival-foot">
        <span>初次见面</span>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
