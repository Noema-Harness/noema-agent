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
import { useConversationNavigation } from './use-conversation-navigation';
import { useScrollActivity } from './use-scroll-activity';
import {
  socialWorkCardTitle,
  socialWorkExecutionStepPresentation,
  socialWorkRecoveryPresentation,
} from './social-work-presentation.mjs';
import type {
  NoemaSocialAgent,
  NoemaInteractionAdjustmentSnapshot,
  NoemaSocialEvent,
  NoemaSocialHistorySource,
  NoemaSocialMessage,
  NoemaSocialProject,
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

function dayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const today = new Date().toDateString() === date.toDateString();
  return `${today ? '今天 · ' : ''}${date.getMonth() + 1} 月 ${date.getDate()} 日`;
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
    | 'noema'
    | 'project'
    | 'archive'
    | 'attach'
    | 'arrow'
    | 'back'
    | 'menu'
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
    send: <path d="M12 5v14M6 11l6-6 6 6" />,
    noema: <path d="M5 18V9a5 5 0 0 1 10 0v9M9 18V9m10 9V6" />,
    project: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4m8-4v4M4 11h16m-11 4h6" />
      </>
    ),
    archive: (
      <>
        <rect x="3" y="4" width="18" height="4" rx="1" />
        <path d="M5 8v12h14V8m-10 5h6" />
      </>
    ),
    attach: (
      <path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8m-3 9 6-6" />
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" />
      </>
    ),
    back: <path d="m15 18-6-6 6-6M9 12h11" />,
    menu: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
      </>
    ),
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
      className={`portrait agent-mark ${agent.kind === 'core' ? 'core' : 'specialist'} ${small ? 'agent-mark-small' : ''}`}
      aria-hidden="true"
    >
      {agent.kind === 'core' ? (
        <Icon name="noema" />
      ) : (
        agent.name.trim().slice(0, 1)
      )}
    </span>
  );
}

