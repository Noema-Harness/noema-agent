import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createRoot } from 'react-dom/client';
import { findTranscriptMatches } from './transcript-search.mjs';
import { linkWebSourceCitations } from './web-source-citations.mjs';
import { QuickCaptureDialog } from './quick-capture-dialog';
import { SocialChatApp } from './social-chat-app';
import type {
  NoemaBackgroundTask,
  NoemaCapture,
  NoemaCodexPreview,
  NoemaCodexThread,
  NoemaContextImport,
  NoemaInteractionAdjustment,
  NoemaQuickCaptureRequest,
  NoemaQuickCaptureShortcutStatus,
  NoemaRootMessage,
  NoemaRootState,
} from './noema-bridge.d.ts';

type ConversationTurn = {
  id: string;
  messages: NoemaRootMessage[];
  latestAttempt: number;
};

type TimelineEntry =
  | { kind: 'turn'; key: string; time: string; turn: ConversationTurn }
  | { kind: 'task'; key: string; time: string; task: NoemaBackgroundTask }
  | { kind: 'context'; key: string; time: string; context: NoemaContextImport }
  | { kind: 'capture'; key: string; time: string; capture: NoemaCapture }
  | {
      kind: 'adjustment';
      key: string;
      time: string;
      adjustment: NoemaInteractionAdjustment;
    };

type InteractionAdjustmentDraft = Pick<
  NoemaInteractionAdjustment,
  'id' | 'scope' | 'situation' | 'behavior'
>;

const markdownComponents: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    src ? (
      <a
        className="image-reference"
        href={src}
        target="_blank"
        rel="noreferrer noopener"
      >
        查看图片{alt ? `：${alt}` : '链接'}
      </a>
    ) : null,
  pre: ({ children }) => <pre className="code-block">{children}</pre>,
};

function groupTurns(messages: NoemaRootMessage[]): ConversationTurn[] {
  const groups = new Map<string, ConversationTurn>();
  for (const message of messages) {
    let group = groups.get(message.turnId);
    if (!group) {
      group = { id: message.turnId, messages: [], latestAttempt: 1 };
      groups.set(message.turnId, group);
    }
    group.messages.push(message);
    group.latestAttempt = Math.max(group.latestAttempt, message.attempt);
  }
  return [...groups.values()];
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatCodexTime(value: string | number | null) {
  if (value === null) return '时间未知';
  const milliseconds = typeof value === 'number' ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf())
    ? '时间未知'
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
}

function taskStatusLabel(task: NoemaBackgroundTask) {
  if (task.status === 'starting') return '正在启动';
  if (task.status === 'running') return '后台执行中';
  if (task.status === 'completed') {
    if (task.verificationStatus === 'verified') return 'Noema 核验通过';
    if (task.verificationStatus === 'unavailable') return '无法独立核验';
    return 'Agent 已结束';
  }
  if (task.verificationStatus === 'verified') {
    return task.status === 'interrupted'
      ? '已停止 · 文件条件通过'
      : 'DSH 异常 · 文件条件通过';
  }
  if (task.errorCode === 'verification_failed') {
    return '执行未完成 · 验收未通过';
  }
  if (task.status === 'interrupted') return '已停止';
  return '执行未完成';
}

function taskPhaseLabel(phase: string) {
  const labels: Record<string, string> = {
    starting: '正在启动 DSH',
    running: '正在处理任务',
    verifying: 'Noema 正在核验文件',
    verification_repairing: 'Noema 正在修复未通过项',
    retry_waiting_rate_limit: '免费模型冷却中，Noema 将自动续做',
    retrying_partial_task: 'DSH 未正常结束，Noema 正在续接任务',
    turn_start: '开始处理',
    step_start: '正在检查项目文件',
    tool_call: '正在操作项目文件',
    tool_result: '已收到文件操作结果',
    completed: '等待 Noema 接回结果',
    failed: '需要检查这次执行',
    interrupted: '进程已停止',
  };
  return labels[phase] ?? '后台处理中';
}

function verificationStatusLabel(task: NoemaBackgroundTask) {
  if (task.verificationStatus === 'verified') {
    return task.status === 'completed'
      ? 'Noema 本地核验通过'
      : 'DSH 未完整结束；列出的文件条件目前通过';
  }
  if (task.verificationStatus === 'failed') {
    return task.status === 'completed'
      ? 'Noema 核验未通过；任务未验收'
      : 'DSH 未完整结束；Noema 文件核验未通过';
  }
  if (task.verificationStatus === 'unavailable')
    return 'Noema 无法安全完成核验；不按已验收处理';
  if (task.verificationStatus === 'pending') return '等待 Noema 独立核验';
  return '未设置独立核验；下方为 DSH Agent 自述';
}

function verificationReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    file_exists: '文件存在',
    text_matches: '目标文本匹配',
    file_missing: '文件不存在',
    text_mismatch: '目标文本不匹配',
    not_a_file: '路径不是普通文件',
    parent_not_directory: '父路径不是目录',
    path_outside_workspace: '路径超出所选项目文件夹',
    symlink_not_checked: '包含符号链接，未检查',
    file_too_large: '文件超过核验大小上限',
    file_unreadable: '文件无法读取',
    workspace_unavailable: '所选项目文件夹不可用',
    path_unreadable: '路径无法读取',
  };
  return labels[reason] ?? reason;
}

function toolActionLabel(
  category: NoemaBackgroundTask['toolActionCategories'][number],
) {
  const labels: Record<
    NoemaBackgroundTask['toolActionCategories'][number],
    string
  > = {
    read: '读取文件',
    write: '写入文件',
    edit: '修改文件',
    search: '搜索内容',
    list: '查找文件',
    other: '其他工具操作',
  };
  return labels[category];
}

function shortSessionId(sessionId: string | null) {
  return sessionId ? sessionId.replace(/^session-/, '').slice(0, 8) : '';
}

function App() {
  if (typeof window.noema?.getSocialState !== 'function') {
    return (
      <main className="desktop-runtime-needed">
        <section
          className="desktop-runtime-card"
          aria-labelledby="desktop-runtime-title"
        >
          <p className="desktop-runtime-brand">noema</p>
          <h1 id="desktop-runtime-title">请在 Noema 桌面客户端中继续</h1>
          <p>
            当前浏览器页面没有连接本机对话服务，因此不会读取或保存对话，也不能发送消息。
          </p>
          <p>请启动 Noema 桌面客户端，再从那里继续使用。</p>
        </section>
      </main>
    );
  }
  return window.location.hash === '#legacy' ? (
    <DesktopApp />
  ) : (
    <SocialChatApp />
  );
}

