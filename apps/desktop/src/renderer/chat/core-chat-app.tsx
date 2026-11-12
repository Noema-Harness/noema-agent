import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  NoemaSocialMessage,
  NoemaSocialWorkTask,
} from '../../shared/contracts/noema-bridge.d.ts';
import { NoemaButton } from '../ui/noema-button';
import { Icon } from './presentation';
import { markdownComponents } from './markdown';
import { TurnTrace, type LiveTraceEvent } from './turn-trace';
import { useSocialChatController } from './use-social-chat-controller';
import { WorkspaceFilesDialog } from './dialogs/workspace-files-dialog';
import { PartnerSettingsDialog } from '../settings/partner-settings-dialog';

function messageTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function taskStatusLabel(status: NoemaSocialWorkTask['status']) {
  switch (status) {
    case 'starting':
      return '准备中';
    case 'running':
      return '执行中';
    case 'verifying':
      return '核验中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '未完成';
    case 'interrupted':
      return '已中断';
  }
}

function taskVerificationLabel(
  status: NoemaSocialWorkTask['verificationStatus'],
) {
  switch (status) {
    case 'verified':
      return '已核验';
    case 'failed':
      return '核验未通过';
    case 'unavailable':
      return '无法核验';
    case 'pending':
      return '待核验';
    case 'not_planned':
      return '未核验';
  }
}

function fileStateLabel(
  state: NoemaSocialWorkTask['fileChanges'][number]['state'],
) {
  switch (state) {
    case 'applied':
      return '已写入';
    case 'kept':
      return '已保留';
    case 'reverted':
      return '已撤回';
    case 'conflict':
      return '有冲突';
    case 'pending':
      return '待确认';
    case 'not_applied':
      return '未生效';
    case 'unknown':
      return '状态未知';
  }
}

