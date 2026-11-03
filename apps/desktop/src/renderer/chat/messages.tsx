import React, { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  socialWorkCardTitle,
  socialWorkExecutionStepPresentation,
  socialWorkRecoveryPresentation,
  socialWorkResultPresentation,
} from '../../shared/execution/social-work-presentation.mjs';
import type {
  NoemaSocialAgent,
  NoemaSocialHistorySource,
  NoemaSocialMessage,
  NoemaSocialRoom,
  NoemaSocialWorkGitReview,
  NoemaSocialWorkTask,
} from '../../shared/contracts/noema-bridge.d.ts';
import { timeLabel, Icon, AgentMark } from './presentation';

export const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    src ? (
      <a href={src} target="_blank" rel="noreferrer noopener">
        查看图片{alt ? `：${alt}` : '链接'}
      </a>
    ) : null,
  pre: ({ children }) => <pre className="social-code-block">{children}</pre>,
};

export function ChatMessage({
  message,
  showNoemaMark,
  continuationOrigin,
  roomClosed,
  agent,
  onRetry,
  onOpenHistorySource,
  forwardSelectionActive,
  forwardSelected,
  onReply,
  onForward,
  onToggleForward,
  continuationThreads,
  onOpenContinuation,
}: {
  message: NoemaSocialMessage;
  showNoemaMark: boolean;
  continuationOrigin: boolean;
  roomClosed: boolean;
  agent: NoemaSocialAgent | null;
  onRetry: (message: NoemaSocialMessage) => void;
  onOpenHistorySource: (source: NoemaSocialHistorySource) => void;
  forwardSelectionActive: boolean;
  forwardSelected: boolean;
  onReply: () => void;
  onForward: () => void;
  onToggleForward: () => void;
  continuationThreads: NoemaSocialRoom[];
  onOpenContinuation: (room: NoemaSocialRoom) => void;
}) {
  const [copyState, setCopyState] = useState<'ready' | 'copied' | 'error'>(
    'ready',
  );
  if (message.role === 'system')
    return (
      <div className="session-label system-message">{message.content}</div>
    );
  const fromNoema = message.senderAgentId === 'noema';
  const user = message.role === 'user' && !fromNoema;
  const failed =
    message.status === 'failed' || message.status === 'interrupted';
  return (
    <article
      className={`message ${user ? 'user user-message' : 'assistant agent-message'} chat-message${forwardSelected ? ' is-forward-selected' : ''}`}
      data-message-id={message.id}
    >
      {user && showNoemaMark ? (
        <div className="byline user-byline">
          <strong>你</strong>
          <span>{timeLabel(message.createdAt)}</span>
        </div>
      ) : !user ? (
        <div className="byline">
          {showNoemaMark ? (
            <span className="message-author-mark" aria-hidden="true">
              <Icon name="noema" />
            </span>
          ) : null}
          <strong>{fromNoema ? 'Noema' : (agent?.name ?? 'Noema')}</strong>
          <span>{timeLabel(message.createdAt)}</span>
        </div>
      ) : null}
      <div className="message-content">
        {message.replyTo ? (
          <div className="message-quote">
            <strong>{message.replyTo.sender}</strong>：{message.replyTo.content}
          </div>
        ) : null}
        {message.forwardedSources.length ? (
          <div className="forwarded-message-card">
            <strong>
              {continuationOrigin
                ? '来源消息'
                : message.forwardedSources.length > 1
                  ? '合并转发'
                  : '转发消息'}
            </strong>
            <span className="forwarded-message-source">
              来自「{message.forwardedSources[0].roomTitle}」
            </span>
            {message.forwardedSources.map((source) => (
              <div
                className="forwarded-message-item"
                key={`${source.roomId}:${source.id}`}
              >
                <div>
                  <strong>{source.sender}</strong>
                  <time dateTime={source.createdAt}>
                    {timeLabel(source.createdAt)}
                  </time>
                </div>
                <p>{source.content}</p>
              </div>
            ))}
          </div>
        ) : null}
        {message.content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
        ) : message.status === 'streaming' ? (
          <span className="typing-state">
            <i />
            <i />
            <i />
            <span>正在回复</span>
          </span>
        ) : null}
        {failed ? (
          <div className="message-failure" role="status">
            <span>{message.errorMessage ?? '这条回复没有完成。'}</span>
            <button
              type="button"
              onClick={() => onRetry(message)}
              disabled={roomClosed}
            >
              重试
            </button>
          </div>
        ) : null}
        {!user ? (
          <SocialHistoryRecallTrace
            message={message}
            onOpenSource={onOpenHistorySource}
          />
        ) : null}
        {continuationThreads.map((thread) => (
          <button
            className="message-continuation-link"
            type="button"
            key={thread.id}
            onClick={() => onOpenContinuation(thread)}
          >
            ↳ 继续：{thread.title}
            {thread.closedAt ? ' · 已结束' : ''}
          </button>
        ))}
      </div>
      {message.status === 'complete' && !roomClosed ? (
        <div className="message-actions">
          {forwardSelectionActive ? (
            <button
              type="button"
              className={forwardSelected ? 'is-selected' : ''}
              aria-pressed={forwardSelected}
              onClick={onToggleForward}
            >
              {forwardSelected ? '已选择' : '选择转发'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(message.content)
                    .then(() => setCopyState('copied'))
                    .catch(() => setCopyState('error'))
                }
              >
                {copyState === 'copied'
                  ? '已复制'
                  : copyState === 'error'
                    ? '复制失败，重试'
                    : '复制'}
              </button>
              <button type="button" onClick={onReply}>
                引用
              </button>
              <button type="button" onClick={onForward}>
                转发
              </button>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

export const GroupMessage = React.memo(function GroupMessage({
  message,
  agent,
  queuedAgentName,
  onRetry,
}: {
  message: NoemaSocialMessage;
  agent: NoemaSocialAgent | null;
  queuedAgentName: string | null;
  onRetry: (message: NoemaSocialMessage) => void;
}) {
  if (message.role === 'system')
    return <div className="note-row">{message.content}</div>;
  const fromNoema =
    message.role === 'user' && message.senderAgentId === 'noema';
  const user = message.role === 'user' && !fromNoema;
  return (
    <article className="group-msg" data-message-id={message.id}>
      {agent ? (
        <AgentMark agent={agent} />
      ) : (
        <span className="portrait">你</span>
      )}
      <div className="msg-text">
        <header>
          <strong>
            {fromNoema ? 'Noema' : user ? '你' : (agent?.name ?? 'Noema')}
          </strong>
          <span>
            {message.deliveryStatus === 'queued'
              ? '待处理 · ' + (queuedAgentName ?? '成员')
              : timeLabel(message.createdAt)}
          </span>
        </header>
        {message.replyTo ? (
          <div className="message-quote">
            {message.replyTo.sender}：{message.replyTo.content}
          </div>
        ) : null}
        {message.content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
        ) : message.status === 'streaming' ? (
          <span className="typing-state">正在回复…</span>
        ) : null}
        {['failed', 'interrupted'].includes(message.status) ? (
          <div className="message-failure" role="status">
            <span>{message.errorMessage ?? '这条回复没有完成。'}</span>
            <button type="button" onClick={() => onRetry(message)}>
              重试
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
});

export function SocialHistoryRecallTrace({
  message,
  onOpenSource,
}: {
  message: NoemaSocialMessage;
  onOpenSource: (source: NoemaSocialHistorySource) => void;
}) {
  if (message.historySearchStatus === 'not_searched') return null;
  const sources = message.historySources;
  const summary =
    message.historySearchStatus === 'no_match'
      ? '查过 Noema 的旧对话，没有找到相关内容'
      : message.historySourcesIncluded
        ? `本轮请求带入 ${sources.length} 条旧对话摘录`
        : `本机找到 ${sources.length} 条旧对话；上游是否收到无法确认`;
  return (
    <details className="history-recall-trace social-history-recall-trace">
      <summary>{summary}</summary>
      {sources.length ? (
        <ul>
          {sources.map((source) => (
            <li key={source.id}>
              <div className="history-source-heading">
                <span>
                  {source.roomTitle} · {source.role === 'user' ? '你' : 'Noema'}{' '}
                  · {timeLabel(source.createdAt)}
                  {source.redacted ? ' · 部分内容已隐藏' : ''}
                </span>
                <button type="button" onClick={() => onOpenSource(source)}>
                  跳到原对话
                </button>
              </div>
              <blockquote>{source.snippet}</blockquote>
            </li>
          ))}
        </ul>
      ) : message.historySearchStatus === 'found' ? (
        <p>来源消息已删除，Noema 不再保留该摘录。</p>
      ) : (
        <p>只检查了 Noema 主私聊及其延续主题；没有把旧消息加入本轮请求。</p>
      )}
      {sources.length && message.historySourcesIncluded ? (
        <p className="history-recall-caveat">
          已将这些摘录发送给当前模型服务；这不证明模型实际使用或理解了它们。
        </p>
      ) : null}
      {sources.length && !message.historySourcesIncluded ? (
        <p className="history-recall-caveat">
          本机找到了这些摘录，但请求未成功送达当前模型服务。
        </p>
      ) : null}
    </details>
  );
}

export function ProjectWorkCard({
  task,
  agent,
  onStop,
  onResume,
  onRepeat,
  onDisableCase,
  onWithdrawPractice,
  onReviewFileChange,
  gitReview,
  onReviewGitState,
}: {
  task: NoemaSocialWorkTask;
  agent: NoemaSocialAgent | null;
  onStop: () => void;
  onResume: () => void;
  onRepeat: () => void;
  onDisableCase: () => void;
  onWithdrawPractice: () => void;
  onReviewFileChange: (changeId: string, action: 'keep' | 'revert') => void;
  gitReview: NoemaSocialWorkGitReview | null;
  onReviewGitState: () => void;
}) {
  const active = ['starting', 'running', 'verifying'].includes(task.status);
  const resultPresentation = socialWorkResultPresentation(task);
  const recovery = ['failed', 'interrupted'].includes(task.status)
    ? socialWorkRecoveryPresentation(task)
    : null;
  const verification = {
    not_planned: '本次没有设置独立核验条件。',
    pending: '正在核验文件结果。',
    verified: '列出的文件条件已通过核验。',
    failed: '列出的文件条件未通过核验。',
    unavailable: '本次无法独立核验文件结果。',
  }[task.verificationStatus];
  return (
    <section
      className={`work-request project-work-card project-work-${task.status}`}
      aria-label={task.taskPrompt}
      data-task-id={task.id}
    >
      <h3>{task.taskPrompt.split('\n')[0].slice(0, 72) || '项目工作'}</h3>
      <p role="status">{socialWorkCardTitle(task)}</p>
      <dl>
        <dt>执行者</dt>
        <dd>{agent?.name ?? '执行成员'}</dd>
        <dt>范围</dt>
        <dd>
          <code title={task.workspacePath}>{task.workspacePath}</code>
        </dd>
        <dt>本次请求</dt>
        <dd>{task.taskPrompt}</dd>
      </dl>
      {task.errorMessage ? (
        <p className="request-explanation" role="status">
          {task.errorMessage}
        </p>
      ) : null}
      {recovery ? (
        <p className="request-explanation" role="status">
          {recovery.message}
        </p>
      ) : null}
      <div className="request-actions">
        {active ? (
          <button className="secondary" type="button" onClick={onStop}>
            停止这项执行
          </button>
        ) : null}
        {recovery ? (
          <>
            {task.canResume ? (
              <button className="primary" type="button" onClick={onResume}>
                从检查点继续
              </button>
            ) : null}
            <button
              className={task.canResume ? 'secondary' : 'primary'}
              type="button"
              onClick={onRepeat}
            >
              再次编辑并执行
            </button>
          </>
        ) : null}
      </div>
      {active || recovery ? (
        <p className="request-explanation">
          停止不会撤销已经产生的文件修改。
          {recovery
            ? task.canResume
              ? '“从检查点继续”沿用已保存的工具结果；再次编辑会创建新任务。'
              : '再次执行会创建新任务，不会续接刚才的会话。'
            : ''}
        </p>
      ) : null}
      <details>
        <summary>
          查看执行记录
          {task.executionSteps.length ? ` · ${task.executionSteps.length}` : ''}
        </summary>
        {task.executionSteps.length ? (
          <ol>
            {task.executionSteps.map((step) => {
              const view = socialWorkExecutionStepPresentation(step);
              return (
                <li key={step.id}>
                  {view.categoryLabel} — {view.statusLabel}
                  {view.effectLabel ? ` · ${view.effectLabel}` : ''}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="request-explanation">还没有可展示的工具执行记录。</p>
        )}
        <p className="request-explanation">
          记录工具类别与状态，不包含工具参数或文件内容。
        </p>
      </details>
      {resultPresentation.visible ? (
        <div className="work-result">
          <h4>{resultPresentation.title}</h4>
          {resultPresentation.caveat ? (
            <p className="request-explanation" role="status">
              {resultPresentation.caveat}
            </p>
          ) : null}
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {task.resultText}
          </ReactMarkdown>
        </div>
      ) : null}
      {!active ? <p className="request-explanation">{verification}</p> : null}
      {task.fileChanges.length ? (
        <details className="project-file-review">
          <summary>审阅 Noema 文件工具变更 · {task.fileChanges.length}</summary>
          <p className="request-explanation">
            这里只列出 Noema
            的文件工具变更；命令或外部程序造成的变化不在此恢复范围内。
          </p>
          {task.fileChanges.map((change) => {
            const label = {
              pending: '写入结果待核对',
              applied: '已写入，待你决定',
              unknown: '写入结果不确定',
              not_applied: '写入未生效',
              kept: '已保留',
              reverted: '已撤回',
              conflict: '内容有变化，未覆盖',
            }[change.state];
            const reviewable =
              !active &&
              ['pending', 'applied', 'unknown', 'conflict'].includes(
                change.state,
              );
            return (
              <section className="project-file-review-item" key={change.id}>
                <h4>
                  <code>
                    {change.originalExists ? '修改' : '新建'} ·{' '}
                    {change.relativePath}
                  </code>
                </h4>
                <p role="status">{label}</p>
                {change.diffText ? <pre>{change.diffText}</pre> : null}
                {change.diffTruncated ? (
                  <p className="request-explanation">差异显示已截断。</p>
                ) : null}
                {reviewable ? (
                  <div className="request-actions">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => onReviewFileChange(change.id, 'keep')}
                    >
                      保留当前文件
                    </button>
                    {['pending', 'applied'].includes(change.state) ? (
                      <button
                        className="quiet"
                        type="button"
                        onClick={() => onReviewFileChange(change.id, 'revert')}
                      >
                        安全撤回此文件
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
        </details>
      ) : null}
      {!active ? (
        <details className="project-git-review">
          <summary>查看当前 Git 工作区状态</summary>
          <p className="request-explanation">
            这是工作区当前状态，可能包含任务开始前已有的修改；它不是本任务独占差异。此视图只读，不执行暂存、提交或清理。
          </p>
          <button
            className="secondary"
            type="button"
            onClick={onReviewGitState}
          >
            读取 Git 状态
          </button>
          {gitReview ? (
            gitReview.available ? (
              <div className="project-git-review-results">
                {gitReview.files.length ? (
                  gitReview.files.map((file) => (
                    <section
                      className="project-file-review-item"
                      key={file.relativePath}
                    >
                      <h4>
                        <code>
                          {file.status} {file.relativePath}
                        </code>
                      </h4>
                      {file.diffText ? <pre>{file.diffText}</pre> : null}
                      {file.diffTruncated ? (
                        <p className="request-explanation">差异内容已截断。</p>
                      ) : null}
                    </section>
                  ))
                ) : (
                  <p className="request-explanation">
                    当前没有 Git 已跟踪或未跟踪的文件变更。
                  </p>
                )}
              </div>
            ) : (
              <p className="request-explanation" role="status">
                {gitReview.reason === 'not_a_repository'
                  ? '所选目录不属于 Git 工作区。'
                  : gitReview.reason === 'git_timeout'
                    ? 'Git 检查超时；没有修改仓库。'
                    : 'Git 当前状态无法安全读取；没有修改仓库。'}
              </p>
            )
          ) : null}
        </details>
      ) : null}
      {task.caseSnapshot || task.practiceSnapshot || task.practiceCandidate ? (
        <details>
          <summary>本次经验引用与候选</summary>
          {task.caseSnapshot ? (
            <p>
              引用案例：{task.caseSnapshot.taskPrompt}（
              {task.caseSnapshot.roomTitle}）
            </p>
          ) : null}
          {task.practiceSnapshot ? (
            <p>试用做法：{task.practiceSnapshot.action}</p>
          ) : null}
          {task.practiceCandidate ? (
            <>
              <p>{task.practiceCandidate.trigger}</p>
              <p>{task.practiceCandidate.action}</p>
              <p className="request-explanation">
                {task.practiceCandidate.limits}
              </p>
              {['available', 'trialing', 'trialed'].includes(
                task.practiceCandidateStatus,
              ) ? (
                <button
                  className="quiet"
                  type="button"
                  onClick={onWithdrawPractice}
                >
                  撤回候选做法
                </button>
              ) : null}
            </>
          ) : null}
          <p className="request-explanation">候选做法不等于已经掌握的能力。</p>
        </details>
      ) : null}
      {task.status === 'completed' &&
      task.verificationStatus === 'verified' &&
      task.caseEligible ? (
        <details>
          <summary>案例引用设置</summary>
          <p className="request-explanation">
            这项工作的文件条件通过了核验，可供同项目后续工作参考。
          </p>
          <button type="button" className="quiet" onClick={onDisableCase}>
            不再引用此案例
          </button>
        </details>
      ) : null}
    </section>
  );
}