function SocialChatApp() {
  const [state, setState] = useState<NoemaSocialState | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [projectWorkspaceId, setProjectWorkspaceId] = useState<string | null>(
    null,
  );
  const [agentWorkspaceId, setAgentWorkspaceId] = useState<string | null>(null);
  const [projectTab, setProjectTab] = useState<
    'delivery' | 'group' | 'members'
  >('delivery');
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [windowMaximized, setWindowMaximized] = useState(false);
  useEffect(() => {
    void window.noema.controlWindow?.('state').then(setWindowMaximized);
    return window.noema.onWindowStateChanged?.(setWindowMaximized);
  }, []);
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
  const [showRoomList, setShowRoomList] = useState(false);
  const navigation = useConversationNavigation();
  const shellRef = useRef<HTMLElement>(null);
  useScrollActivity(shellRef);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectBrief, setProjectBrief] = useState('');
  const [projectAgentIds, setProjectAgentIds] = useState<string[]>([]);
  const [projectBusy, setProjectBusy] = useState(false);
  const [archivedProjectsOpen, setArchivedProjectsOpen] = useState(false);
  const [projectStatusBusy, setProjectStatusBusy] = useState(false);
  const [activeProjectSession, setActiveProjectSession] = useState<{
    projectId: string;
    agentId: string;
    roomId: string;
  } | null>(null);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editProviderConfig, setEditProviderConfig] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupAgentIds, setGroupAgentIds] = useState<string[]>(['noema']);
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
  const groupDraftRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);
  const dialogRef = useRef<HTMLFormElement>(null);
  const forwardOriginMessageId = useRef<string | null>(null);
  const threadTriggerRef = useRef<HTMLButtonElement>(null);
  const groupTriggerRef = useRef<HTMLButtonElement>(null);
  const projectTriggerRef = useRef<HTMLButtonElement>(null);
  const agentTriggerRef = useRef<HTMLButtonElement>(null);
  const editAgentTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const shouldFollowRef = useRef(true);
  const loadSequenceRef = useRef(0);

  const draft = activeRoomId ? (draftsByRoom[activeRoomId] ?? '') : '';
  useLayoutEffect(() => setShowJumpToLatest(false), [activeRoomId]);
  useLayoutEffect(() => {
    const input = draftRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [
    draft,
    activeRoomId,
    roomState?.room.id,
    projectTab,
    projectWorkspaceId,
    agentWorkspaceId,
    archivedProjectsOpen,
  ]);
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
    const projectSessionStillActive = activeProjectSession
      ? next.projects.some(
          (project) =>
            project.id === activeProjectSession.projectId &&
            project.status !== 'archived',
        )
      : false;
    if (activeProjectSession && !projectSessionStillActive) {
      setActiveProjectSession(null);
    }
    setActiveRoomId((current) =>
      (current && next.rooms.some((room) => room.id === current)) ||
      (current === activeProjectSession?.roomId && projectSessionStillActive)
        ? current
        : 'room-noema',
    );
    return next;
  }, [activeProjectSession]);

  const closeGroupDialog = useCallback(() => {
    setCreateGroupOpen(false);
    requestAnimationFrame(() => groupTriggerRef.current?.focus());
  }, []);

  const closeProjectDialog = useCallback(() => {
    setCreateProjectOpen(false);
    setProjectTitle('');
    setProjectBrief('');
    setProjectAgentIds([]);
    requestAnimationFrame(() => projectTriggerRef.current?.focus());
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
        navigation.reveal();
        setShowRoomList(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, [navigation.reveal]);

  useEffect(() => {
    if (!navigation.narrow || !showRoomList) return;
    const dismissNavigation = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest('[role="dialog"]'))
      )
        return;
      event.preventDefault();
      setShowRoomList(false);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>('.navigation-reveal')
          ?.focus(),
      );
    };
    window.addEventListener('keydown', dismissNavigation);
    return () => window.removeEventListener('keydown', dismissNavigation);
  }, [navigation.narrow, showRoomList]);

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
      !createProjectOpen &&
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
        else if (createProjectOpen) closeProjectDialog();
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
    createProjectOpen,
    createAgentOpen,
    editingAgentId,
    settingsOpen,
    forwardDialogOpen,
    threadDialogOpen,
    closeGroupDialog,
    closeProjectDialog,
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
  const projects = state?.projects ?? [];
  const editingAgent = editingAgentId
    ? (agents.find((agent) => agent.id === editingAgentId) ?? null)
    : null;
  const rooms = state?.rooms ?? [];
  const noemaRoom = rooms.find((room) => room.id === 'room-noema') ?? null;
  const currentProjectSessionRoom =
    activeProjectSession && roomState?.room.id === activeProjectSession.roomId
      ? {
          ...roomState.room,
          lastMessageAt: roomState.messages.at(-1)?.createdAt ?? null,
          messageCount: roomState.messages.length,
          memberIds: roomState.members.map((member) => member.id),
          preview: null,
        }
      : null;
  const currentRoom =
    rooms.find((room) => room.id === activeRoomId) ??
    (currentProjectSessionRoom?.id === activeRoomId
      ? currentProjectSessionRoom
      : null);
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
    roomCanWork && currentRoom?.id !== noemaRoom?.id;
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
  const projectRoomIds = new Set(
    projects.map((project) => project.groupRoomId),
  );
  const projectSessionRoomIds = new Set(
    projects.flatMap((project) =>
      project.members.flatMap((member) =>
        member.sessionRoomId ? [member.sessionRoomId] : [],
      ),
    ),
  );
  const otherRooms = filteredRooms.filter(
    (room) =>
      room.id !== noemaRoom?.id &&
      !projectRoomIds.has(room.id) &&
      !projectSessionRoomIds.has(room.id),
  );
  const memberRooms = otherRooms.filter(
    (room) => room.kind === 'direct' && !room.parentRoomId,
  );
  const otherConversationRooms = otherRooms.filter(
    (room) => room.kind !== 'direct' || Boolean(room.parentRoomId),
  );
  const projectQuery = search.trim().toLocaleLowerCase();
  const visibleProjects = projects.filter((project) => {
    if (!projectQuery) return true;
    const memberNames = project.members.map((member) => member.name).join(' ');
    return `${project.title} ${project.brief} ${memberNames}`
      .toLocaleLowerCase()
      .includes(projectQuery);
  });
  const activeProjects = visibleProjects.filter(
    (project) => project.status !== 'archived',
  );
  const archivedProjects = visibleProjects.filter(
    (project) => project.status === 'archived',
  );
  const activeProject =
    projects.find((project) => project.groupRoomId === currentRoom?.id) ??
    projects.find((project) => project.id === activeProjectSession?.projectId);
  const projectWorkspace =
    projects.find((project) => project.id === projectWorkspaceId) ?? null;
  const projectGroupRoom = projectWorkspace
    ? (rooms.find((room) => room.id === projectWorkspace.groupRoomId) ?? null)
    : null;
  const agentWorkspace =
    agents.find((agent) => agent.id === agentWorkspaceId) ?? null;
  const viewingProjectSession = Boolean(
    activeProjectSession &&
    activeProjectSession.roomId === currentRoom?.id &&
    activeProject?.id === activeProjectSession.projectId,
  );
  const visibleMessageSearchResults =
    messageSearchResultQuery === search.trim() ? messageSearchResults : [];

  const renderRoomListItem = (room: NoemaSocialRoom) => {
    const agent = messageAgent.get(room.memberIds[0] ?? '');
    const selected =
      !projectWorkspaceId &&
      !agentWorkspaceId &&
      !archivedProjectsOpen &&
      room.id === activeRoomId;
    return (
      <button
        key={room.id}
        type="button"
        className={`index-item room-list-item ${selected ? 'selected' : ''}`}
        aria-current={selected ? 'page' : undefined}
        onClick={() => selectRoom(room)}
      >
        {room.kind === 'direct' && agent ? (
          <AgentMark agent={agent} />
        ) : (
          <span className="portrait">
            <Icon name="users" />
          </span>
        )}
        <span>
          <span className="item-title">{room.title}</span>
          <small>
            {room.kind === 'direct'
              ? agent?.kind === 'core'
                ? '你的个人伙伴'
                : agent?.headline || '常驻私聊'
              : room.preview?.text || '独立的群聊记录'}
          </small>
        </span>
      </button>
    );
  };

  const selectRoom = (room: NoemaSocialRoom) => {
    setShowJumpToLatest(false);
    setArchivedProjectsOpen(false);
    setActiveProjectSession(null);
    setProjectWorkspaceId(null);
    setAgentWorkspaceId(null);
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

  const openAgentWorkspace = (agentId: string) => {
    setArchivedProjectsOpen(false);
    setProjectWorkspaceId(null);
    setAgentWorkspaceId(agentId);
    setActiveProjectSession(null);
    setSelectedAgentId('noema');
    setComposerMode('chat');
    setReplyTarget(null);
    setForwardSelectionActive(false);
    setSelectedForwardMessageIds([]);
    setActiveRoomId('room-noema');
    setShowRoomList(false);
    shouldFollowRef.current = true;
    const homeRoom = rooms.find((room) => room.id === 'room-noema');
    if (homeRoom) void loadRoom(homeRoom.id);
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
      (draftRef.current ?? groupDraftRef.current)?.focus();
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

  const handleCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    const eligibleAgentIds = projectAgentIds.filter((agentId) =>
      activeAgents.some((agent) => agent.id === agentId),
    );
    if (!eligibleAgentIds.length) {
      setNotice('项目至少需要一位未归档的专业联系人。');
      return;
    }
    setProjectBusy(true);
    setNotice('');
    try {
      const project = await window.noema.createSocialProject({
        title: projectTitle.trim(),
        brief: projectBrief.trim(),
        agentIds: ['noema', ...eligibleAgentIds],
      });
      closeProjectDialog();
      const next = await refreshState();
      setProjectWorkspaceId(project.id);
      setAgentWorkspaceId(null);
      setActiveProjectSession(null);
      setActiveRoomId('room-noema');
      setShowRoomList(false);
      const homeRoom = next.rooms.find((room) => room.id === 'room-noema');
      if (homeRoom) {
        setSelectedAgentId('noema');
        setComposerMode('chat');
        void loadRoom(homeRoom.id);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '项目没有创建成功。');
    } finally {
      setProjectBusy(false);
    }
  };

  const openProject = async (project: NoemaSocialProject) => {
    setNotice('');
    try {
      if (project.status === 'archived') {
        await window.noema.restoreSocialProject(project.id);
      }
      const next = await refreshState();
      setProjectWorkspaceId(project.id);
      setArchivedProjectsOpen(false);
      setProjectTab('delivery');
      setAgentWorkspaceId(null);
      setActiveProjectSession(null);
      setSelectedAgentId('noema');
      setComposerMode('chat');
      setReplyTarget(null);
      setActiveRoomId(project.groupRoomId);
      setShowRoomList(false);
      shouldFollowRef.current = true;
      if (next.rooms.some((room) => room.id === project.groupRoomId))
        void loadRoom(project.groupRoomId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法打开这个项目。');
    }
  };

  const openProjectMemberSession = async (
    project: NoemaSocialProject,
    agentId: string,
  ) => {
    setNotice('');
    try {
      const session = await window.noema.getSocialProjectSession(
        project.id,
        agentId,
      );
      shouldFollowRef.current = true;
      setActiveProjectSession({
        projectId: project.id,
        agentId,
        roomId: session.room.room.id,
      });
      setProjectWorkspaceId(null);
      setAgentWorkspaceId(null);
      setRoomState(session.room);
      setActiveRoomId(session.room.room.id);
      setSelectedAgentId(agentId);
      setComposerMode('chat');
      setReplyTarget(null);
      setForwardSelectionActive(false);
      setSelectedForwardMessageIds([]);
      setShowRoomList(false);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '无法打开成员的项目会话。',
      );
    }
  };

  const archiveCurrentProject = async (project = activeProject) => {
    if (!project || projectStatusBusy) return;
    setProjectStatusBusy(true);
    setNotice('');
    try {
      await window.noema.archiveSocialProject(project.id);
      await refreshState();
      setProjectWorkspaceId(null);
      if (activeProject?.id === project.id) setActiveRoomId('room-noema');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '项目尚不能归档。');
    } finally {
      setProjectStatusBusy(false);
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

  const turnDate = (turn: (typeof conversationTurns)[number] | undefined) => {
    const first = turn?.items[0];
    return first
      ? first.kind === 'message'
        ? first.message.createdAt
        : first.task.createdAt
      : '';
  };

  const navigationHidden = navigation.narrow
    ? !showRoomList
    : navigation.collapsed;
  const workspaceOpen = Boolean(
    projectWorkspace || agentWorkspace || archivedProjectsOpen,
  );
  const composerDisabled =
    !composerReady ||
    Boolean(currentRoom?.closedAt) ||
    forwardSelectionActive ||
    !currentRecipient ||
    currentRecipientArchived ||
    Boolean(activeReply) ||
    workBusy ||
    (composerMode === 'project' && !currentRecipientCanWork);
  const sendDisabled = composerDisabled || !draft.trim() || busy;
  const conversationContent =
    currentRoom && roomState?.room.id === currentRoom.id ? (
      <>
        <div
          className={`${currentRoom.id === noemaRoom?.id ? 'chat-scroll' : 'session-scroll'} message-thread`}
          data-room-id={currentRoom.id}
          ref={conversationRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            shouldFollowRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              60;
            setShowJumpToLatest(!shouldFollowRef.current);
          }}
          aria-live="polite"
          aria-relevant="additions text"
        >
          {currentRoom.id !== noemaRoom?.id &&
          members[0]?.kind === 'specialist' ? (
            <div className="session-label">
              {viewingProjectSession
                ? `${activeProject?.title ?? '项目'} / 此成员的项目工作会话`
                : '日常私聊 / 与项目工作会话分开'}
            </div>
          ) : null}
          {!messages.some((message) => message.role !== 'system') &&
          workTasks.length === 0 ? (
            <div className="empty-chat" aria-label="空对话">
              <span className="room-empty-rule" aria-hidden="true" />
              <span>
                {currentRoom.kind === 'group'
                  ? '群聊记录从这里开始'
                  : `${currentRoom.title} · 新对话`}
              </span>
            </div>
          ) : (
            <div
              className={`${currentRoom.id === noemaRoom?.id ? 'chat-body' : 'session-body'} message-sequence`}
              data-room-kind={currentRoom.kind}
            >
              {conversationTurns.map((turn, turnIndex) => (
                <section
                  className="conversation-turn"
                  data-conversation-turn={turn.id}
                  key={turn.id}
                >
                  {dayLabel(turnDate(turn)) !==
                  dayLabel(turnDate(conversationTurns[turnIndex - 1])) ? (
                    <div className="dayline">{dayLabel(turnDate(turn))}</div>
                  ) : null}
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
                          agent={
                            item.message.agentId
                              ? (messageAgent.get(item.message.agentId) ?? null)
                              : null
                          }
                          onRetry={handleRetry}
                          onOpenHistorySource={openHistorySource}
                          forwardSelectionActive={forwardSelectionActive}
                          forwardSelected={selectedForwardMessageIds.includes(
                            item.message.id,
                          )}
                          onReply={() => {
                            const forwardedText = item.message.forwardedSources
                              .map(
                                (source) =>
                                  `${source.sender}：${source.content}`,
                              )
                              .join('\n');
                            setReplyTarget({
                              id: item.message.id,
                              roomId: currentRoom.id,
                              role: item.message.role as 'user' | 'assistant',
                              sender:
                                item.message.role === 'user'
                                  ? '你'
                                  : (messageAgent.get(
                                      item.message.agentId ?? '',
                                    )?.name ?? '联系人'),
                              createdAt: item.message.createdAt,
                              content: forwardedText || item.message.content,
                            });
                            draftRef.current?.focus();
                          }}
                          onForward={() => beginForwardSelection(item.message)}
                          continuationThreads={childThreads.filter(
                            (thread) =>
                              thread.originMessageId === item.message.id,
                          )}
                          onOpenContinuation={(thread) => selectRoom(thread)}
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
        <button
          className="jump-latest"
          type="button"
          hidden={!showJumpToLatest}
          onClick={() => {
            const scroll = conversationRef.current;
            if (scroll) {
              shouldFollowRef.current = true;
              scroll.scrollTop = scroll.scrollHeight;
            }
            setShowJumpToLatest(false);
          }}
        >
          回到最新消息 ↓
        </button>
        <form
          className="composer message-composer"
          onSubmit={(event) =>
            void (composerMode === 'project'
              ? handleStartProjectWork(event)
              : handleSend(event))
          }
        >
          <div className="composer-inner">
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
              <div className="draft-quote">
                <span>
                  引用 {replyTarget.sender}：
                  {replyTarget.content.replace(/\s+/gu, ' ').slice(0, 150)}
                </span>
                <button
                  type="button"
                  aria-label="取消引用"
                  onClick={() => {
                    setReplyTarget(null);
                    requestAnimationFrame(() => draftRef.current?.focus());
                  }}
                >
                  ×
                </button>
              </div>
            ) : null}

            <div className="composer-field">
              <label className="visually-hidden" htmlFor="social-message-input">
                给{currentRecipient?.name ?? '联系人'}发送消息
              </label>
              <textarea
                id="social-message-input"
                ref={draftRef}
                value={draft}
                rows={2}
                placeholder={
                  composerMode === 'project'
                    ? '描述希望在项目中完成什么…'
                    : currentRoom.id === noemaRoom?.id
                      ? `和${currentRecipient?.name ?? 'Noema'}说点什么…`
                      : `发给${currentRecipient?.name ?? '联系人'}…`
                }
                onChange={(event) => {
                  setDraft(event.target.value);
                  event.currentTarget.style.height = 'auto';
                  event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 180)}px`;
                }}
                onKeyDown={handleComposerKeyDown}
                disabled={composerDisabled}
              />
              <button
                className="icon-button attach-button"
                type="button"
                aria-label="添加附件（尚未接入）"
                title="附件尚未接入，当前可发送文字"
                disabled
              >
                <Icon name="attach" />
              </button>
              {activeReply && composerMode === 'chat' ? (
                <button
                  className="send stop-reply-button"
                  type="button"
                  aria-label="停止回复"
                  title="停止回复"
                  onClick={() => void handleStop()}
                >
                  <Icon name="stop" />
                </button>
              ) : (
                <button
                  className="send send-message-button"
                  type="submit"
                  aria-label={
                    composerMode === 'project' ? '选择项目并启动' : '发送消息'
                  }
                  title={
                    composerMode === 'project' ? '选择项目并启动' : '发送消息'
                  }
                  disabled={sendDisabled}
                >
                  <Icon name="send" />
                </button>
              )}
            </div>
            <div className="composer-hint">
              <span>Enter 发送 · Shift + Enter 换行</span>
              <span>{activeRoute?.label || activeModel || '尚未连接模型'}</span>
            </div>
          </div>
        </form>
      </>
    ) : (
      <div className="empty-chat" role="status">
        正在打开聊天…
      </div>
    );

  return (
    <main
      className={`social-shell app layout-c${workspaceOpen ? ' has-workspace' : ''}${navigationHidden ? ' index-closed' : ''}${navigation.narrow ? ' narrow-shell' : ''}${navigation.dragging ? ' resizing' : ''}`}
      ref={shellRef}
    >
      <header className="window-head social-topbar" aria-label="应用导航">
        <div className="wordmark">
          <button
            className="index-toggle navigation-reveal"
            type="button"
            aria-controls="conversation-navigation"
            aria-label={navigationHidden ? '展开导航' : '收起导航'}
            aria-expanded={!navigationHidden}
            onClick={() => {
              if (navigation.narrow) setShowRoomList((open) => !open);
              else if (navigation.collapsed) navigation.reveal();
              else navigation.collapse();
            }}
          >
            <Icon name="menu" />
          </button>
          <span className="logo">
            <Icon name="noema" />
          </span>
          <span>noema</span>
        </div>
        <div className="window-tools">
          <div className="window-controls" aria-label="窗口控件">
            <button
              className="window-control"
              type="button"
              title="最小化"
              aria-label="最小化"
              onClick={() => void window.noema.controlWindow('minimize')}
            >
              <svg viewBox="0 0 16 16">
                <path d="M3 8h10" />
              </svg>
            </button>
            <button
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
              <svg viewBox="0 0 16 16">
                {windowMaximized ? (
                  <path d="M5 3h8v8M3 5h8v8H3Z" />
                ) : (
                  <rect x="3" y="3" width="10" height="10" />
                )}
              </svg>
            </button>
            <button
              className="window-control close-control"
              type="button"
              title="关闭窗口"
              aria-label="关闭窗口"
              onClick={() => void window.noema.controlWindow('close')}
            >
              <svg viewBox="0 0 16 16">
                <path d="m3 3 10 10M13 3 3 13" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <div
        ref={navigation.containerRef}
        className={`shell social-body${navigation.collapsed ? ' navigation-collapsed' : ''}${navigation.dragging ? ' navigation-resizing' : ''}`}
        style={
          {
            ...navigation.style,
            '--index-width': `${navigation.width}px`,
          } as React.CSSProperties
        }
      >
        <button
          className="index-shade"
          type="button"
          aria-label="收起导航"
          onClick={() => setShowRoomList(false)}
        />
        <aside
          className="index conversation-sidebar"
          id="conversation-navigation"
          aria-label="成员和项目索引"
          inert={navigationHidden}
        >
          <label className="index-search chat-search">
            <Icon name="search" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              aria-label="搜索联系人、聊天和消息"
              placeholder="搜索成员或项目"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="section-title">与你对话</div>
          {noemaRoom ? renderRoomListItem(noemaRoom) : null}
          <div className="section-title">
            <span>成员</span>
            <span>{memberRooms.length}</span>
          </div>
          <nav aria-label="成员">
            {memberRooms.map((room) => renderRoomListItem(room))}
          </nav>
          {otherConversationRooms.length ? (
            <>
              <div className="section-title">
                <span>其他聊天</span>
              </div>
              <nav aria-label="其他聊天">
                {otherConversationRooms.map((room) => renderRoomListItem(room))}
              </nav>
            </>
          ) : null}
          <div className="section-title">
            <span>项目</span>
            <span>{activeProjects.length}</span>
          </div>
          <nav aria-label="项目">
            {activeProjects.map((project) => (
              <button
                type="button"
                className={`index-item project-list-item ${projectWorkspaceId === project.id ? 'selected' : ''}`}
                key={project.id}
                aria-current={
                  projectWorkspaceId === project.id ? 'page' : undefined
                }
                onClick={() => void openProject(project)}
              >
                <span className="project-icon">
                  <Icon name="project" />
                </span>
                <span>
                  <span className="item-title">{project.title}</span>
                  <small>
                    {project.status === 'awaiting_user'
                      ? '等待你的评审'
                      : '进行中'}
                  </small>
                </span>
              </button>
            ))}
          </nav>
          {!activeProjects.length ? (
            <div className="index-empty-state">当前没有活跃项目</div>
          ) : null}
          <button
            type="button"
            className="bottom-link"
            onClick={() => {
              setArchivedProjectsOpen(true);
              setProjectWorkspaceId(null);
              setAgentWorkspaceId(null);
              setShowRoomList(false);
            }}
          >
            <Icon name="archive" />{' '}
            <span>已归档项目 · {archivedProjects.length}</span>
          </button>
          {search.trim() ? (
            <section
              className="message-search-results"
              aria-label="消息搜索结果"
              aria-live="polite"
              data-search-query={messageSearchResultQuery}
            >
              <h3>消息</h3>
              {messageSearchLoading ? <p>正在搜索历史消息…</p> : null}
              {messageSearchError ? (
                <p role="status">{messageSearchError}</p>
              ) : null}
              {visibleMessageSearchResults.map((result) => (
                <button
                  className="message-search-result"
                  type="button"
                  key={`${result.roomId}:${result.id}`}
                  onClick={() => openMessageSearchResult(result)}
                >
                  <strong>{result.roomTitle}</strong>
                  <span>{result.content}</span>
                </button>
              ))}
            </section>
          ) : null}
          <div className="section-title">个人</div>
          <button
            className="bottom-link sidebar-settings-button"
            ref={settingsTriggerRef}
            type="button"
            aria-label="连接与模型设置"
            onClick={() => setSettingsOpen(true)}
          >
            伙伴设置
          </button>
        </aside>
        <div
          className="index-resizer navigation-resize-handle"
          role="separator"
          tabIndex={navigation.narrow || navigation.collapsed ? -1 : 0}
          aria-label="调整导航宽度"
          aria-controls="conversation-navigation"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={navigation.widthLimit}
          aria-valuenow={
            navigation.collapsed ? 0 : Math.round(navigation.width)
          }
          {...navigation.separatorProps}
        />
        <section
          className="chat conversation-panel"
          aria-label="当前聊天"
          inert={navigation.narrow && showRoomList}
        >
          <header
            className={`${currentRoom?.id === noemaRoom?.id ? 'pane-head' : 'work-head'} room-header`}
          >
            <div
              className={
                currentRoom?.id === noemaRoom?.id ? 'identity' : 'work-title'
              }
            >
              {currentRoom?.id !== noemaRoom?.id ? (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={
                    viewingProjectSession ? '返回项目空间' : '返回 Noema 主聊'
                  }
                  onClick={() => {
                    if (viewingProjectSession && activeProject) {
                      void openProject(activeProject).then(() =>
                        setProjectTab('members'),
                      );
                    } else if (noemaRoom) selectRoom(noemaRoom);
                  }}
                >
                  <Icon name="back" />
                </button>
              ) : null}
              {members[0] && currentRoom?.id === noemaRoom?.id ? (
                <AgentMark agent={members[0]} />
              ) : null}
              <div className="chat-header-title">
                <strong>
                  {viewingProjectSession
                    ? members[0]?.name
                    : currentRoom?.title || 'Noema'}
                </strong>
                <small>
                  {viewingProjectSession
                    ? `${activeProject?.title ?? '项目'} · 项目会话`
                    : currentRoom?.kind === 'group'
                      ? `${members.map((member) => member.name).join(' · ')} 与你`
                      : currentRoom?.id === noemaRoom?.id
                        ? '与你的持续对话'
                        : '常驻私聊'}
                </small>
              </div>
            </div>
            <div className="pane-actions">
              <button
                className="icon-button"
                type="button"
                aria-label="搜索聊天和消息"
                title="查找当前对话"
                onClick={() => {
                  navigation.reveal();
                  setShowRoomList(true);
                  requestAnimationFrame(() => searchRef.current?.focus());
                }}
              >
                <Icon name="search" />
              </button>
              {members[0]?.kind === 'specialist' ? (
                <button
                  className="quiet"
                  type="button"
                  aria-label="成员资料"
                  title="成员资料"
                  onClick={() => openAgentWorkspace(members[0].id)}
                >
                  资料
                </button>
              ) : null}
            </div>
          </header>
          {currentRoom?.parentRoomId ? (
            <div className="note-row">
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  const parent = rooms.find(
                    (room) => room.id === currentRoom.parentRoomId,
                  );
                  if (parent) {
                    selectRoom(parent);
                    setPendingScrollMessageId(currentRoom.originMessageId);
                  }
                }}
              >
                回到来源消息
              </button>{' '}
              · {currentRoom.closedAt ? '已结束' : '持续主题'}{' '}
              <button
                type="button"
                className="quiet"
                onClick={() => void handleThreadStatus(!currentRoom.closedAt)}
                disabled={threadStatusBusy}
              >
                {currentRoom.closedAt ? '重新打开' : '结束主题'}
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => void handleDeleteThread()}
                disabled={threadStatusBusy}
              >
                删除
              </button>
            </div>
          ) : null}
          {!workspaceOpen ? (
            currentRoom?.id === noemaRoom?.id ? (
              conversationContent
            ) : (
              <div className="session-content">{conversationContent}</div>
            )
          ) : null}
        </section>
        <section
          className="workspace"
          aria-label="当前工作内容"
          inert={navigation.narrow && showRoomList}
        >
          {projectWorkspace ? (
            <>
              <header className="work-head">
                <div className="work-title">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="返回 Noema 主聊"
                    onClick={() => {
                      if (noemaRoom) selectRoom(noemaRoom);
                    }}
                  >
                    <Icon name="back" />
                  </button>
                  <div>
                    <strong>{projectWorkspace.title}</strong>
                    <small>
                      项目空间 ·{' '}
                      {projectWorkspace.status === 'awaiting_user'
                        ? '等待你的评审'
                        : projectWorkspace.status === 'archived'
                          ? '已归档'
                          : '进行中'}
                    </small>
                  </div>
                </div>
              </header>
              <nav className="work-tabs" aria-label="项目视图">
                {(['delivery', 'group', 'members'] as const).map(
                  (tab, index) => (
                    <button
                      type="button"
                      key={tab}
                      className={projectTab === tab ? 'active' : ''}
                      aria-pressed={projectTab === tab}
                      onClick={() => setProjectTab(tab)}
                    >
                      {
                        [
                          '交付',
                          '共同讨论',
                          `成员 · ${projectWorkspace.members.length}`,
                        ][index]
                      }
                    </button>
                  ),
                )}
              </nav>
              {projectTab === 'group' ? (
                <div
                  className="work-content"
                  ref={conversationRef}
                  data-room-id={currentRoom?.id}
                  onScroll={(event) => {
                    const scroll = event.currentTarget;
                    shouldFollowRef.current =
                      scroll.scrollHeight -
                        scroll.scrollTop -
                        scroll.clientHeight <
                      60;
                  }}
                >
                  <div className="discussion">
                    <p className="lead">
                      共同讨论与项目决定在这里；成员的完整执行过程在各自的工作会话中。
                    </p>
                    {messages.map((message) => (
                      <GroupMessage
                        key={message.id}
                        message={message}
                        agent={
                          message.agentId
                            ? (messageAgent.get(message.agentId) ?? null)
                            : null
                        }
                        onRetry={handleRetry}
                      />
                    ))}
                    {notice ? (
                      <div className="note-row" role="status">
                        {notice}
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => setNotice('')}
                        >
                          关闭
                        </button>
                      </div>
                    ) : null}
                    <div className="note-row">
                      {providerReady
                        ? `本条由 ${currentRecipient?.name ?? 'Noema'} 回应。`
                        : providerWarning}
                      {!providerReady ? (
                        <button
                          className="quiet"
                          type="button"
                          onClick={() => setSettingsOpen(true)}
                        >
                          连接模型
                        </button>
                      ) : null}
                    </div>
                    <form
                      className="group-form"
                      onSubmit={(event) => void handleSend(event)}
                    >
                      <input
                        ref={groupDraftRef}
                        aria-label="在项目群中发消息"
                        placeholder="在项目群中发消息"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        disabled={composerDisabled}
                      />
                      {activeReply ? (
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => void handleStop()}
                        >
                          停止回复
                        </button>
                      ) : (
                        <button
                          className="primary"
                          type="submit"
                          disabled={sendDisabled}
                        >
                          发送
                        </button>
                      )}
                    </form>
                  </div>
                </div>
              ) : (
                <div className="work-content">
                  {projectTab === 'members' ? (
                    <>
                      <h2>这次项目的成员</h2>
                      <p className="lead">
                        同一位持续存在的成员，在这里拥有独立的项目工作会话。
                      </p>
                      <div className="member-list">
                        {projectWorkspace.members.map((member) => {
                          const agent = agents.find(
                            (candidate) => candidate.id === member.agentId,
                          );
                          return (
                            <button
                              type="button"
                              className="member-row"
                              key={member.agentId}
                              disabled={
                                member.status !== 'active' ||
                                Boolean(member.agentArchivedAt)
                              }
                              onClick={() => {
                                if (member.agentId === 'noema') {
                                  if (noemaRoom) selectRoom(noemaRoom);
                                } else
                                  void openProjectMemberSession(
                                    projectWorkspace,
                                    member.agentId,
                                  );
                              }}
                            >
                              {agent ? (
                                <AgentMark agent={agent} />
                              ) : (
                                <span className="portrait">
                                  {member.name.slice(0, 1)}
                                </span>
                              )}
                              <span className="member-name">
                                <strong>{member.name}</strong>
                                <small>
                                  {member.agentId === 'noema'
                                    ? '协调与阶段把关'
                                    : agent?.headline || '项目成员'}
                                </small>
                              </span>
                              <span className="status">
                                {member.status === 'active'
                                  ? '打开工作会话'
                                  : '已退出'}
                              </span>
                              <Icon name="arrow" />
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="project-stage">
                        <span
                          className={`state-mark ${projectWorkspace.status === 'awaiting_user' ? '' : 'running'}`}
                        />
                        {projectWorkspace.status === 'awaiting_user'
                          ? '等待你的反馈'
                          : '项目进行中'}
                      </div>
                      <h2>{projectWorkspace.title}</h2>
                      <p className="lead">{projectWorkspace.brief}</p>
                      {workTasks.length ? (
                        workTasks.map(renderProjectWorkCard)
                      ) : (
                        <div className="project-summary">
                          <section>
                            <h3>当前阶段</h3>
                            <p>
                              {projectWorkspace.status === 'awaiting_user'
                                ? '等待你的评审，相关工作暂停。'
                                : '项目进行中。'}
                            </p>
                          </section>
                          <section>
                            <h3>最近进展</h3>
                            <p>
                              {projectGroupRoom?.preview?.text ||
                                '还没有阶段交付。成员的讨论会保留在共同讨论中。'}
                            </p>
                          </section>
                        </div>
                      )}
                      <div className="real-project-actions">
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => setProjectTab('group')}
                        >
                          查看共同讨论
                        </button>
                        <button
                          className="quiet"
                          type="button"
                          disabled={
                            projectStatusBusy ||
                            projectWorkspace.status === 'awaiting_user'
                          }
                          title={
                            projectWorkspace.status === 'awaiting_user'
                              ? '先在 Noema 主聊完成待反馈事项'
                              : '归档后保留项目和成员会话'
                          }
                          onClick={() =>
                            void archiveCurrentProject(projectWorkspace)
                          }
                        >
                          {projectStatusBusy ? '正在归档…' : '归档项目'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {projectWorkspace.status === 'awaiting_user' ? (
                <div className="review-dock">
                  <div>
                    Noema 正在等你的评审
                    <small>请求保留在与 Noema 的对话中</small>
                  </div>
                  <div className="dock-actions">
                    <button
                      className="review-jump"
                      type="button"
                      onClick={() => {
                        if (noemaRoom) selectRoom(noemaRoom);
                      }}
                    >
                      回到 Noema 主聊 <Icon name="arrow" />
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : agentWorkspace ? (
            <>
              <header className="work-head">
                <div className="work-title">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="返回成员会话"
                    onClick={() => {
                      const room = rooms.find(
                        (candidate) =>
                          candidate.kind === 'direct' &&
                          !candidate.parentRoomId &&
                          candidate.memberIds.length === 1 &&
                          candidate.memberIds[0] === agentWorkspace.id,
                      );
                      if (room) selectRoom(room);
                      else setAgentWorkspaceId(null);
                    }}
                  >
                    <Icon name="back" />
                  </button>
                  <div>
                    <strong>{agentWorkspace.name}</strong>
                    <small>成员资料</small>
                  </div>
                </div>
              </header>
              <div className="work-content">
                <div className="profile-hero">
                  <AgentMark agent={agentWorkspace} />
                  <div>
                    <h2>{agentWorkspace.name}</h2>
                    <p>{agentWorkspace.headline}</p>
                  </div>
                </div>
                <div className="profile-detail">
                  <p>{agentWorkspace.description}</p>
                  <div className="profile-links">
                    <button
                      className="primary"
                      type="button"
                      onClick={() => {
                        const room = rooms.find(
                          (candidate) =>
                            candidate.kind === 'direct' &&
                            !candidate.parentRoomId &&
                            candidate.memberIds.length === 1 &&
                            candidate.memberIds[0] === agentWorkspace.id,
                        );
                        if (room) selectRoom(room);
                      }}
                    >
                      打开常驻私聊
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => openAgentProfileEditor(agentWorkspace)}
                    >
                      编辑资料
                    </button>
                  </div>
                  <h3>参与过的工作</h3>
                  {projects
                    .filter((project) =>
                      project.members.some(
                        (member) => member.agentId === agentWorkspace.id,
                      ),
                    )
                    .map((project) => (
                      <button
                        type="button"
                        className="history-item"
                        key={project.id}
                        onClick={() => void openProject(project)}
                      >
                        <strong>{project.title}</strong>
                        <small>
                          {project.status === 'archived' ? '已归档' : '进行中'}
                        </small>
                      </button>
                    ))}
                  {!projects.some((project) =>
                    project.members.some(
                      (member) => member.agentId === agentWorkspace.id,
                    ),
                  ) ? (
                    <p>还没有项目经历。</p>
                  ) : null}
                  <h3>自己的能力与工作方式</h3>
                  <p>{agentWorkspace.headline || '尚未填写专业方向'}</p>
                  <div className="asset-row">
                    <span>文件项目工作</span>
                    <button
                      className="quiet"
                      type="button"
                      disabled={updatingAgentId === agentWorkspace.id}
                      onClick={() =>
                        void handleToggleAgentProjectWork(agentWorkspace)
                      }
                    >
                      {agentWorkspace.capabilities.includes('project-work')
                        ? '已启用 · 关闭'
                        : '未启用 · 开启'}
                    </button>
                  </div>
                  <div className="profile-links">
                    <button
                      className="quiet"
                      type="button"
                      disabled={updatingAgentId === agentWorkspace.id}
                      onClick={() =>
                        void handleToggleAgentArchive(agentWorkspace)
                      }
                    >
                      {agentWorkspace.archivedAt ? '恢复联系人' : '归档联系人'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : archivedProjectsOpen ? (
            <>
              <header className="work-head">
                <div className="work-title">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="返回 Noema 主聊"
                    onClick={() => {
                      if (noemaRoom) selectRoom(noemaRoom);
                    }}
                  >
                    <Icon name="back" />
                  </button>
                  <div>
                    <strong>已归档项目</strong>
                    <small>归档保留记录，恢复沿用原项目会话</small>
                  </div>
                </div>
              </header>
              <div className="work-content">
                <h2>可以续接的工作</h2>
                <p className="lead">
                  新的需求属于原项目时，从这里恢复；Noema
                  也可以在对话中替你找到它。
                </p>
                {archivedProjects.map((project) => (
                  <button
                    type="button"
                    className="project-link"
                    key={project.id}
                    onClick={() => void openProject(project)}
                  >
                    <Icon name="archive" />
                    <span className="link-copy">
                      <strong>{project.title}</strong>
                      <small>
                        已归档 ·{' '}
                        {
                          project.members.filter(
                            (member) => member.agentId !== 'noema',
                          ).length
                        }{' '}
                        位成员的项目会话保留
                      </small>
                    </span>
                    <Icon name="arrow" />
                  </button>
                ))}
                {!archivedProjects.length ? (
                  <p className="lead">还没有已归档项目。</p>
                ) : null}
              </div>
            </>
          ) : null}
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

      {createProjectOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeProjectDialog();
          }}
        >
          <form
            ref={dialogRef}
            className="social-dialog project-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-title"
            onSubmit={(event) => void handleCreateProject(event)}
          >
            <div className="dialog-heading">
              <div>
                <h2 id="create-project-title">建立项目空间</h2>
                <p>项目群聊与成员各自的项目会话会分开保存。</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭"
                onClick={closeProjectDialog}
              >
                <Icon name="close" />
              </button>
            </div>
            <label className="dialog-field">
              <span>项目名称</span>
              <input
                autoFocus
                data-dialog-initial-focus
                value={projectTitle}
                maxLength={120}
                placeholder="这次要一起完成什么？"
                onChange={(event) => setProjectTitle(event.target.value)}
                required
              />
            </label>
            <label className="dialog-field">
              <span>目标与背景</span>
              <textarea
                value={projectBrief}
                maxLength={40000}
                rows={4}
                placeholder="说明预期结果、已知背景或需要遵守的边界。"
                onChange={(event) => setProjectBrief(event.target.value)}
                required
              />
            </label>
            <fieldset className="group-agent-picker">
              <legend>初始成员</legend>
              {activeAgents
                .filter((agent) => agent.id !== 'noema')
                .map((agent) => (
                  <label key={agent.id} className="group-agent-option">
                    <input
                      type="checkbox"
                      checked={projectAgentIds.includes(agent.id)}
                      onChange={() =>
                        setProjectAgentIds((selected) =>
                          selected.includes(agent.id)
                            ? selected.filter((id) => id !== agent.id)
                            : [...selected, agent.id],
                        )
                      }
                    />
                    <AgentMark agent={agent} small />
                    <span>
                      <strong>{agent.name}</strong>
                      <small>{agent.headline}</small>
                    </span>
                  </label>
                ))}
              {activeAgents.filter((agent) => agent.id !== 'noema').length ===
              0 ? (
                <p className="project-list-empty">
                  还没有专业联系人。先创建联系人，再为项目组队。
                </p>
              ) : null}
            </fieldset>
            <p className="dialog-footnote">
              Noema 会加入项目群；每位成员的项目上下文与常驻私聊相互独立。
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={closeProjectDialog}
              >
                取消
              </button>
              <button
                className="primary-action"
                type="submit"
                disabled={
                  projectBusy ||
                  !projectTitle.trim() ||
                  !projectBrief.trim() ||
                  projectAgentIds.length === 0
                }
              >
                {projectBusy ? '正在建立…' : '建立项目'}
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
            <div className="settings-administration">
              <button
                type="button"
                ref={agentTriggerRef}
                onClick={() => {
                  setSettingsOpen(false);
                  setCreateAgentOpen(true);
                }}
              >
                创建联系人
              </button>
              <button
                type="button"
                ref={groupTriggerRef}
                onClick={() => {
                  setSettingsOpen(false);
                  setCreateGroupOpen(true);
                }}
              >
                新建群聊
              </button>
              <button
                type="button"
                ref={projectTriggerRef}
                onClick={() => {
                  setSettingsOpen(false);
                  setCreateProjectOpen(true);
                }}
              >
                新建项目
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
                {activeModel &&
                !modelOptions.some((model) => model.name === activeModel) ? (
                  <option value={activeModel} disabled>
                    {activeModel} · 当前目录未列出
                  </option>
                ) : null}
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
  const user = message.role === 'user';
  const failed =
    message.status === 'failed' || message.status === 'interrupted';
  return (
    <article
      className={`message ${user ? 'user user-message' : 'assistant agent-message'} chat-message${forwardSelected ? ' is-forward-selected' : ''}`}
      data-message-id={message.id}
    >
      {!user ? (
        <div className="byline">
          <strong>{agent?.name ?? 'Noema'}</strong>
          <span>{timeLabel(message.createdAt)}</span>
        </div>
      ) : null}
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
        <>
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
        </>
      ) : null}
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
    </article>
  );
}

function GroupMessage({
  message,
  agent,
  onRetry,
}: {
  message: NoemaSocialMessage;
  agent: NoemaSocialAgent | null;
  onRetry: (message: NoemaSocialMessage) => void;
}) {
  if (message.role === 'system')
    return <div className="note-row">{message.content}</div>;
  const user = message.role === 'user';
  return (
    <article className="group-msg" data-message-id={message.id}>
      {agent ? (
        <AgentMark agent={agent} />
      ) : (
        <span className="portrait">你</span>
      )}
      <div className="msg-text">
        <header>
          <strong>{user ? '你' : (agent?.name ?? 'Noema')}</strong>
          <span>{timeLabel(message.createdAt)}</span>
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
          <button className="primary" type="button" onClick={onRepeat}>
            再次编辑并执行
          </button>
        ) : null}
      </div>
      {active || recovery ? (
        <p className="request-explanation">
          停止不会撤销已经产生的文件修改。
          {recovery ? '再次执行会创建新任务，不会续接刚才的会话。' : ''}
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
      {task.resultText ? (
        <div className="work-result">
          <h4>执行结果</h4>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {task.resultText}
          </ReactMarkdown>
        </div>
      ) : null}
      {!active ? <p className="request-explanation">{verification}</p> : null}
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

export { SocialChatApp };
