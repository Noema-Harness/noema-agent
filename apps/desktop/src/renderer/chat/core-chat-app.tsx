import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  NoemaSocialMessage,
  NoemaSocialProject,
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
      return '执行完成';
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
      return '未独立核验';
  }
}

type GrowthMember = NonNullable<
  NoemaSocialProject['growthBatch']
>['members'][number];

function growthMemberStatusLabel(status: GrowthMember['status']) {
  switch (status) {
    case 'pending':
      return '等待整理';
    case 'running':
      return '整理中';
    case 'completed':
      return '已整理';
    case 'no_change':
      return '无变化';
    case 'interrupted':
      return '已中断';
    case 'failed':
      return '失败';
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

function isActiveTask(status: NoemaSocialWorkTask['status']) {
  return (
    status === 'starting' || status === 'running' || status === 'verifying'
  );
}

function isSettledTask(status: NoemaSocialWorkTask['status']) {
  return (
    status === 'completed' || status === 'failed' || status === 'interrupted'
  );
}

type DeliveryEventStatus = 'completed' | 'failed' | 'interrupted';

interface DeliveryEvent {
  taskId: string;
  agentName: string;
  status: DeliveryEventStatus;
  at: string;
}

const DELIVERY_EVENTS_STORAGE_KEY = 'noema.delivery-events.v1';

function readDeliveryEvents(): DeliveryEvent[] {
  try {
    const raw = window.localStorage.getItem(DELIVERY_EVENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is DeliveryEvent => {
        if (!entry || typeof entry !== 'object') return false;
        const event = entry as Partial<DeliveryEvent>;
        return (
          typeof event.taskId === 'string' &&
          typeof event.agentName === 'string' &&
          typeof event.at === 'string' &&
          (event.status === 'completed' ||
            event.status === 'failed' ||
            event.status === 'interrupted')
        );
      })
      .slice(-8);
  } catch {
    return [];
  }
}

type TimelineEntry =
  | {
      kind: 'message';
      at: string;
      key: string;
      order: number;
      message: NoemaSocialMessage;
    }
  | {
      kind: 'event';
      at: string;
      key: string;
      order: number;
      event: DeliveryEvent;
    };

function deliveryEventLabel(status: DeliveryEventStatus) {
  switch (status) {
    case 'completed':
      return '已交付';
    case 'failed':
      return '未完成';
    case 'interrupted':
      return '已中断';
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
    openAgentConversation,
    rooms,
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
    saveAssistantEdit,
    latestArchive,
    restoreLatestArchive,
    handleStop,
    handleRetry,
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
    agents,
    projects,
    teams,
    projectStatusBusy,
    retryProjectGrowthMember,
  } = controller;

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [taskWorkspace, setTaskWorkspace] = useState<{
    path: string;
    initialFile: string | null;
  } | null>(null);
  const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);
  const [completedNoticeId, setCompletedNoticeId] = useState<string | null>(
    null,
  );
  const [taskHistoryOpen, setTaskHistoryOpen] = useState(false);
  const [taskHistoryAll, setTaskHistoryAll] = useState(false);
  const [section, setSection] = useState<
    'chat' | 'teams' | 'projects' | 'members'
  >('chat');
  const [deliveryEvents, setDeliveryEvents] =
    useState<DeliveryEvent[]>(readDeliveryEvents);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [growthProjectId, setGrowthProjectId] = useState<string | null>(null);
  const growthProject =
    (growthProjectId
      ? projects.find((project) => project.id === growthProjectId)
      : null) ?? null;
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousTaskStatus = useRef(
    new Map<string, NoemaSocialWorkTask['status']>(),
  );

  const visibleTurns = useMemo(
    () =>
      conversationTurns
        .map((turn) => ({
          ...turn,
          items: turn.items.filter(
            (item) => item.kind === 'message' && item.message.role !== 'system',
          ),
        }))
        .filter((turn) => turn.items.length > 0),
    [conversationTurns],
  );

  const directRoomByAgent = useMemo(() => {
    const result = new Map<string, (typeof rooms)[number]>();
    for (const room of rooms) {
      if (room.kind !== 'direct') continue;
      for (const memberId of room.memberIds) {
        if (memberId !== 'noema') result.set(memberId, room);
      }
    }
    return result;
  }, [rooms]);

  const activeTeams = useMemo(
    () => teams.filter((team) => team.status !== 'archived'),
    [teams],
  );
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status !== 'archived'),
    [projects],
  );
  const visibleMembers = useMemo(
    () => agents.filter((agent) => agent.id !== 'noema' && !agent.archivedAt),
    [agents],
  );
  const roomById = useMemo(
    () => new Map(rooms.map((room) => [room.id, room])),
    [rooms],
  );
  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const openTeamGroup = (groupRoomId: string) => {
    const room = roomById.get(groupRoomId);
    if (!room) return;
    selectRoom(room);
    setSection('chat');
  };
  const openMemberChat = (agentId: string) => {
    openAgentConversation(agentId);
    setSection('chat');
  };
  const returnToNoema = () => {
    setSection('chat');
    if (noemaRoom) selectRoom(noemaRoom);
  };

  const timelineEntries = useMemo(() => {
    let order = 0;
    const entries: TimelineEntry[] = [];
    for (const turn of visibleTurns) {
      for (const item of turn.items) {
        if (item.kind !== 'message') continue;
        entries.push({
          kind: 'message',
          at: item.message.createdAt,
          key: `message:${item.message.id}`,
          order: order++,
          message: item.message,
        });
      }
    }
    for (const event of deliveryEvents) {
      entries.push({
        kind: 'event',
        at: event.at,
        key: `event:${event.taskId}`,
        order: order++,
        event,
      });
    }
    return entries.sort(
      (left, right) =>
        left.at.localeCompare(right.at) || left.order - right.order,
    );
  }, [deliveryEvents, visibleTurns]);

  const workTasks = useMemo(() => {
    const seen = new Set<string>();
    const tasks: NoemaSocialWorkTask[] = [];
    for (const turn of conversationTurns) {
      for (const item of turn.items) {
        if (item.kind === 'work-task' && !seen.has(item.task.id)) {
          seen.add(item.task.id);
          tasks.push(item.task);
        }
      }
    }
    return tasks;
  }, [conversationTurns]);

  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const agentNameForTask = (task: NoemaSocialWorkTask) =>
    agentNames.get(task.agentId) ?? '执行者';
  const inspectedTask =
    (inspectedTaskId
      ? workTasks.find((task) => task.id === inspectedTaskId)
      : null) ?? null;
  const activeTasks = useMemo(
    () => workTasks.filter((task) => isActiveTask(task.status)),
    [workTasks],
  );
  const settledTasks = useMemo(
    () => workTasks.filter((task) => isSettledTask(task.status)),
    [workTasks],
  );
  const sortedSettledTasks = useMemo(
    () =>
      settledTasks
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [settledTasks],
  );
  const visibleSettledTasks = taskHistoryAll
    ? sortedSettledTasks
    : sortedSettledTasks.slice(0, 8);
  const completedNotice =
    (completedNoticeId
      ? workTasks.find((task) => task.id === completedNoticeId)
      : null) ?? null;

  useEffect(() => {
    const settledNow: Array<{
      task: NoemaSocialWorkTask;
      status: DeliveryEventStatus;
    }> = [];
    for (const task of workTasks) {
      const previous = previousTaskStatus.current.get(task.id);
      if (
        previous &&
        previous !== task.status &&
        (task.status === 'completed' ||
          task.status === 'failed' ||
          task.status === 'interrupted')
      ) {
        settledNow.push({ task, status: task.status });
      }
      previousTaskStatus.current.set(task.id, task.status);
    }
    if (!settledNow.length) return;
    const latest = settledNow[settledNow.length - 1];
    setCompletedNoticeId(latest.task.id);
    setDeliveryEvents((current) => {
      const next = [...current];
      for (const { task, status } of settledNow) {
        if (next.some((event) => event.taskId === task.id)) continue;
        next.push({
          taskId: task.id,
          agentName: agentNames.get(task.agentId) ?? '执行者',
          status,
          at: task.updatedAt,
        });
      }
      return next.slice(-8);
    });
    const timer = window.setTimeout(() => setCompletedNoticeId(null), 8000);
    return () => window.clearTimeout(timer);
  }, [agentNames, workTasks]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        DELIVERY_EVENTS_STORAGE_KEY,
        JSON.stringify(deliveryEvents),
      );
    } catch {
      // Notification persistence is best effort; the delivery ledger remains durable.
    }
  }, [deliveryEvents]);

  useEffect(() => {
    if (!deliveryEvents.length || !shouldFollowRef.current) return;
    const element = conversationRef.current;
    if (!element) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationRef, deliveryEvents.length, shouldFollowRef]);

  useEffect(() => {
    if (!editingMessageId) return;
    const frame = window.requestAnimationFrame(() => {
      const area = editTextareaRef.current;
      if (!area) return;
      area.focus();
      const end = area.value.length;
      area.setSelectionRange(end, end);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingMessageId]);

  const saveEdit = async (message: NoemaSocialMessage) => {
    const text = editingText.trim();
    if (!text) return;
    if (text === message.content.trim()) {
      setEditingMessageId(null);
      setEditingText('');
      return;
    }
    setEditingMessageId(null);
    setEditingText('');
    if (message.role === 'assistant') {
      await saveAssistantEdit(message.id, text);
      return;
    }
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
    const hasWorkTask = conversationTurns.some((turn) =>
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
          <strong>
            {user
              ? '你'
              : currentRoom?.kind === 'direct' &&
                  currentRoom.id !== noemaRoom?.id
                ? currentRoom.title
                : 'Noema'}
          </strong>
          <span>{messageTime(message.createdAt)}</span>
        </div>
        <div className="message-content">
          {!user &&
          liveTrace?.messageId === message.id &&
          liveTrace.events.length ? (
            <TurnTrace events={liveTrace.events} done={liveTrace.done} />
          ) : null}
          {editingMessageId === message.id ? (
            <div className="message-editor">
              <textarea
                ref={editTextareaRef}
                value={editingText}
                onChange={(event) => setEditingText(event.target.value)}
                rows={Math.min(8, Math.max(2, editingText.split('\n').length))}
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
                  {user ? '保存并发送' : '保存'}
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
              (user || (!user && message.status === 'complete')) &&
              !busy &&
              !activeReply
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

  const renderTaskInspector = (task: NoemaSocialWorkTask) => {
    const trace = taskTrace(task, liveTrace);
    const openWorkspace = (initialFile: string | null = null) => {
      if (!task.workspacePath) return;
      setTaskWorkspace({ path: task.workspacePath, initialFile });
    };
    return (
      <section
        className="core-task-inspector"
        role="dialog"
        aria-modal="true"
        aria-label="任务详情"
      >
        <header className="core-task-inspector-head">
          <span className="core-task-inspector-avatar" aria-hidden="true">
            {agentNameForTask(task).slice(0, 1)}
          </span>
          <div className="core-task-inspector-title">
            <strong>{agentNameForTask(task)}</strong>
            <span>
              <span className="core-task-status" data-status={task.status}>
                {taskStatusLabel(task.status)}
              </span>
              {' · '}
              {task.executionSteps.length} 步
            </span>
          </div>
          <NoemaButton
            className="core-task-inspector-chat"
            type="button"
            title="打开执行者会话"
            onClick={() => {
              setInspectedTaskId(null);
              openAgentConversation(task.agentId);
            }}
          >
            会话
          </NoemaButton>
          <NoemaButton
            className="icon-button"
            type="button"
            title="关闭任务详情"
            aria-label="关闭任务详情"
            onClick={() => setInspectedTaskId(null)}
          >
            <Icon name="close" />
          </NoemaButton>
        </header>
        <div className="core-task-inspector-body">
          <details className="core-task-prompt">
            <summary>任务说明</summary>
            <p>{task.taskPrompt}</p>
          </details>
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
          {task.resumeBlockReason ? (
            <p className="core-task-note">{task.resumeBlockReason}</p>
          ) : null}
        </div>
      </section>
    );
  };

  const sendDisabled =
    !providerReady || busy || (!draft.trim() && draftAttachments.length === 0);
  const isExecutorDirect =
    currentRoom?.kind === 'direct' && currentRoom.id !== noemaRoom?.id;
  const isGroupRoom = currentRoom?.kind === 'group';
  const canReturnToNoema =
    section === 'chat' &&
    Boolean(currentRoom && noemaRoom) &&
    currentRoom?.id !== noemaRoom?.id;
  const title =
    section === 'teams'
      ? '团队'
      : section === 'projects'
        ? '项目'
        : section === 'members'
          ? '成员'
          : currentRoom?.title || 'Noema';
  const subtitle =
    section === 'chat'
      ? isExecutorDirect
        ? '常驻私聊'
        : isGroupRoom
          ? '群聊'
          : null
      : null;

  return (
    <div className="core-app">
      <aside className="core-sidebar" aria-label="主导航">
        <div className="core-sidebar-brand">
          <Icon name="noema" />
          <strong>Noema</strong>
        </div>
        <nav className="core-sidebar-nav">
          <button
            className="core-nav-item"
            data-active={section === 'chat'}
            type="button"
            aria-current={section === 'chat' ? 'page' : undefined}
            onClick={returnToNoema}
          >
            <Icon name="thread" />
            <span>对话</span>
          </button>
          <button
            className="core-nav-item"
            data-active={section === 'teams'}
            type="button"
            aria-current={section === 'teams' ? 'page' : undefined}
            onClick={() => setSection('teams')}
          >
            <Icon name="users" />
            <span>团队</span>
            <small>{activeTeams.length}</small>
          </button>
          <button
            className="core-nav-item"
            data-active={section === 'projects'}
            type="button"
            aria-current={section === 'projects' ? 'page' : undefined}
            onClick={() => setSection('projects')}
          >
            <Icon name="project" />
            <span>项目</span>
            <small>{activeProjects.length}</small>
          </button>
          <button
            className="core-nav-item"
            data-active={section === 'members'}
            type="button"
            aria-current={section === 'members' ? 'page' : undefined}
            onClick={() => setSection('members')}
          >
            <Icon name="user-add" />
            <span>成员</span>
            <small>{visibleMembers.length}</small>
          </button>
        </nav>
        <div className="core-sidebar-foot">
          <span className="core-status-dot" data-ready={providerReady} />
          {providerReady ? '本地运行' : '模型未连接'}
        </div>
      </aside>
      <div className="core-shell" data-section={section}>
        <header className="core-topbar">
          <div className="core-top-left">
            {canReturnToNoema ? (
              <NoemaButton
                className="icon-button core-back"
                type="button"
                title="返回 Noema"
                aria-label="返回 Noema"
                onClick={returnToNoema}
              >
                <Icon name="back" />
              </NoemaButton>
            ) : null}
            <div className="core-brand">
              <Icon name="noema" />
              <strong>{title}</strong>
              {subtitle ? <small>{subtitle}</small> : null}
            </div>
          </div>
          <div className="core-top-actions">
            {latestArchive ? (
              <NoemaButton
                className="icon-button"
                type="button"
                title="恢复修改前版本"
                aria-label="恢复修改前版本"
                disabled={busy || Boolean(activeReply)}
                onClick={() => setRestoreConfirmOpen(true)}
              >
                <Icon name="restore" />
              </NoemaButton>
            ) : null}
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
            {!historyPageLoading && timelineEntries.length === 0 ? (
              <div className="core-empty">
                <h1>
                  {currentRoom?.kind === 'direct' &&
                  currentRoom.id !== noemaRoom?.id
                    ? currentRoom.title
                    : '有什么想做的？'}
                </h1>
                <p>
                  {currentRoom?.kind === 'direct' &&
                  currentRoom.id !== noemaRoom?.id
                    ? '这里是你们的常驻私聊；任务执行记录仍留在对应任务里。'
                    : '直接说结果，Noema 会安排执行并在这里展示过程。'}
                </p>
              </div>
            ) : null}
            {timelineEntries.map((entry) =>
              entry.kind === 'message' ? (
                <React.Fragment key={entry.key}>
                  {renderMessage(entry.message)}
                </React.Fragment>
              ) : (
                <div
                  className="core-task-event"
                  data-status={entry.event.status}
                  key={entry.key}
                  role="status"
                >
                  <span className="core-task-event-icon" aria-hidden="true">
                    <Icon
                      name={
                        entry.event.status === 'completed' ? 'check' : 'close'
                      }
                    />
                  </span>
                  <span className="core-task-event-text">
                    <strong>{entry.event.agentName}</strong>
                    {deliveryEventLabel(entry.event.status)}
                  </span>
                  <NoemaButton
                    className="core-task-event-action"
                    type="button"
                    title="查看任务结果"
                    aria-label={`查看 ${entry.event.agentName} 的任务结果`}
                    onClick={() => setInspectedTaskId(entry.event.taskId)}
                  >
                    查看结果
                  </NoemaButton>
                </div>
              ),
            )}
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
          {activeTasks.length ? (
            <div className="core-task-dock" aria-label="进行中的任务">
              {activeTasks.slice(-3).map((task) => (
                <NoemaButton
                  className="core-task-dock-item"
                  type="button"
                  key={task.id}
                  title={task.taskPrompt}
                  aria-label={`查看 ${agentNameForTask(task)} 的任务`}
                  onClick={() => setInspectedTaskId(task.id)}
                >
                  <span
                    className="core-task-pulse"
                    data-status={task.status}
                    aria-hidden="true"
                  />
                  <span className="core-task-dock-agent">
                    {agentNameForTask(task)}
                  </span>
                  <span
                    className="core-task-dock-state"
                    data-status={task.status}
                  >
                    {taskStatusLabel(task.status)}
                  </span>
                  <span className="core-task-dock-meta">
                    {task.executionSteps.length} 步
                  </span>
                </NoemaButton>
              ))}
            </div>
          ) : null}
          {completedNotice ? (
            <NoemaButton
              className="core-task-delivery"
              type="button"
              onClick={() => setInspectedTaskId(completedNotice.id)}
            >
              <Icon name="check" aria-hidden="true" />
              <span>
                {agentNameForTask(completedNotice)} 已交付
                {completedNotice.status === 'completed'
                  ? ''
                  : ` · ${taskStatusLabel(completedNotice.status)}`}
              </span>
              <span className="core-task-delivery-open">查看</span>
            </NoemaButton>
          ) : null}
          {settledTasks.length ? (
            <NoemaButton
              className="core-task-ledger"
              type="button"
              title="交付记录"
              aria-label="交付记录"
              onClick={() => {
                setTaskHistoryAll(false);
                setTaskHistoryOpen(true);
              }}
            >
              <Icon name="archive" aria-hidden="true" />
            </NoemaButton>
          ) : null}
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

        {section !== 'chat' ? (
          <main className="core-page" aria-label={title}>
            <header className="core-page-head">
              <div>
                <h1>{title}</h1>
                <p>
                  {section === 'teams'
                    ? '长期协作的人与他们的团队群。'
                    : section === 'projects'
                      ? '有目标、计划和交付物的项目。'
                      : '可以随时直接对话的联系人。'}
                </p>
              </div>
            </header>
            <div className="core-page-body">
              {section === 'teams' ? (
                activeTeams.length ? (
                  <div className="core-card-grid">
                    {activeTeams.map((team) => {
                      const lead = team.leadAgentId
                        ? agentById.get(team.leadAgentId)?.name
                        : null;
                      const project = team.projectId
                        ? activeProjects.find(
                            (candidate) => candidate.id === team.projectId,
                          )
                        : null;
                      const canOpen = roomById.has(team.groupRoomId);
                      return (
                        <article className="core-card" key={team.id}>
                          <header>
                            <div>
                              <h2>{team.title}</h2>
                              <span>{team.members.length} 位成员</span>
                            </div>
                            <span className="core-tag">团队</span>
                          </header>
                          <p>{team.brief || '暂无说明。'}</p>
                          <dl className="core-card-meta">
                            <div>
                              <dt>负责人</dt>
                              <dd>{lead ?? '未指定'}</dd>
                            </div>
                            <div>
                              <dt>项目</dt>
                              <dd>{project?.title ?? '独立团队'}</dd>
                            </div>
                          </dl>
                          <button
                            className="core-card-action"
                            type="button"
                            disabled={!canOpen}
                            onClick={() => openTeamGroup(team.groupRoomId)}
                          >
                            {canOpen ? '打开团队群' : '团队群不可用'}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="core-empty">
                    <strong>还没有团队</strong>
                    <span>团队会出现在这里，并拥有自己的团队群。</span>
                  </div>
                )
              ) : null}
              {section === 'projects' ? (
                activeProjects.length ? (
                  <div className="core-card-grid">
                    {activeProjects.map((project) => {
                      const lead = project.leadAgentId
                        ? agentById.get(project.leadAgentId)?.name
                        : null;
                      const canOpen = roomById.has(project.groupRoomId);
                      return (
                        <article className="core-card" key={project.id}>
                          <header>
                            <div>
                              <h2>{project.title}</h2>
                              <span>{project.members.length} 位成员</span>
                            </div>
                            <span className="core-tag">项目</span>
                          </header>
                          <p>{project.brief || '暂无说明。'}</p>
                          <dl className="core-card-meta">
                            <div>
                              <dt>负责人</dt>
                              <dd>{lead ?? '未指定'}</dd>
                            </div>
                            <div>
                              <dt>状态</dt>
                              <dd>
                                {project.status === 'active'
                                  ? '进行中'
                                  : '等待反馈'}
                              </dd>
                            </div>
                          </dl>
                          <div className="core-card-actions">
                            <button
                              className="core-card-action"
                              type="button"
                              disabled={!canOpen}
                              onClick={() => openTeamGroup(project.groupRoomId)}
                            >
                              {canOpen ? '打开项目群' : '项目群不可用'}
                            </button>
                            {project.growthBatch ? (
                              <button
                                className="core-card-action"
                                type="button"
                                onClick={() => setGrowthProjectId(project.id)}
                              >
                                成长记录
                              </button>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="core-empty">
                    <strong>还没有项目</strong>
                    <span>
                      项目会出现在这里，并拥有自己的工作文件夹和群聊。
                    </span>
                  </div>
                )
              ) : null}
              {section === 'members' ? (
                visibleMembers.length ? (
                  <div className="core-member-list">
                    {visibleMembers.map((agent) => {
                      const canOpen = directRoomByAgent.has(agent.id);
                      return (
                        <button
                          className="core-member-row"
                          type="button"
                          key={agent.id}
                          disabled={!canOpen}
                          onClick={() => openMemberChat(agent.id)}
                        >
                          <span className="core-member-avatar">
                            {agent.name.slice(0, 1)}
                          </span>
                          <span className="core-member-copy">
                            <strong>{agent.name}</strong>
                            <small>{agent.headline}</small>
                          </span>
                          <span className="core-member-action">
                            {canOpen ? '私聊' : '不可用'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="core-empty">
                    <strong>还没有成员</strong>
                    <span>新建联系人后，可以直接从这里开始对话。</span>
                  </div>
                )
              ) : null}
            </div>
          </main>
        ) : null}

        {taskHistoryOpen ? (
          <div
            className="core-task-inspector-backdrop"
            onClick={() => setTaskHistoryOpen(false)}
            role="presentation"
          >
            <div
              className="core-task-inspector-wrap"
              onClick={(event) => event.stopPropagation()}
            >
              <section
                className="core-task-inspector core-task-history"
                aria-label="交付记录"
              >
                <header className="core-task-inspector-head">
                  <div className="core-task-inspector-title">
                    <strong>交付记录</strong>
                    <span>{settledTasks.length} 项已结束</span>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="关闭交付记录"
                    title="关闭"
                    onClick={() => setTaskHistoryOpen(false)}
                  >
                    ×
                  </button>
                </header>
                <div className="core-task-inspector-body">
                  <div className="core-task-history-list">
                    {visibleSettledTasks.map((task) => (
                      <button
                        type="button"
                        key={task.id}
                        className="core-task-history-item"
                        onClick={() => {
                          setTaskHistoryOpen(false);
                          setInspectedTaskId(task.id);
                        }}
                      >
                        <span className="core-task-history-main">
                          <strong>{agentNameForTask(task)}</strong>
                          <span>{task.taskPrompt}</span>
                        </span>
                        <span className="core-task-history-meta">
                          <span
                            className="core-task-dock-state"
                            data-status={task.status}
                          >
                            {taskStatusLabel(task.status)}
                          </span>
                          <span>{task.executionSteps.length} 步</span>
                        </span>
                      </button>
                    ))}
                    {settledTasks.length > 8 ? (
                      <button
                        type="button"
                        className="core-task-history-more"
                        onClick={() => setTaskHistoryAll((current) => !current)}
                      >
                        {taskHistoryAll
                          ? '只看最近 8 项'
                          : `查看全部 ${settledTasks.length} 项`}
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {inspectedTask ? (
          <div
            className="core-task-inspector-backdrop"
            onClick={() => setInspectedTaskId(null)}
            role="presentation"
          >
            <div
              className="core-task-inspector-wrap"
              onClick={(event) => event.stopPropagation()}
            >
              {renderTaskInspector(inspectedTask)}
            </div>
          </div>
        ) : null}
        {restoreConfirmOpen ? (
          <div
            className="core-task-inspector-backdrop"
            onClick={() => setRestoreConfirmOpen(false)}
            role="presentation"
          >
            <div
              className="core-confirm-wrap"
              onClick={(event) => event.stopPropagation()}
            >
              <section
                className="core-confirm-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="确认恢复修改前版本"
              >
                <header className="core-confirm-head">
                  <div>
                    <strong>恢复修改前版本？</strong>
                    <span>当前对话会被丢弃，然后回到存档内容。</span>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="关闭恢复确认"
                    title="关闭"
                    onClick={() => setRestoreConfirmOpen(false)}
                  >
                    ×
                  </button>
                </header>
                <footer className="core-confirm-actions">
                  <NoemaButton
                    className="text-button"
                    type="button"
                    onClick={() => setRestoreConfirmOpen(false)}
                  >
                    取消
                  </NoemaButton>
                  <NoemaButton
                    className="text-button primary"
                    type="button"
                    onClick={() => {
                      setRestoreConfirmOpen(false);
                      void restoreLatestArchive();
                    }}
                  >
                    恢复
                  </NoemaButton>
                </footer>
              </section>
            </div>
          </div>
        ) : null}

        {growthProject?.growthBatch ? (
          <div
            className="core-task-inspector-backdrop"
            onClick={() => setGrowthProjectId(null)}
            role="presentation"
          >
            <div
              className="core-confirm-wrap core-growth-wrap"
              onClick={(event) => event.stopPropagation()}
            >
              <section
                className="core-confirm-dialog core-growth-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="项目成长记录"
              >
                <header className="core-confirm-head">
                  <div>
                    <strong>成长记录</strong>
                    <span>
                      {growthProject.title} · 计划版本{' '}
                      {growthProject.growthBatch.planRevision} ·{' '}
                      {growthProject.growthBatch.status === 'completed'
                        ? '已归档'
                        : '整理中'}
                    </span>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="关闭成长记录"
                    title="关闭"
                    onClick={() => setGrowthProjectId(null)}
                  >
                    ×
                  </button>
                </header>
                <div className="core-growth-body">
                  <p className="core-growth-intro">
                    项目结束后，成员会把可复用的经验整理为带来源的资产版本。
                  </p>
                  {growthProject.growthBatch.members.length ? (
                    <div className="core-growth-list">
                      {growthProject.growthBatch.members.map((member) => (
                        <article
                          className="core-growth-member"
                          key={member.agentId}
                        >
                          <header>
                            <div>
                              <strong>{member.agentName}</strong>
                              <span
                                className={`core-growth-status core-growth-status-${member.status}`}
                              >
                                {growthMemberStatusLabel(member.status)}
                              </span>
                            </div>
                            {member.status === 'failed' ||
                            member.status === 'interrupted' ? (
                              <button
                                className="core-card-action"
                                type="button"
                                disabled={projectStatusBusy}
                                onClick={() => {
                                  if (growthProject) {
                                    void retryProjectGrowthMember(
                                      growthProject,
                                      member.agentId,
                                    );
                                  }
                                }}
                              >
                                重新整理
                              </button>
                            ) : null}
                          </header>
                          <p>
                            {member.brief?.trim() ||
                              member.errorMessage ||
                              '未留下成长说明。'}
                          </p>
                          {member.assets.length ? (
                            <ul className="core-growth-assets">
                              {member.assets.map((asset) => (
                                <li key={`${asset.path}:${asset.revision}`}>
                                  <code>{asset.path}</code>
                                  <span>
                                    v{asset.revision}
                                    {asset.isDeleted ? ' · 已删除' : ''}
                                  </span>
                                  {asset.reason ? (
                                    <small>{asset.reason}</small>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="core-growth-muted">
                              没有改动资产。
                            </span>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <span className="core-growth-muted">
                      这批成长还没有成员记录。
                    </span>
                  )}
                </div>
                <footer className="core-confirm-actions">
                  <NoemaButton
                    className="text-button primary"
                    type="button"
                    onClick={() => setGrowthProjectId(null)}
                  >
                    关闭
                  </NoemaButton>
                </footer>
              </section>
            </div>
          </div>
        ) : null}

        <PartnerSettingsDialog model={controller} />
        {taskWorkspace ? (
          <WorkspaceFilesDialog
            workspacePath={taskWorkspace.path}
            initialFile={taskWorkspace.initialFile}
            onClose={() => setTaskWorkspace(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
