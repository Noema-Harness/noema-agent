import React, {
  type FormEvent,
  type KeyboardEvent,
  type SVGProps,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  NoemaSocialAgent,
  NoemaInteractionAdjustment,
  NoemaInteractionAdjustmentSnapshot,
  NoemaSocialEvent,
  NoemaSocialHistorySource,
  NoemaSocialMessage,
  NoemaSocialReplySource,
  NoemaSocialRoom,
  NoemaSocialRoomState,
  NoemaSocialSearchResult,
  NoemaSocialState,
  NoemaSocialWorkTask,
} from './noema-bridge.d.ts';

const markdownComponents: Components = {
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

function timeLabel(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat('zh-CN', {
    ...(sameDay ? {} : { month: 'numeric', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & {
  name:
    | 'plus'
    | 'users'
    | 'user-add'
    | 'search'
    | 'send'
    | 'settings'
    | 'back'
    | 'close'
    | 'stop';
}) {
  const paths: Record<typeof name, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    users: (
      <>
        <path d="M16 20v-1.3a3.7 3.7 0 0 0-3.7-3.7H6.7A3.7 3.7 0 0 0 3 18.7V20" />
        <circle cx="9.5" cy="7.5" r="3.5" />
        <path d="M17 11a3.5 3.5 0 1 0-1-6.8M17 15h4m-2-2v4" />
      </>
    ),
    'user-add': (
      <>
        <circle cx="9" cy="7.5" r="3.5" />
        <path d="M2.5 20v-1.3A3.7 3.7 0 0 1 6.2 15h5.6a3.7 3.7 0 0 1 3.7 3.7V20M19 7v6m-3-3h6" />
      </>
    ),
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.3" />
        <path d="m15.4 15.4 4.1 4.1" />
      </>
    ),
    send: <path d="m21 3-7.1 18-3.9-7.9L2 9.2 21 3Zm0 0L10 13.1" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" />
      </>
    ),
    back: <path d="m15 18-6-6 6-6M9 12h11" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

function AgentMark({
  agent,
  small = false,
}: {
  agent: Pick<NoemaSocialAgent, 'id' | 'name' | 'kind'>;
  small?: boolean;
}) {
  return (
    <span
      className={`agent-mark ${agent.kind === 'core' ? 'agent-mark-core' : 'agent-mark-specialist'} ${small ? 'agent-mark-small' : ''}`}
      aria-hidden="true"
    >
      {agent.kind === 'core' ? 'N' : agent.name.trim().slice(0, 1)}
    </span>
  );
}

function SocialChatApp() {
  const [state, setState] = useState<NoemaSocialState | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<NoemaSocialRoomState | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('noema');
  const [draftsByRoom, setDraftsByRoom] = useState<Record<string, string>>({});
  const [composerMode, setComposerMode] = useState<'chat' | 'project'>('chat');
  const [reuseCase, setReuseCase] = useState(false);
  const [replyTarget, setReplyTarget] = useState<NoemaSocialReplySource | null>(
    null,
  );
  const [forwardSelectionActive, setForwardSelectionActive] = useState(false);
  const [selectedForwardMessageIds, setSelectedForwardMessageIds] = useState<
    string[]
  >([]);
  const [forwardDialogOpen, setForwardDialogOpen] = useState(false);
  const [forwardTargetRoomId, setForwardTargetRoomId] = useState('');
  const [forwardBusy, setForwardBusy] = useState(false);
  const [threadDialogOpen, setThreadDialogOpen] = useState(false);
  const [threadTitle, setThreadTitle] = useState('');
  const [threadBusy, setThreadBusy] = useState(false);
  const [threadStatusBusy, setThreadStatusBusy] = useState(false);
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState<
    string | null
  >(null);
  const [search, setSearch] = useState('');
  const [messageSearchResults, setMessageSearchResults] = useState<
    NoemaSocialSearchResult[]
  >([]);
  const [messageSearchResultQuery, setMessageSearchResultQuery] = useState('');
  const [messageSearchLoading, setMessageSearchLoading] = useState(false);
  const [messageSearchError, setMessageSearchError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [workBusy, setWorkBusy] = useState(false);
  const [showRoomList, setShowRoomList] = useState(true);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editProviderConfig, setEditProviderConfig] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupAgentIds, setGroupAgentIds] = useState<string[]>([
    'noema',
    'engineering-partner',
  ]);
  const [agentName, setAgentName] = useState('');
  const [agentHeadline, setAgentHeadline] = useState('');
  const [agentDescription, setAgentDescription] = useState('');
  const [agentProjectWork, setAgentProjectWork] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [updatingAgentProfile, setUpdatingAgentProfile] = useState(false);
  const [updatingAgentId, setUpdatingAgentId] = useState<string | null>(null);
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);
  const dialogRef = useRef<HTMLFormElement>(null);
  const forwardOriginMessageId = useRef<string | null>(null);
  const threadTriggerRef = useRef<HTMLButtonElement>(null);
  const groupTriggerRef = useRef<HTMLButtonElement>(null);
  const agentTriggerRef = useRef<HTMLButtonElement>(null);
  const editAgentTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const shouldFollowRef = useRef(true);
  const loadSequenceRef = useRef(0);

  const draft = activeRoomId ? (draftsByRoom[activeRoomId] ?? '') : '';
  const setRoomDraft = (roomId: string, value: string) => {
    setDraftsByRoom((current) => {
      const next = { ...current };
      if (value) next[roomId] = value;
      else delete next[roomId];
      return next;
    });
  };
  const setDraft = (value: string) => {
    if (activeRoomId) setRoomDraft(activeRoomId, value);
  };

  const refreshState = useCallback(async () => {
    const next = await window.noema.getSocialState();
    setState(next);
    setProviderBaseUrl(next.providerBaseUrl);
    setActiveRoomId((current) =>
      current && next.rooms.some((room) => room.id === current)
        ? current
        : 'room-noema',
    );
    return next;
  }, []);

  const closeGroupDialog = useCallback(() => {
    setCreateGroupOpen(false);
    requestAnimationFrame(() => groupTriggerRef.current?.focus());
  }, []);

  const closeAgentDialog = useCallback(() => {
    const returnToEdit = Boolean(editingAgentId);
    setCreateAgentOpen(false);
    setEditingAgentId(null);
    setAgentName('');
    setAgentHeadline('');
    setAgentDescription('');
    setAgentProjectWork(false);
    requestAnimationFrame(() =>
      (returnToEdit ? editAgentTriggerRef : agentTriggerRef).current?.focus(),
    );
  }, [editingAgentId]);

  const closeSettingsDialog = useCallback(() => {
    setSettingsOpen(false);
    setEditProviderConfig(false);
    requestAnimationFrame(() => settingsTriggerRef.current?.focus());
  }, []);

  const cancelForward = useCallback(() => {
    const originMessageId = forwardOriginMessageId.current;
    forwardOriginMessageId.current = null;
    setForwardSelectionActive(false);
    setSelectedForwardMessageIds([]);
    setForwardDialogOpen(false);
    setForwardTargetRoomId('');
    requestAnimationFrame(() => {
      if (!originMessageId) return;
      document
        .querySelector<HTMLElement>(
          `[data-message-id="${originMessageId}"] .message-actions button`,
        )
        ?.focus();
    });
  }, []);

  const closeThreadDialog = useCallback(() => {
    setThreadDialogOpen(false);
    requestAnimationFrame(() => threadTriggerRef.current?.focus());
  }, []);

  const loadRoom = useCallback(async (roomId: string) => {
    const sequence = ++loadSequenceRef.current;
    try {
      const next = await window.noema.getSocialRoom(roomId);
      if (sequence === loadSequenceRef.current) {
        setRoomState(next);
        setSelectedAgentId((current) =>
          next.members.some(
            (member) => member.id === current && !member.archivedAt,
          )
            ? current
            : (next.members.find((member) => !member.archivedAt)?.id ??
              next.members[0]?.id ??
              'noema'),
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法打开这个聊天。');
    }
  }, []);

  useEffect(() => {
    void refreshState().catch((error) =>
      setNotice(
        error instanceof Error ? error.message : '无法读取本机聊天数据。',
      ),
    );
  }, [refreshState]);

  useEffect(() => {
    if (activeRoomId) void loadRoom(activeRoomId);
  }, [activeRoomId, loadRoom]);

  useEffect(() => {
    const unsubscribe = window.noema.onSocialEvent(
      (event: NoemaSocialEvent) => {
        if (event.type === 'chat-message-delta') {
          setRoomState((current) => {
            if (!current || current.room.id !== event.roomId) return current;
            return {
              ...current,
              messages: current.messages.map((message) =>
                message.id === event.messageId
                  ? { ...message, content: message.content + event.delta }
                  : message,
              ),
            };
          });
          return;
        }
        void refreshState().catch(() => {});
        if ('roomId' in event && event.roomId === activeRoomId) {
          void loadRoom(event.roomId);
        }
        if (event.type === 'agent-state-updated' && activeRoomId) {
          void loadRoom(activeRoomId);
        }
        if (event.type === 'chat-room-created') {
          setActiveRoomId(event.roomId);
          setShowRoomList(false);
        }
      },
    );
    return unsubscribe;
  }, [activeRoomId, loadRoom, refreshState]);

  useEffect(() => {
    const unsubscribe = window.noema.onRootEvent((event) => {
      if (
        event.type === 'models-updated' ||
        event.type === 'model-selected' ||
        event.type === 'provider-configured' ||
        event.type === 'interaction-adjustments-updated'
      ) {
        void refreshState().catch(() => {});
      }
    });
    return unsubscribe;
  }, [refreshState]);

  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    const query = search.trim();
    const requestId = ++searchRequestRef.current;
    if (!query) {
      setMessageSearchResults([]);
      setMessageSearchResultQuery('');
      setMessageSearchLoading(false);
      setMessageSearchError('');
      return;
    }
    setMessageSearchResults([]);
    setMessageSearchResultQuery('');
    setMessageSearchLoading(true);
    setMessageSearchError('');
    const timeout = window.setTimeout(() => {
      void window.noema
        .searchSocialMessages(query)
        .then((results) => {
          if (requestId === searchRequestRef.current) {
            setMessageSearchResults(results);
            setMessageSearchResultQuery(query);
            setMessageSearchLoading(false);
          }
        })
        .catch((error: unknown) => {
          if (requestId === searchRequestRef.current) {
            setMessageSearchResults([]);
            setMessageSearchResultQuery(query);
            setMessageSearchError(
              error instanceof Error ? error.message : '搜索历史消息失败。',
            );
            setMessageSearchLoading(false);
          }
        });
    }, 160);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (
      !createGroupOpen &&
      !createAgentOpen &&
      !editingAgentId &&
      !settingsOpen &&
      !forwardDialogOpen &&
      !threadDialogOpen
    ) {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) => element.getClientRects().length > 0,
      );
    const focusFrame = requestAnimationFrame(() => {
      const initial =
        dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
        focusables()[0];
      initial?.focus();
    });
    const onDialogKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (createGroupOpen) closeGroupDialog();
        else if (createAgentOpen || editingAgentId) closeAgentDialog();
        else if (forwardDialogOpen) cancelForward();
        else if (threadDialogOpen) closeThreadDialog();
        else closeSettingsDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onDialogKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onDialogKeyDown);
    };
  }, [
    createGroupOpen,
    createAgentOpen,
    editingAgentId,
    settingsOpen,
    forwardDialogOpen,
    threadDialogOpen,
    closeGroupDialog,
    closeAgentDialog,
    closeSettingsDialog,
    cancelForward,
    closeThreadDialog,
  ]);

  useLayoutEffect(() => {
    if (!shouldFollowRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (conversationRef.current) {
        conversationRef.current.scrollTop =
          conversationRef.current.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [roomState?.messages, roomState?.workTasks]);

  useLayoutEffect(() => {
    if (!pendingScrollMessageId || roomState?.room.id !== activeRoomId) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-message-id="${pendingScrollMessageId}"]`,
        )
        ?.scrollIntoView({ block: 'center' });
      setPendingScrollMessageId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeRoomId, pendingScrollMessageId, roomState]);

  const agents = state?.agents ?? [];
  const activeAgents = agents.filter((agent) => !agent.archivedAt);
  const editingAgent = editingAgentId
    ? (agents.find((agent) => agent.id === editingAgentId) ?? null)
    : null;
  const rooms = state?.rooms ?? [];
  const noemaRoom = rooms.find((room) => room.id === 'room-noema') ?? null;
  const currentRoom = rooms.find((room) => room.id === activeRoomId) ?? null;
  const members = roomState?.room.id === activeRoomId ? roomState.members : [];
  const messages =
    roomState?.room.id === activeRoomId ? roomState.messages : [];
  const workTasks =
    roomState?.room.id === activeRoomId ? roomState.workTasks : [];
  const activeReply = messages.find(
    (message) => message.role === 'assistant' && message.status === 'streaming',
  );
  const messageAgent = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const currentRecipient =
    members.find((agent) => agent.id === selectedAgentId) ?? members[0] ?? null;
  const currentRecipientArchived = Boolean(currentRecipient?.archivedAt);
  const currentRecipientCanWork = Boolean(
    currentRecipient?.capabilities.includes('project-work') &&
    !currentRecipientArchived,
  );
  const roomCanWork = members.some(
    (agent) => !agent.archivedAt && agent.capabilities.includes('project-work'),
  );
  const showProjectModeSwitch =
    roomCanWork &&
    (currentRoom?.id !== 'room-noema' || composerMode === 'project');
  const forwardableRooms = rooms.filter(
    (room) =>
      room.id !== currentRoom?.id &&
      room.memberIds.some((id) =>
        activeAgents.some((agent) => agent.id === id),
      ),
  );
  const forwardTargetRoom = forwardableRooms.find(
    (room) => room.id === forwardTargetRoomId,
  );
  const selectedForwardMessages = messages.filter((message) =>
    selectedForwardMessageIds.includes(message.id),
  );
  const childThreads = rooms.filter(
    (room) => room.parentRoomId === currentRoom?.id,
  );
  const filteredRooms = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return rooms;
    return rooms.filter((room) => {
      const participants = room.memberIds
        .map((id) => messageAgent.get(id)?.name ?? '')
        .join(' ');
      return `${room.title} ${participants} ${room.preview?.text ?? ''}`
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [messageAgent, rooms, search]);
  const otherRooms = filteredRooms.filter((room) => room.id !== noemaRoom?.id);
  const visibleMessageSearchResults =
    messageSearchResultQuery === search.trim() ? messageSearchResults : [];

  const renderRoomListItem = (room: NoemaSocialRoom, extraClassName = '') => {
    const firstAgent = messageAgent.get(room.memberIds[0] ?? '');
    const selected = room.id === activeRoomId;
    const preview = room.preview;
    const memberNames = room.memberIds
      .map((id) => messageAgent.get(id)?.name)
      .filter(Boolean)
      .join('、');
    return (
      <button
        key={room.id}
        type="button"
        className={`room-list-item ${extraClassName} ${selected ? 'is-selected' : ''}`}
        aria-current={selected ? 'page' : undefined}
        onClick={() => selectRoom(room)}
      >
        <span className="room-list-copy">
          <span className="room-list-title-line">
            <span className="room-list-title">{room.title}</span>
            {room.parentRoomId ? (
              <span className="continuation-room-mark">主题</span>
            ) : null}
            {room.closedAt ? (
              <span className="continuation-room-mark">已结束</span>
            ) : null}
            {room.memberIds.some(
              (agentId) => messageAgent.get(agentId)?.archivedAt,
            ) ? (
              <span className="room-archived-mark">已归档联系人</span>
            ) : null}
            {preview ? (
              <time dateTime={preview.createdAt}>
                {timeLabel(preview.createdAt)}
              </time>
            ) : null}
          </span>
          <span className="room-preview">
            {preview ? (
              <>
                {preview.sender ? <b>{preview.sender}：</b> : null}
                {preview.text}
              </>
            ) : room.kind === 'group' ? (
              memberNames
            ) : (
              firstAgent?.headline
            )}
          </span>
        </span>
      </button>
    );
  };

  const selectRoom = (room: NoemaSocialRoom) => {
    shouldFollowRef.current = true;
    setActiveRoomId(room.id);
    setSelectedAgentId(room.memberIds[0] ?? 'noema');
    setComposerMode('chat');
    setReuseCase(false);
    setReplyTarget(null);
    setForwardSelectionActive(false);
    setSelectedForwardMessageIds([]);
    setShowRoomList(false);
    setNotice('');
  };

  const openMessageSearchResult = (result: NoemaSocialSearchResult) => {
    const room = rooms.find((candidate) => candidate.id === result.roomId);
    if (!room) return;
    setPendingScrollMessageId(result.id);
    setSearch('');
    selectRoom(room);
  };

  const openHistorySource = (source: NoemaSocialHistorySource) => {
    const room = rooms.find((candidate) => candidate.id === source.roomId);
    if (!room) return;
    setPendingScrollMessageId(source.id);
    selectRoom(room);
  };

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault();
    if (
      !currentRoom ||
      !currentRecipient ||
      !draft.trim() ||
      busy ||
      forwardSelectionActive
    ) {
      return;
    }
    if (currentRecipientArchived) {
      setNotice('这位联系人已归档；恢复后才能继续聊天。');
      return;
    }
    const roomId = currentRoom.id;
    const text = draft;
    setBusy(true);
    setNotice('');
    shouldFollowRef.current = true;
    try {
      await window.noema.sendSocialMessage({
        roomId,
        agentId: currentRecipient.id,
        text,
        replyToMessageId: replyTarget?.id ?? null,
      });
      setRoomDraft(roomId, '');
      setReplyTarget(null);
      if (draftRef.current) draftRef.current.style.height = 'auto';
      await Promise.all([refreshState(), loadRoom(roomId)]);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '消息没有发送，请重试。',
      );
    } finally {
      setBusy(false);
      draftRef.current?.focus();
    }
  };

  const beginForwardSelection = (message: NoemaSocialMessage) => {
    if (
      !currentRoom ||
      !['user', 'assistant'].includes(message.role) ||
      message.status !== 'complete'
    ) {
      return;
    }
    forwardOriginMessageId.current = message.id;
    setForwardSelectionActive(true);
    setSelectedForwardMessageIds([message.id]);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-message-id="${message.id}"] .message-actions button`,
        )
        ?.focus();
    });
  };

  const toggleForwardMessage = (message: NoemaSocialMessage) => {
    setSelectedForwardMessageIds((current) => {
      if (current.includes(message.id)) {
        return current.filter((id) => id !== message.id);
      }
      if (current.length >= 20) {
        setNotice('一次最多合并转发 20 条消息。');
        return current;
      }
      return [...current, message.id];
    });
  };

  const openForwardDialog = () => {
    if (!currentRoom || selectedForwardMessageIds.length === 0) return;
    const targetRooms = rooms.filter(
      (room) =>
        room.id !== currentRoom.id &&
        room.memberIds.some((id) =>
          state?.agents.some((agent) => agent.id === id && !agent.archivedAt),
        ),
    );
    const targetRoom = targetRooms[0];
    if (!targetRoom) {
      setNotice('没有可接收转发消息的聊天。');
      return;
    }
    setForwardTargetRoomId(targetRoom.id);
    setForwardDialogOpen(true);
  };

  const openThreadDialog = () => {
    const first = selectedForwardMessages[0];
    if (
      !currentRoom ||
      currentRoom.kind !== 'direct' ||
      currentRoom.memberIds.length !== 1 ||
      currentRoom.memberIds[0] !== 'noema' ||
      !first ||
      selectedForwardMessageIds.length === 0
    )
      return;
    const initial = first.content.replace(/\s+/gu, ' ').trim().slice(0, 80);
    setThreadTitle(initial || '未命名主题');
    setThreadDialogOpen(true);
  };

  const handleCreateThread = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !currentRoom ||
      !threadTitle.trim() ||
      !selectedForwardMessageIds.length ||
      threadBusy
    )
      return;
    setThreadBusy(true);
    setNotice('');
    try {
      const created = await window.noema.createSocialContinuationThread({
        sourceRoomId: currentRoom.id,
        sourceIds: selectedForwardMessageIds,
        title: threadTitle.trim(),
      });
      forwardOriginMessageId.current = null;
      cancelForward();
      setThreadDialogOpen(false);
      setActiveRoomId(created.room.id);
      setSelectedAgentId('noema');
      setShowRoomList(false);
      shouldFollowRef.current = true;
      await Promise.all([refreshState(), loadRoom(created.room.id)]);
      requestAnimationFrame(() => draftRef.current?.focus());
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '主题没有创建，请重试。',
      );
    } finally {
      setThreadBusy(false);
    }
  };

  const handleThreadStatus = async (closed: boolean) => {
    if (!currentRoom || threadStatusBusy) return;
    setThreadStatusBusy(true);
    try {
      await window.noema.setSocialContinuationThreadClosed(
        currentRoom.id,
        closed,
      );
      await Promise.all([refreshState(), loadRoom(currentRoom.id)]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '主题状态没有更新。');
    } finally {
      setThreadStatusBusy(false);
    }
  };

  const handleDeleteThread = async () => {
    if (!currentRoom?.parentRoomId || threadStatusBusy) return;
    if (
      !window.confirm(
        `删除主题“${currentRoom.title}”？这会删除主题聊天及其消息，但不会影响来源聊天。`,
      )
    )
      return;
    const parentRoomId = currentRoom.parentRoomId;
    setThreadStatusBusy(true);
    try {
      await window.noema.deleteSocialContinuationThread(currentRoom.id);
      await refreshState();
      const parent = rooms.find((room) => room.id === parentRoomId);
      if (parent) selectRoom(parent);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '主题没有删除。');
    } finally {
      setThreadStatusBusy(false);
    }
  };

  const chooseForwardRoom = (roomId: string) => {
    setForwardTargetRoomId(roomId);
  };

  const handleForward = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !currentRoom ||
      !forwardTargetRoomId ||
      selectedForwardMessageIds.length === 0 ||
      forwardBusy
    ) {
      return;
    }
    setForwardBusy(true);
    setNotice('');
    try {
      await window.noema.forwardSocialMessages({
        targetRoomId: forwardTargetRoomId,
        sourceRoomId: currentRoom.id,
        sourceIds: selectedForwardMessageIds,
      });
      setActiveRoomId(forwardTargetRoomId);
      setSelectedAgentId(
        forwardTargetRoom?.memberIds.find((id) =>
          activeAgents.some((agent) => agent.id === id),
        ) ?? 'noema',
      );
      setShowRoomList(false);
      forwardOriginMessageId.current = null;
      cancelForward();
      shouldFollowRef.current = true;
      await Promise.all([refreshState(), loadRoom(forwardTargetRoomId)]);
      requestAnimationFrame(() => draftRef.current?.focus());
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '消息没有转发，请重试。',
      );
    } finally {
      setForwardBusy(false);
    }
  };

  const handleStartProjectWork = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!currentRoom || !currentRecipient || !draft.trim() || workBusy) return;
    setReplyTarget(null);
    cancelForward();
    if (currentRecipientArchived) {
      setNotice('这位联系人已归档；恢复后才能承接项目工作。');
      return;
    }
    if (!state?.projectWork.available) {
      setNotice(state?.projectWork.reason ?? '项目工作当前不可用。');
      return;
    }
    if (!currentRecipientCanWork) {
      setNotice('请在群聊中选择工程搭档，再把任务交给它。');
      return;
    }
    const roomId = currentRoom.id;
    setWorkBusy(true);
    setNotice('');
    try {
      const result = await window.noema.startSocialWorkTask({
        roomId,
        agentId: currentRecipient.id,
        prompt: draft.trim(),
        reuseCase,
      });
      if (result.accepted) {
        setRoomDraft(roomId, '');
        setReuseCase(false);
        if (draftRef.current) draftRef.current.style.height = 'auto';
        setNotice('工程搭档已开始处理；你可以继续在这个聊天里说话。');
        await Promise.all([refreshState(), loadRoom(roomId)]);
      } else if (result.reason) {
        setNotice(result.reason);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '项目工作没有启动。');
    } finally {
      setWorkBusy(false);
      draftRef.current?.focus();
    }
  };

  const handleStopProjectWork = async (task: NoemaSocialWorkTask) => {
    try {
      await window.noema.stopSocialWorkTask(task.id);
      await loadRoom(task.roomId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '任务没有停止。');
    }
  };

  const handleDisableCaseReuse = async (task: NoemaSocialWorkTask) => {
    try {
      await window.noema.setSocialWorkCaseEligible(task.id, false);
      await loadRoom(task.roomId);
      setNotice('这项案例不会再被后续项目任务引用；历史任务快照保持不变。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '案例状态没有更新。');
    }
  };

  const handleWithdrawPracticeCandidate = async (task: NoemaSocialWorkTask) => {
    try {
      await window.noema.withdrawSocialPracticeCandidate(task.id);
      await loadRoom(task.roomId);
      setNotice('候选做法已撤回；历史任务快照保持不变。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '候选做法没有撤回。');
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void (composerMode === 'project'
        ? handleStartProjectWork()
        : handleSend());
    }
  };

  const handleStop = async () => {
    if (!activeReply) return;
    try {
      await window.noema.stopSocialReply(activeReply.id);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '停止失败，请稍后重试。',
      );
    }
  };

  const handleRetry = async (message: NoemaSocialMessage) => {
    setNotice('');
    try {
      await window.noema.retrySocialReply(message.id);
      if (currentRoom) await loadRoom(currentRoom.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '重试没有启动。');
    }
  };

  const handleCreateGroup = async (event: FormEvent) => {
    event.preventDefault();
    const eligibleAgentIds = groupAgentIds.filter((agentId) =>
      activeAgents.some((agent) => agent.id === agentId),
    );
    if (!eligibleAgentIds.length) {
      setNotice('请至少邀请一位未归档联系人。');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const group = await window.noema.createSocialGroup({
        title: groupTitle.trim(),
        agentIds: eligibleAgentIds,
      });
      setCreateGroupOpen(false);
      setGroupTitle('');
      setActiveRoomId(group.room.id);
      setShowRoomList(false);
      await refreshState();
      await loadRoom(group.room.id);
      requestAnimationFrame(() => draftRef.current?.focus());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '群聊没有创建成功。');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAgent = async (event: FormEvent) => {
    event.preventDefault();
    setCreatingAgent(true);
    setNotice('');
    try {
      const room = await window.noema.createSocialAgent({
        name: agentName.trim(),
        headline: agentHeadline.trim(),
        description: agentDescription.trim(),
        projectWork: agentProjectWork,
      });
      setCreateAgentOpen(false);
      setAgentName('');
      setAgentHeadline('');
      setAgentDescription('');
      setAgentProjectWork(false);
      setActiveRoomId(room.room.id);
      setShowRoomList(false);
      await Promise.all([refreshState(), loadRoom(room.room.id)]);
      requestAnimationFrame(() => draftRef.current?.focus());
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '联系人没有创建成功。',
      );
    } finally {
      setCreatingAgent(false);
    }
  };

  const openAgentProfileEditor = (agent: NoemaSocialAgent) => {
    setAgentName(agent.name);
    setAgentHeadline(agent.headline);
    setAgentDescription(agent.description);
    setEditingAgentId(agent.id);
  };

  const handleUpdateAgentProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingAgentId) return;
    setUpdatingAgentProfile(true);
    setNotice('');
    try {
      await window.noema.updateSocialAgentProfile({
        agentId: editingAgentId,
        name: agentName.trim(),
        headline: agentHeadline.trim(),
        description: agentDescription.trim(),
      });
      setEditingAgentId(null);
      setAgentName('');
      setAgentHeadline('');
      setAgentDescription('');
      if (activeRoomId) {
        await Promise.all([refreshState(), loadRoom(activeRoomId)]);
      }
      setNotice('资料已更新；之后开始的新回复会使用这些资料。');
      requestAnimationFrame(() => editAgentTriggerRef.current?.focus());
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '联系人资料没有更新。',
      );
    } finally {
      setUpdatingAgentProfile(false);
    }
  };

  const handleToggleAgentProjectWork = async (agent: NoemaSocialAgent) => {
    const nextEnabled = !agent.capabilities.includes('project-work');
    setUpdatingAgentId(agent.id);
    setNotice('');
    try {
      await window.noema.setSocialAgentProjectWork(agent.id, nextEnabled);
      if (activeRoomId)
        await Promise.all([refreshState(), loadRoom(activeRoomId)]);
      if (!nextEnabled) setComposerMode('chat');
      setNotice(
        nextEnabled
          ? `${agent.name}可以承接项目文件任务；每次仍需切换项目工作并选择目录。`
          : `${agent.name}的项目文件能力已关闭；此前聊天与已启动任务不受影响。`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '项目工作能力没有更新。',
      );
    } finally {
      setUpdatingAgentId(null);
    }
  };

  const handleToggleAgentArchive = async (agent: NoemaSocialAgent) => {
    setUpdatingAgentId(agent.id);
    setNotice('');
    try {
      await window.noema.setSocialAgentArchived(agent.id, !agent.archivedAt);
      if (activeRoomId)
        await Promise.all([refreshState(), loadRoom(activeRoomId)]);
      setNotice(
        agent.archivedAt
          ? `${agent.name}已恢复。`
          : `${agent.name}已归档；现有聊天记录保留。`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '联系人状态没有更新。',
      );
    } finally {
      setUpdatingAgentId(null);
    }
  };

  const toggleGroupAgent = (agentId: string) => {
    setGroupAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId],
    );
  };

  const handleModelChange = async (model: string) => {
    if (!model) return;
    setSwitchingModel(true);
    setNotice('');
    try {
      await window.noema.selectModel(model);
      await refreshState();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '模型没有切换成功。');
    } finally {
      setSwitchingModel(false);
    }
  };

  const beginProviderEdit = () => {
    setEditProviderConfig(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        dialogRef.current
          ?.querySelector<HTMLInputElement>('[data-dialog-initial-focus]')
          ?.focus(),
      ),
    );
  };

  const handleProviderSave = async (event: FormEvent) => {
    event.preventDefault();
    setSavingProvider(true);
    setNotice('');
    try {
      const result = await window.noema.configureProvider({
        baseUrl: providerBaseUrl,
        apiKey: providerApiKey,
      });
      setProviderApiKey('');
      setEditProviderConfig(false);
      setSettingsOpen(false);
      await refreshState();
      requestAnimationFrame(() => settingsTriggerRef.current?.focus());
      if (result.error) setNotice(result.error);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '连接没有保存，请重试。',
      );
    } finally {
      setSavingProvider(false);
    }
  };

  const avatarAgent =
    currentRoom?.kind === 'group'
      ? null
      : currentRoom?.kind === 'direct'
        ? members[0]
        : (currentRecipient ?? members[0]);
  const modelOptions = state?.models ?? [];
  const activeModel = state?.selectedModel ?? '';
  const activeRoute = modelOptions.find((model) => model.name === activeModel);
  const activeRouteUnavailable = Boolean(
    activeRoute?.executionStatus === 'exhausted' ||
    activeRoute?.executionStatus === 'needsKey',
  );
  const providerReady = Boolean(
    state?.connected && modelOptions.length > 0 && !activeRouteUnavailable,
  );
  const providerWarning = state?.checking
    ? '正在检查本机模型服务…'
    : !state?.providerConfigured
      ? '连接本机 FreeLLMAPI 后即可开始聊天。'
      : !state?.connected || modelOptions.length === 0
        ? (state?.error ?? '当前没有可用模型。')
        : activeRouteUnavailable
          ? activeRoute?.executionStatus === 'needsKey'
            ? '所选模型需要配置服务商密钥。可以切换其他可用模型，或检查 FreeLLMAPI 设置。'
            : '所选模型最近报告额度已耗尽。可以切换其他模型后继续。'
          : null;
  const composerReady =
    composerMode === 'chat'
      ? providerReady
      : Boolean(state?.projectWork.available);
  const messagesById = new Map(
    messages.map((message) => [message.id, message]),
  );
  const tasksBySourceMessage = new Map<string, NoemaSocialWorkTask[]>();
  for (const task of workTasks) {
    if (!task.sourceMessageId || !messagesById.has(task.sourceMessageId))
      continue;
    const anchored = tasksBySourceMessage.get(task.sourceMessageId) ?? [];
    anchored.push(task);
    tasksBySourceMessage.set(task.sourceMessageId, anchored);
  }
  const anchoredTaskIds = new Set(
    [...tasksBySourceMessage.values()].flatMap((tasks) =>
      tasks.map((task) => task.id),
    ),
  );
  const timelineItems = [
    ...messages.map((message) => ({
      kind: 'message' as const,
      createdAt: message.createdAt,
      id: message.id,
      message,
      tasks: tasksBySourceMessage.get(message.id) ?? [],
    })),
    ...workTasks
      .filter((task) => !anchoredTaskIds.has(task.id))
      .map((task) => ({
        kind: 'work-task' as const,
        createdAt: task.createdAt,
        id: task.id,
        task,
      })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const conversationTurns: {
    id: string;
    items: typeof timelineItems;
  }[] = [];
  for (const item of timelineItems) {
    const turnId =
      item.kind === 'message' ? item.message.turnId : `task:${item.id}`;
    const previousTurn = conversationTurns.at(-1);
    if (previousTurn?.id === turnId) previousTurn.items.push(item);
    else conversationTurns.push({ id: turnId, items: [item] });
  }

  const renderProjectWorkCard = (task: NoemaSocialWorkTask) => (
    <ProjectWorkCard
      key={task.id}
      task={task}
      agent={messageAgent.get(task.agentId) ?? null}
      onStop={() => void handleStopProjectWork(task)}
      onDisableCase={() => void handleDisableCaseReuse(task)}
      onWithdrawPractice={() => void handleWithdrawPracticeCandidate(task)}
      onRepeat={() => {
        setSelectedAgentId(task.agentId);
        setComposerMode('project');
        setReplyTarget(null);
        cancelForward();
        setDraft(task.taskPrompt);
        requestAnimationFrame(() => draftRef.current?.focus());
      }}
    />
  );

  return (
    <main className="social-shell">
      <div className={`social-body ${showRoomList ? '' : 'room-open'}`}>
        <aside className="conversation-sidebar" aria-label="聊天列表">
          <div className="sidebar-heading">
            <h1>Noema</h1>
            <div className="sidebar-create-actions">
              <button
                className="sidebar-create-action new-agent-button"
                ref={agentTriggerRef}
                type="button"
                aria-label="创建专业联系人"
                title="创建专业联系人"
                onClick={() => setCreateAgentOpen(true)}
              >
                <span className="sidebar-create-mark" aria-hidden="true">
                  ＋
                </span>
                <span className="sidebar-create-label">联系人</span>
              </button>
              <button
                className="sidebar-create-action new-group-button"
                ref={groupTriggerRef}
                type="button"
                aria-label="新建群聊"
                title="新建群聊"
                onClick={() => setCreateGroupOpen(true)}
              >
                <span className="sidebar-create-mark" aria-hidden="true">
                  ＋
                </span>
                <span className="sidebar-create-label">群聊</span>
              </button>
            </div>
          </div>

          <label className="chat-search">
            <Icon name="search" />
            <input
              type="search"
              ref={searchRef}
              placeholder="搜索聊天和消息"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="搜索联系人、聊天和消息"
            />
            <kbd>Ctrl K</kbd>
          </label>

          <div className="primary-conversation-heading">主聊</div>
          {noemaRoom ? (
            <nav className="primary-conversation-nav" aria-label="Noema 主聊">
              {renderRoomListItem(noemaRoom, 'noema-primary-item')}
            </nav>
          ) : null}

          <div className="conversation-list-heading">
            <span>其他聊天</span>
            <span>{otherRooms.length}</span>
          </div>

          <nav className="conversation-list" aria-label="其他聊天">
            {otherRooms.map((room) => renderRoomListItem(room))}
            {otherRooms.length === 0 &&
            !messageSearchLoading &&
            messageSearchResultQuery === search.trim() &&
            !messageSearchError &&
            visibleMessageSearchResults.length === 0 ? (
              <p className="no-search-results">
                {search
                  ? '没有找到匹配的聊天或消息。'
                  : '专业联系人和群聊会显示在这里。'}
              </p>
            ) : null}
            {search.trim() ? (
              <section
                className="message-search-results"
                aria-label="消息搜索结果"
                aria-live="polite"
                data-search-query={messageSearchResultQuery}
                data-search-state={
                  messageSearchLoading
                    ? 'loading'
                    : messageSearchError
                      ? 'error'
                      : 'complete'
                }
              >
                <h3>消息</h3>
                {messageSearchLoading &&
                visibleMessageSearchResults.length === 0 ? (
                  <p className="message-search-state">正在搜索历史消息…</p>
                ) : null}
                {messageSearchError ? (
                  <p className="message-search-state" role="status">
                    {messageSearchError}
                  </p>
                ) : null}
                {visibleMessageSearchResults.map((result) => (
                  <button
                    className="message-search-result"
                    data-message-id={result.id}
                    key={`${result.roomId}:${result.id}`}
                    type="button"
                    onClick={() => openMessageSearchResult(result)}
                  >
                    <span className="message-search-result-heading">
                      <strong>{result.roomTitle}</strong>
                      <span>{timeLabel(result.createdAt)}</span>
                    </span>
                    <span className="message-search-result-meta">
                      {result.sender}
                      {result.forwarded ? ' · 转发内容' : ''}
                    </span>
                    <span className="message-search-result-excerpt">
                      {result.content}
                    </span>
                  </button>
                ))}
              </section>
            ) : null}
          </nav>

          <div className="sidebar-bottom">
            <div className="sidebar-self-copy">
              <strong>本地对话</strong>
              <span>记录保存在这台设备</span>
            </div>
            <button
              className="icon-button settings-button sidebar-settings-button"
              ref={settingsTriggerRef}
              type="button"
              aria-label="连接与模型设置"
              title="连接与模型设置"
              onClick={(event) => {
                settingsTriggerRef.current = event.currentTarget;
                setSettingsOpen(true);
              }}
            >
              <Icon name="settings" />
            </button>
          </div>
        </aside>

        <section className="conversation-panel" aria-label="当前聊天">
          {currentRoom && roomState?.room.id === currentRoom.id ? (
            <>
              <header className="room-header">
                <button
                  type="button"
                  className="mobile-back-button"
                  aria-label="返回聊天列表"
                  onClick={() => setShowRoomList(true)}
                >
                  <Icon name="back" />
                </button>
                <button
                  className="icon-button settings-button room-settings-button"
                  type="button"
                  aria-label="连接与模型设置"
                  title="连接与模型设置"
                  onClick={(event) => {
                    settingsTriggerRef.current = event.currentTarget;
                    setSettingsOpen(true);
                  }}
                >
                  <Icon name="settings" />
                </button>
                {currentRoom.parentRoomId ? (
                  <button
                    className="continuation-parent-link"
                    type="button"
                    onClick={() => {
                      const parent = rooms.find(
                        (room) => room.id === currentRoom.parentRoomId,
                      );
                      if (!parent) return;
                      selectRoom(parent);
                      setPendingScrollMessageId(currentRoom.originMessageId);
                    }}
                    title="回到来源消息"
                  >
                    ← 来源
                  </button>
                ) : null}
                <div className="room-header-copy">
                  <h2>{currentRoom.title}</h2>
                  {currentRoom.kind === 'group' ? (
                    <p>
                      {members.map((member) => member.name).join(' · ')} 与你
                    </p>
                  ) : members[0]?.kind === 'specialist' ? (
                    <p>{members[0]?.headline ?? '持续对话'}</p>
                  ) : null}
                </div>
                <div className="room-header-meta">
                  {currentRoom.parentRoomId ? (
                    <>
                      <span className="continuation-status">
                        {currentRoom.closedAt ? '已结束' : '持续主题'}
                      </span>
                      <button
                        className="agent-archive-button"
                        type="button"
                        onClick={() =>
                          void handleThreadStatus(!currentRoom.closedAt)
                        }
                        disabled={threadStatusBusy}
                      >
                        {threadStatusBusy
                          ? '更新中…'
                          : currentRoom.closedAt
                            ? '重新打开'
                            : '结束主题'}
                      </button>
                      <button
                        className="agent-archive-button"
                        type="button"
                        onClick={() => void handleDeleteThread()}
                        disabled={threadStatusBusy}
                        title="删除此主题聊天及其消息"
                      >
                        删除
                      </button>
                    </>
                  ) : currentRoom.kind === 'group' ? (
                    <span className="member-count">
                      {members.length + 1} 位参与者
                    </span>
                  ) : members[0]?.kind === 'specialist' ? (
                    <div className="agent-header-actions">
                      <button
                        className="agent-edit-profile-button"
                        ref={editAgentTriggerRef}
                        type="button"
                        aria-label={`编辑${members[0].name}的资料`}
                        title="编辑联系人资料"
                        onClick={() => openAgentProfileEditor(members[0])}
                      >
                        编辑资料
                      </button>
                      <label
                        className="agent-project-capability"
                        title="此联系人是否可在你明确选择项目目录后承接文件任务"
                      >
                        <input
                          type="checkbox"
                          checked={members[0].capabilities.includes(
                            'project-work',
                          )}
                          disabled={
                            Boolean(members[0].archivedAt) ||
                            updatingAgentId === members[0].id
                          }
                          onChange={() =>
                            void handleToggleAgentProjectWork(members[0])
                          }
                        />
                        项目工作
                      </label>
                      <button
                        className="agent-archive-button"
                        type="button"
                        onClick={() =>
                          void handleToggleAgentArchive(members[0])
                        }
                        disabled={updatingAgentId === members[0].id}
                      >
                        {updatingAgentId === members[0].id
                          ? '更新中…'
                          : members[0].archivedAt
                            ? '恢复'
                            : '归档'}
                      </button>
                    </div>
                  ) : null}
                </div>
              </header>

              <div
                className="message-thread"
                ref={conversationRef}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  shouldFollowRef.current =
                    element.scrollHeight -
                      element.scrollTop -
                      element.clientHeight <
                    96;
                }}
                aria-live="polite"
                aria-relevant="additions text"
              >
                {!messages.some((message) => message.role !== 'system') &&
                workTasks.length === 0 ? (
                  <div className="room-empty-state">
                    <h3>
                      {currentRoom.kind === 'group'
                        ? '在这里一起聊'
                        : '从这里开始'}
                    </h3>
                    <p>
                      {currentRoom.kind === 'direct'
                        ? `这是你和${avatarAgent?.name ?? '联系人'}的私聊。${avatarAgent?.description ?? '把正在想的事直接说出来就好。'}`
                        : '这个群聊有独立记录。发送前，可以指定由哪位联系人回应。'}
                    </p>
                  </div>
                ) : (
                  <div className="message-sequence">
                    {conversationTurns.map((turn) => (
                      <section
                        className="conversation-turn"
                        data-conversation-turn={turn.id}
                        key={turn.id}
                      >
                        {turn.items.map((item) =>
                          item.kind === 'message' ? (
                            <React.Fragment key={item.id}>
                              <ChatMessage
                                message={item.message}
                                continuationOrigin={Boolean(
                                  currentRoom.parentRoomId &&
                                  item.message.forwardedSources.some(
                                    (source) =>
                                      source.id === currentRoom.originMessageId,
                                  ),
                                )}
                                roomClosed={Boolean(currentRoom.closedAt)}
                                hideSenderMetadata={false}
                                agent={
                                  item.message.agentId
                                    ? (messageAgent.get(item.message.agentId) ??
                                      null)
                                    : null
                                }
                                canManageInteractionAdjustment={
                                  currentRoom.kind === 'direct' &&
                                  currentRoom.memberIds.length === 1 &&
                                  currentRoom.memberIds[0] === 'noema'
                                }
                                interactionAdjustment={
                                  state?.interactionAdjustments.find(
                                    (adjustment) =>
                                      adjustment.sourceSurface === 'social' &&
                                      adjustment.sourceRoomId ===
                                        currentRoom.id &&
                                      adjustment.sourceTurnId ===
                                        item.message.turnId,
                                  ) ?? null
                                }
                                onRetry={handleRetry}
                                onOpenHistorySource={openHistorySource}
                                forwardSelectionActive={forwardSelectionActive}
                                forwardSelected={selectedForwardMessageIds.includes(
                                  item.message.id,
                                )}
                                onReply={() => {
                                  const forwardedText =
                                    item.message.forwardedSources
                                      .map(
                                        (source) =>
                                          `${source.sender}：${source.content}`,
                                      )
                                      .join('\n');
                                  setReplyTarget({
                                    id: item.message.id,
                                    roomId: currentRoom.id,
                                    role: item.message.role as
                                      | 'user'
                                      | 'assistant',
                                    sender:
                                      item.message.role === 'user'
                                        ? '你'
                                        : (messageAgent.get(
                                            item.message.agentId ?? '',
                                          )?.name ?? '联系人'),
                                    createdAt: item.message.createdAt,
                                    content:
                                      forwardedText || item.message.content,
                                  });
                                  draftRef.current?.focus();
                                }}
                                onForward={() =>
                                  beginForwardSelection(item.message)
                                }
                                continuationThreads={childThreads.filter(
                                  (thread) =>
                                    thread.originMessageId === item.message.id,
                                )}
                                onOpenContinuation={(thread) =>
                                  selectRoom(thread)
                                }
                                onToggleForward={() =>
                                  toggleForwardMessage(item.message)
                                }
                              />
                              {item.tasks.map(renderProjectWorkCard)}
                            </React.Fragment>
                          ) : (
                            renderProjectWorkCard(item.task)
                          ),
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </div>

              {notice ? (
                <div className="inline-notice" role="status">
                  <span>{notice}</span>
                  <button
                    type="button"
                    onClick={() => setNotice('')}
                    aria-label="关闭提示"
                  >
                    <Icon name="close" />
                  </button>
                </div>
              ) : null}

              {currentRoom.kind === 'direct' && members[0]?.archivedAt ? (
                <div className="archived-agent-notice" role="status">
                  <span>
                    {members[0].name}
                    已归档。历史记录仍可查看；恢复后才能继续聊天。
                  </span>
                </div>
              ) : null}

              {composerMode === 'chat' && !providerReady ? (
                <div className="provider-warning" role="status">
                  <span>{providerWarning}</span>
                  <button type="button" onClick={() => setSettingsOpen(true)}>
                    {state?.providerConfigured ? '检查设置' : '连接模型'}
                  </button>
                </div>
              ) : null}

              {currentRoom.kind === 'group' ? (
                <div
                  className="reply-routing"
                  role="group"
                  aria-label="选择本轮回应者"
                >
                  <span>
                    {composerMode === 'project' ? '工作交给' : '本条由'}
                  </span>
                  {members.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      className={
                        member.id === currentRecipient?.id ? 'is-chosen' : ''
                      }
                      aria-pressed={member.id === currentRecipient?.id}
                      disabled={Boolean(member.archivedAt)}
                      title={member.archivedAt ? '联系人已归档' : undefined}
                      onClick={() => setSelectedAgentId(member.id)}
                    >
                      {member.name}
                      {member.archivedAt ? ' · 已归档' : ''}
                    </button>
                  ))}
                  <span>{composerMode === 'project' ? '执行' : '回应'}</span>
                </div>
              ) : null}

              {forwardSelectionActive ? (
                <div className="forward-selection-toolbar" role="status">
                  <span>
                    已选 {selectedForwardMessageIds.length} 条消息
                    <small>按时间顺序合并转发</small>
                  </span>
                  <button type="button" onClick={cancelForward}>
                    取消
                  </button>
                  <button
                    type="button"
                    ref={threadTriggerRef}
                    className="secondary-action"
                    onClick={openThreadDialog}
                    disabled={
                      !selectedForwardMessageIds.length ||
                      currentRoom.kind !== 'direct' ||
                      currentRoom.memberIds[0] !== 'noema' ||
                      Boolean(currentRoom.parentRoomId)
                    }
                    title="把选中的消息作为来源，在 Noema 私聊下开一条主题聊天"
                  >
                    开主题
                  </button>
                  <button
                    type="button"
                    className="primary-action"
                    onClick={openForwardDialog}
                    disabled={!selectedForwardMessageIds.length}
                  >
                    选择目标聊天
                  </button>
                </div>
              ) : null}

              {showProjectModeSwitch ? (
                <div
                  className="composer-mode-switch"
                  role="group"
                  aria-label="选择聊天方式"
                >
                  <button
                    type="button"
                    className={composerMode === 'chat' ? 'is-selected' : ''}
                    aria-pressed={composerMode === 'chat'}
                    onClick={() => setComposerMode('chat')}
                  >
                    聊天
                  </button>
                  <button
                    type="button"
                    className={composerMode === 'project' ? 'is-selected' : ''}
                    aria-pressed={composerMode === 'project'}
                    onClick={() => {
                      setReplyTarget(null);
                      cancelForward();
                      setComposerMode('project');
                    }}
                    disabled={!state?.projectWork.available}
                    title={state?.projectWork.reason ?? undefined}
                  >
                    项目工作
                  </button>
                  {composerMode === 'project' ? (
                    <span className="composer-mode-explainer">
                      选择文件夹后，由工程搭档在这里处理
                    </span>
                  ) : null}
                  {!state?.projectWork.available ? (
                    <span className="composer-mode-unavailable" role="status">
                      {state?.projectWork.reason ?? '项目工作暂不可用。'}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {composerMode === 'project' ? (
                <label className="case-reuse-control">
                  <input
                    type="checkbox"
                    checked={reuseCase}
                    onChange={(event) => setReuseCase(event.target.checked)}
                    disabled={workBusy}
                  />
                  <span>
                    <strong>参考同项目的已核验经验</strong>
                    <small>
                      若有候选，选定文件夹后会展示触发条件、做法、边界和来源；默认只带入已核验案例。不会复制原聊天。核验后，Noema
                      可能再用当前免费路由整理一条可撤回的候选做法。
                    </small>
                  </span>
                </label>
              ) : null}

              {replyTarget && composerMode === 'chat' ? (
                <div className="reply-composer-preview">
                  <div>
                    <strong>回复 {replyTarget.sender}</strong>
                    <span>
                      {replyTarget.content.replace(/\s+/gu, ' ').slice(0, 150)}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="取消回复引用"
                    onClick={() => {
                      setReplyTarget(null);
                      requestAnimationFrame(() => draftRef.current?.focus());
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              ) : null}

              <form
                className="message-composer"
                onSubmit={(event) =>
                  void (composerMode === 'project'
                    ? handleStartProjectWork(event)
                    : handleSend(event))
                }
              >
                <label
                  className="visually-hidden"
                  htmlFor="social-message-input"
                >
                  {composerMode === 'project'
                    ? `交给${currentRecipient?.name ?? '联系人'}的项目任务`
                    : `给${currentRecipient?.name ?? '联系人'}发送消息`}
                </label>
                <textarea
                  id="social-message-input"
                  ref={draftRef}
                  value={draft}
                  placeholder={
                    composerMode === 'project'
                      ? '描述希望工程搭档在项目中完成什么…'
                      : '写下你正在想的事…'
                  }
                  rows={1}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    event.currentTarget.style.height = 'auto';
                    event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 180)}px`;
                  }}
                  onKeyDown={handleComposerKeyDown}
                  disabled={
                    !composerReady ||
                    Boolean(currentRoom.closedAt) ||
                    forwardSelectionActive ||
                    !currentRecipient ||
                    currentRecipientArchived ||
                    Boolean(activeReply) ||
                    workBusy ||
                    (composerMode === 'project' && !currentRecipientCanWork)
                  }
                />
                <div className="composer-footer">
                  <span>
                    {composerMode === 'project'
                      ? currentRecipientCanWork
                        ? '选择项目文件夹后启动 · 你可以继续聊天'
                        : '在群聊中选择工程搭档后才能启动项目工作'
                      : 'Enter 发送 · Shift + Enter 换行'}
                  </span>
                  {activeReply && composerMode === 'chat' ? (
                    <button
                      className="stop-reply-button"
                      type="button"
                      onClick={() => void handleStop()}
                    >
                      <Icon name="stop" />
                      停止回复
                    </button>
                  ) : (
                    <button
                      className="send-message-button"
                      type="submit"
                      disabled={
                        !composerReady ||
                        Boolean(currentRoom.closedAt) ||
                        forwardSelectionActive ||
                        !draft.trim() ||
                        !currentRecipient ||
                        currentRecipientArchived ||
                        busy ||
                        workBusy ||
                        (composerMode === 'project' &&
                          (!currentRecipientCanWork || Boolean(activeReply)))
                      }
                    >
                      {composerMode === 'project'
                        ? workBusy
                          ? '启动中…'
                          : '选择项目并启动'
                        : '发送'}
                      <Icon name="send" />
                    </button>
                  )}
                </div>
              </form>
              <p className="data-flow-note">
                {composerMode === 'project'
                  ? '项目工作会留在当前聊天，并带入当前联系人的专业资料。启动前会选择文件夹并显示数据范围；Noema 会区分 DSH 结束与独立核验结果。'
                  : replyTarget
                    ? '回复只关联当前聊天中的这条消息；发送后双方都能看到引用。'
                    : '发送后，本轮对话与联系人的专业资料会交给当前模型处理；聊天记录保存在本机。'}
              </p>
            </>
          ) : (
            <div className="room-loading" aria-live="polite">
              <span className="loading-mark" />
              <span>正在打开聊天…</span>
            </div>
          )}
        </section>
      </div>

      {forwardDialogOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cancelForward();
          }}
        >
          <form
            ref={dialogRef}
            className="social-dialog forward-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="forward-dialog-title"
            onSubmit={(event) => void handleForward(event)}
          >
            <div className="dialog-heading">
              <div>
                <h2 id="forward-dialog-title">转发到聊天</h2>
                <p>
                  {selectedForwardMessages.length} 条消息 · 来自「
                  {currentRoom?.title ?? '当前聊天'}」
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="取消转发"
                onClick={cancelForward}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="forward-dialog-preview">
              {selectedForwardMessages.map((message) => (
                <article key={message.id}>
                  <strong>
                    {message.role === 'user'
                      ? '你'
                      : (messageAgent.get(message.agentId ?? '')?.name ??
                        '联系人')}
                  </strong>
                  <time dateTime={message.createdAt}>
                    {timeLabel(message.createdAt)}
                  </time>
                  <p>
                    {message.forwardedSources.length
                      ? `已转发 ${message.forwardedSources.length} 条消息`
                      : message.content}
                  </p>
                </article>
              ))}
            </div>
            <label className="dialog-field">
              <span>转发到</span>
              <select
                value={forwardTargetRoomId}
                onChange={(event) => chooseForwardRoom(event.target.value)}
                required
                data-dialog-initial-focus
              >
                {forwardableRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.title} ·{' '}
                    {room.memberIds
                      .map((id) => messageAgent.get(id)?.name ?? '')
                      .filter(Boolean)
                      .join('、')}
                  </option>
                ))}
              </select>
            </label>
            <p className="dialog-footnote">
              转发只会把消息送到目标聊天，不会自动触发回复。需要讨论时，再像平常一样发送一条消息。
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={cancelForward}
                disabled={forwardBusy}
              >
                取消
              </button>
              <button
                className="primary-action"
                type="submit"
                disabled={
                  forwardBusy ||
                  !forwardTargetRoom ||
                  selectedForwardMessages.length === 0
                }
              >
                {forwardBusy ? '正在转发…' : '转发'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {threadDialogOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !threadBusy)
              closeThreadDialog();
          }}
        >
          <form
            ref={dialogRef}
            className="social-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="continuation-title"
            onSubmit={(event) => void handleCreateThread(event)}
          >
            <div className="dialog-heading">
              <div>
                <h2 id="continuation-title">另开一条主题聊天</h2>
                <p>选中的原话会作为可见来源放在新聊天开头。</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭"
                onClick={closeThreadDialog}
                disabled={threadBusy}
              >
                <Icon name="close" />
              </button>
            </div>
            <label className="dialog-field">
              <span>主题名称</span>
              <input
                value={threadTitle}
                onChange={(event) => setThreadTitle(event.target.value)}
                maxLength={80}
                required
                data-dialog-initial-focus
              />
            </label>
            <p className="dialog-footnote">
              这是同一个 Noema
              的独立聊天。创建不会调用模型，也不会带入来源聊天的其他记录。
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={closeThreadDialog}
                disabled={threadBusy}
              >
                取消
              </button>
              <button
                className="primary-action"
                type="submit"
                disabled={threadBusy || !threadTitle.trim()}
              >
                {threadBusy ? '正在创建…' : '创建主题'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {createAgentOpen || editingAgentId ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAgentDialog();
          }}
        >
          <form
            ref={dialogRef}
            className="social-dialog agent-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-agent-title"
            onSubmit={(event) =>
              void (editingAgentId
                ? handleUpdateAgentProfile(event)
                : handleCreateAgent(event))
            }
          >
            <div className="dialog-heading">
              <div>
                <h2 id="create-agent-title">
                  {editingAgentId ? '编辑联系人资料' : '创建专业联系人'}
                </h2>
                <p>
                  {editingAgentId
                    ? `正在编辑${editingAgent?.name ?? '联系人'}。身份和聊天记录会保留。`
                    : '给它一个可以长期实践的领域，而不是一次任务。'}
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭"
                onClick={closeAgentDialog}
              >
                <Icon name="close" />
              </button>
            </div>
            <label className="dialog-field">
              <span>联系人名称</span>
              <input
                autoFocus
                data-dialog-initial-focus
                id="social-agent-name"
                value={agentName}
                maxLength={60}
                placeholder="例如：林间观察员"
                onChange={(event) => setAgentName(event.target.value)}
                required
                disabled={creatingAgent || updatingAgentProfile}
              />
            </label>
            <label className="dialog-field">
              <span>长期专业范围</span>
              <input
                id="social-agent-headline"
                value={agentHeadline}
                maxLength={140}
                placeholder="例如：长期研究 Godot 游戏开发与项目迭代"
                onChange={(event) => setAgentHeadline(event.target.value)}
                required
                disabled={creatingAgent || updatingAgentProfile}
              />
              <small>尽量写一类可持续积累的实践，不写单次待办。</small>
            </label>
            <label className="dialog-field">
              <span>你希望它如何与你合作</span>
              <textarea
                id="social-agent-description"
                value={agentDescription}
                maxLength={800}
                rows={3}
                placeholder="例如：先和我厘清目标，再拆成可以验证的小步；发现方案有风险时直接指出。"
                onChange={(event) => setAgentDescription(event.target.value)}
                required
                disabled={creatingAgent || updatingAgentProfile}
              />
            </label>
            {!editingAgentId ? (
              <label className="agent-capability-choice">
                <input
                  type="checkbox"
                  checked={agentProjectWork}
                  onChange={(event) =>
                    setAgentProjectWork(event.target.checked)
                  }
                  disabled={creatingAgent}
                />
                <span>
                  <strong>允许它承接项目文件任务</strong>
                  <small>
                    默认关闭。开启后，它可在你明确切到项目工作并选择目录后，通过现有
                    DSH 流程操作项目文件；不会因为普通聊天自动执行。
                  </small>
                </span>
              </label>
            ) : null}
            <p className="dialog-footnote">
              {editingAgentId
                ? '资料保存在本机，不会调用模型。更新会影响之后在该联系人的各个聊天中开始的新回复；历史消息不变。专业范围是你的设定，不代表其能力已经验证。'
                : '创建时资料只保存在本机，不调用模型。以后在这里聊天时，专业范围与合作方式会随消息发送给当前模型。专业范围是你的设定，不代表其能力已经验证。'}
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={closeAgentDialog}
                disabled={creatingAgent || updatingAgentProfile}
              >
                取消
              </button>
              <button
                className="primary-action"
                type="submit"
                disabled={
                  creatingAgent ||
                  updatingAgentProfile ||
                  !agentName.trim() ||
                  !agentHeadline.trim() ||
                  !agentDescription.trim()
                }
              >
                {creatingAgent
                  ? '正在创建…'
                  : updatingAgentProfile
                    ? '正在保存…'
                    : editingAgentId
                      ? '保存资料'
                      : '创建联系人并开始私聊'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {createGroupOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeGroupDialog();
          }}
        >
          <form
            ref={dialogRef}
            className="social-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-group-title"
            onSubmit={(event) => void handleCreateGroup(event)}
          >
            <div className="dialog-heading">
              <div>
                <h2 id="create-group-title">新建群聊</h2>
                <p>把同一位联系人带进新的聊天空间。</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭"
                onClick={closeGroupDialog}
              >
                <Icon name="close" />
              </button>
            </div>
            <label className="dialog-field">
              <span>群聊名称</span>
              <input
                autoFocus
                data-dialog-initial-focus
                id="social-group-title"
                value={groupTitle}
                maxLength={80}
                placeholder="例如：Noema 产品讨论"
                onChange={(event) => setGroupTitle(event.target.value)}
                required
              />
            </label>
            <fieldset className="group-agent-picker">
              <legend>邀请联系人</legend>
              {activeAgents.map((agent) => (
                <label key={agent.id} className="group-agent-option">
                  <input
                    type="checkbox"
                    checked={groupAgentIds.includes(agent.id)}
                    onChange={() => toggleGroupAgent(agent.id)}
                  />
                  <AgentMark agent={agent} small />
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{agent.headline}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            {activeAgents.length < agents.length ? (
              <p className="dialog-footnote">
                已归档联系人保留在原有聊天记录中；恢复后才能加入新的群聊。
              </p>
            ) : null}
            <p className="dialog-footnote">
              群聊会有独立记录；不会把各自私聊的历史带进来。
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={closeGroupDialog}
              >
                取消
              </button>
              <button
                className="primary-action"
                type="submit"
                disabled={
                  !groupTitle.trim() ||
                  !groupAgentIds.some((agentId) =>
                    activeAgents.some((agent) => agent.id === agentId),
                  ) ||
                  busy
                }
              >
                {busy ? '正在创建…' : '创建群聊'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {settingsOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSettingsDialog();
          }}
        >
          <form
            ref={dialogRef}
            className="social-dialog settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-settings-title"
            onSubmit={(event) => void handleProviderSave(event)}
          >
            <div className="dialog-heading">
              <div>
                <h2 id="connection-settings-title">连接与模型</h2>
                <p>消息保存在本机，并发送到这里选择的模型服务。</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭"
                onClick={closeSettingsDialog}
              >
                <Icon name="close" />
              </button>
            </div>
            {state?.providerConfigured && !editProviderConfig ? (
              <div className="connection-summary">
                <span>
                  <i className={state.connected ? 'is-connected' : ''} />
                  {state.connected
                    ? '本机 FreeLLMAPI 已连接'
                    : 'FreeLLMAPI 已配置，当前连接不可用'}
                </span>
                <button
                  type="button"
                  data-dialog-initial-focus={
                    modelOptions.length === 0 ? true : undefined
                  }
                  onClick={beginProviderEdit}
                >
                  更改配置
                </button>
              </div>
            ) : (
              <>
                <label className="dialog-field">
                  <span>本机 FreeLLMAPI 地址</span>
                  <input
                    autoFocus
                    data-dialog-initial-focus
                    value={providerBaseUrl}
                    onChange={(event) => setProviderBaseUrl(event.target.value)}
                    placeholder="http://127.0.0.1:31415/v1"
                    required
                  />
                </label>
                <label className="dialog-field">
                  <span>统一 API Key</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={providerApiKey}
                    onChange={(event) => setProviderApiKey(event.target.value)}
                    placeholder={
                      state?.providerConfigured
                        ? '输入新 Key 以替换本机凭据'
                        : '粘贴 FreeLLMAPI Key'
                    }
                    required
                  />
                </label>
              </>
            )}
            <label className="dialog-field">
              <span>当前对话模型</span>
              <select
                aria-label="在设置中选择对话模型"
                data-dialog-initial-focus={
                  state?.providerConfigured && !editProviderConfig
                    ? modelOptions.length > 0
                    : undefined
                }
                value={activeModel}
                disabled={modelOptions.length === 0 || switchingModel}
                onChange={(event) => void handleModelChange(event.target.value)}
              >
                {modelOptions.map((model) => (
                  <option
                    key={model.name}
                    value={model.name}
                    disabled={
                      model.executionStatus === 'exhausted' ||
                      model.executionStatus === 'needsKey'
                    }
                  >
                    {model.label}
                    {model.executionStatus === 'ready'
                      ? ' · 最近可用'
                      : model.executionStatus === 'exhausted'
                        ? ' · 暂不可用'
                        : model.executionStatus === 'needsKey'
                          ? ' · 需密钥'
                          : ' · 状态未知'}
                  </option>
                ))}
              </select>
            </label>
            <p className="dialog-footnote">
              Noema 只接受本机地址。模型服务可能按各自政策处理请求内容。
            </p>
            {state?.error ? (
              <p className="dialog-error" role="status">
                {state.error}
              </p>
            ) : null}
            <div className="dialog-actions">
              {state?.providerConfigured && !editProviderConfig ? (
                <button
                  className="primary-action"
                  type="button"
                  onClick={closeSettingsDialog}
                >
                  完成
                </button>
              ) : (
                <>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={closeSettingsDialog}
                  >
                    取消
                  </button>
                  <button
                    className="primary-action"
                    type="submit"
                    disabled={savingProvider || !providerApiKey.trim()}
                  >
                    {savingProvider ? '正在检查…' : '保存并检查模型'}
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function ChatMessage({
  message,
  continuationOrigin,
  roomClosed,
  hideSenderMetadata,
  agent,
  canManageInteractionAdjustment,
  interactionAdjustment,
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
  continuationOrigin: boolean;
  roomClosed: boolean;
  hideSenderMetadata: boolean;
  agent: NoemaSocialAgent | null;
  canManageInteractionAdjustment: boolean;
  interactionAdjustment: NoemaInteractionAdjustment | null;
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
  const adjustmentEditorRef = useRef<HTMLFormElement>(null);
  const [adjustmentEditorOpen, setAdjustmentEditorOpen] = useState(false);
  const [adjustmentScope, setAdjustmentScope] = useState<
    'conversation' | 'coding' | 'both'
  >('conversation');
  const [adjustmentSituation, setAdjustmentSituation] = useState('');
  const [adjustmentBehavior, setAdjustmentBehavior] = useState('');
  const [adjustmentQuote, setAdjustmentQuote] = useState('');
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState('');

  useLayoutEffect(() => {
    if (!adjustmentEditorOpen || !adjustmentEditorRef.current) return;
    const observedThread =
      adjustmentEditorRef.current.closest('.message-thread');
    const keepEditorVisible = () => {
      const editor = adjustmentEditorRef.current;
      const thread = editor?.closest('.message-thread');
      if (!editor || !thread) return;
      editor.style.maxHeight = `${Math.max(180, thread.clientHeight - 28)}px`;
      editor.style.overflowY = 'auto';
      const editorBounds = editor.getBoundingClientRect();
      const threadBounds = thread.getBoundingClientRect();
      if (editorBounds.bottom > threadBounds.bottom) {
        thread.scrollTop +=
          Math.ceil(editorBounds.bottom - threadBounds.bottom) + 1;
      } else if (editorBounds.top < threadBounds.top) {
        thread.scrollTop -= Math.ceil(threadBounds.top - editorBounds.top) + 1;
      }
    };
    keepEditorVisible();
    adjustmentEditorRef.current.querySelector('input')?.focus({
      preventScroll: true,
    });
    const resizeObserver = observedThread
      ? new ResizeObserver(keepEditorVisible)
      : null;
    if (observedThread) resizeObserver?.observe(observedThread);
    window.addEventListener('resize', keepEditorVisible);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', keepEditorVisible);
    };
  }, [adjustmentEditorOpen]);

  const openAdjustmentEditor = () => {
    setAdjustmentScope(interactionAdjustment?.scope ?? 'conversation');
    setAdjustmentSituation(interactionAdjustment?.situation ?? '');
    setAdjustmentBehavior(interactionAdjustment?.behavior ?? '');
    setAdjustmentQuote(
      interactionAdjustment?.sourceQuote ?? message.content.slice(0, 240),
    );
    setAdjustmentError('');
    setAdjustmentEditorOpen(true);
  };

  const saveInteractionAdjustment = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !message.content.includes(adjustmentQuote) ||
      !adjustmentQuote.trim() ||
      adjustmentQuote.length > 240
    ) {
      setAdjustmentError('引用必须是这条消息中的连续原文，且不超过 240 字。');
      return;
    }
    setAdjustmentSaving(true);
    setAdjustmentError('');
    try {
      if (interactionAdjustment?.status === 'active') {
        await window.noema.updateInteractionAdjustment({
          id: interactionAdjustment.id,
          scope: adjustmentScope,
          situation: adjustmentSituation.trim(),
          behavior: adjustmentBehavior.trim(),
        });
      } else {
        await window.noema.addSocialInteractionAdjustment({
          sourceTurnId: message.turnId,
          sourceRoomId: message.roomId,
          scope: adjustmentScope,
          situation: adjustmentSituation.trim(),
          behavior: adjustmentBehavior.trim(),
          sourceQuote: adjustmentQuote.trim(),
        });
      }
      setAdjustmentEditorOpen(false);
    } catch (error) {
      setAdjustmentError(
        error instanceof Error ? error.message : '互动约定没有保存。',
      );
    } finally {
      setAdjustmentSaving(false);
    }
  };

  const withdrawInteractionAdjustment = async () => {
    if (!interactionAdjustment || interactionAdjustment.status !== 'active') {
      return;
    }
    setAdjustmentSaving(true);
    setAdjustmentError('');
    try {
      await window.noema.withdrawInteractionAdjustment(
        interactionAdjustment.id,
      );
      setAdjustmentEditorOpen(false);
    } catch (error) {
      setAdjustmentError(
        error instanceof Error ? error.message : '互动约定没有撤回。',
      );
    } finally {
      setAdjustmentSaving(false);
    }
  };

  if (message.role === 'system') {
    return (
      <div className="system-message">
        <span className="system-message-rule" />
        <p>{message.content}</p>
        <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
      </div>
    );
  }

  const canActOnMessage = message.status === 'complete' && !roomClosed;
  const actions = canActOnMessage ? (
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
          <button type="button" onClick={onReply}>
            回复
          </button>
          {canManageInteractionAdjustment && message.role === 'user' ? (
            <button
              type="button"
              onClick={openAdjustmentEditor}
              disabled={interactionAdjustment?.status === 'withdrawn'}
              title="只在 Noema 私聊中为这条用户原话显式保存互动约定"
            >
              {interactionAdjustment?.status === 'active'
                ? '互动约定'
                : interactionAdjustment?.status === 'withdrawn'
                  ? '已撤回'
                  : '设为约定'}
            </button>
          ) : null}
          <button type="button" onClick={onForward}>
            转发
          </button>
        </>
      )}
    </div>
  ) : null;

  const replyPreview = message.replyTo ? (
    <div className="message-reply-reference">
      <strong>{message.replyTo.sender}</strong>
      <span>{message.replyTo.content}</span>
    </div>
  ) : null;
  const forwardCard =
    message.forwardedSources.length > 0 ? (
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
        <div className="forwarded-message-items">
          {message.forwardedSources.map((source) => (
            <div
              className="forwarded-message-item"
              key={`${source.roomId}:${source.id}`}
            >
              <div>
                <b>{source.sender}</b>
                <time dateTime={source.createdAt}>
                  {timeLabel(source.createdAt)}
                </time>
              </div>
              <p>{source.content}</p>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  if (message.role === 'user') {
    return (
      <article
        className={`chat-message user-message ${forwardSelectionActive ? 'is-forward-selecting' : ''} ${forwardSelected ? 'is-forward-selected' : ''}`}
        data-message-id={message.id}
      >
        <div
          className={`message-author ${hideSenderMetadata ? 'visually-hidden' : ''}`}
        >
          <strong>你</strong>
          <time dateTime={message.createdAt}>
            {timeLabel(message.createdAt)}
          </time>
        </div>
        <div className="message-body">
          {replyPreview}
          {forwardCard}
          {message.content ? (
            <div className="message-bubble">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          ) : null}
          {actions}
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
          {adjustmentEditorOpen && canManageInteractionAdjustment ? (
            <form
              ref={adjustmentEditorRef}
              className="interaction-adjustment-editor"
              onSubmit={(event) => void saveInteractionAdjustment(event)}
            >
              <div className="interaction-adjustment-editor-heading">
                <strong>
                  {interactionAdjustment?.status === 'active'
                    ? '修改互动约定'
                    : '保存为互动约定'}
                </strong>
                <button
                  type="button"
                  className="interaction-adjustment-close"
                  onClick={() => setAdjustmentEditorOpen(false)}
                  aria-label="关闭互动约定编辑"
                  disabled={adjustmentSaving}
                >
                  ×
                </button>
              </div>
              <label>
                <span>遇到什么情况？</span>
                <input
                  value={adjustmentSituation}
                  onChange={(event) =>
                    setAdjustmentSituation(event.target.value)
                  }
                  maxLength={180}
                  required
                  placeholder="例如：我在分享一段不愉快的经历时"
                />
              </label>
              <label>
                <span>希望 Noema 怎么做？</span>
                <textarea
                  value={adjustmentBehavior}
                  onChange={(event) =>
                    setAdjustmentBehavior(event.target.value)
                  }
                  maxLength={240}
                  required
                  rows={2}
                  placeholder="写下你希望它未来如何回应"
                />
              </label>
              <label>
                <span>适用范围</span>
                <select
                  value={adjustmentScope}
                  onChange={(event) =>
                    setAdjustmentScope(
                      event.target.value as 'conversation' | 'coding' | 'both',
                    )
                  }
                >
                  <option value="conversation">Noema 日常对话</option>
                  <option value="coding">项目工作</option>
                  <option value="both">对话和项目工作</option>
                </select>
              </label>
              {interactionAdjustment?.status !== 'active' ? (
                <label>
                  <span>来源原话（需为连续原文）</span>
                  <textarea
                    value={adjustmentQuote}
                    onChange={(event) => setAdjustmentQuote(event.target.value)}
                    maxLength={240}
                    required
                    rows={2}
                  />
                </label>
              ) : (
                <p className="interaction-adjustment-source">
                  来源原话：{interactionAdjustment.sourceQuote}
                </p>
              )}
              <p className="interaction-adjustment-note">
                只保存你明确写下的偏好，不会自动从聊天中提取；撤回会停止后续带入，不会改写过去的请求。
              </p>
              {adjustmentError ? (
                <p className="interaction-adjustment-error" role="alert">
                  {adjustmentError}
                </p>
              ) : null}
              <div className="interaction-adjustment-actions">
                {interactionAdjustment?.status === 'active' ? (
                  <button
                    type="button"
                    className="interaction-adjustment-withdraw"
                    onClick={() => void withdrawInteractionAdjustment()}
                    disabled={adjustmentSaving}
                  >
                    撤回
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setAdjustmentEditorOpen(false)}
                  disabled={adjustmentSaving}
                >
                  取消
                </button>
                <button type="submit" disabled={adjustmentSaving}>
                  {adjustmentSaving ? '保存中…' : '保存约定'}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </article>
    );
  }

  const running = message.status === 'streaming';
  const failed =
    message.status === 'failed' || message.status === 'interrupted';
  return (
    <article
      className={`chat-message agent-message ${running ? 'is-running' : ''} ${forwardSelectionActive ? 'is-forward-selecting' : ''} ${forwardSelected ? 'is-forward-selected' : ''}`}
      data-message-id={message.id}
    >
      <div className="message-author">
        <strong>{agent?.name ?? 'Noema'}</strong>
        <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
      </div>
      <div className="message-body">
        {replyPreview}
        {forwardCard}
        <div className="message-bubble">
          {message.content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          ) : running ? (
            <span className="typing-state">
              <i />
              <i />
              <i />
              <span>正在回复</span>
            </span>
          ) : null}
        </div>
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
        <InteractionAdjustmentTrace
          snapshots={message.interactionAdjustmentSnapshots}
          attempts={message.interactionAdjustmentAttempts}
          currentAttempt={message.attempt}
          kind="conversation"
        />
        <SocialHistoryRecallTrace
          message={message}
          onOpenSource={onOpenHistorySource}
        />
        {actions}
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
    </article>
  );
}

function SocialHistoryRecallTrace({
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
          FreeLLMAPI
          已接受包含这些摘录的请求；这不证明模型实际使用或理解了它们。
        </p>
      ) : null}
      {sources.length && !message.historySourcesIncluded ? (
        <p className="history-recall-caveat">
          本机找到了这些摘录，但 FreeLLMAPI
          未返回接受响应；无法确认是否送达上游。
        </p>
      ) : null}
    </details>
  );
}

function InteractionAdjustmentTrace({
  snapshots,
  attempts = [],
  currentAttempt = 1,
  kind,
}: {
  snapshots: NoemaInteractionAdjustmentSnapshot[];
  attempts?: NoemaSocialMessage['interactionAdjustmentAttempts'];
  currentAttempt?: number;
  kind: 'conversation' | 'project';
}) {
  const history =
    attempts.length > 0
      ? attempts
      : snapshots.length > 0
        ? [
            {
              attempt: currentAttempt,
              interactionAdjustmentIds: snapshots.map(
                (snapshot) => snapshot.id,
              ),
              interactionAdjustmentSnapshots: snapshots,
            },
          ]
        : [];
  if (!history.some((entry) => entry.interactionAdjustmentSnapshots.length)) {
    return null;
  }
  return (
    <details className="interaction-adjustment-trace">
      <summary>
        {history.length > 1 ? `查看 ${history.length} 次回复尝试` : '本轮带入'}
        {kind === 'project' ? '编码协作' : '互动'}约定
      </summary>
      {history.map((entry) => (
        <section className="interaction-adjustment-attempt" key={entry.attempt}>
          {history.length > 1 ? <strong>第 {entry.attempt} 次</strong> : null}
          {entry.interactionAdjustmentSnapshots.length ? (
            <ul>
              {entry.interactionAdjustmentSnapshots.map((snapshot) => (
                <li key={snapshot.id}>
                  <strong>{snapshot.situation}</strong>
                  <span>{snapshot.behavior}</span>
                  <small>
                    来源：
                    {snapshot.sourceSurface === 'social'
                      ? 'Noema 聊天'
                      : '旧根对话'}
                    · 原话「
                    {snapshot.sourceQuote}」
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>这次尝试没有带入互动约定。</p>
          )}
        </section>
      ))}
      <p>这只表示 Noema 组装上下文时带入了它们，不证明上游收到或模型遵循。</p>
    </details>
  );
}

function ProjectWorkCard({
  task,
  agent,
  onStop,
  onRepeat,
  onDisableCase,
  onWithdrawPractice,
}: {
  task: NoemaSocialWorkTask;
  agent: NoemaSocialAgent | null;
  onStop: () => void;
  onRepeat: () => void;
  onDisableCase: () => void;
  onWithdrawPractice: () => void;
}) {
  const active = ['starting', 'running', 'verifying'].includes(task.status);
  const title =
    task.status === 'starting'
      ? '正在启动项目工作'
      : task.status === 'running'
        ? '工程搭档正在处理'
        : task.status === 'verifying'
          ? '正在核对交付文件'
          : task.status === 'completed'
            ? task.verificationStatus === 'verified'
              ? '项目工作已完成并核验'
              : '项目工作已结束 · 未独立核验'
            : task.status === 'interrupted'
              ? '项目工作已停止'
              : '项目工作未完成';
  const verificationLabel =
    task.verificationStatus === 'verified'
      ? '文件条件已由 Noema 独立确认'
      : task.verificationStatus === 'failed'
        ? '文件条件未通过'
        : task.verificationStatus === 'unavailable'
          ? '无法完成独立核验'
          : '没有设置可自动核对的文件条件';
  const toolLabels: Record<string, string> = {
    read: '读取',
    search: '搜索',
    write: '写入',
    edit: '编辑',
    command: '命令',
    other: '其他操作',
  };
  const toolSummary = Object.entries(
    task.toolActionCategories.reduce<Record<string, number>>((counts, item) => {
      counts[item] = (counts[item] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .map(([category, count]) => `${toolLabels[category] ?? '操作'} ${count}`)
    .join(' · ');
  return (
    <article
      className={`project-work-card project-work-${task.status}`}
      aria-label={`${agent?.name ?? '工程搭档'}：${title}`}
      aria-live={active ? 'polite' : undefined}
    >
      <header className="project-work-header">
        <span className="project-work-status-mark" aria-hidden="true" />
        <strong>
          {agent?.name ?? '工程搭档'} · {title}
        </strong>
        <time dateTime={task.updatedAt}>{timeLabel(task.updatedAt)}</time>
      </header>
      {task.sourceMessageId ? (
        <details className="project-work-task-detail">
          <summary>查看交给执行者的完整任务文本</summary>
          <p className="project-work-request">{task.taskPrompt}</p>
        </details>
      ) : (
        <p className="project-work-request">{task.taskPrompt}</p>
      )}
      <InteractionAdjustmentTrace
        snapshots={task.interactionAdjustmentSnapshots}
        kind="project"
      />
      {task.practiceSnapshot ? (
        <details className="project-work-case project-work-practice">
          <summary>本轮试用了一条跨房间候选做法</summary>
          <p>
            候选来自「{task.practiceSnapshot.roomTitle}」中的已核验工作；
            基础案例：
            {task.practiceSnapshot.basisTaskPrompt ||
              task.practiceSnapshot.basisTaskId}
          </p>
          <p>
            <strong>做法：</strong>
            {task.practiceSnapshot.action}
          </p>
          <p>
            <strong>边界：</strong>
            {task.practiceSnapshot.limits}
          </p>
          <p className="project-work-case-empty">
            这是一次候选试用；下方 Noema
            核验只检查当前文件条件，不证明做法导致了结果。
          </p>
        </details>
      ) : task.caseSnapshot ? (
        <details className="project-work-case">
          <summary>
            本轮引用了「{task.caseSnapshot.roomTitle}」中的已核验案例
          </summary>
          <p>来源任务：{task.caseSnapshot.taskPrompt || '（任务摘要为空）'}</p>
          {task.caseSnapshot.resultText ? (
            <p>当时结果：{task.caseSnapshot.resultText}</p>
          ) : null}
          <p>
            来源任务的文件条件曾通过 Noema
            核验；这只说明当时条件通过，不代表本轮应照搬或已因此成功。
          </p>
        </details>
      ) : task.caseReuseRequested ? (
        <p className="project-work-case-empty">
          本轮没有找到同一项目、来自其他聊天且通过核验的案例或候选做法。
        </p>
      ) : null}
      {task.practiceCandidateStatus === 'pending' ? (
        <p className="project-work-case-empty" role="status">
          Noema 正在整理一条候选做法；项目验收状态不受影响。
        </p>
      ) : null}
      {task.practiceCandidate ? (
        <details className="project-work-case project-work-practice">
          <summary>
            {task.practiceCandidateStatus === 'available'
              ? 'Noema 提出一条可试用的候选做法'
              : task.practiceCandidateStatus === 'trialing'
                ? '候选做法已交给另一房间的任务试用'
                : task.practiceCandidateStatus === 'trialed'
                  ? '候选做法已试用一次'
                  : '候选做法已撤回'}
          </summary>
          <p>
            <strong>触发条件：</strong>
            {task.practiceCandidate.trigger}
          </p>
          <p>
            <strong>候选做法：</strong>
            {task.practiceCandidate.action}
          </p>
          <p>
            <strong>适用边界：</strong>
            {task.practiceCandidate.limits}
          </p>
          <p className="project-work-case-empty">
            来源案例：
            {task.practiceBasisTaskId ?? task.practiceCandidate.basisTaskId}
            。候选不是永久技能；试用通过也不能单独证明方法导致了结果。
          </p>
          {task.practiceTrialTaskId ? (
            <p className="project-work-case-empty">
              试用结果：
              {task.practiceTrialVerificationStatus === 'verified'
                ? '列出的文件条件通过'
                : task.practiceTrialVerificationStatus === 'failed'
                  ? '文件条件未通过'
                  : task.practiceTrialVerificationStatus === 'unavailable'
                    ? '无法独立核验'
                    : '未设置核验条件'}
              （任务 {task.practiceTrialTaskStatus ?? '进行中'}
              ）。这只记录本次结果，不证明候选做法造成了结果。
            </p>
          ) : null}
          {['available', 'trialing', 'trialed'].includes(
            task.practiceCandidateStatus,
          ) ? (
            <div className="project-work-case-footer">
              <span>仅在同一好友、同一项目的另一个聊天中试用一次</span>
              <button type="button" onClick={onWithdrawPractice}>
                撤回候选
              </button>
            </div>
          ) : null}
        </details>
      ) : null}
      {task.practiceCandidateStatus === 'failed' ? (
        <p className="project-work-case-empty" role="status">
          Noema 没有生成候选做法；项目工作结果不受影响。
        </p>
      ) : null}
      {task.caseReuseRequested &&
      task.caseSnapshot &&
      task.verificationStatus === 'verified' &&
      task.practiceCandidateStatus === 'none' ? (
        <p className="project-work-case-empty" role="status">
          Noema 没有找到适合迁移的做法；已核验案例仍可单独引用。
        </p>
      ) : null}
      {active ? (
        <div className="project-work-progress">
          <span>
            {task.phase === 'verifying'
              ? '正在检查文件结果'
              : '项目工作仍在进行'}
          </span>
          {task.toolCallCount > 0 ? (
            <span>{toolSummary || `已进行 ${task.toolCallCount} 次操作`}</span>
          ) : null}
        </div>
      ) : null}
      <details className="project-work-location">
        <summary>查看项目范围</summary>
        <code title={task.workspacePath}>{task.workspacePath}</code>
      </details>
      {task.resultText ? (
        <div className="project-work-result">
          <span className="project-work-result-label">工程搭档回报</span>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {task.resultText}
          </ReactMarkdown>
        </div>
      ) : null}
      {!active ? (
        <p
          className={`project-work-verification is-${task.verificationStatus}`}
        >
          {verificationLabel}
        </p>
      ) : null}
      {task.errorMessage ? (
        <p className="project-work-error" role="status">
          {task.errorMessage}
        </p>
      ) : null}
      {!active && ['failed', 'interrupted'].includes(task.status) ? (
        <footer className="project-work-footer">
          <span>再次提交前，可以先检查项目里的部分改动</span>
          <button type="button" onClick={onRepeat}>
            再次编辑并执行
          </button>
        </footer>
      ) : null}
      {!active &&
      task.status === 'completed' &&
      task.verificationStatus === 'verified' &&
      task.caseEligible ? (
        <footer className="project-work-case-footer">
          <span>这项工作可作为同项目后续任务的案例</span>
          <button type="button" onClick={onDisableCase}>
            不再引用此案例
          </button>
        </footer>
      ) : null}
      {!task.caseEligible &&
      task.status === 'completed' &&
      task.verificationStatus === 'verified' ? (
        <p className="project-work-case-retired">已从后续案例中撤回</p>
      ) : null}
      {active ? (
        <footer className="project-work-footer">
          <span>停止不会撤销已经产生的文件改动</span>
          <button type="button" onClick={onStop}>
            <Icon name="stop" />
            停止工作
          </button>
        </footer>
      ) : null}
    </article>
  );
}

export { SocialChatApp };
