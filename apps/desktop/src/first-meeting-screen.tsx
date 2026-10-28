import React, { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';

type Props = {
  onEnter: () => Promise<void>;
  onReturn?: () => void;
};
export function FirstMeeting({ onEnter, onReturn }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  const enter = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const transitionDocument = document as Document & {
        startViewTransition?: (callback: () => Promise<void>) => {
          updateCallbackDone: Promise<void>;
        };
      };
      if (transitionDocument.startViewTransition) {
        const transition = transitionDocument.startViewTransition(onEnter);
        await transition.updateCallbackDone;
      } else {
        await onEnter();
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '没有打开成功，请重试。',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="first-meeting arrival" aria-labelledby="arrival-title">
      <div className="arrival-inner">
        <div className="arrival-composition">
          <div className="arrival-signature" aria-hidden="true">
            <span>n</span>
            <span>o</span>
            <span>e</span>
            <span>m</span>
            <span>a</span>
          </div>
          <div className="arrival-copy">
            <p className="arrival-kicker">
              <span /> 初次见面
            </p>
            <h1 id="arrival-title" ref={title} tabIndex={-1}>
              先说一半，
              <br />
              也可以。
            </h1>
            <p className="arrival-support">想法还没理清，也能从这里开始。</p>
            <div className="arrival-actions">
              <Button
                className="arrival-enter"
                variant="primary"
                type="button"
                disabled={busy}
                onClick={() => void enter()}
              >
                {busy ? '正在打开…' : '进入聊天'}
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14m-5-5 5 5-5 5" />
                </svg>
              </Button>
            </div>
            {onReturn ? (
              <button
                className="arrival-return"
                type="button"
                onClick={onReturn}
              >
                返回当前对话
              </button>
            ) : null}
            {error ? (
              <p className="arrival-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