function DesktopApp() {
  const [root, setRoot] = useState<NoemaRootState | null>(null);
  const [draft, setDraft] = useState('');
  const [captureEdit, setCaptureEdit] = useState<{
    id: string;
    content: string;
  } | null>(null);
  const [captureBusy, setCaptureBusy] = useState<string | null>(null);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [quickCaptureText, setQuickCaptureText] = useState('');
  const [quickCaptureError, setQuickCaptureError] = useState('');
  const [quickCaptureSaving, setQuickCaptureSaving] = useState(false);
  const [quickCaptureSaved, setQuickCaptureSaved] = useState(false);
  const [quickCaptureShortcutStatus, setQuickCaptureShortcutStatus] =
    useState<NoemaQuickCaptureShortcutStatus | null>(null);
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const [retryingTurn, setRetryingTurn] = useState<string | null>(null);
  const [retryingWorkerEvent, setRetryingWorkerEvent] = useState<string | null>(
    null,
  );
  const [codexImportOpen, setCodexImportOpen] = useState(false);
  const [codexThreads, setCodexThreads] = useState<NoemaCodexThread[]>([]);
  const [codexPreview, setCodexPreview] = useState<NoemaCodexPreview | null>(
    null,
  );
  const [codexNextCursor, setCodexNextCursor] = useState<string | null>(null);
  const [loadingCodex, setLoadingCodex] = useState(false);
  const [importingCodex, setImportingCodex] = useState(false);
  const [codexError, setCodexError] = useState('');
  const [editingAdjustmentId, setEditingAdjustmentId] = useState<string | null>(
    null,
  );
  const [adjustmentDraft, setAdjustmentDraft] =
    useState<InteractionAdjustmentDraft | null>(null);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [adjustmentEditError, setAdjustmentEditError] = useState('');
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationSearchQuery, setConversationSearchQuery] = useState('');
  const [conversationSearchIndex, setConversationSearchIndex] = useState(0);
  const conversationRef = useRef<HTMLDivElement>(null);
  const followConversationRef = useRef(true);
  const conversationSearchInputRef = useRef<HTMLInputElement>(null);
  const conversationSearchTriggerRef = useRef<HTMLButtonElement>(null);
  const conversationSearchWasOpenRef = useRef(false);
  const adjustmentEditSituationRef = useRef<HTMLInputElement>(null);
  const adjustmentEditPanelRef = useRef<HTMLElement>(null);
  const adjustmentEditButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const previousEditingAdjustmentIdRef = useRef<string | null>(null);
  const codexImportTriggerRef = useRef<HTMLButtonElement>(null);
  const codexImportCloseRef = useRef<HTMLButtonElement>(null);
  const quickCaptureOpenRef = useRef(false);
  const quickCaptureReturnToPreviousRef = useRef(false);
  const quickCaptureSaveInFlightRef = useRef(false);
  const quickCaptureFinishTimerRef = useRef<number | null>(null);

  const refreshRoot = useCallback(async () => {
    try {
      setRoot(await window.noema.getRootState());
    } catch {
      setNotice('无法读取这台设备上的对话数据。请关闭并重新打开 Noema。');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = window.noema.onRootEvent((event) => {
      if (event.type === 'turn-delta') {
        setRoot((current) => {
          if (!current) return current;
          return {
            ...current,
            messages: current.messages.map((message) =>
              message.turnId === event.turnId &&
              message.role === 'assistant' &&
              message.attempt === event.attempt
                ? {
                    ...message,
                    content: message.content + event.delta,
                    status: 'streaming',
                  }
                : message,
            ),
            activeTurnId: event.turnId,
          };
        });
        return;
      }
      if (event.type === 'turn-started') {
        setRoot((current) =>
          current ? { ...current, activeTurnId: event.turnId } : current,
        );
      }
      void refreshRoot();
    });
    void refreshRoot();
    return unsubscribe;
  }, [refreshRoot]);

  useEffect(() => {
    const unsubscribeQuickCapture = window.noema.onQuickCaptureRequested(
      (request: NoemaQuickCaptureRequest) => {
        quickCaptureReturnToPreviousRef.current = request.returnToPrevious;
        if (!quickCaptureOpenRef.current) {
          setQuickCaptureText('');
          setQuickCaptureError('');
          setQuickCaptureSaved(false);
          quickCaptureSaveInFlightRef.current = false;
        }
        quickCaptureOpenRef.current = true;
        setQuickCaptureOpen(true);
      },
    );
    void window.noema
      .getQuickCaptureShortcutStatus()
      .then((status) => setQuickCaptureShortcutStatus(status))
      .catch(() => {
        setNotice('无法读取快捷速记状态；仍可使用输入框里的“只记下来”。');
      });
    void window.noema.markQuickCaptureReady().catch(() => {
      setNotice('快捷速记没有就绪；仍可使用输入框里的“只记下来”。');
    });
    return () => {
      unsubscribeQuickCapture();
    };
  }, []);

  const turns = useMemo(
    () => groupTurns(root?.messages ?? []),
    [root?.messages],
  );
  const workerTasks = root?.workerTasks ?? [];
  const activeWorkerTasks = workerTasks.filter((task) =>
    ['starting', 'running'].includes(task.status),
  );
  const contextImports = root?.contextImports ?? [];
  const interactionAdjustments = root?.interactionAdjustments ?? [];
  const conversationSearchMatches = useMemo(
    () =>
      findTranscriptMatches(
        root?.messages ?? [],
        conversationSearchQuery,
        root?.captures ?? [],
      ),
    [root?.messages, root?.captures, conversationSearchQuery],
  );
  const activeConversationSearchIndex = conversationSearchMatches.length
    ? ((conversationSearchIndex % conversationSearchMatches.length) +
        conversationSearchMatches.length) %
      conversationSearchMatches.length
    : 0;
  const activeConversationSearchMatch =
    conversationSearchMatches[activeConversationSearchIndex] ?? null;
  const timeline = useMemo<TimelineEntry[]>(() => {
    const turnEntries: TimelineEntry[] = turns.flatMap((turn) => {
      const userMessage = turn.messages.find(
        (message) => message.role === 'user',
      );
      return userMessage
        ? [
            {
              kind: 'turn',
              key: `turn:${turn.id}`,
              time: userMessage.createdAt,
              turn,
            },
          ]
        : [];
    });
    const taskEntries: TimelineEntry[] = workerTasks
      .filter((task) => !['starting', 'running'].includes(task.status))
      .map((task) => ({
        kind: 'task',
        key: `task:${task.id}`,
        time: task.eventCreatedAt ?? task.createdAt,
        task,
      }));
    const contextEntries: TimelineEntry[] = (root?.contextImports ?? []).map(
      (context) => ({
        kind: 'context',
        key: `context:${context.id}`,
        time: context.capturedAt,
        context,
      }),
    );
    const captureEntries: TimelineEntry[] = (root?.captures ?? []).map(
      (capture) => ({
        kind: 'capture',
        key: `capture:${capture.id}`,
        time: capture.createdAt,
        capture,
      }),
    );
    const adjustmentEntries: TimelineEntry[] = (
      root?.interactionAdjustments ?? []
    ).map((adjustment) => ({
      kind: 'adjustment',
      key: `adjustment:${adjustment.id}`,
      time: adjustment.createdAt,
      adjustment,
    }));
    return [
      ...turnEntries,
      ...taskEntries,
      ...contextEntries,
      ...captureEntries,
      ...adjustmentEntries,
    ].sort((left, right) => left.time.localeCompare(right.time));
  }, [
    turns,
    workerTasks,
    root?.contextImports,
    root?.captures,
    interactionAdjustments,
  ]);
  const busy = Boolean(root?.activeTurnId);
  const quickCaptureShortcutLabel =
    quickCaptureShortcutStatus?.accelerator
      .replace('Control', 'Ctrl')
      .replace('Command', '⌘') ?? null;

  useLayoutEffect(() => {
    const node = conversationRef.current;
    if (node && followConversationRef.current)
      node.scrollTop = node.scrollHeight;
  }, [
    root?.messages,
    root?.contextImports,
    root?.captures,
    interactionAdjustments,
  ]);

  useEffect(() => {
    const node = conversationRef.current;
    if (!node) return;
    const preserveLatestTurn = () => {
      if (followConversationRef.current) node.scrollTop = node.scrollHeight;
    };
    window.addEventListener('resize', preserveLatestTurn);
    return () => window.removeEventListener('resize', preserveLatestTurn);
  }, []);

  useEffect(() => {
    if (codexImportOpen) codexImportCloseRef.current?.focus();
  }, [codexImportOpen]);

  useEffect(() => {
    if (editingAdjustmentId) {
      adjustmentEditSituationRef.current?.focus();
      adjustmentEditPanelRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
        block: 'nearest',
      });
    } else if (previousEditingAdjustmentIdRef.current) {
      adjustmentEditButtonsRef.current
        .get(previousEditingAdjustmentIdRef.current)
        ?.focus();
    }
    previousEditingAdjustmentIdRef.current = editingAdjustmentId;
  }, [editingAdjustmentId]);

  useEffect(() => {
    if (conversationSearchOpen) {
      conversationSearchInputRef.current?.focus();
    } else if (conversationSearchWasOpenRef.current) {
      conversationSearchTriggerRef.current?.focus();
    }
    conversationSearchWasOpenRef.current = conversationSearchOpen;
  }, [conversationSearchOpen]);

  useEffect(() => {
    if (!conversationSearchOpen || !activeConversationSearchMatch) return;
    const revealMatch = (behavior: ScrollBehavior) => {
      const target = document.getElementById(
        `transcript-${activeConversationSearchMatch.source}-${activeConversationSearchMatch.id}`,
      );
      const visibleMatch =
        activeConversationSearchMatch.source === 'capture'
          ? target?.querySelector('.capture-content')
          : target;
      visibleMatch?.scrollIntoView({ behavior, block: 'nearest' });
    };
    revealMatch(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    );
    const keepMatchVisibleAfterResize = () => revealMatch('auto');
    window.addEventListener('resize', keepMatchVisibleAfterResize);
    return () =>
      window.removeEventListener('resize', keepMatchVisibleAfterResize);
  }, [
    conversationSearchOpen,
    activeConversationSearchMatch?.id,
    activeConversationSearchMatch?.source,
  ]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f' &&
        !modelSettingsOpen &&
        !codexImportOpen &&
        ((root?.messages.length ?? 0) > 0 || (root?.captures.length ?? 0) > 0)
      ) {
        event.preventDefault();
        setConversationSearchOpen(true);
        return;
      }
      if (event.key === 'Escape' && conversationSearchOpen) {
        event.preventDefault();
        setConversationSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, [
    conversationSearchOpen,
    codexImportOpen,
    modelSettingsOpen,
    root?.messages.length,
    root?.captures.length,
  ]);

  const moveConversationSearch = (direction: number) => {
    if (conversationSearchMatches.length === 0) return;
    setConversationSearchIndex(
      (current) =>
        (current + direction + conversationSearchMatches.length) %
        conversationSearchMatches.length,
    );
  };

  const refreshModels = async () => {
    setRefreshing(true);
    setNotice('');
    try {
      await window.noema.refreshModels();
      await refreshRoot();
    } catch {
      setNotice('刷新失败。请检查模型服务地址与网络连接。');
    } finally {
      setRefreshing(false);
    }
  };

  const selectModel = async (model: string) => {
    if (!model) return;
    setNotice('');
    try {
      await window.noema.selectModel(model);
      await refreshRoot();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法选择这个模型。');
      await refreshRoot();
    }
  };

  const openModelSettings = () => {
    setProviderBaseUrl(root?.providerBaseUrl ?? 'https://api.deepseek.com/v1');
    setProviderApiKey('');
    setModelSettingsOpen(true);
  };

  const closeModelSettings = () => {
    setProviderApiKey('');
    setModelSettingsOpen(false);
  };

  const saveProviderSettings = async () => {
    if (!providerApiKey.trim() || savingProvider) return;
    setSavingProvider(true);
    setNotice('');
    try {
      await window.noema.configureProvider({
        baseUrl: providerBaseUrl,
        apiKey: providerApiKey,
      });
      await refreshRoot();
      closeModelSettings();
      setNotice('模型服务设置已加密保存。');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '模型服务设置没有保存。',
      );
    } finally {
      setProviderApiKey('');
      setSavingProvider(false);
    }
  };

  const openCodexImport = async () => {
    setCodexImportOpen(true);
    setCodexPreview(null);
    setCodexError('');
    setLoadingCodex(true);
    try {
      const page = await window.noema.listCodexThreads();
      setCodexThreads(page.threads);
      setCodexNextCursor(page.nextCursor);
    } catch (error) {
      setCodexError(
        error instanceof Error ? error.message : '无法读取 Codex 会话列表。',
      );
    } finally {
      setLoadingCodex(false);
    }
  };

  const loadMoreCodexThreads = async () => {
    if (!codexNextCursor || loadingCodex) return;
    setCodexError('');
    setLoadingCodex(true);
    try {
      const page = await window.noema.listCodexThreads(codexNextCursor);
      setCodexThreads((current) => {
        const known = new Set(current.map((thread) => thread.id));
        return [
          ...current,
          ...page.threads.filter((thread) => !known.has(thread.id)),
        ];
      });
      setCodexNextCursor(page.nextCursor);
    } catch (error) {
      setCodexError(
        error instanceof Error ? error.message : '无法读取更早的 Codex 会话。',
      );
    } finally {
      setLoadingCodex(false);
    }
  };

  const closeCodexImport = () => {
    setCodexImportOpen(false);
    requestAnimationFrame(() => codexImportTriggerRef.current?.focus());
  };

  const previewCodexThread = async (threadId: string) => {
    setCodexPreview(null);
    setCodexError('');
    setLoadingCodex(true);
    try {
      setCodexPreview(await window.noema.previewCodexThread(threadId));
    } catch (error) {
      setCodexError(
        error instanceof Error ? error.message : '无法预览所选 Codex 会话。',
      );
    } finally {
      setLoadingCodex(false);
    }
  };

  const importCodexThread = async () => {
    if (!codexPreview || importingCodex || contextImports.length > 0) return;
    setImportingCodex(true);
    setCodexError('');
    try {
      await window.noema.importCodexThread({
        threadId: codexPreview.threadId,
        expectedSourceUpdatedAt: codexPreview.sourceUpdatedAt,
      });
      setCodexImportOpen(false);
      setCodexPreview(null);
      await refreshRoot();
      setNotice('已把 Codex 的可见消息带入 Noema；原会话不会改变。');
    } catch (error) {
      setCodexError(
        error instanceof Error ? error.message : 'Codex 对话文字没有导入。',
      );
      await refreshRoot();
    } finally {
      setImportingCodex(false);
    }
  };

  const removeContextImport = async () => {
    try {
      if (await window.noema.removeContextImport()) {
        await refreshRoot();
        setNotice('已从 Noema 移除这段 Codex 对话文字；原会话未改变。');
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '无法移除已带入的文字。',
      );
    }
  };

  const withdrawInteractionAdjustment = async (id: string) => {
    try {
      if (await window.noema.withdrawInteractionAdjustment(id)) {
        await refreshRoot();
        setNotice('已撤回这条互动调整；之后的请求不再带入。');
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '无法撤回这条互动调整。',
      );
    }
  };

  const beginEditingInteractionAdjustment = (
    adjustment: NoemaInteractionAdjustment,
  ) => {
    setAdjustmentDraft({
      id: adjustment.id,
      scope: adjustment.scope,
      situation: adjustment.situation,
      behavior: adjustment.behavior,
    });
    setAdjustmentEditError('');
    setEditingAdjustmentId(adjustment.id);
  };

  const cancelEditingInteractionAdjustment = () => {
    if (savingAdjustment) return;
    setAdjustmentEditError('');
    setAdjustmentDraft(null);
    setEditingAdjustmentId(null);
  };

  const saveInteractionAdjustment = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!adjustmentDraft || savingAdjustment) return;
    setSavingAdjustment(true);
    setAdjustmentEditError('');
    try {
      const saved =
        await window.noema.updateInteractionAdjustment(adjustmentDraft);
      if (!saved) {
        setAdjustmentEditError(
          '这条调整已撤回或发生变化；刷新后确认当前状态。',
        );
        await refreshRoot();
        return;
      }
      await refreshRoot();
      setAdjustmentDraft(null);
      setEditingAdjustmentId(null);
      setNotice('已修订；后续新请求会使用当前版本，旧对话和运行中的任务不变。');
    } catch (error) {
      setAdjustmentEditError(
        error instanceof Error ? error.message : '修订没有保存，请重试。',
      );
    } finally {
      setSavingAdjustment(false);
    }
  };

  const sendMessage = async () => {
    const text = draft;
    if (!text.trim() || busy || sending) return;
    if (selectedModelUnavailable) {
      setNotice('当前选择的直连模型不可用；刷新状态或切换路由后再发送。');
      return;
    }
    followConversationRef.current = true;
    setSending(true);
    setNotice('');
    try {
      const result = await window.noema.sendMessage(text);
      if (result.canceled) {
        setNotice('本次发送已取消；导入内容没有发送给模型。');
        return;
      }
      setDraft('');
      await refreshRoot();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '消息没有发送。请重试。',
      );
      await refreshRoot();
    } finally {
      setSending(false);
    }
  };

  const saveCapture = async () => {
    const text = draft;
    if (!text.trim() || captureBusy) return;
    setCaptureBusy('new');
    setNotice('');
    try {
      await window.noema.saveCapture(text);
      setDraft((current) => (current === text ? '' : current));
      await refreshRoot();
      setNotice('已只保存在这台设备，没有发送给模型。');
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : '速记没有保存；原文仍在输入框中。',
      );
    } finally {
      setCaptureBusy(null);
    }
  };

  const dismissQuickCapture = async () => {
    if (quickCaptureSaveInFlightRef.current) return;
    if (quickCaptureFinishTimerRef.current !== null) {
      window.clearTimeout(quickCaptureFinishTimerRef.current);
      quickCaptureFinishTimerRef.current = null;
    }
    quickCaptureOpenRef.current = false;
    quickCaptureReturnToPreviousRef.current = false;
    setQuickCaptureOpen(false);
    setQuickCaptureText('');
    setQuickCaptureError('');
    setQuickCaptureSaved(false);
    try {
      await window.noema.finishQuickCapture();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : '速记窗口没有正常关闭；可以再次按 Esc。',
      );
    }
  };

  const saveQuickCapture = async () => {
    const text = quickCaptureText;
    if (
      !text.trim() ||
      quickCaptureSaving ||
      quickCaptureSaved ||
      quickCaptureSaveInFlightRef.current
    ) {
      return;
    }
    quickCaptureSaveInFlightRef.current = true;
    setQuickCaptureSaving(true);
    setQuickCaptureError('');
    try {
      await window.noema.saveCapture(text);
      await refreshRoot();
      quickCaptureSaveInFlightRef.current = false;
      setQuickCaptureSaving(false);
      if (quickCaptureReturnToPreviousRef.current) {
        setQuickCaptureSaved(true);
        quickCaptureFinishTimerRef.current = window.setTimeout(() => {
          quickCaptureFinishTimerRef.current = null;
          void dismissQuickCapture();
        }, 520);
      } else {
        await dismissQuickCapture();
        setNotice('速记已保存在 Noema 本机，没有发送给模型。');
      }
    } catch (error) {
      quickCaptureSaveInFlightRef.current = false;
      setQuickCaptureError(
        error instanceof Error
          ? error.message
          : '速记没有保存；原文仍在输入框中。',
      );
      setQuickCaptureSaving(false);
    }
  };

  const saveCaptureEdit = async () => {
    if (!captureEdit) return;
    setCaptureBusy(captureEdit.id);
    try {
      await window.noema.updateCapture(captureEdit.id, captureEdit.content);
      setCaptureEdit(null);
      await refreshRoot();
      setNotice('速记已在本机更新，未发送给模型。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '速记没有更新。');
    } finally {
      setCaptureBusy(null);
    }
  };

  const discussCapture = async (capture: NoemaCapture) => {
    if (busy || captureBusy) return;
    setCaptureBusy(capture.id);
    followConversationRef.current = true;
    try {
      const result = await window.noema.discussCapture(capture.id);
      await refreshRoot();
      setNotice('已把这条速记作为新消息发送给当前模型；原速记仍保留在本机。');
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '暂时无法开始讨论。');
    } finally {
      setCaptureBusy(null);
    }
    return undefined;
  };

  const deleteCapture = async (capture: NoemaCapture) => {
    const confirmed = window.confirm(
      capture.discussionTurnId
        ? '删除本机速记？已写入 Noema 对话的原文不会被删除；如果请求已经发出，也无法撤回。'
        : '删除这条本机速记？此操作无法撤销。',
    );
    if (!confirmed) return;
    setCaptureBusy(capture.id);
    try {
      await window.noema.deleteCapture(capture.id);
      await refreshRoot();
      setNotice('已删除本机速记。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '速记没有删除。');
    } finally {
      setCaptureBusy(null);
    }
  };

  const jumpToTurn = (turnId: string) => {
    const turn = turns.find((candidate) => candidate.id === turnId);
    const message = turn?.messages.find(
      (candidate) => candidate.role === 'user',
    );
    if (!message) return;
    document
      .getElementById(`transcript-message-${message.id}`)
      ?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
        block: 'center',
      });
  };

  const jumpToMessage = (messageId: string) => {
    const target = document.getElementById(`transcript-message-${messageId}`);
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'center',
    });
  };

  const stopReply = async () => {
    if (!root?.activeTurnId || stopping) return;
    setStopping(true);
    try {
      await window.noema.stopTurn(root.activeTurnId);
      await refreshRoot();
    } catch {
      setNotice('停止请求没有完成。');
    } finally {
      setStopping(false);
    }
  };

  const retryTurn = async (turnId: string) => {
    if (busy || retryingTurn) return;
    setRetryingTurn(turnId);
    setNotice('');
    followConversationRef.current = true;
    try {
      await window.noema.retryTurn(turnId, root?.selectedModel ?? null);
      await refreshRoot();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '重试没有启动。');
      await refreshRoot();
    } finally {
      setRetryingTurn(null);
    }
  };

  const chooseWorkspace = async () => {
    if (!root?.dshAvailable) {
      setNotice(root?.dshWorkerError ?? '当前没有可用的 DSH 后台运行环境。');
      return;
    }
    try {
      const directory = await window.noema.chooseWorkspace();
      if (!directory) return;
      await refreshRoot();
      setNotice('项目目录已选定；代码任务只会访问这个目录。');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '项目目录没有设置成功。',
      );
    }
  };

  const clearWorkspace = async () => {
    try {
      await window.noema.clearWorkspace();
      await refreshRoot();
      setNotice('已移除项目目录；后续代码任务不会访问它。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '项目目录没有移除。');
    }
  };

  const stopBackgroundTask = async (taskId: string) => {
    try {
      const stopped = await window.noema.stopBackgroundTask(taskId);
      if (!stopped) {
        setNotice('后台任务已结束或无法停止；请检查任务状态。');
      }
      await refreshRoot();
    } catch {
      setNotice('停止请求没有完成；后台任务可能已产生部分文件改动。');
    }
  };

  const resumeBackgroundTask = async (taskId: string) => {
    try {
      const result = await window.noema.resumeBackgroundTask(taskId);
      if (!result.accepted) {
        setNotice(result.errorMessage ?? '后台任务暂时无法续接。');
      } else {
        setNotice('已在原 DSH 会话中继续；已发生的文件改动不会回滚。');
      }
      await refreshRoot();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '后台任务续接失败。');
      await refreshRoot();
    }
  };

  const retryBackgroundEvent = async (taskId: string) => {
    setRetryingWorkerEvent(taskId);
    try {
      const result = await window.noema.retryBackgroundEvent(taskId);
      if (!result.accepted) {
        setNotice(result.errorMessage ?? '暂时无法重新接回这条结果。');
      } else if (result.completed) {
        setNotice('Noema 已接回这条后台结果。');
      } else {
        setNotice(
          result.errorMessage ??
            '结果仍已保留，但 Noema 暂时没有完成整理；可以稍后重试。',
        );
      }
      await refreshRoot();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : '结果仍已保留，但重新接回失败。',
      );
      await refreshRoot();
    } finally {
      setRetryingWorkerEvent(null);
    }
  };

  const onComposerKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void sendMessage();
    }
  };

  const selectedModelMissing = Boolean(
    root?.selectedModel &&
    !root.models.some((model) => model.name === root.selectedModel),
  );
  const selectedModelState = root?.models.find(
    (model) => model.name === root.selectedModel,
  );
  const selectedModelUnavailable = Boolean(
    root?.selectedModel &&
    (selectedModelMissing ||
      selectedModelState?.executionStatus === 'exhausted' ||
      selectedModelState?.executionStatus === 'needsKey'),
  );
  const selectedModelReadinessLabel = selectedModelMissing
    ? '不可用'
    : selectedModelState?.executionStatus === 'exhausted'
      ? '冷却中'
      : selectedModelState?.executionStatus === 'needsKey'
        ? '需密钥'
        : selectedModelState?.executionStatus === 'ready'
          ? '可用'
          : root?.selectedModel
            ? '状态未知'
            : null;
  const selectedModelReadinessKind =
    selectedModelState?.executionStatus ??
    (selectedModelMissing ? 'exhausted' : 'unknown');
  const workspaceName = root?.workspaceDirectory
    ?.split(/[\\/]/u)
    .filter(Boolean)
    .at(-1);

  return (
    <div className="noema-app">
      <header className="topbar">
        <div className="brand-lockup" aria-label="Noema">
          <span className="brand-name">noema</span>
        </div>

        <div className="topbar-tools">
          <label className="model-control">
            <span>回复模型</span>
            <select
              aria-label="选择回复模型"
              title={
                selectedModelState?.routeKind === 'router'
                  ? selectedModelState.executionStatus
                    ? '最近一次检查报告路由可用；自动选择的上游仍可能变化，每条回复会记录实际提供方。'
                    : '自动链路的实时上游状态无法从模型目录项判断；每条回复会记录实际提供方。'
                  : undefined
              }
              value={
                selectedModelMissing
                  ? '__missing__'
                  : (root?.selectedModel ?? '')
              }
              onChange={(event) => void selectModel(event.target.value)}
              disabled={!root || root.models.length === 0}
            >
              {selectedModelMissing && (
                <option value="__missing__">
                  {root?.selectedModel}（当前不可用）
                </option>
              )}
              {!root?.selectedModel && <option value="">选择模型</option>}
              {root?.models.map((model) => (
                <option
                  key={model.name}
                  value={model.name}
                  disabled={
                    model.executionStatus === 'exhausted' ||
                    model.executionStatus === 'needsKey'
                  }
                  title={
                    model.executionStatus === 'exhausted'
                      ? '模型服务当前报告该模型不可服务；刷新后状态可能变化。'
                      : model.executionStatus === 'ready'
                        ? '最近一次检查报告该模型可用；发送时仍可能遇到限流或超时。'
                        : undefined
                  }
                >
                  {model.label}
                </option>
              ))}
            </select>
            {selectedModelReadinessLabel && (
              <span
                className="model-readiness-badge"
                data-status={selectedModelReadinessKind}
                title={
                  selectedModelState?.routeKind === 'router' &&
                  selectedModelState.executionStatus === null
                    ? '自动链路没有逐模型就绪状态；真实提供方以回复来源或请求错误为准。'
                    : selectedModelState?.executionStatus === 'ready'
                      ? '最近一次检查报告可用；发送时仍可能遇到限流或超时。'
                      : selectedModelState?.executionStatus === 'exhausted'
                        ? '模型服务当前报告该模型的密钥暂时无法服务。刷新后状态可能变化。'
                        : undefined
                }
              >
                {selectedModelReadinessLabel}
              </span>
            )}
          </label>
          <div
            className={`connection-state ${root?.connected ? (root.models.length ? 'connected' : 'empty-models') : 'disconnected'}`}
          >
            <span className="connection-symbol" aria-hidden="true" />
            <span>
              {!root || root.checking
                ? '正在检查模型服务'
                : root.connected
                  ? root.models.length
                    ? `${root.providerName} 已连接`
                    : '服务端未列出可用模型'
                  : `${root.providerName} 未连接`}
            </span>
          </div>
          <button
            className="refresh-button"
            type="button"
            onClick={() => void refreshModels()}
            disabled={refreshing}
          >
            {refreshing ? '正在检查' : '刷新'}
          </button>
          <button
            className="refresh-button provider-settings-button"
            type="button"
            onClick={openModelSettings}
          >
            {root?.providerConfigured ? '模型设置' : '连接模型'}
          </button>
        </div>
      </header>

      <main className="conversation-page">
        <div
          className={`page-heading${conversationSearchOpen || editingAdjustmentId ? ' is-focus-mode' : ''}`}
        >
          <div className="heading-copy">
            <div className="heading-title-row">
              <h1>对话</h1>
              {((root?.messages.length ?? 0) > 0 ||
                (root?.captures.length ?? 0) > 0) && (
                <button
                  ref={conversationSearchTriggerRef}
                  className="conversation-search-trigger"
                  type="button"
                  onClick={() => setConversationSearchOpen(true)}
                  aria-keyshortcuts="Control+F Meta+F"
                  title="查找这条对话（Ctrl+F）"
                >
                  查找
                </button>
              )}
            </div>
            <p>
              对话保存在本机；回复会发送到当前配置的模型服务商。请按服务商条款评估数据处理方式。
            </p>
          </div>
        </div>

        {root && !root.connected && !root.checking && (
          <section className="connection-notice" role="status">
            <div>
              <strong>
                {root.providerConfigured
                  ? `${root.providerName} 暂不可用`
                  : '还没有连接模型服务'}
              </strong>
              <p>
                {root.error ??
                  '配置模型服务后即可开始；已发送的消息会保留，可恢复后重试。'}
              </p>
            </div>
            <button
              type="button"
              onClick={
                root.providerConfigured
                  ? () => void refreshModels()
                  : openModelSettings
              }
              disabled={refreshing}
            >
              {refreshing
                ? '检查中…'
                : root.providerConfigured
                  ? '重新连接'
                  : '连接设置'}
            </button>
          </section>
        )}
        {root?.connected && selectedModelUnavailable && (
          <section className="connection-notice" role="status">
            <div>
              <strong>所选模型当前不可用</strong>
              <p>
                {selectedModelState?.executionStatus === 'exhausted'
                  ? '模型服务报告该模型的凭据暂时无法服务（例如处于限流冷却）。可切换模型或稍后刷新。'
                  : '当前模型服务没有列出这个模型。刷新状态或选择其他模型。'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshModels()}
              disabled={refreshing}
            >
              {refreshing ? '检查中…' : '刷新模型状态'}
            </button>
          </section>
        )}
        {root?.connected && !root.checking && root.models.length === 0 && (
          <section className="connection-notice" role="status">
            <div>
              <strong>模型服务暂无可用模型</strong>
              <p>
                检查网关中的免费供应商与模型状态后刷新。Noema
                不会回退到本机模型。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshModels()}
              disabled={refreshing}
            >
              {refreshing ? '检查中…' : '刷新列表'}
            </button>
          </section>
        )}

        {conversationSearchOpen && (
          <section
            className="conversation-search"
            role="search"
            aria-label="在这条对话中查找"
          >
            <div className="conversation-search-controls">
              <label className="sr-only" htmlFor="conversation-search-input">
                查找本机保存的对话消息
              </label>
              <input
                id="conversation-search-input"
                ref={conversationSearchInputRef}
                type="search"
                value={conversationSearchQuery}
                onChange={(event) => {
                  setConversationSearchQuery(event.target.value);
                  setConversationSearchIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    moveConversationSearch(event.shiftKey ? -1 : 1);
                  }
                }}
                placeholder="查找消息或速记"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="conversation-search-actions">
                <button
                  type="button"
                  onClick={() => moveConversationSearch(-1)}
                  disabled={conversationSearchMatches.length === 0}
                  aria-label="上一条匹配"
                  title="上一条匹配（Shift+Enter）"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveConversationSearch(1)}
                  disabled={conversationSearchMatches.length === 0}
                  aria-label="下一条匹配"
                  title="下一条匹配（Enter）"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => setConversationSearchOpen(false)}
                  aria-label="关闭查找"
                  title="关闭查找（Escape）"
                >
                  ×
                </button>
              </div>
            </div>
            <p
              className="conversation-search-status"
              role="status"
              aria-live="polite"
            >
              {!conversationSearchQuery.trim() ? (
                '只查找本机保存的消息与速记；不会调用模型。'
              ) : conversationSearchMatches.length === 0 ? (
                <>没有找到“{conversationSearchQuery.trim()}”</>
              ) : (
                <>
                  {activeConversationSearchIndex + 1} /{' '}
                  {conversationSearchMatches.length} ·{' '}
                  {activeConversationSearchMatch?.source === 'capture'
                    ? '速记'
                    : activeConversationSearchMatch?.role === 'user'
                      ? '你'
                      : 'Noema'}{' '}
                  · {formatTime(activeConversationSearchMatch?.createdAt ?? '')}
                  {' · '}
                  {activeConversationSearchMatch?.snippet}
                </>
              )}
            </p>
          </section>
        )}

        <div
          className="conversation-scroll"
          ref={conversationRef}
          onScroll={(event) => {
            const node = event.currentTarget;
            followConversationRef.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 140;
          }}
          aria-label="对话记录"
        >
          {timeline.length === 0 ? (
            <div className="empty-conversation">
              <div className="empty-thread" aria-hidden="true">
                <span />
              </div>
              <div className="empty-copy">
                <p className="empty-lead">这条对话还没有消息。</p>
                <p>
                  {!root || root.checking
                    ? '正在检查本机模型连接。'
                    : !root.connected
                      ? '配置模型服务后即可开始；对话会保存在本机。'
                      : root.models.length === 0
                        ? '模型服务已连接，但当前没有可用模型。检查服务商状态后刷新。'
                        : selectedModelMissing
                          ? '当前选中的模型暂不可用；可在顶部切换其他模型。'
                          : !root.selectedModel
                            ? '先在顶部选择模型，再从这里开始。'
                            : '直接从这里开始；对话会一直留在本机。若你明确纠正 Noema 的交流或协作方式，它可能会记录为互动调整，你可以查看来源、修改或撤回。'}
                </p>
              </div>
            </div>
          ) : (
            <div className="turn-list">
              {timeline.map((entry) => {
                if (entry.kind === 'context') {
                  const context = entry.context;
                  return (
                    <article className="turn context-turn" key={entry.key}>
                      <div className="turn-gutter">
                        <time dateTime={context.capturedAt}>
                          {formatTime(entry.time)}
                        </time>
                        <span className="turn-spine" aria-hidden="true">
                          <span />
                        </span>
                      </div>
                      <div className="turn-body">
                        <section
                          className="context-card"
                          aria-label="带入的 Codex 对话文字"
                        >
                          <div className="context-card-heading">
                            <div>
                              <strong>Codex 可见对话文字</strong>
                              <span>{context.title}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void removeContextImport()}
                            >
                              从 Noema 移除
                            </button>
                          </div>
                          <p
                            className="context-card-origin"
                            title={context.workingDirectory ?? ''}
                          >
                            {context.workingDirectory ?? '未记录工作目录'} ·{' '}
                            {context.messageCount} 条可见消息 ·{' '}
                            {context.characterCount.toLocaleString()} 字
                          </p>
                          {(context.omittedItems > 0 ||
                            context.omittedTurns > 0 ||
                            context.omittedMessages > 0 ||
                            context.hasMoreTurns) && (
                            <p className="context-card-omissions">
                              {context.hasMoreTurns &&
                                '只导入最近 40 个轮次，更早轮次未带入。 '}
                              有内容未带入：{context.omittedItems}{' '}
                              项工具/非文字记录、
                              {context.omittedTurns} 个进行中轮次、 较早历史中的{' '}
                              {context.omittedMessages} 条可见消息。
                            </p>
                          )}
                          <details className="context-preview-details">
                            <summary>查看实际导入的可见文字</summary>
                            <div className="context-preview-messages">
                              {context.messages.map((message, index) => (
                                <div
                                  className="context-preview-message"
                                  key={`${context.sourceThreadId}:${index}`}
                                >
                                  <span>
                                    {message.role === 'user'
                                      ? 'Codex 用户消息'
                                      : 'Codex 回复'}
                                  </span>
                                  <p>{message.content}</p>
                                </div>
                              ))}
                            </div>
                          </details>
                          <p
                            className={
                              context.consentedAt
                                ? 'context-transmission is-active'
                                : 'context-transmission'
                            }
                          >
                            {context.consentedAt
                              ? '已授权：这份快照会随 Noema 后续对话发送到当前模型服务，直到移除。'
                              : '仅保存在本机；下次发送时会先说明数据去向并征求同意。'}
                          </p>
                          <div className="context-card-footnote">
                            这不是可继续运行的 Codex
                            会话副本。只读的文字不会在两边保持同步；Codex
                            内部运行状态仍留在原应用。
                          </div>
                        </section>
                      </div>
                    </article>
                  );
                }
                if (entry.kind === 'capture') {
                  const capture = entry.capture;
                  const editing = captureEdit?.id === capture.id;
                  return (
                    <article className="turn capture-turn" key={entry.key}>
                      <div className="turn-gutter">
                        <time dateTime={capture.createdAt}>
                          {formatTime(entry.time)}
                        </time>
                        <span className="turn-spine" aria-hidden="true">
                          <span />
                        </span>
                      </div>
                      <div className="turn-body">
                        <section
                          id={`transcript-capture-${capture.id}`}
                          className={`capture-card${activeConversationSearchMatch?.source === 'capture' && activeConversationSearchMatch.id === capture.id ? ' is-search-current' : ''}`}
                          aria-label="本机速记"
                        >
                          <div className="capture-card-heading">
                            <div>
                              <strong>留给自己的速记</strong>
                              <span>
                                {capture.discussionTurnId
                                  ? '本机保存 · 已带入一轮对话'
                                  : '本机保存 · 未发送给模型'}
                              </span>
                            </div>
                            {capture.updatedAt !== capture.createdAt && (
                              <span>已修改</span>
                            )}
                          </div>
                          {editing ? (
                            <div className="capture-edit">
                              <textarea
                                aria-label="编辑速记内容"
                                value={captureEdit.content}
                                maxLength={100_000}
                                onChange={(event) =>
                                  setCaptureEdit({
                                    id: capture.id,
                                    content: event.target.value,
                                  })
                                }
                              />
                              <div className="capture-actions">
                                <button
                                  type="button"
                                  onClick={() => setCaptureEdit(null)}
                                  disabled={captureBusy === capture.id}
                                >
                                  取消
                                </button>
                                <button
                                  className="capture-primary-action"
                                  type="button"
                                  onClick={() => void saveCaptureEdit()}
                                  disabled={
                                    !captureEdit.content.trim() ||
                                    captureBusy === capture.id
                                  }
                                >
                                  {captureBusy === capture.id
                                    ? '正在保存…'
                                    : '保存修改'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="capture-content">{capture.content}</p>
                          )}
                          <div className="capture-actions">
                            {capture.discussionTurnId ? (
                              <button
                                type="button"
                                onClick={() =>
                                  jumpToTurn(capture.discussionTurnId!)
                                }
                              >
                                查看讨论
                              </button>
                            ) : !editing ? (
                              <>
                                <button
                                  className="capture-primary-action"
                                  type="button"
                                  onClick={() => void discussCapture(capture)}
                                  disabled={busy || captureBusy === capture.id}
                                >
                                  {captureBusy === capture.id
                                    ? '正在发送…'
                                    : '与 Noema 讨论'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCaptureEdit({
                                      id: capture.id,
                                      content: capture.content,
                                    })
                                  }
                                  disabled={Boolean(captureBusy)}
                                >
                                  编辑
                                </button>
                              </>
                            ) : null}
                            <button
                              className="capture-delete-action"
                              type="button"
                              onClick={() => void deleteCapture(capture)}
                              disabled={Boolean(captureBusy)}
                            >
                              删除
                            </button>
                          </div>
                          {capture.discussionTurnId && (
                            <p className="capture-discussion-note">
                              已另行写入 Noema
                              对话；是否抵达模型以该轮状态为准。删除速记不会删除对话副本，也无法撤回已发出的请求。
                            </p>
                          )}
                        </section>
                      </div>
                    </article>
                  );
                }
                if (entry.kind === 'adjustment') {
                  const adjustment = entry.adjustment;
                  const scopeLabel =
                    adjustment.scope === 'conversation'
                      ? 'Noema 对话'
                      : adjustment.scope === 'coding'
                        ? '后台编码任务'
                        : 'Noema 对话与后台编码任务';
                  const originalScopeLabel =
                    adjustment.originalScope === 'conversation'
                      ? 'Noema 对话'
                      : adjustment.originalScope === 'coding'
                        ? '后台编码任务'
                        : adjustment.originalScope === 'both'
                          ? 'Noema 对话与后台编码任务'
                          : null;
                  const isEditingAdjustment =
                    editingAdjustmentId === adjustment.id && adjustmentDraft;
                  return (
                    <article className="turn adjustment-turn" key={entry.key}>
                      <div className="turn-gutter">
                        <time dateTime={adjustment.createdAt}>
                          {formatTime(entry.time)}
                        </time>
                        <span className="turn-spine" aria-hidden="true">
                          <span />
                        </span>
                      </div>
                      <div className="turn-body">
                        <section
                          ref={
                            isEditingAdjustment
                              ? adjustmentEditPanelRef
                              : undefined
                          }
                          className={`adjustment-event${adjustment.status === 'withdrawn' ? ' is-withdrawn' : ''}`}
                          aria-label="Noema 互动调整"
                        >
                          <div className="adjustment-heading">
                            <div className="adjustment-heading-copy">
                              <strong>
                                {isEditingAdjustment
                                  ? '正在修改互动调整'
                                  : adjustment.status === 'active'
                                    ? '互动调整已记录'
                                    : '互动调整已撤回'}
                              </strong>
                              {adjustment.userEdited && (
                                <span
                                  className="adjustment-edited-badge"
                                  title={
                                    adjustment.editedAt
                                      ? `修订于 ${formatCodexTime(adjustment.editedAt)}`
                                      : '此条调整由用户修订'
                                  }
                                >
                                  你已修订
                                </span>
                              )}
                            </div>
                            {adjustment.status === 'active' &&
                              !isEditingAdjustment && (
                                <div className="adjustment-heading-actions">
                                  <button
                                    ref={(element) => {
                                      if (element) {
                                        adjustmentEditButtonsRef.current.set(
                                          adjustment.id,
                                          element,
                                        );
                                      } else {
                                        adjustmentEditButtonsRef.current.delete(
                                          adjustment.id,
                                        );
                                      }
                                    }}
                                    className="adjustment-edit-button"
                                    type="button"
                                    onClick={() =>
                                      beginEditingInteractionAdjustment(
                                        adjustment,
                                      )
                                    }
                                    aria-label={`修改互动调整：${adjustment.situation}`}
                                  >
                                    修改
                                  </button>
                                  <button
                                    className="adjustment-withdraw-button"
                                    type="button"
                                    onClick={() =>
                                      void withdrawInteractionAdjustment(
                                        adjustment.id,
                                      )
                                    }
                                    aria-label={`撤回互动调整：${adjustment.situation}`}
                                  >
                                    撤回后续使用
                                  </button>
                                </div>
                              )}
                          </div>
                          {isEditingAdjustment ? (
                            <form
                              className="adjustment-edit-form"
                              onSubmit={(event) =>
                                void saveInteractionAdjustment(event)
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelEditingInteractionAdjustment();
                                }
                              }}
                            >
                              <div className="adjustment-edit-grid">
                                <label>
                                  <span>适用情境</span>
                                  <input
                                    id="interaction-adjustment-situation"
                                    ref={adjustmentEditSituationRef}
                                    value={adjustmentDraft.situation}
                                    maxLength={180}
                                    required
                                    disabled={savingAdjustment}
                                    onChange={(event) =>
                                      setAdjustmentDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              situation: event.target.value,
                                            }
                                          : current,
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  <span>适用范围</span>
                                  <select
                                    value={adjustmentDraft.scope}
                                    disabled={savingAdjustment}
                                    onChange={(event) =>
                                      setAdjustmentDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              scope: event.target
                                                .value as NoemaInteractionAdjustment['scope'],
                                            }
                                          : current,
                                      )
                                    }
                                  >
                                    <option value="conversation">
                                      Noema 对话
                                    </option>
                                    <option value="coding">后台编码任务</option>
                                    <option value="both">
                                      对话与后台编码任务
                                    </option>
                                  </select>
                                </label>
                              </div>
                              <label>
                                <span>期望做法</span>
                                <textarea
                                  value={adjustmentDraft.behavior}
                                  maxLength={240}
                                  rows={2}
                                  required
                                  disabled={savingAdjustment}
                                  onChange={(event) =>
                                    setAdjustmentDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            behavior: event.target.value,
                                          }
                                        : current,
                                    )
                                  }
                                />
                              </label>
                              <p className="adjustment-edit-note">
                                原始引文：{adjustment.sourceQuote}
                                。来源时间保持不变；修订只影响之后新建的请求，不回写旧对话或运行中的任务。
                              </p>
                              {adjustment.userEdited && (
                                <details className="adjustment-edit-original">
                                  <summary>查看模型初始归纳</summary>
                                  <p>
                                    适用：{originalScopeLabel} ·{' '}
                                    {adjustment.originalSituation}
                                  </p>
                                  <p>期望做法：{adjustment.originalBehavior}</p>
                                </details>
                              )}
                              {adjustmentEditError && (
                                <p
                                  className="adjustment-edit-error"
                                  role="alert"
                                >
                                  {adjustmentEditError}
                                </p>
                              )}
                              <div className="adjustment-edit-actions">
                                <button
                                  type="button"
                                  onClick={cancelEditingInteractionAdjustment}
                                  disabled={savingAdjustment}
                                >
                                  取消
                                </button>
                                <button
                                  className="adjustment-edit-save"
                                  type="submit"
                                  disabled={
                                    savingAdjustment ||
                                    !adjustmentDraft.situation.trim() ||
                                    !adjustmentDraft.behavior.trim()
                                  }
                                >
                                  {savingAdjustment ? '保存中…' : '保存修订'}
                                </button>
                              </div>
                            </form>
                          ) : (
                            <p className="adjustment-change">
                              <span>适用：{scopeLabel}</span>
                              <span>{adjustment.situation}</span>
                              <span>期望做法：{adjustment.behavior}</span>
                            </p>
                          )}
                          {!isEditingAdjustment && (
                            <details className="adjustment-source">
                              <summary>
                                {adjustment.userEdited
                                  ? '查看原始归纳与来源'
                                  : '查看来源与数据范围'}
                              </summary>
                              {adjustment.userEdited &&
                                adjustment.originalScope && (
                                  <div className="adjustment-original-proposal">
                                    <strong>模型初始归纳</strong>
                                    <span>适用：{originalScopeLabel}</span>
                                    <span>{adjustment.originalSituation}</span>
                                    <span>
                                      期望做法：{adjustment.originalBehavior}
                                    </span>
                                  </div>
                                )}
                              <blockquote>{adjustment.sourceQuote}</blockquote>
                              <p>
                                {adjustment.status === 'active'
                                  ? '后续匹配情境时，当前版本会作为参考随请求发送到当前免费模型路由；这不保证模型每次都遵循。编辑或撤回不会改变已发送内容或 DSH 原生任务记录。'
                                  : '撤回后，这条记录不会进入新的模型请求；原始对话仍保存在本机。'}
                              </p>
                            </details>
                          )}
                        </section>
                      </div>
                    </article>
                  );
                }
                if (entry.kind === 'task') {
                  const task = entry.task;
                  const toolActionSummary = task.toolActionsTruncated
                    ? `工具调用记录不完整（已记录 ${task.toolActionCategories.length} 次）`
                    : `查看 ${task.toolActionCategories.length} 次工具调用`;
                  const taskAdjustments = task.interactionAdjustmentSnapshots;
                  return (
                    <article className="turn worker-turn" key={entry.key}>
                      <div className="turn-gutter">
                        <time>{formatTime(entry.time)}</time>
                        <span className="turn-spine" aria-hidden="true">
                          <span />
                        </span>
                      </div>
                      <div className="turn-body">
                        <section
                          className={`worker-card worker-${task.status}`}
                          aria-label="后台任务返回事件"
                        >
                          <div className="worker-card-heading">
                            <div className="worker-title-group">
                              <strong>后台任务</strong>
                              <span>DSH · {task.model}</span>
                            </div>
                            <span
                              className={`worker-status status-${task.status}`}
                            >
                              {taskStatusLabel(task)}
                            </span>
                          </div>
                          <p className="worker-task-prompt">{task.prompt}</p>
                          <section
                            className={`worker-verification worker-verification-${task.verificationStatus}`}
                            aria-label="Noema 任务验收状态"
                            role={
                              ['failed', 'unavailable'].includes(
                                task.verificationStatus,
                              )
                                ? 'status'
                                : undefined
                            }
                          >
                            <strong>{verificationStatusLabel(task)}</strong>
                            {task.verificationChecks.length > 0 && (
                              <details>
                                <summary>
                                  查看 Noema 核验标准与结果（
                                  {task.verificationChecks.length} 项）
                                </summary>
                                <ul>
                                  {task.verificationChecks.map(
                                    (check, index) => {
                                      const result =
                                        task.verificationResults[index];
                                      const expected =
                                        check.kind === 'file_exists'
                                          ? '文件存在'
                                          : check.kind === 'file_equals'
                                            ? `文件内容等于「${check.text}」`
                                            : `文件包含「${check.text}」`;
                                      return (
                                        <li
                                          key={`${check.path}:${index}`}
                                          className={`verification-result verification-${result?.status ?? 'pending'}`}
                                        >
                                          <code>{check.path}</code> · {expected}
                                          {result && (
                                            <span>
                                              {' '}
                                              —{' '}
                                              {verificationReasonLabel(
                                                result.reason,
                                              )}
                                            </span>
                                          )}
                                        </li>
                                      );
                                    },
                                  )}
                                </ul>
                              </details>
                            )}
                          </section>
                          {task.interactionAdjustmentIds.length > 0 && (
                            <details className="adjustment-application-trace">
                              <summary>
                                本任务关联了{' '}
                                {task.interactionAdjustmentIds.length}{' '}
                                条互动纠正
                              </summary>
                              {taskAdjustments.length > 0 ? (
                                <ul>
                                  {taskAdjustments.map((adjustment) => (
                                    <li key={adjustment.id}>
                                      <strong>
                                        {adjustment.situation}
                                        {adjustment.userEdited &&
                                          ' · 用户已修订'}
                                      </strong>
                                      <span>
                                        期望做法：{adjustment.behavior}
                                      </span>
                                      <blockquote>
                                        {adjustment.sourceQuote}
                                      </blockquote>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p>
                                  没有保存当时的互动调整快照，无法检查具体内容。
                                </p>
                              )}
                              {task.interactionAdjustmentIds.length >
                                taskAdjustments.length && (
                                <p>
                                  这项历史任务只保存了部分调整快照；没有用当前版本推测当时上下文。
                                </p>
                              )}
                              <p className="adjustment-application-caveat">
                                这是 Noema
                                记录的会话关联，不证明模型成功接收或遵循。下方核验仅检查列出的任务条件；通过或失败都不能单独证明纠正造成了结果。
                              </p>
                            </details>
                          )}
                          {(task.toolActionCategories.length > 0 ||
                            task.toolActionsTruncated) && (
                            <details className="worker-output-details worker-action-trace">
                              <summary>{toolActionSummary}</summary>
                              {task.toolActionCategories.length > 0 ? (
                                <ol className="worker-action-sequence">
                                  {task.toolActionCategories.map(
                                    (category, index) => (
                                      <li key={`${category}:${index}`}>
                                        {toolActionLabel(category)}
                                      </li>
                                    ),
                                  )}
                                </ol>
                              ) : (
                                <p className="worker-action-disclosure">
                                  操作记录不完整，当前无法显示调用顺序。
                                </p>
                              )}
                              <p className="worker-action-disclosure">
                                只保留类别与顺序，不含参数、文件内容或返回值。调用记录不代表成功；文件条件以
                                Noema 核验为准。
                              </p>
                            </details>
                          )}
                          <div className="worker-metadata">
                            <span title={task.workspacePath}>
                              项目文件夹 · {task.workspacePath}
                            </span>
                            {task.sessionId && (
                              <span>
                                会话 · {shortSessionId(task.sessionId)}
                              </span>
                            )}
                            <span>工具调用 · {task.toolCallCount}</span>
                          </div>
                          {(task.resultText || task.errorMessage) && (
                            <details className="worker-output-details">
                              <summary>
                                {task.errorMessage
                                  ? '执行信息'
                                  : '查看 DSH Agent 报告'}
                              </summary>
                              <div className="worker-output">
                                {task.resultText || task.errorMessage}
                              </div>
                            </details>
                          )}
                          {task.status !== 'completed' &&
                            (task.status === 'interrupted' ||
                              task.toolCallCount > 0) && (
                              <p className="worker-side-effect-note">
                                任务未完整结束；停止前已发生的文件改动不会自动回滚。
                              </p>
                            )}
                          {task.noemaResponseStatus === 'streaming' && (
                            <p
                              className="worker-response-pending"
                              role="status"
                            >
                              Noema 正在接回这条系统事件…
                            </p>
                          )}
                          {task.noemaResponse && (
                            <div className="worker-noema-response">
                              <span>Noema 接回结果</span>
                              <p>{task.noemaResponse}</p>
                            </div>
                          )}
                          {task.noemaResponseError && (
                            <div className="worker-response-recovery">
                              <p
                                className="worker-response-error"
                                role="status"
                              >
                                {task.noemaResponseError}
                              </p>
                              {task.eventStatus === 'pending' &&
                                ['failed', 'interrupted'].includes(
                                  task.noemaResponseStatus,
                                ) && (
                                  <button
                                    className="worker-event-retry-button"
                                    type="button"
                                    onClick={() =>
                                      void retryBackgroundEvent(task.id)
                                    }
                                    disabled={
                                      busy || retryingWorkerEvent === task.id
                                    }
                                    title="只重新整理已保存的结果，不会重启 DSH 或重复文件操作。"
                                  >
                                    {retryingWorkerEvent === task.id
                                      ? '正在重试结果…'
                                      : '重试结果接回'}
                                  </button>
                                )}
                            </div>
                          )}
                          {['failed', 'interrupted'].includes(task.status) &&
                            task.sessionId && (
                              <button
                                className="worker-resume-button"
                                type="button"
                                onClick={() =>
                                  void resumeBackgroundTask(task.id)
                                }
                                disabled={busy || activeWorkerTasks.length > 0}
                              >
                                在原 DSH 会话中继续
                              </button>
                            )}
                          <div className="worker-return-caption">
                            结果作为后台系统事件返回；不是用户消息，也不是 DSH
                            完整会话副本。
                          </div>
                        </section>
                      </div>
                    </article>
                  );
                }
                const turn = entry.turn;
                const userMessage = turn.messages.find(
                  (message) => message.role === 'user',
                );
                const assistantMessages = turn.messages.filter(
                  (message) => message.role === 'assistant',
                );
                const currentAssistant = assistantMessages.find(
                  (message) => message.attempt === turn.latestAttempt,
                );
                const contextAdjustments =
                  currentAssistant?.interactionAdjustmentSnapshots ?? [];
                if (!userMessage) return null;
                return (
                  <article className="turn" key={entry.key}>
                    <div className="turn-gutter">
                      <time dateTime={userMessage.createdAt}>
                        {formatTime(userMessage.createdAt)}
                      </time>
                      <span className="turn-spine" aria-hidden="true">
                        <span />
                      </span>
                    </div>
                    <div className="turn-body">
                      <div
                        id={`transcript-message-${userMessage.id}`}
                        className={`user-entry${activeConversationSearchMatch?.source === 'message' && activeConversationSearchMatch.id === userMessage.id ? ' is-search-current' : ''}`}
                      >
                        <div className="entry-byline">
                          <span>你</span>
                        </div>
                        <div className="user-copy">{userMessage.content}</div>
                      </div>
                      {userMessage.contextOmittedTurns > 0 && (
                        <div className="context-coverage" role="note">
                          本轮常规上下文带入最近 {userMessage.contextTurns}{' '}
                          轮；更早的 {userMessage.contextOmittedTurns}{' '}
                          轮未自动发送。
                          {currentAssistant?.historySearchStatus === 'found' &&
                            currentAssistant.historySources.length > 0 && (
                              <>
                                {' '}
                                {currentAssistant.historySourcesIncluded
                                  ? `按本轮提及，另向当前模型服务发送了 ${currentAssistant.historySources.length} 条旧消息；来源见下方。`
                                  : `本机另找到 ${currentAssistant.historySources.length} 条旧消息，但上游是否收到无法确认；来源见下方。`}
                              </>
                            )}
                        </div>
                      )}
                      {assistantMessages.map((message) => {
                        const isLatestAttempt =
                          message.attempt === turn.latestAttempt;
                        const isStreaming = message.status === 'streaming';
                        return (
                          <section
                            id={`transcript-message-${message.id}`}
                            className={`assistant-entry${isStreaming ? ' is-streaming' : ''}${activeConversationSearchMatch?.source === 'message' && activeConversationSearchMatch.id === message.id ? ' is-search-current' : ''}`}
                            key={message.id}
                            aria-busy={isStreaming}
                          >
                            <div className="entry-byline assistant-byline">
                              <strong>Noema</strong>
                              {message.model && (
                                <span className="message-model">
                                  {root?.models.find(
                                    (model) => model.name === message.model,
                                  )?.label ?? message.model}
                                </span>
                              )}
                              {message.routeMetadataStatus === 'reported' &&
                                message.routedVia.length > 0 &&
                                (message.routedVia.length === 1 ? (
                                  <span
                                    className="route-provenance-label"
                                    title="FreeLLMAPI 响应头报告的实际提供方和模型。"
                                  >
                                    实际：{message.routedVia[0]}
                                  </span>
                                ) : (
                                  <details className="route-provenance">
                                    <summary>
                                      实际路由 {message.routedVia.length} 次
                                    </summary>
                                    <ul>
                                      {message.routedVia.map((route, index) => (
                                        <li key={`${route}-${index}`}>
                                          {route}
                                        </li>
                                      ))}
                                    </ul>
                                    <p>
                                      来源：FreeLLMAPI
                                      响应头；所选路由与实际服务模型可能不同。
                                    </p>
                                  </details>
                                ))}
                              {message.routeMetadataStatus ===
                                'not_reported' && (
                                <span
                                  className="route-unreported"
                                  title="FreeLLMAPI 本轮没有报告实际提供方和模型。"
                                >
                                  实际路由未报告
                                </span>
                              )}
                              {message.attempt > 1 && (
                                <span className="attempt-label">
                                  重试 {message.attempt}
                                </span>
                              )}
                              <time>{formatTime(message.createdAt)}</time>
                            </div>
                            {message.historySearchStatus !== 'not_searched' && (
                              <details className="history-recall-trace">
                                <summary>
                                  {message.historySearchStatus === 'no_match'
                                    ? '本轮查过旧对话，没有找到相关原文'
                                    : message.historySourcesIncluded
                                      ? `本轮请求已包含 ${message.historySources.length} 条旧对话`
                                      : `本机找到 ${message.historySources.length} 条旧对话；上游是否收到无法确认`}
                                </summary>
                                {message.historySources.length > 0 ? (
                                  <ul>
                                    {message.historySources.map((source) => {
                                      const sourceStillAvailable =
                                        root?.messages.some(
                                          (candidate) =>
                                            candidate.id === source.id,
                                        ) ?? false;
                                      return (
                                        <li key={source.id}>
                                          <div className="history-source-heading">
                                            <span>
                                              {source.role === 'user'
                                                ? '你'
                                                : 'Noema'}
                                              {' · '}
                                              {formatTime(source.createdAt)}
                                              {source.redacted &&
                                                ' · 部分内容已隐藏'}
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                jumpToMessage(source.id)
                                              }
                                              disabled={!sourceStillAvailable}
                                            >
                                              {sourceStillAvailable
                                                ? '跳到原对话'
                                                : '原消息已移除'}
                                            </button>
                                          </div>
                                          <blockquote>
                                            {source.snippet}
                                          </blockquote>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                ) : (
                                  <p>
                                    检索没有匹配到已完成的旧对话；本轮未加入旧消息内容。
                                  </p>
                                )}
                                {message.historySources.length > 0 && (
                                  <p className="history-recall-caveat">
                                    {message.historySourcesIncluded
                                      ? '已将这些摘录发送给当前模型服务；这不证明模型实际使用或理解了它们。'
                                      : 'Noema 已在本机找到这些摘录，但请求未成功送达当前模型服务。'}{' '}
                                    Noema 不会将检索命中自动转为长期记忆。
                                  </p>
                                )}
                              </details>
                            )}
                            {message.externalSources.length > 0 && (
                              <details className="history-recall-trace external-source-trace">
                                <summary>
                                  本轮参考 {message.externalSources.length}{' '}
                                  个网页来源
                                </summary>
                                <ul>
                                  {message.externalSources.map((source) => (
                                    <li key={source.id}>
                                      <div className="history-source-heading">
                                        <a
                                          href={source.url}
                                          target="_blank"
                                          rel="noreferrer noopener"
                                        >
                                          {source.citationId &&
                                            `[${source.citationId}] `}
                                          {source.title}
                                        </a>
                                        <span>
                                          {message.externalSourcesIncluded
                                            ? '已随本轮请求发送'
                                            : '模型是否收到无法确认'}
                                          {source.truncated && ' · 摘录已截短'}
                                        </span>
                                      </div>
                                      <blockquote>{source.excerpt}</blockquote>
                                    </li>
                                  ))}
                                </ul>
                                <p className="history-recall-caveat">
                                  这里展示的是 Noema
                                  实际读取的网页正文摘录；搜索只用于发现候选页面，不保存搜索摘要。它记录了尝试提供给模型的资料，不证明模型实际使用或理解了它，也不代表来源内容已独立核实。
                                </p>
                              </details>
                            )}
                            {isLatestAttempt &&
                              message.interactionAdjustmentIds.length > 0 && (
                                <details className="adjustment-application-trace root-adjustment-trace">
                                  <summary>
                                    本轮上下文列出{' '}
                                    {message.interactionAdjustmentIds.length}{' '}
                                    条互动纠正
                                  </summary>
                                  {contextAdjustments.length > 0 ? (
                                    <ul>
                                      {contextAdjustments.map((adjustment) => (
                                        <li key={adjustment.id}>
                                          <strong>
                                            {adjustment.situation}
                                            {adjustment.userEdited &&
                                              ' · 用户已修订'}
                                          </strong>
                                          <span>
                                            期望做法：{adjustment.behavior}
                                          </span>
                                          <blockquote>
                                            {adjustment.sourceQuote}
                                          </blockquote>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p>
                                      没有保存当时的互动调整快照，无法检查具体内容。
                                    </p>
                                  )}
                                  {contextAdjustments.length <
                                    (currentAssistant?.interactionAdjustmentIds
                                      .length ?? 0) && (
                                    <p>
                                      旧 attempt
                                      未保存全部文字快照；没有用当前版本推测当时上下文。
                                    </p>
                                  )}
                                  <p className="adjustment-application-caveat">
                                    这只证明 Noema
                                    组装的请求包含这些纠正；不证明上游成功接收或模型遵循。
                                  </p>
                                </details>
                              )}
                            {message.content ? (
                              <div className="markdown-body">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={markdownComponents}
                                >
                                  {linkWebSourceCitations(
                                    message.content,
                                    message.externalSources,
                                  )}
                                </ReactMarkdown>
                                {isStreaming && (
                                  <span
                                    className="stream-caret"
                                    aria-hidden="true"
                                  />
                                )}
                              </div>
                            ) : isStreaming ? (
                              <p className="reply-waiting">
                                正在等待免费模型的第一段回复…
                              </p>
                            ) : null}
                            {message.status === 'interrupted' && (
                              <div className="attempt-note">
                                <span>
                                  {isLatestAttempt
                                    ? '本轮已停止，部分内容仍保留。'
                                    : '上一次回复已停止，部分内容仍保留。'}
                                </span>
                                {isLatestAttempt && (
                                  <button
                                    type="button"
                                    onClick={() => void retryTurn(turn.id)}
                                    disabled={busy || retryingTurn === turn.id}
                                  >
                                    {retryingTurn === turn.id
                                      ? '正在生成…'
                                      : '重新生成'}
                                  </button>
                                )}
                              </div>
                            )}
                            {message.status === 'failed' && (
                              <div
                                className="attempt-note failed-note"
                                role={isLatestAttempt ? 'alert' : undefined}
                              >
                                <span>
                                  {isLatestAttempt
                                    ? (message.errorMessage ?? '本轮没有完成。')
                                    : '上一次回复没有完成，部分内容仍保留。'}
                                </span>
                                {isLatestAttempt && (
                                  <button
                                    type="button"
                                    onClick={() => void retryTurn(turn.id)}
                                    disabled={busy || retryingTurn === turn.id}
                                  >
                                    {retryingTurn === turn.id
                                      ? '正在重试…'
                                      : '重新尝试免费模型'}
                                  </button>
                                )}
                              </div>
                            )}
                          </section>
                        );
                      })}
                      {busy &&
                        root?.activeTurnId === turn.id &&
                        !currentAssistant && (
                          <p className="reply-waiting" role="status">
                            正在等待免费模型…
                          </p>
                        )}
                    </div>
                  </article>
                );
              })}
              <div className="scroll-anchor" />
            </div>
          )}
        </div>

        {activeWorkerTasks.length > 0 && (
          <section className="worker-dock" aria-label="正在进行的后台任务">
            {activeWorkerTasks.map((task) => (
              <div className="worker-active-row" key={task.id}>
                <span className="worker-activity-pulse" aria-hidden="true" />
                <div className="worker-active-copy">
                  <div className="worker-active-heading">
                    <strong>{taskPhaseLabel(task.phase)}</strong>
                    <span>DSH · {task.toolCallCount} 次工具调用</span>
                  </div>
                  <p>{task.prompt}</p>
                  <small title={task.workspacePath}>{task.workspacePath}</small>
                </div>
                <button
                  className="worker-stop-button"
                  type="button"
                  onClick={() => void stopBackgroundTask(task.id)}
                >
                  停止任务
                </button>
              </div>
            ))}
          </section>
        )}

        <div className="composer-dock">
          <form
            className={`composer${busy ? ' composer-busy' : ''}`}
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage();
            }}
          >
            <label className="sr-only" htmlFor="message-input">
              发送消息给 Noema
            </label>
            <textarea
              id="message-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="接着说你正在想的事…"
              rows={2}
              maxLength={100_000}
              autoComplete="off"
              spellCheck
            />
            <div className="composer-context-tools" aria-label="可选上下文">
              <button
                ref={codexImportTriggerRef}
                className={`context-tool-button${contextImports.length > 0 ? ' context-tool-button-active' : ''}`}
                type="button"
                onClick={() => void openCodexImport()}
                disabled={
                  !root?.codexImportAvailable || contextImports.length > 0
                }
                title={
                  contextImports.length > 0
                    ? '先移除时间线中的这段快照，才能换另一段。'
                    : root?.codexImportAvailable
                      ? '只复制可见消息；不会续接或同步原会话。'
                      : '没有找到本机 Codex 桌面程序。'
                }
              >
                {contextImports.length > 0
                  ? 'Codex 对话已带入'
                  : '导入 Codex 对话'}
              </button>
              <button
                className={`context-tool-button${root?.workspaceDirectory ? ' context-tool-button-active' : ''}`}
                type="button"
                onClick={() => void chooseWorkspace()}
                disabled={!root?.dshAvailable || activeWorkerTasks.length > 0}
                title={
                  root?.dshWorkerError ??
                  root?.workspaceDirectory ??
                  '仅在你委托代码任务时使用；普通聊天不会读取。'
                }
              >
                {activeWorkerTasks.length > 0
                  ? '代码任务运行中'
                  : workspaceName
                    ? `项目目录：${workspaceName}`
                    : '选择项目目录'}
              </button>
              {root?.workspaceDirectory && (
                <button
                  className="context-tool-clear"
                  type="button"
                  onClick={() => void clearWorkspace()}
                  disabled={activeWorkerTasks.length > 0}
                  title="移除已选项目目录"
                >
                  移除
                </button>
              )}
            </div>
            <div className="composer-footer">
              <span className="composer-hint">
                {quickCaptureOpen
                  ? '本机速记已打开 · Esc 取消 · Ctrl+Enter 保存'
                  : busy
                    ? 'Noema 正在回复。可以先保存速记，或停止后再发送。'
                    : quickCaptureShortcutStatus?.registered
                      ? `${quickCaptureShortcutLabel} 快速速记 · Ctrl + Enter 发送 · 只记下来不会调用模型`
                      : quickCaptureShortcutStatus
                        ? `${quickCaptureShortcutLabel} 快捷速记不可用（可能被占用）；仍可使用“只记下来”`
                        : 'Ctrl + Enter 发送 · Enter 换行 · 只记下来不会调用模型'}
              </span>
              {busy ? (
                <div className="composer-actions">
                  <button
                    className="capture-save-button"
                    type="button"
                    onClick={() => void saveCapture()}
                    disabled={!draft.trim() || Boolean(captureBusy)}
                    title="只保存在本机，不调用模型"
                  >
                    {captureBusy === 'new' ? '正在保存…' : '只记下来'}
                  </button>
                  <button
                    className="stop-button"
                    type="button"
                    onClick={() => void stopReply()}
                    disabled={stopping}
                  >
                    {stopping ? '正在停止…' : '停止回复'}
                  </button>
                </div>
              ) : (
                <div className="composer-actions">
                  <button
                    className="capture-save-button"
                    type="button"
                    onClick={() => void saveCapture()}
                    disabled={!draft.trim() || sending || Boolean(captureBusy)}
                    title="只保存在本机，不调用模型"
                  >
                    {captureBusy === 'new' ? '正在保存…' : '只记下来'}
                  </button>
                  <button
                    className="send-button"
                    type="submit"
                    disabled={
                      !draft.trim() ||
                      sending ||
                      Boolean(captureBusy) ||
                      selectedModelUnavailable
                    }
                  >
                    {sending ? '发送中…' : '发送给 Noema'}
                  </button>
                </div>
              )}
            </div>
          </form>
          <div className="composer-disclosure">
            <span>本地保存</span>
            <span aria-hidden="true">·</span>
            <span>每轮最多带入最近 8 轮</span>
            {root?.workspaceDirectory && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  后台任务及读取文件会发送到第三方免费模型链；免费不代表私密
                </span>
              </>
            )}
          </div>
        </div>
      </main>

      <QuickCaptureDialog
        open={quickCaptureOpen}
        value={quickCaptureText}
        shortcutLabel={quickCaptureShortcutLabel}
        shortcutRegistered={quickCaptureShortcutStatus?.registered ?? null}
        saving={quickCaptureSaving}
        saved={quickCaptureSaved}
        error={quickCaptureError}
        onChange={(value) => {
          setQuickCaptureText(value);
          if (quickCaptureError) setQuickCaptureError('');
        }}
        onSave={() => void saveQuickCapture()}
        onCancel={() => void dismissQuickCapture()}
      />

      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice('')}
            aria-label="关闭提示"
          >
            关闭
          </button>
        </div>
      )}

      {codexImportOpen && (
        <div className="modal-scrim codex-import-scrim" role="presentation">
          <section
            className="codex-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="codex-import-title"
            aria-describedby="codex-import-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                closeCodexImport();
                return;
              }
              if (event.key !== 'Tab') return;
              const focusable = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  'button:not(:disabled)',
                ),
              );
              if (focusable.length === 0) return;
              const first = focusable[0];
              const last = focusable.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="settings-heading">
              <div>
                <p className="settings-eyebrow">只读 · 本机 Codex</p>
                <h2 id="codex-import-title">选择要带入的 Codex 对话</h2>
              </div>
              <button
                ref={codexImportCloseRef}
                className="modal-close"
                type="button"
                onClick={closeCodexImport}
                aria-label="关闭 Codex 会话导入"
              >
                ×
              </button>
            </div>
            <p className="settings-description" id="codex-import-description">
              选择本机 Codex
              的一段对话，先预览可带入的消息。导入后，它会作为文字出现在
              Noema；不会恢复 Codex
              会话，也不会把之后的消息同步过来。读取和预览只访问本机数据，不会调用模型。
            </p>
            {contextImports.length > 0 && (
              <div className="codex-import-warning" role="status">
                当前已有一段 Codex 对话文字。移除后才能换另一段。
              </div>
            )}
            {codexError && (
              <div className="codex-import-error" role="alert">
                {codexError}
              </div>
            )}
            <div className="codex-import-columns">
              <div
                className="codex-thread-list"
                aria-label="本机 Codex 会话列表"
              >
                {loadingCodex && (
                  <p className="codex-empty-state">正在只读读取会话…</p>
                )}
                {!loadingCodex && codexThreads.length === 0 && !codexError && (
                  <p className="codex-empty-state">
                    没有找到可导入的 Codex 会话。
                  </p>
                )}
                {codexThreads.map((thread) => (
                  <button
                    className={`codex-thread-option${codexPreview?.threadId === thread.id ? ' is-selected' : ''}`}
                    key={thread.id}
                    type="button"
                    aria-pressed={codexPreview?.threadId === thread.id}
                    onClick={() => void previewCodexThread(thread.id)}
                    disabled={loadingCodex}
                  >
                    <strong>{thread.title}</strong>
                    <span>{thread.cwd ?? '未记录工作目录'}</span>
                    <small>{formatCodexTime(thread.updatedAt)}</small>
                  </button>
                ))}
                {codexNextCursor && (
                  <button
                    className="codex-load-more"
                    type="button"
                    onClick={() => void loadMoreCodexThreads()}
                    disabled={loadingCodex}
                  >
                    {loadingCodex ? '正在读取…' : '加载更早的会话'}
                  </button>
                )}
              </div>
              <div className="codex-thread-preview">
                {!codexPreview && (
                  <p className="codex-empty-state">
                    选中左侧会话，查看将会带入的内容。
                  </p>
                )}
                {loadingCodex && codexPreview && (
                  <p className="codex-empty-state">正在重新读取预览…</p>
                )}
                {codexPreview && !loadingCodex && (
                  <>
                    <div className="codex-preview-heading">
                      <strong>{codexPreview.title}</strong>
                      <span>
                        {codexPreview.messages.length} 条消息 ·{' '}
                        {codexPreview.characterCount.toLocaleString()} 字
                      </span>
                    </div>
                    {codexPreview.hasMoreTurns && (
                      <p className="codex-preview-truncation">
                        只显示最近 40 个轮次；更早历史不会导入。
                      </p>
                    )}
                    {(codexPreview.omittedItems > 0 ||
                      codexPreview.omittedTurns > 0 ||
                      codexPreview.omittedMessages > 0) && (
                      <p className="codex-preview-truncation">
                        未导入 {codexPreview.omittedItems} 项工具/非文字记录、
                        {codexPreview.omittedTurns} 个进行中轮次、 较早历史中的{' '}
                        {codexPreview.omittedMessages} 条可见消息。
                      </p>
                    )}
                    <div className="codex-preview-scroll">
                      {codexPreview.messages.map((message, index) => (
                        <article
                          className="codex-preview-message"
                          key={`${codexPreview.threadId}:${index}`}
                        >
                          <span>
                            {message.role === 'user' ? '用户' : 'Codex'}
                          </span>
                          <p>{message.content}</p>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="codex-import-disclosure">
              这里只复制可见消息，不复制内部推理、工具记录、文件内容或运行状态，也不修改
              Codex 原会话。内容保存在本机；首次发送给模型前，Noema
              会再次征求同意。
            </div>
            <div className="settings-actions">
              <button
                className="settings-cancel"
                type="button"
                onClick={closeCodexImport}
              >
                取消
              </button>
              <button
                className="settings-save"
                type="button"
                onClick={() => void importCodexThread()}
                disabled={
                  !codexPreview ||
                  loadingCodex ||
                  importingCodex ||
                  contextImports.length > 0
                }
              >
                {importingCodex ? '正在校验并保存…' : '导入这段对话文字'}
              </button>
            </div>
          </section>
        </div>
      )}

      {modelSettingsOpen && (
        <div className="modal-scrim" role="presentation">
          <section
            className="model-settings"
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-settings-title"
            aria-describedby="model-settings-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeModelSettings();
            }}
          >
            <div className="settings-heading">
              <div>
                <p className="settings-eyebrow">模型连接</p>
                <h2 id="model-settings-title">配置模型服务</h2>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={closeModelSettings}
                aria-label="关闭模型设置"
              >
                ×
              </button>
            </div>
            <p className="settings-description" id="model-settings-description">
              填入兼容 OpenAI Chat Completions 的模型服务地址与 API
              Key。凭据只保存在这台设备，并由系统安全存储加密；请求会发送至你填写的服务地址。
            </p>
            <label className="settings-field">
              <span>模型服务地址</span>
              <input
                type="url"
                value={providerBaseUrl}
                onChange={(event) => setProviderBaseUrl(event.target.value)}
                autoComplete="url"
                spellCheck={false}
                placeholder="https://api.deepseek.com/v1 或本机兼容接口"
              />
            </label>
            <label className="settings-field">
              <span>API Key</span>
              <input
                type="password"
                autoFocus
                value={providerApiKey}
                onChange={(event) => setProviderApiKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveProviderSettings();
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder="粘贴服务商提供的 API Key"
              />
            </label>
            <p className="settings-footnote">
              远程服务必须使用 HTTPS。Noema
              不会自动切换模型或服务商；费用与数据处理规则由你填写的服务商决定。
            </p>
            <div className="settings-actions">
              <button
                className="settings-cancel"
                type="button"
                onClick={closeModelSettings}
              >
                取消
              </button>
              <button
                className="settings-save"
                type="button"
                onClick={() => void saveProviderSettings()}
                disabled={!providerApiKey.trim() || savingProvider}
              >
                {savingProvider ? '连接中…' : '加密保存并连接'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