function taskTrace(
  task: NoemaSocialWorkTask,
  live: ReturnType<typeof useSocialChatController>['liveTrace'],
): {
  events: LiveTraceEvent[];
  done: boolean;
  durationMs: number | null;
} | null {
  const source = live?.taskId === task.id ? live : null;
  const events: LiveTraceEvent[] = [];
  for (const step of task.executionSteps) {
    const call = source?.events.find(
      (event) => event.type === 'tool_call' && event.stepId === step.id,
    );
    events.push({
      type: 'tool_call',
      name: step.toolName,
      status: 'running',
      stepId: step.id,
      detail: call?.detail ?? step.detail ?? null,
      output: step.output ?? null,
    });
    events.push({
      type: 'tool_result',
      name: step.toolName,
      status:
        step.status === 'running'
          ? 'running'
          : step.status === 'succeeded'
            ? 'completed'
            : 'failed',
      stepId: step.id,
      output: step.output ?? null,
    });
  }
  const start = Date.parse(task.createdAt);
  const end = Date.parse(task.completedAt ?? task.updatedAt);
  const durationMs =
    Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? end - start
      : null;
  if (events.length) {
    return {
      events,
      done: ['completed', 'failed', 'interrupted'].includes(task.status),
      durationMs,
    };
  }
  if (!source) return null;
  return {
    events: source.events.map((event) => ({
      type: event.type === 'tool_result' ? 'tool_result' : 'tool_call',
      name: event.name,
      status: event.status,
      stepId: event.stepId,
      detail: event.detail,
      output: event.output,
    })),
    done: Boolean(source.done),
    durationMs,
  };
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

function MessageActions({
  text,
  onQuote,
  onRetry,
  onEdit,
}: {
  text: string;
  onQuote: (text: string) => void;
  onRetry?: () => void;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!text.trim() && !onRetry) return null;
  return (
    <div className="message-actions" aria-label="消息操作">
      {onEdit ? (
        <NoemaButton
          className="message-action"
          type="button"
          title="修改"
          aria-label="修改"
          onClick={onEdit}
        >
          <Icon name="edit" />
        </NoemaButton>
      ) : null}
      {onRetry ? (
        <NoemaButton
          className="message-action"
          type="button"
          title="重试"
          aria-label="重试"
          onClick={onRetry}
        >
          <Icon name="refresh" />
        </NoemaButton>
      ) : null}
      {text.trim() ? (
        <NoemaButton
          className="message-action"
          type="button"
          title={copied ? '已复制' : '复制'}
          aria-label={copied ? '已复制' : '复制'}
          onClick={async () => {
            if (!(await copyText(text))) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} />
        </NoemaButton>
      ) : null}
      {text.trim() ? (
        <NoemaButton
          className="message-action"
          type="button"
          title="引用"
          aria-label="引用"
          onClick={() => onQuote(text)}
        >
          <Icon name="quote" />
        </NoemaButton>
      ) : null}
    </div>
  );
}

export function CoreChatApp() {
  const controller = useSocialChatController();
  const {
    noemaRoom,
    currentRoom,
    selectRoom,
    conversationTurns,
    draft,
    setDraft,
    draftAttachments,
    addDraftAttachments,
    removeDraftAttachment,
    attachmentInputRef,
    handleComposerKeyDown,
    handleSend,
    rewindAndResend,
    continuity,
    handleStop,
    handleRetry,
    handleResumeProjectWork,
    handleContinueProjectWork,
    busy,
    activeReply,
    providerReady,
    providerWarning,
    setSettingsOpen,
    notice,
    liveTrace,
    windowMaximized,
    setWindowMaximized,
    draftRef,
    conversationRef,
    shouldFollowRef,
    setShowJumpToLatest,
    showJumpToLatest,
    historyPageLoading,
  } = controller;

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [taskWorkspace, setTaskWorkspace] = useState<{
    path: string;
    initialFile: string | null;
  } | null>(null);

  const visibleTurns = useMemo(
    () => conversationTurns.filter((turn) => turn.items.length > 0),
    [conversationTurns],
  );

  useEffect(() => {
    if (noemaRoom && currentRoom?.id !== noemaRoom.id) selectRoom(noemaRoom);
  }, [currentRoom?.id, noemaRoom, selectRoom]);

  const saveEdit = async (message: NoemaSocialMessage) => {
    const text = editingText.trim();
    if (!text) return;
    const items = conversationTurns.flatMap((turn) => turn.items);
    const index = items.findIndex(
      (item) => item.kind === 'message' && item.message.id === message.id,
    );
    const later = index >= 0 && index < items.length - 1;
    const notice =
      continuity?.mode === 'on'
        ? '修改这条消息会新建一个分支并重新发送，原对话保留。继续吗？'
        : '修改这条消息会回退它之后的对话，然后重新发送。继续吗？';
    if (later && !window.confirm(notice)) return;
    setEditingMessageId(null);
    setEditingText('');
    await rewindAndResend(message.id, text);
  };

  const quoteMessage = (text: string) => {
    const selected = window.getSelection()?.toString().trim();
    const source = selected || text;
    const quoted = source
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    const existing = draft.trimEnd();
    setDraft(existing ? `${existing}\n\n${quoted}\n\n` : `${quoted}\n\n`);
    window.requestAnimationFrame(() => {
      const area = draftRef.current;
      if (!area) return;
      area.focus();
      const end = area.value.length;
      area.setSelectionRange(end, end);
    });
  };

  const renderMessage = (message: NoemaSocialMessage) => {
    if (message.role === 'system') return null;
    const hasWorkTask = visibleTurns.some((turn) =>
      turn.items.some((item) => item.kind === 'work-task'),
    );
    if (
      message.role === 'assistant' &&
      hasWorkTask &&
      /^已开始这项工作|^已交给.*工单受理/.test(message.content.trim())
    )
      return null;
    const user = message.role === 'user' && message.senderAgentId !== 'noema';
    const streaming = message.status === 'streaming';
    return (
      <article
        className={`message ${user ? 'user user-message' : 'assistant agent-message'} chat-message core-message`}
        key={message.id}
        data-message-id={message.id}
      >
        <div className="byline">
          {!user ? (
            <span className="message-author-mark" aria-hidden="true">
              <Icon name="noema" />
            </span>
          ) : null}
          <strong>{user ? '你' : 'Noema'}</strong>
          <span>{messageTime(message.createdAt)}</span>
        </div>
        <div className="message-content">
          {editingMessageId === message.id ? (
            <div className="message-editor">
              <textarea
                value={editingText}
                onChange={(event) => setEditingText(event.target.value)}
                rows={Math.min(8, Math.max(2, editingText.split('\n').length))}
                autoFocus
              />
              <div className="message-editor-actions">
                <NoemaButton
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setEditingMessageId(null);
                    setEditingText('');
                  }}
                >
                  取消
                </NoemaButton>
                <NoemaButton
                  type="button"
                  className="text-button primary"
                  disabled={!editingText.trim() || busy || Boolean(activeReply)}
                  onClick={() => void saveEdit(message)}
                >
                  保存并发送
                </NoemaButton>
              </div>
            </div>
          ) : message.content ? (
            <ReactMarkdown
              components={markdownComponents}
              remarkPlugins={[remarkGfm]}
            >
              {message.content}
            </ReactMarkdown>
          ) : streaming ? (
            <span className="typing-state">正在回复…</span>
          ) : null}
          {message.status === 'interrupted' ? (
            <p className="request-explanation">
              本轮回复没有完成。消息已保留，你可以重试。
            </p>
          ) : null}
          {message.status === 'failed' ? (
            <p className="request-explanation">
              {message.errorMessage ?? '这条回复没有完成。'}
            </p>
          ) : null}
        </div>
        {editingMessageId === message.id ? null : (
          <MessageActions
            text={message.content}
            onQuote={quoteMessage}
            onEdit={
              user && !busy && !activeReply
                ? () => {
                    setEditingMessageId(message.id);
                    setEditingText(message.content);
                  }
                : undefined
            }
            onRetry={
              message.status === 'failed'
                ? () => handleRetry(message)
                : undefined
            }
          />
        )}
      </article>
    );
  };

  const renderTask = (task: NoemaSocialWorkTask) => {
    const trace = taskTrace(task, liveTrace);
    const canResume =
      task.canResume &&
      (task.status === 'failed' || task.status === 'interrupted');
    const canContinue =
      task.status === 'completed' &&
      Boolean(task.runtimeSessionId && task.workspacePath);
    const blockedResume =
      !canResume &&
      Boolean(task.resumeBlockReason) &&
      (task.status === 'failed' || task.status === 'interrupted');
    const openWorkspace = (initialFile: string | null = null) => {
      if (!task.workspacePath) return;
      setTaskWorkspace({ path: task.workspacePath, initialFile });
    };
    return (
      <article
        className="message assistant agent-message chat-message core-message core-task"
        key={task.id}
      >
        <div className="byline">
          <span className="message-author-mark" aria-hidden="true">
            <Icon name="noema" />
          </span>
          <strong>Noema</strong>
          <span>{messageTime(task.updatedAt)}</span>
          <span className="core-task-status" data-status={task.status}>
            {taskStatusLabel(task.status)}
          </span>
        </div>
        <div className="message-content">
          {trace ? (
            <TurnTrace
              events={trace.events}
              done={trace.done}
              durationMs={trace.durationMs}
            />
          ) : null}
          <p
            className="core-task-verification"
            data-status={task.verificationStatus}
          >
            {taskVerificationLabel(task.verificationStatus)}
          </p>
          {task.fileChanges.length ? (
            <div className="core-task-files">
              <div className="core-task-files-head">
                <strong>{task.fileChanges.length} 个文件</strong>
                <NoemaButton
                  className="core-task-file-action"
                  type="button"
                  disabled={!task.workspacePath}
                  onClick={() => openWorkspace()}
                >
                  查看文件
                </NoemaButton>
              </div>
              <div className="core-task-file-list">
                {task.fileChanges.map((change) => (
                  <NoemaButton
                    className="core-task-file"
                    type="button"
                    key={change.id}
                    title={`查看 ${change.relativePath}`}
                    disabled={!task.workspacePath}
                    onClick={() => openWorkspace(change.relativePath)}
                  >
                    <span className="core-task-file-path">
                      {change.relativePath}
                    </span>
                    <small>{fileStateLabel(change.state)}</small>
                  </NoemaButton>
                ))}
              </div>
            </div>
          ) : null}
          {task.resultText ? (
            <ReactMarkdown
              components={markdownComponents}
              remarkPlugins={[remarkGfm]}
            >
              {task.resultText}
            </ReactMarkdown>
          ) : task.status === 'running' ? (
            <span className="typing-state">正在执行…</span>
          ) : null}
          {task.status === 'failed' && task.errorMessage ? (
            <p className="core-task-error">{task.errorMessage}</p>
          ) : null}
          {canResume || canContinue ? (
            <div className="core-task-actions">
              {canResume ? (
                <NoemaButton
                  className="core-task-action"
                  type="button"
                  disabled={busy || Boolean(activeReply)}
                  onClick={() => void handleResumeProjectWork(task)}
                >
                  从检查点继续
                </NoemaButton>
              ) : null}
              {canContinue ? (
                <NoemaButton
                  className="core-task-action"
                  type="button"
                  disabled={busy || Boolean(activeReply)}
                  onClick={() => void handleContinueProjectWork(task)}
                >
                  继续这项任务
                </NoemaButton>
              ) : null}
            </div>
          ) : null}
          {blockedResume ? (
            <p className="core-task-note">{task.resumeBlockReason}</p>
          ) : null}
        </div>
        <MessageActions text={task.resultText ?? ''} onQuote={quoteMessage} />
      </article>
    );
  };

  const sendDisabled =
    !providerReady || busy || (!draft.trim() && draftAttachments.length === 0);

  return (
    <div className="core-shell">
      <header className="core-topbar">
        <div className="core-brand">
          <Icon name="noema" />
          <strong>Noema</strong>
        </div>
        <div className="core-top-actions">
          <NoemaButton
            className="icon-button"
            type="button"
            title="设置"
            aria-label="设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" />
          </NoemaButton>
          <div className="window-controls" aria-label="窗口控件">
            <NoemaButton
              className="window-control"
              type="button"
              title="最小化"
              aria-label="最小化"
              onClick={() => void window.noema.controlWindow('minimize')}
            >
              <Icon name="minus" />
            </NoemaButton>
            <NoemaButton
              className="window-control"
              type="button"
              title={windowMaximized ? '还原窗口' : '最大化'}
              aria-label={windowMaximized ? '还原窗口' : '最大化'}
              onClick={() =>
                void window.noema
                  .controlWindow('maximize')
                  .then(setWindowMaximized)
              }
            >
              <Icon name={windowMaximized ? 'restore' : 'maximize'} />
            </NoemaButton>
            <NoemaButton
              className="window-control close-control"
              type="button"
              title="关闭窗口"
              aria-label="关闭窗口"
              onClick={() => void window.noema.controlWindow('close')}
            >
              <Icon name="close" />
            </NoemaButton>
          </div>
        </div>
      </header>

      <main
        className="core-thread"
        ref={conversationRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          shouldFollowRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            60;
          setShowJumpToLatest(!shouldFollowRef.current);
        }}
      >
        <div className="core-thread-inner">
          {historyPageLoading ? (
            <p className="request-explanation">正在读取更早的消息…</p>
          ) : null}
          {!historyPageLoading && visibleTurns.length === 0 ? (
            <div className="core-empty">
              <h1>有什么想做的？</h1>
              <p>直接说结果，Noema 会安排执行并在这里展示过程。</p>
            </div>
          ) : null}
          {visibleTurns.map((turn) => (
            <React.Fragment key={turn.id}>
              {turn.items
                .filter(
                  (item) =>
                    !(
                      item.kind === 'message' &&
                      item.message.role === 'assistant' &&
                      /工单受理|已开始这项工作|已交给/.test(
                        item.message.content,
                      ) &&
                      turn.items.some((next) => next.kind === 'work-task')
                    ),
                )
                .map((item) =>
                  item.kind === 'message'
                    ? renderMessage(item.message)
                    : renderTask(item.task),
                )}
            </React.Fragment>
          ))}
        </div>
        {showJumpToLatest ? (
          <NoemaButton
            className="jump-to-latest"
            type="button"
            onClick={() => {
              const element = conversationRef.current;
              if (!element) return;
              element.scrollTop = element.scrollHeight;
              setShowJumpToLatest(false);
            }}
          >
            回到最新消息
          </NoemaButton>
        ) : null}
      </main>

      <footer className="core-composer">
        {notice ? (
          <p className="core-notice" role="status">
            {notice}
          </p>
        ) : null}
        {!providerReady ? (
          <div className="core-provider-warning">
            <span>{providerWarning ?? '还没有连接模型。'}</span>
            <NoemaButton
              className="secondary"
              type="button"
              onClick={() => setSettingsOpen(true)}
            >
              连接模型
            </NoemaButton>
          </div>
        ) : null}
        {draftAttachments.length ? (
          <div className="core-attachments">
            {draftAttachments.map((attachment, index) => (
              <span key={`${attachment.name}-${index}`}>
                {attachment.name}
                <button
                  type="button"
                  aria-label={`移除 ${attachment.name}`}
                  onClick={() => removeDraftAttachment(index)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="core-composer-box">
          <textarea
            ref={draftRef}
            value={draft}
            placeholder="说说你正在想的事…"
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          <div className="core-composer-actions">
            <input
              ref={attachmentInputRef}
              type="file"
              hidden
              multiple
              onChange={(event) => {
                void addDraftAttachments(event.target.files);
                event.target.value = '';
              }}
            />
            <NoemaButton
              className="icon-button"
              type="button"
              title="添加附件"
              aria-label="添加附件"
              onClick={() => attachmentInputRef.current?.click()}
            >
              <Icon name="attach" />
            </NoemaButton>
            {busy || activeReply ? (
              <NoemaButton
                className="secondary"
                type="button"
                onClick={() => void handleStop()}
              >
                停止
              </NoemaButton>
            ) : (
              <NoemaButton
                className="primary core-send"
                type="button"
                disabled={sendDisabled}
                onClick={() => void handleSend()}
              >
                <Icon name="send" />
              </NoemaButton>
            )}
          </div>
        </div>
        <p className="core-hint">Enter 发送 · Shift + Enter 换行</p>
      </footer>

      <PartnerSettingsDialog model={controller} />
      {taskWorkspace ? (
        <WorkspaceFilesDialog
          workspacePath={taskWorkspace.path}
          initialFile={taskWorkspace.initialFile}
          onClose={() => setTaskWorkspace(null)}
        />
      ) : null}
    </div>
  );
}
