import { useState, type FormEvent } from 'react';
import type { NoemaSocialProjectReview } from './noema-bridge.d.ts';

export function ProjectReviewCard({
  review,
  draft,
  onDraftChange,
  onSubmit,
  disabled,
}: {
  review: NoemaSocialProjectReview;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  disabled: boolean;
}) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || submitting || !draft.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '反馈尚未提交，请重试。',
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <section
      className="review-request"
      data-project-review={review.id}
      data-review-message-id={review.requestMessageId}
      aria-label={`${review.projectTitle}评审反馈`}
      tabIndex={-1}
    >
      <div className="review-context">
        {review.projectTitle} /{' '}
        {review.status === 'pending' ? '等待你的反馈' : '反馈已提交'}
      </div>
      {review.status === 'answered' ? (
        <div className="review-receipt">
          Noema 已收到。后续处理保留在本对话中。
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor={`review-feedback-${review.id}`}>
            你的判断与调整意见
          </label>
          <textarea
            id={`review-feedback-${review.id}`}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={3}
            maxLength={40_000}
            placeholder="可以说喜欢哪里、哪里要改，或还需要澄清什么…"
            required
            disabled={submitting}
          />
          {error ? (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="review-submit">
            <span>明确反馈交给 Noema；普通聊天不会解除项目等待。</span>
            <button
              className="primary"
              type="submit"
              disabled={disabled || submitting || !draft.trim()}
            >
              {submitting ? '正在提交…' : '发送反馈'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
