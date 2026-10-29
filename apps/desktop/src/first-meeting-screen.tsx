import React, { useState } from 'react';
import { FIRST_MEETING_LETTER } from './first-meeting.mjs';
import './first-meeting.css';

type Props = {
  mode?: 'empty' | 'replay';
  onRead: () => Promise<void>;
  onClose?: () => void;
};

export function FirstMeeting({ mode = 'empty', onRead, onClose }: Props) {
  const [letterOpen, setLetterOpen] = useState(mode === 'replay');
  const [error, setError] = useState('');

  const openLetter = async () => {
    setLetterOpen(true);
    setError('');
    try {
      await onRead();
    } catch {
      setError('说明已打开，但阅读状态尚未保存。');
    }
  };

  const letter = (
    <article className="arrival-letter" aria-label="创作者的话">
      {mode === 'replay' ? (
        <header className="arrival-letter-heading">
          <span>创作者的话</span>
          <button type="button" aria-label="关闭创作者的话" onClick={onClose}>
            ×
          </button>
        </header>
      ) : null}
      <div className="arrival-letter-copy">
        {FIRST_MEETING_LETTER.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      {error ? (
        <p className="arrival-letter-error" role="status">
          {error}
        </p>
      ) : null}
      <footer>Noema 的创作者</footer>
    </article>
  );

  if (mode === 'replay') {
    return (
      <div
        className="creator-note-backdrop"
        role="presentation"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose?.();
        }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose?.();
        }}
      >
        <div
          className="creator-note-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="创作者的话"
        >
          {letter}
        </div>
      </div>
    );
  }

  return (
    <section className="first-meeting-entry" aria-label="初次相遇">
      <svg
        className="first-meeting-mark"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M5 18V9a5 5 0 0 1 10 0v9M9 18V9m10 9V6" />
      </svg>
      <button
        className="arrival-letter-toggle"
        type="button"
        aria-expanded={letterOpen}
        onClick={() => {
          if (letterOpen) setLetterOpen(false);
          else void openLetter();
        }}
      >
        创作者的话 <span aria-hidden="true">{letterOpen ? '−' : '+'}</span>
      </button>
      {letterOpen ? letter : null}
    </section>
  );
}
