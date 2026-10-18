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
  NoemaSocialEvent,
  NoemaSocialMessage,
  NoemaSocialRoom,
  NoemaSocialRoomState,
  NoemaSocialState,
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

function formatModel(model: string) {
  return model
    .replace(/^auto:/, '')
    .replace(/^nvidia\//, '')
    .replace(/[-_]/gu, ' ');
}

function formatRoute(model: string) {
  if (model === 'auto:noema-free') return 'Noema 免费模型链（自动路由）';
  if (model === 'free-router') return 'FreeLLMAPI 免费路由（自动选择）';
  return formatModel(model);
}

function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & {
  name: 'plus' | 'search' | 'send' | 'settings' | 'back' | 'close' | 'stop';
}) {
  const paths: Record<typeof name, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
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
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showRoomList, setShowRoomList] = useState(true);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editProviderConfig, setEditProviderConfig] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupAgentIds, setGroupAgentIds] = useState<string[]>([
    'noema',
    'engineering-partner',
  ]);
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const groupTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const shouldFollowRef = useRef(true);
  const loadSequenceRef = useRef(0);

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

  const closeSettingsDialog = useCallback(() => {
    setSettingsOpen(false);
    setEditProviderConfig(false);
    requestAnimationFrame(() => settingsTriggerRef.current?.focus());
  }, []);

  const loadRoom = useCallback(async (roomId: string) => {
    const sequence = ++loadSequenceRef.current;
    try {
      const next = await window.noema.getSocialRoom(roomId);
      if (sequence === loadSequenceRef.current) setRoomState(next);
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
        event.type === 'provider-configured'
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
    if (!createGroupOpen && !settingsOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    returnFocusRef.current = previousFocus;
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
      requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [createGroupOpen, settingsOpen, closeGroupDialog, closeSettingsDialog]);

  useLayoutEffect(() => {
    if (!shouldFollowRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (conversationRef.current) {
        conversationRef.current.scrollTop =
          conversationRef.current.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [roomState?.messages]);

  const agents = state?.agents ?? [];
  const rooms = state?.rooms ?? [];
  const currentRoom = rooms.find((room) => room.id === activeRoomId) ?? null;
  const members = roomState?.room.id === activeRoomId ? roomState.members : [];
  const messages =
    roomState?.room.id === activeRoomId ? roomState.messages : [];
  const activeReply = messages.find(
    (message) => message.role === 'assistant' && message.status === 'streaming',
  );
  const messageAgent = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const currentRecipient =
    members.find((agent) => agent.id === selectedAgentId) ?? members[0] ?? null;
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

  const selectRoom = (room: NoemaSocialRoom) => {
    shouldFollowRef.current = true;
    setActiveRoomId(room.id);
    setSelectedAgentId(room.memberIds[0] ?? 'noema');
    setShowRoomList(false);
    setNotice('');
  };

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!currentRoom || !currentRecipient || !draft.trim() || busy) return;
    const text = draft;
    setBusy(true);
    setNotice('');
    shouldFollowRef.current = true;
    try {
      await window.noema.sendSocialMessage({
        roomId: currentRoom.id,
        agentId: currentRecipient.id,
        text,
      });
      setDraft('');
      if (draftRef.current) draftRef.current.style.height = 'auto';
      await Promise.all([refreshState(), loadRoom(currentRoom.id)]);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '消息没有发送，请重试。',
      );
    } finally {
      setBusy(false);
      draftRef.current?.focus();
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void handleSend();
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
    setBusy(true);
    setNotice('');
    try {
      const group = await window.noema.createSocialGroup({
        title: groupTitle.trim(),
        agentIds: groupAgentIds,
      });
      setCreateGroupOpen(false);
      setGroupTitle('');
      setActiveRoomId(group.room.id);
      setShowRoomList(false);
      await refreshState();
      await loadRoom(group.room.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '群聊没有创建成功。');
    } finally {
      setBusy(false);
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
    currentRoom?.kind === 'direct'
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
  const modelConnectionLabel = state?.checking
    ? '正在连接模型'
    : !state?.connected || modelOptions.length === 0
      ? '模型未连接'
      : activeRouteUnavailable
        ? activeRoute?.executionStatus === 'needsKey'
          ? '所选模型需要密钥'
          : '所选模型暂不可用'
        : activeRoute?.executionStatus === 'ready'
          ? '对话已就绪'
          : '模型链状态未知';
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

  return (
    <main className="social-shell">
      <header className="social-topbar">
        <a className="social-brand" href="#chat" aria-label="Noema 首页">
          <span className="brand-symbol" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Noema</span>
        </a>
        <div className="topbar-divider" aria-hidden="true" />
        <span className={`model-connection ${providerReady ? 'is-ready' : ''}`}>
          <span className="connection-dot" />
          {modelConnectionLabel}
        </span>
        <div className="topbar-spacer" />
        {providerReady ? (
          <label className="model-select-wrap">
            <span>使用</span>
            <select
              aria-label="选择对话模型"
              value={activeModel}
              disabled={switchingModel}
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
        ) : null}
        <button
          className="icon-button settings-button"
          ref={settingsTriggerRef}
          type="button"
          aria-label="连接与模型设置"
          title="连接与模型设置"
          onClick={() => setSettingsOpen(true)}
        >
          <Icon name="settings" />
        </button>
      </header>

      <div className={`social-body ${showRoomList ? '' : 'room-open'}`}>
        <aside className="conversation-sidebar" aria-label="聊天列表">
          <div className="sidebar-heading">
            <div>
              <h1>聊天</h1>
              <p>和你的 agent 接着聊</p>
            </div>
            <button
              className="icon-button new-group-button"
              ref={groupTriggerRef}
              type="button"
              aria-label="新建群聊"
              title="新建群聊"
              onClick={() => setCreateGroupOpen(true)}
            >
              <Icon name="plus" />
            </button>
          </div>

          <label className="chat-search">
            <Icon name="search" />
            <input
              type="search"
              ref={searchRef}
              placeholder="搜索联系人或聊天"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="搜索联系人或聊天"
            />
            <kbd>Ctrl K</kbd>
          </label>

          <div className="conversation-list-heading">
            <span>最近聊天</span>
            <span>{filteredRooms.length}</span>
          </div>

          <nav className="conversation-list" aria-label="最近聊天">
            {filteredRooms.map((room) => {
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
                  className={`room-list-item ${selected ? 'is-selected' : ''}`}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => selectRoom(room)}
                >
                  <span className="room-avatar-stack">
                    {room.kind === 'group' ? (
                      <span className="group-avatar" aria-hidden="true">
                        {room.memberIds.slice(0, 2).map((agentId) => {
                          const agent = messageAgent.get(agentId);
                          return agent ? (
                            <AgentMark key={agent.id} agent={agent} small />
                          ) : null;
                        })}
                      </span>
                    ) : firstAgent ? (
                      <AgentMark agent={firstAgent} />
                    ) : null}
                    {room.kind === 'group' ? (
                      <span className="room-kind-mark" aria-label="群聊">
                        组
                      </span>
                    ) : null}
                  </span>
                  <span className="room-list-copy">
                    <span className="room-list-title-line">
                      <span className="room-list-title">{room.title}</span>
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
            })}
            {filteredRooms.length === 0 ? (
              <p className="no-search-results">没有找到匹配的聊天。</p>
            ) : null}
          </nav>

          <div className="sidebar-bottom">
            <div className="sidebar-self-mark" aria-hidden="true">
              你
            </div>
            <div className="sidebar-self-copy">
              <strong>个人空间</strong>
              <span>消息保存在这台设备</span>
            </div>
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
                {currentRoom.kind === 'direct' && avatarAgent ? (
                  <AgentMark agent={avatarAgent} />
                ) : (
                  <span className="group-header-mark" aria-hidden="true">
                    <AgentMark
                      agent={
                        members[0] ??
                        agents[0] ?? {
                          id: 'noema',
                          name: 'Noema',
                          kind: 'core',
                        }
                      }
                      small
                    />
                    <AgentMark
                      agent={
                        members[1] ??
                        agents[1] ?? {
                          id: 'engineering-partner',
                          name: '工程搭档',
                          kind: 'specialist',
                        }
                      }
                      small
                    />
                  </span>
                )}
                <div className="room-header-copy">
                  <h2>{currentRoom.title}</h2>
                  {currentRoom.kind === 'group' ? (
                    <p>
                      {members.map((member) => member.name).join(' · ')} 与你
                    </p>
                  ) : (
                    <p>{members[0]?.headline ?? '持续对话'}</p>
                  )}
                </div>
                <div className="room-header-meta">
                  {currentRoom.kind === 'group' ? (
                    <span className="member-count">
                      {members.length + 1} 位参与者
                    </span>
                  ) : (
                    <span className="room-presence">
                      <i /> 持续联系人
                    </span>
                  )}
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
                {!messages.some((message) => message.role !== 'system') ? (
                  <div className="room-empty-state">
                    {avatarAgent ? <AgentMark agent={avatarAgent} /> : null}
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
                    <div className="room-start-marker">
                      <span />
                      <span>聊天记录</span>
                      <span />
                    </div>
                    {messages.map((message) => (
                      <ChatMessage
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

              {!providerReady ? (
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
                  <span>本条由</span>
                  {members.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      className={
                        member.id === currentRecipient?.id ? 'is-chosen' : ''
                      }
                      aria-pressed={member.id === currentRecipient?.id}
                      onClick={() => setSelectedAgentId(member.id)}
                    >
                      <AgentMark agent={member} small />
                      {member.name}
                    </button>
                  ))}
                  <span>回应</span>
                </div>
              ) : null}

              <form
                className="message-composer"
                onSubmit={(event) => void handleSend(event)}
              >
                <label
                  className="visually-hidden"
                  htmlFor="social-message-input"
                >
                  给{currentRecipient?.name ?? '联系人'}发送消息
                </label>
                <textarea
                  id="social-message-input"
                  ref={draftRef}
                  value={draft}
                  placeholder="写下你正在想的事…"
                  rows={1}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    event.currentTarget.style.height = 'auto';
                    event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 180)}px`;
                  }}
                  onKeyDown={handleComposerKeyDown}
                  disabled={
                    !providerReady || !currentRecipient || Boolean(activeReply)
                  }
                />
                <div className="composer-footer">
                  <span>Enter 发送 · Shift + Enter 换行</span>
                  {activeReply ? (
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
                        !providerReady ||
                        !draft.trim() ||
                        !currentRecipient ||
                        busy
                      }
                    >
                      发送
                      <Icon name="send" />
                    </button>
                  )}
                </div>
              </form>
              <p className="data-flow-note">
                聊天记录保存在本机；发送后，消息会经 FreeLLMAPI
                发给当前选择的模型。
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
              {agents.map((agent) => (
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
                  !groupTitle.trim() || groupAgentIds.length === 0 || busy
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
  agent,
  onRetry,
}: {
  message: NoemaSocialMessage;
  agent: NoemaSocialAgent | null;
  onRetry: (message: NoemaSocialMessage) => void;
}) {
  if (message.role === 'system') {
    return (
      <div className="system-message">
        <span className="system-message-rule" />
        <p>{message.content}</p>
        <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <article className="chat-message user-message">
        <div className="message-body">
          <div className="message-bubble">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          </div>
          <div className="message-meta">
            <time dateTime={message.createdAt}>
              {timeLabel(message.createdAt)}
            </time>
          </div>
        </div>
        <span className="user-message-mark" aria-hidden="true">
          你
        </span>
      </article>
    );
  }

  const running = message.status === 'streaming';
  const failed =
    message.status === 'failed' || message.status === 'interrupted';
  return (
    <article
      className={`chat-message agent-message ${running ? 'is-running' : ''}`}
    >
      {agent ? (
        <AgentMark agent={agent} />
      ) : (
        <span className="agent-mark agent-mark-core">N</span>
      )}
      <div className="message-body">
        <div className="message-name-line">
          <strong>{agent?.name ?? 'Noema'}</strong>
          <time dateTime={message.createdAt}>
            {timeLabel(message.createdAt)}
          </time>
        </div>
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
            <button type="button" onClick={() => onRetry(message)}>
              重试
            </button>
          </div>
        ) : null}
        {message.model && !running ? (
          <div className="reply-provenance">
            请求路由 · {formatRoute(message.model)}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export { SocialChatApp };
