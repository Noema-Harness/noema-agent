import { NoemaButton } from '../ui/noema-button';
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useConversationNavigation } from './use-conversation-navigation';
import type { LiveTraceEvent } from './turn-trace';
import { resolveFollowupNavigationTarget } from './followup-navigation.mjs';
import { highlightMessageMatches } from './search-highlights';
import { useScrollActivity } from '../shared/use-scroll-activity';
import { resolveGroupRecipient } from '../../shared/chat/group-mentions.mjs';
import {
  isSupportedChatAttachment,
  MAX_CHAT_ATTACHMENT_CHARACTERS,
  MAX_CHAT_ATTACHMENT_COUNT,
  maxChatAttachmentBytes,
  prepareChatMessage,
} from '../../shared/chat/chat-text-attachments.mjs';
import { extractChatPdfText } from '../../shared/chat/chat-pdf-extraction.mjs';
import { createNotificationEarcon } from '../notifications/notification-earcon.mjs';
import type {
  NoemaSocialAgent,
  NoemaPersonalMemoryList,
  NoemaUserFollowupList,
  NoemaSocialEvent,
  NoemaSocialHistorySource,
  NoemaSocialMessage,
  NoemaSocialProject,
  NoemaSocialProjectSession,
  NoemaSocialProjectReview,
  NoemaSocialReplySource,
  NoemaSocialRoom,
  NoemaSocialRoomState,
  NoemaSocialSearchResult,
  NoemaSocialState,
  NoemaSocialWorkTask,
  NoemaSocialWorkGitReview,
  NoemaExecutionPermissions,
  SocialContinuityState,
} from '../../shared/contracts/noema-bridge.d.ts';
import { Icon, AgentMark } from './presentation';

function socialErrorMessage(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message.trim() ? error.message : fallback;
  return (
    message
      .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u, '')
      .trim() || fallback
  );
}

function scrollMessageIntoView(
  scroller: HTMLElement | null,
  target: HTMLElement | null | undefined,
) {
  if (!scroller || !target || !scroller.contains(target)) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetTop = targetRect.top - scrollerRect.top + scroller.scrollTop;
  const preferredOffset = Math.max(
    24,
    (scroller.clientHeight - targetRect.height) * 0.4,
  );
  scroller.scrollTo({
    top: Math.max(0, targetTop - preferredOffset),
    behavior: 'smooth',
  });
}

type QueuedMessage = {
  id: string;
  roomId: string;
  agentId: string;
  text: string;
  replyToMessageId: string | null;
  error: string | null;
};
type ProjectSessionsState = {
  loading: boolean;
  error: string | null;
  sessions: NoemaSocialProjectSession[];
};
export function useSocialChatController() {
  const [state, setState] = useState<NoemaSocialState | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const activeRoomIdRef = useRef(activeRoomId);
  activeRoomIdRef.current = activeRoomId;
  const socialStateRequestSequenceRef = useRef(0);
  const socialStateRef = useRef<NoemaSocialState | null>(null);
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
  const [continuity, setContinuity] = useState<SocialContinuityState | null>(
    null,
  );
  const [historyPageLoading, setHistoryPageLoading] = useState(false);
  const [historyPageError, setHistoryPageError] = useState('');
  const [draftsByRoom, setDraftsByRoom] = useState<Record<string, string>>({});
  const draftsByRoomRef = useRef(draftsByRoom);
  draftsByRoomRef.current = draftsByRoom;
  const [queuedMessagesByRoom, setQueuedMessagesByRoom] = useState<
    Record<string, QueuedMessage[]>
  >({});
  const [projectSessionsById, setProjectSessionsById] = useState<
    Record<string, ProjectSessionsState>
  >({});
  const [gitReviewsByTask, setGitReviewsByTask] = useState<
    Record<string, NoemaSocialWorkGitReview>
  >({});
  const [queueResumedAfterByRoom, setQueueResumedAfterByRoom] = useState<
    Record<string, string>
  >({});
  const [replyTarget, setReplyTarget] = useState<NoemaSocialReplySource | null>(
    null,
  );
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
  const [navigationSearch, setNavigationSearch] = useState('');
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const globalSearchTriggerRef = useRef<HTMLButtonElement>(null);
  const globalSearchReturnFocusRef = useRef<HTMLElement | null>(null);
  const globalNavigationSequence = useRef(0);
  const pendingRoomTargetRef = useRef<{
    roomId: string;
    messageId: string;
  } | null>(null);
  const pendingHistoryPrependRef = useRef<{
    roomId: string;
    scrollTop: number;
    scrollHeight: number;
  } | null>(null);
  const [conversationSearchQuery, setConversationSearchQuery] = useState('');
  const [conversationSearchResponse, setConversationSearchResponse] = useState<{
    roomId: string;
    query: string;
    items: NoemaSocialSearchResult[];
  }>({ roomId: '', query: '', items: [] });
  const [conversationSearchLoading, setConversationSearchLoading] =
    useState(false);
  const [conversationSearchError, setConversationSearchError] = useState('');
  const [conversationSearchRetry, setConversationSearchRetry] = useState(0);
  const conversationSearchRequestRef = useRef(0);
  const [
    pendingConversationSearchNavigation,
    setPendingConversationSearchNavigation,
  ] = useState<{
    messageId: string;
    roomId: string;
    query: string;
  } | null>(null);
  const [activeConversationSearchMatch, setActiveConversationSearchMatch] =
    useState<{
      messageId: string;
      roomId: string;
      query: string;
    } | null>(null);
  const [notice, setNotice] = useState('');
  const [draftAttachmentsByRoom, setDraftAttachmentsByRoom] = useState<
    Record<string, File[]>
  >({});
  const draftAttachmentsByRoomRef = useRef(draftAttachmentsByRoom);
  draftAttachmentsByRoomRef.current = draftAttachmentsByRoom;
  const [busy, setBusy] = useState(false);
  const [liveTrace, setLiveTrace] = useState<{
    roomId: string;
    messageId: string;
    taskId?: string;
    events: LiveTraceEvent[];
    done?: boolean;
  } | null>(null);
  const [showRoomList, setShowRoomList] = useState(false);
  const navigation = useConversationNavigation();
  const shellRef = useRef<HTMLElement>(null);
  useScrollActivity(shellRef);
  const selectRoom = useCallback((room: NoemaSocialRoom) => {
    setShowJumpToLatest(false);
    setArchivedProjectsOpen(false);
    setActiveProjectSession(null);
    setProjectWorkspaceId(null);
    setAgentWorkspaceId(null);
    shouldFollowRef.current = true;
    setActiveRoomId(room.id);
    setReplyTarget(null);
    setSelectedForwardMessageIds([]);
    setShowRoomList(false);
    setNotice('');
  }, []);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectBrief, setProjectBrief] = useState('');
  const [newProjectWorkspace, setNewProjectWorkspace] = useState<{
    workspacePath: string;
    identity: unknown;
  } | null>(null);
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
  const [executionPermissions, setExecutionPermissionsState] =
    useState<NoemaExecutionPermissions>({ externalFiles: 'ask' });
  const [executionPermissionsBusy, setExecutionPermissionsBusy] =
    useState(false);
  const [executionPermissionsError, setExecutionPermissionsError] =
    useState('');
  const [personalMemoryOpen, setPersonalMemoryOpen] = useState(false);
  const [personalMemoryList, setPersonalMemoryList] =
    useState<NoemaPersonalMemoryList | null>(null);
  const [personalMemoryLoading, setPersonalMemoryLoading] = useState(false);
  const [personalMemoryBusy, setPersonalMemoryBusy] = useState(false);
  const [personalMemoryError, setPersonalMemoryError] = useState('');
  const [personalMemoryDraft, setPersonalMemoryDraft] = useState('');
  const [editingPersonalMemoryId, setEditingPersonalMemoryId] = useState<
    string | null
  >(null);
  const [deletingPersonalMemoryId, setDeletingPersonalMemoryId] = useState<
    string | null
  >(null);
  const [userFollowupsOpen, setUserFollowupsOpen] = useState(false);
  const [userFollowupList, setUserFollowupList] =
    useState<NoemaUserFollowupList | null>(null);
  const [userFollowupLoading, setUserFollowupLoading] = useState(false);
  const [userFollowupBusy, setUserFollowupBusy] = useState(false);
  const [userFollowupError, setUserFollowupError] = useState('');
  const [userFollowupTitle, setUserFollowupTitle] = useState('');
  const [userFollowupBody, setUserFollowupBody] = useState('');
  const [userFollowupDueAt, setUserFollowupDueAt] = useState('');
  const [editingUserFollowupId, setEditingUserFollowupId] = useState<
    string | null
  >(null);
  const [editProviderConfig, setEditProviderConfig] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupAgentIds, setGroupAgentIds] = useState<string[]>(['noema']);
  const [agentName, setAgentName] = useState('');
  const [agentNameError, setAgentNameError] = useState('');
  const [agentHeadline, setAgentHeadline] = useState('');
  const [agentDescription, setAgentDescription] = useState('');
  const [agentProjectWork, setAgentProjectWork] = useState(true);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [updatingAgentProfile, setUpdatingAgentProfile] = useState(false);
  const [updatingAgentId, setUpdatingAgentId] = useState<string | null>(null);
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const [refreshingProvider, setRefreshingProvider] = useState(false);
  const [providerFeedback, setProviderFeedback] = useState<{
    kind: 'error' | 'success';
    message: string;
  } | null>(null);
  const [webSearchApiKey, setWebSearchApiKey] = useState('');
  const [savingWebSearch, setSavingWebSearch] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const groupDraftRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const conversationSearchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const personalMemoryDialogRef = useRef<HTMLElement>(null);
  const userFollowupDialogRef = useRef<HTMLElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const forwardOriginMessageId = useRef<string | null>(null);
  const threadTriggerRef = useRef<HTMLButtonElement>(null);
  const groupTriggerRef = useRef<HTMLButtonElement>(null);
  const projectTriggerRef = useRef<HTMLButtonElement>(null);
  const agentTriggerRef = useRef<HTMLButtonElement>(null);
  const editAgentTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const agentDialogReturnTargetRef = useRef<'settings' | 'edit'>('settings');
  const personalMemoryTriggerRef = useRef<HTMLButtonElement>(null);
  const userFollowupTriggerRef = useRef<HTMLButtonElement>(null);
  const shouldFollowRef = useRef(true);
  const loadSequenceRef = useRef(0);
  const queueDispatchingRef = useRef<string | null>(null);
  const draft = activeRoomId ? (draftsByRoom[activeRoomId] ?? '') : '';
  const draftAttachments = activeRoomId
    ? (draftAttachmentsByRoom[activeRoomId] ?? [])
    : [];
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
  const addDraftAttachments = (files: FileList | null) => {
    if (!activeRoomId || !files?.length) return;
    const selected = Array.from(files);
    const roomFiles = draftAttachmentsByRoom[activeRoomId] ?? [];
    const seen = new Set(
      roomFiles.map(
        (file) => `${file.name}\u0000${file.size}\u0000${file.lastModified}`,
      ),
    );
    const rejected: string[] = [];
    const valid = selected.filter((file) => {
      if (!isSupportedChatAttachment(file)) {
        rejected.push(
          `${file.name}：当前只支持 TXT、Markdown、CSV 和 PDF；图片暂不支持。`,
        );
        return false;
      }
      const sizeLimit = maxChatAttachmentBytes(file);
      if (file.size > sizeLimit) {
        rejected.push(
          file.name.toLowerCase().endsWith('.pdf')
            ? `${file.name}：PDF 附件不能超过 2 MiB。`
            : `${file.name}：单个文本附件不能超过 256 KiB。`,
        );
        return false;
      }
      const key = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
      if (seen.has(key)) {
        rejected.push(`${file.name}：重复附件已忽略。`);
        return false;
      }
      seen.add(key);
      return true;
    });
    const remaining = Math.max(0, MAX_CHAT_ATTACHMENT_COUNT - roomFiles.length);
    const added = valid.slice(0, remaining);
    if (valid.length > remaining) {
      rejected.push(
        `每条消息最多添加 ${MAX_CHAT_ATTACHMENT_COUNT} 个附件；其余文件未加入。`,
      );
    }
    if (added.length) {
      setDraftAttachmentsByRoom((current) => ({
        ...current,
        [activeRoomId]: [...(current[activeRoomId] ?? []), ...added],
      }));
    }
    setNotice(rejected.join('\n'));
  };
  const removeDraftAttachment = (index: number) => {
    if (!activeRoomId) return;
    setDraftAttachmentsByRoom((current) => {
      const nextFiles = [...(current[activeRoomId] ?? [])];
      nextFiles.splice(index, 1);
      const next = { ...current };
      if (nextFiles.length) next[activeRoomId] = nextFiles;
      else delete next[activeRoomId];
      return next;
    });
  };
  const clearDraftAttachments = (roomId: string) => {
    setDraftAttachmentsByRoom((current) => {
      const next = { ...current };
      delete next[roomId];
      return next;
    });
  };
  const refreshState = useCallback(async () => {
    const sequence = ++socialStateRequestSequenceRef.current;
    const next = await window.noema.getSocialState();
    if (sequence !== socialStateRequestSequenceRef.current) {
      return socialStateRef.current ?? next;
    }
    socialStateRef.current = next;
    setState(next);
    setProviderBaseUrl(next.providerBaseUrl);
    const projectSessionStillActive = activeProjectSession
      ? next.projects.some(
          (project) =>
            project.id === activeProjectSession.projectId &&
            project.members.some(
              (member) => member.sessionRoomId === activeProjectSession.roomId,
            ),
        )
      : false;
    if (activeProjectSession && !projectSessionStillActive) {
      setActiveProjectSession(null);
    }
    setActiveRoomId((current) =>
      (current && next.rooms.some((room) => room.id === current)) ||
      (current === activeProjectSession?.roomId && projectSessionStillActive) ||
      next.projects.some((project) => project.groupRoomId === current)
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
    setNewProjectWorkspace(null);
    setProjectAgentIds([]);
    requestAnimationFrame(() => projectTriggerRef.current?.focus());
  }, []);
  const closeAgentDialog = useCallback(() => {
    agentDialogReturnTargetRef.current = editingAgentId ? 'edit' : 'settings';
    setCreateAgentOpen(false);
    setEditingAgentId(null);
    setAgentName('');
    setAgentNameError('');
    setAgentHeadline('');
    setAgentDescription('');
    setAgentProjectWork(true);
    window.setTimeout(() => {
      const target =
        agentDialogReturnTargetRef.current === 'edit'
          ? (editAgentTriggerRef.current ??
            document.querySelector<HTMLButtonElement>(
              '[data-agent-edit-trigger]',
            ))
          : (settingsTriggerRef.current ??
            document.querySelector<HTMLButtonElement>(
              '.sidebar-settings-button',
            ));
      target?.focus({ preventScroll: true });
    }, 0);
  }, [editingAgentId]);
  useEffect(() => {
    if (!settingsOpen) return;
    let active = true;
    void window.noema
      .getExecutionPermissions()
      .then((permissions) => {
        if (active) setExecutionPermissionsState(permissions);
      })
      .catch(() => {
        if (active) setExecutionPermissionsError('无法读取执行权限。');
      });
    return () => {
      active = false;
    };
  }, [settingsOpen]);
  const handleExecutionPermissionsChange = useCallback(
    async (patch: Partial<NoemaExecutionPermissions>) => {
      const previous = executionPermissions;
      setExecutionPermissionsState({ ...previous, ...patch });
      setExecutionPermissionsBusy(true);
      setExecutionPermissionsError('');
      try {
        const saved = await window.noema.setExecutionPermissions(patch);
        setExecutionPermissionsState(saved);
      } catch {
        setExecutionPermissionsState(previous);
        setExecutionPermissionsError('没有保存，请再试一次。');
      } finally {
        setExecutionPermissionsBusy(false);
      }
    },
    [executionPermissions],
  );
  const closeSettingsDialog = useCallback(() => {
    setSettingsOpen(false);
    setEditProviderConfig(false);
    setProviderFeedback(null);
    requestAnimationFrame(() => settingsTriggerRef.current?.focus());
  }, []);
  const refreshPersonalMemories = useCallback(async () => {
    setPersonalMemoryLoading(true);
    setPersonalMemoryError('');
    try {
      setPersonalMemoryList(await window.noema.getPersonalMemories());
    } catch (error) {
      setPersonalMemoryError(
        error instanceof Error ? error.message : '无法读取个人记忆。',
      );
    } finally {
      setPersonalMemoryLoading(false);
    }
  }, []);
  const openPersonalMemories = useCallback(() => {
    setSettingsOpen(false);
    setPersonalMemoryOpen(true);
    void refreshPersonalMemories();
  }, [refreshPersonalMemories]);
  const closePersonalMemories = useCallback(() => {
    setPersonalMemoryOpen(false);
    setPersonalMemoryError('');
    setPersonalMemoryDraft('');
    setEditingPersonalMemoryId(null);
    setDeletingPersonalMemoryId(null);
    requestAnimationFrame(() => personalMemoryTriggerRef.current?.focus());
  }, []);
  const handlePersonalMemoryEnabled = useCallback(
    async (enabled: boolean) => {
      setPersonalMemoryBusy(true);
      setPersonalMemoryError('');
      try {
        await window.noema.setPersonalMemoryEnabled(enabled);
        await refreshPersonalMemories();
      } catch (error) {
        setPersonalMemoryError(
          error instanceof Error ? error.message : '无法更新个人记忆设置。',
        );
      } finally {
        setPersonalMemoryBusy(false);
      }
    },
    [refreshPersonalMemories],
  );
  const savePersonalMemory = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const content = personalMemoryDraft.trim();
      if (!content) return;
      setPersonalMemoryBusy(true);
      setPersonalMemoryError('');
      try {
        if (editingPersonalMemoryId) {
          await window.noema.updatePersonalMemory({
            id: editingPersonalMemoryId,
            content,
          });
        } else {
          await window.noema.addPersonalMemory(content);
        }
        setPersonalMemoryDraft('');
        setEditingPersonalMemoryId(null);
        await refreshPersonalMemories();
      } catch (error) {
        setPersonalMemoryError(
          error instanceof Error ? error.message : '无法保存个人记忆。',
        );
      } finally {
        setPersonalMemoryBusy(false);
      }
    },
    [editingPersonalMemoryId, personalMemoryDraft, refreshPersonalMemories],
  );
  const deletePersonalMemory = useCallback(
    async (id: string) => {
      setPersonalMemoryBusy(true);
      setPersonalMemoryError('');
      try {
        await window.noema.deletePersonalMemory(id);
        setDeletingPersonalMemoryId(null);
        if (editingPersonalMemoryId === id) {
          setEditingPersonalMemoryId(null);
          setPersonalMemoryDraft('');
        }
        await refreshPersonalMemories();
      } catch (error) {
        setPersonalMemoryError(
          error instanceof Error ? error.message : '无法删除个人记忆。',
        );
      } finally {
        setPersonalMemoryBusy(false);
      }
    },
    [editingPersonalMemoryId, refreshPersonalMemories],
  );
  const refreshUserFollowups = useCallback(async () => {
    setUserFollowupLoading(true);
    setUserFollowupError('');
    try {
      setUserFollowupList(await window.noema.getUserFollowups());
    } catch (error) {
      setUserFollowupError(
        error instanceof Error ? error.message : '无法读取回访。',
      );
    } finally {
      setUserFollowupLoading(false);
    }
  }, []);
  const openUserFollowups = useCallback(() => {
    setSettingsOpen(false);
    setUserFollowupsOpen(true);
    void refreshUserFollowups();
  }, [refreshUserFollowups]);
  const closeUserFollowups = useCallback(() => {
    setUserFollowupsOpen(false);
    setUserFollowupError('');
    setUserFollowupTitle('');
    setUserFollowupBody('');
    setUserFollowupDueAt('');
    setEditingUserFollowupId(null);
    requestAnimationFrame(() => userFollowupTriggerRef.current?.focus());
  }, []);
  const handleUserFollowupsEnabled = useCallback(
    async (enabled: boolean) => {
      setUserFollowupBusy(true);
      setUserFollowupError('');
      try {
        await window.noema.setUserFollowupsEnabled(enabled);
        await refreshUserFollowups();
      } catch (error) {
        setUserFollowupError(
          error instanceof Error ? error.message : '无法更新回访设置。',
        );
      } finally {
        setUserFollowupBusy(false);
      }
    },
    [refreshUserFollowups],
  );
  const saveUserFollowup = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setUserFollowupBusy(true);
      setUserFollowupError('');
      try {
        const input = {
          title: userFollowupTitle,
          body: userFollowupBody,
          dueAt: new Date(userFollowupDueAt).toISOString(),
        };
        if (editingUserFollowupId) {
          await window.noema.updateUserFollowup({
            id: editingUserFollowupId,
            ...input,
          });
        } else {
          await window.noema.addUserFollowup(input);
        }
        setUserFollowupTitle('');
        setUserFollowupBody('');
        setUserFollowupDueAt('');
        setEditingUserFollowupId(null);
        await refreshUserFollowups();
      } catch (error) {
        setUserFollowupError(
          error instanceof Error ? error.message : '无法保存回访。',
        );
      } finally {
        setUserFollowupBusy(false);
      }
    },
    [
      editingUserFollowupId,
      refreshUserFollowups,
      userFollowupBody,
      userFollowupDueAt,
      userFollowupTitle,
    ],
  );
  const cancelUserFollowup = useCallback(
    async (id: string) => {
      setUserFollowupBusy(true);
      setUserFollowupError('');
      try {
        const canceled = await window.noema.cancelUserFollowup(id);
        if (!canceled) throw new Error('这条回访已进入发送流程，无法取消。');
        if (editingUserFollowupId === id) {
          setEditingUserFollowupId(null);
          setUserFollowupTitle('');
          setUserFollowupBody('');
          setUserFollowupDueAt('');
        }
        await refreshUserFollowups();
      } catch (error) {
        setUserFollowupError(
          error instanceof Error ? error.message : '无法取消回访。',
        );
      } finally {
        setUserFollowupBusy(false);
      }
    },
    [editingUserFollowupId, refreshUserFollowups],
  );
  const cancelForward = useCallback(() => {
    const originMessageId = forwardOriginMessageId.current;
    forwardOriginMessageId.current = null;
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
  const closeConversationSearch = useCallback(() => {
    setConversationSearchOpen(false);
    setConversationSearchQuery('');
    requestAnimationFrame(() => searchTriggerRef.current?.focus());
  }, []);
  const closeGlobalSearch = useCallback((restoreFocus = true) => {
    globalNavigationSequence.current++;
    setGlobalSearchOpen(false);
    if (restoreFocus)
      requestAnimationFrame(() => {
        const previous = globalSearchReturnFocusRef.current;
        if (previous?.isConnected) previous.focus();
        else globalSearchTriggerRef.current?.focus();
      });
  }, []);
  const openGlobalSearch = useCallback(() => {
    if (document.querySelector('[role="dialog"]')) return;
    globalSearchReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setGlobalSearchOpen(true);
  }, []);
  const openConversationSearch = () => {
    setActiveConversationSearchMatch(null);
    setConversationSearchQuery('');
    setConversationSearchOpen(true);
  };
  const loadRoom = useCallback(
    async (
      roomId: string,
      options: {
        limit?: number;
        beforeSequence?: number;
        aroundMessageId?: string;
      } = { limit: 200 },
    ) => {
      const sequence = ++loadSequenceRef.current;
      try {
        const next = await window.noema.getSocialRoom(roomId, options);
        if (
          sequence === loadSequenceRef.current &&
          activeRoomIdRef.current === roomId
        ) {
          if (options.aroundMessageId) shouldFollowRef.current = false;
          if (
            options.aroundMessageId &&
            next.messageWindow?.targetFound === false
          ) {
            setPendingScrollMessageId(null);
            setPendingConversationSearchNavigation(null);
            setNotice('这条历史来源已移除，无法跳转到原消息。');
            return;
          }
          setRoomState(next);
          setHistoryPageError('');
          void window.noema
            .getSocialContinuityState(roomId)
            .then((nextContinuity) => {
              if (
                sequence === loadSequenceRef.current &&
                activeRoomIdRef.current === roomId
              ) {
                setContinuity(nextContinuity);
              }
            })
            .catch(() => {
              if (sequence === loadSequenceRef.current) setContinuity(null);
            });
        }
      } catch (error) {
        if (
          sequence === loadSequenceRef.current &&
          activeRoomIdRef.current === roomId
        ) {
          if (options.beforeSequence !== undefined) {
            setHistoryPageError(
              error instanceof Error
                ? error.message
                : '无法读取更早的聊天记录。',
            );
          } else {
            if (options.aroundMessageId)
              setPendingConversationSearchNavigation(null);
            setNotice(
              error instanceof Error ? error.message : '无法打开这个聊天。',
            );
          }
        }
      }
    },
    [],
  );
  const loadEarlierMessages = useCallback(async () => {
    const current = roomState;
    const roomId = activeRoomId;
    const oldest = current?.messageWindow?.oldestSequence;
    if (
      !roomId ||
      current?.room.id !== roomId ||
      !current.messageWindow?.hasEarlier ||
      !oldest ||
      historyPageLoading
    )
      return;
    setHistoryPageLoading(true);
    setHistoryPageError('');
    shouldFollowRef.current = false;
    const scroller = conversationRef.current;
    pendingHistoryPrependRef.current = scroller
      ? {
          roomId,
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
        }
      : null;
    try {
      const earlier = await window.noema.getSocialRoom(roomId, {
        limit: 200,
        beforeSequence: Number(oldest),
      });
      if (activeRoomIdRef.current !== roomId) {
        pendingHistoryPrependRef.current = null;
        return;
      }
      setRoomState((latest) => {
        if (latest?.room.id !== roomId) return latest;
        const known = new Set(latest.messages.map((message) => message.id));
        const messages = [
          ...earlier.messages.filter((message) => !known.has(message.id)),
          ...latest.messages,
        ];
        return {
          ...latest,
          messages,
          messageWindow: {
            oldestSequence:
              earlier.messageWindow?.oldestSequence ??
              latest.messageWindow?.oldestSequence ??
              null,
            newestSequence:
              latest.messageWindow?.newestSequence ??
              earlier.messageWindow?.newestSequence ??
              null,
            hasEarlier: earlier.messageWindow?.hasEarlier ?? false,
            hasLater: true,
            targetFound: earlier.messageWindow?.targetFound ?? null,
          },
        };
      });
    } catch (error) {
      pendingHistoryPrependRef.current = null;
      setHistoryPageError(
        error instanceof Error ? error.message : '无法读取更早的聊天记录。',
      );
    } finally {
      if (activeRoomIdRef.current === roomId) setHistoryPageLoading(false);
    }
  }, [activeRoomId, historyPageLoading, roomState]);
  useLayoutEffect(() => {
    const anchor = pendingHistoryPrependRef.current;
    const scroller = conversationRef.current;
    if (!anchor || !scroller || roomState?.room.id !== anchor.roomId) return;
    scroller.scrollTop =
      anchor.scrollTop +
      Math.max(0, scroller.scrollHeight - anchor.scrollHeight);
    pendingHistoryPrependRef.current = null;
  }, [roomState?.messages.length, roomState?.room.id]);
  useEffect(() => {
    void refreshState().catch((error) =>
      setNotice(
        error instanceof Error ? error.message : '无法读取本机聊天数据。',
      ),
    );
  }, [refreshState]);
  useEffect(() => {
    if (!activeRoomId) return;
    setHistoryPageLoading(false);
    setHistoryPageError('');
    if (pendingHistoryPrependRef.current?.roomId !== activeRoomId)
      pendingHistoryPrependRef.current = null;
    const target = pendingRoomTargetRef.current;
    if (target?.roomId === activeRoomId) {
      pendingRoomTargetRef.current = null;
      void loadRoom(activeRoomId, {
        limit: 200,
        aroundMessageId: target.messageId,
      });
    } else void loadRoom(activeRoomId);
  }, [activeRoomId, loadRoom]);
  useEffect(() => {
    const AudioContextClass = window.AudioContext;
    const earcon = createNotificationEarcon(
      AudioContextClass ? () => new AudioContextClass() : null,
    );
    const unlock = () => earcon.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    const unsubscribe = window.noema.onSocialEvent((event) => {
      if (
        event.type === 'chat-turn-completed' &&
        event.notifyUser &&
        !document.hasFocus()
      ) {
        earcon.play();
      }
    });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      unsubscribe();
      earcon.close();
    };
  }, []);
  useEffect(() => {
    const unsubscribe = window.noema.onSocialEvent(
      (event: NoemaSocialEvent) => {
        if (event.type === 'chat-trace') {
          setLiveTrace((current) => {
            if (
              current?.roomId !== event.roomId ||
              current?.messageId !== event.messageId
            ) {
              return {
                roomId: event.roomId,
                messageId: event.messageId,
                taskId: event.taskId,
                events: [event.event],
                done: false,
              };
            }
            const stepId = event.event.stepId;
            if (stepId) {
              const index = current.events.findIndex(
                (item) =>
                  item.stepId === stepId && item.type === event.event.type,
              );
              if (index >= 0) {
                const events = current.events.slice();
                events[index] = {
                  ...events[index],
                  type: event.event.type,
                  status: event.event.status ?? events[index].status,
                  name: event.event.name ?? events[index].name,
                  detail: event.event.detail ?? events[index].detail,
                  output: event.event.output ?? events[index].output,
                };
                return { ...current, events };
              }
            }
            return {
              ...current,
              events: [...current.events, event.event].slice(-16),
            };
          });
          return;
        }
        if (event.type === 'chat-turn-started') {
          setLiveTrace((current) => {
            if (current?.roomId === event.roomId) {
              if (
                current.messageId === event.assistantMessageId ||
                (current.taskId && current.events.length > 0)
              ) {
                return current;
              }
            }
            return {
              roomId: event.roomId,
              messageId: event.assistantMessageId,
              events: [],
            };
          });
          return;
        }
        if (
          event.type === 'chat-turn-completed' ||
          event.type === 'chat-turn-interrupted'
        ) {
          setLiveTrace((current) =>
            current ? { ...current, done: true } : current,
          );
          return;
        }
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
        if (event.type === 'project-work-updated') {
          const status = event.task.status;
          setLiveTrace((current) =>
            current?.taskId === event.task.id &&
            ['completed', 'failed', 'interrupted'].includes(status)
              ? { ...current, done: true }
              : current,
          );
        }
        void refreshState().catch(() => {});
        if (event.type === 'project-growth-archived') {
          setNotice(`「${event.title}」已完成成员经历整理，并归档到历史项目。`);
        }
        if ('roomId' in event && event.roomId === activeRoomId) {
          void loadRoom(event.roomId);
        }
        if (event.type === 'agent-state-updated' && activeRoomId) {
          void loadRoom(activeRoomId);
        }
        if (event.type === 'chat-room-created' && event.navigate !== false) {
          setActiveRoomId(event.roomId);
          setShowRoomList(false);
        }
      },
    );
    return unsubscribe;
  }, [activeRoomId, loadRoom, refreshState]);
  useEffect(() => {
    const unsubscribe = window.noema.onSocialEvent(
      (event: NoemaSocialEvent) => {
        if (event.type !== 'open-followup-source') return;
        void window.noema
          .getSocialState()
          .then((state) => {
            const target = resolveFollowupNavigationTarget(state.rooms, {
              roomId: event.roomId,
              messageId: event.messageId,
            });
            if (!target.room) {
              setNotice('无法打开回访来源聊天。');
              return;
            }
            if (target.messageId) {
              setPendingScrollMessageId(target.messageId);
              if (activeRoomId === target.room.id) {
                void loadRoom(target.room.id, {
                  limit: 200,
                  aroundMessageId: target.messageId,
                });
              } else {
                pendingRoomTargetRef.current = {
                  roomId: target.room.id,
                  messageId: target.messageId,
                };
                selectRoom(target.room);
                shouldFollowRef.current = false;
              }
            } else selectRoom(target.room);
          })
          .catch(() => setNotice('无法打开回访来源聊天。'));
      },
    );
    void window.noema.markSocialChatReady().catch(() => {});
    return unsubscribe;
  }, [activeRoomId, loadRoom, selectRoom]);
  useEffect(() => {
    const unsubscribe = window.noema.onModelStateChanged((event) => {
      if (
        event.type === 'models-updated' ||
        event.type === 'model-selected' ||
        event.type === 'provider-configured' ||
        event.type === 'web-search-configured'
      ) {
        void refreshState().catch(() => {});
      }
    });
    return unsubscribe;
  }, [refreshState]);
  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (event.defaultPrevented || event.isComposing) return;
        event.preventDefault();
        if (globalSearchOpen)
          document.querySelector<HTMLInputElement>('[cmdk-input]')?.focus();
        else openGlobalSearch();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, [globalSearchOpen, openGlobalSearch]);
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
    if (
      !createGroupOpen &&
      !createProjectOpen &&
      !createAgentOpen &&
      !editingAgentId &&
      !settingsOpen &&
      !forwardDialogOpen &&
      !threadDialogOpen &&
      !conversationSearchOpen &&
      !globalSearchOpen &&
      !personalMemoryOpen &&
      !userFollowupsOpen
    ) {
      return;
    }
    const dialog = userFollowupsOpen
      ? userFollowupDialogRef.current
      : personalMemoryOpen
        ? personalMemoryDialogRef.current
        : ([
            ...document.querySelectorAll<HTMLElement>(
              '[role="dialog"][aria-modal="true"]',
            ),
          ].find((candidate) => candidate.getClientRects().length > 0) ??
          dialogRef.current);
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      [
        ...(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []),
      ].filter((element) => element.getClientRects().length > 0);
    const focusFrame = dialog
      ? requestAnimationFrame(() => {
          const initial =
            dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
            focusables()[0];
          initial?.focus();
        })
      : 0;
    const onDialogKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (globalSearchOpen) closeGlobalSearch();
        else if (createGroupOpen) closeGroupDialog();
        else if (createProjectOpen) closeProjectDialog();
        else if (createAgentOpen || editingAgentId) closeAgentDialog();
        else if (forwardDialogOpen) cancelForward();
        else if (threadDialogOpen) closeThreadDialog();
        else if (conversationSearchOpen) closeConversationSearch();
        else if (personalMemoryOpen) closePersonalMemories();
        else if (userFollowupsOpen) closeUserFollowups();
        else closeSettingsDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      if (!dialog) return;
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
    conversationSearchOpen,
    globalSearchOpen,
    personalMemoryOpen,
    userFollowupsOpen,
    closeUserFollowups,
    closePersonalMemories,
    closeGlobalSearch,
    closeGroupDialog,
    closeProjectDialog,
    closeAgentDialog,
    closeSettingsDialog,
    cancelForward,
    closeThreadDialog,
    closeConversationSearch,
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
    if (roomState.messageWindow?.targetFound == null) return;
    const frame = requestAnimationFrame(() => {
      const reviewSelector = `[data-review-message-id="${pendingScrollMessageId}"]`;
      const feedbackSelector = `${reviewSelector} textarea`;
      const messageSelector = `[data-message-id="${pendingScrollMessageId}"]`;
      const target =
        document.querySelector<HTMLElement>(reviewSelector) ??
        document.querySelector<HTMLElement>(messageSelector);
      if (!target) return;
      scrollMessageIntoView(conversationRef.current, target);
      const feedback = document.querySelector<HTMLElement>(feedbackSelector);
      feedback?.focus({ preventScroll: true });
      if (!feedback && target.isConnected) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
      setPendingScrollMessageId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeRoomId, pendingScrollMessageId, roomState]);
  useLayoutEffect(() => {
    const navigation = pendingConversationSearchNavigation;
    if (
      !navigation ||
      navigation.roomId !== activeRoomId ||
      roomState?.room.id !== navigation.roomId ||
      roomState.messageWindow?.targetFound == null
    )
      return;
    const frame = requestAnimationFrame(() => {
      const target = Array.from(
        document.querySelectorAll<HTMLElement>('[data-message-id]'),
      ).find((message) => message.dataset.messageId === navigation.messageId);
      if (!target) return;
      scrollMessageIntoView(conversationRef.current, target);
      setActiveConversationSearchMatch(navigation);
      setPendingConversationSearchNavigation(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    activeRoomId,
    pendingConversationSearchNavigation,
    roomState?.room.id,
    roomState?.messages,
  ]);
  useEffect(() => {
    const match = activeConversationSearchMatch;
    if (!match || match.roomId !== activeRoomId) return;
    const message = Array.from(
      document.querySelectorAll<HTMLElement>('[data-message-id]'),
    ).find((item) => item.dataset.messageId === match.messageId);
    const body = message?.querySelector<HTMLElement>('.message-content');
    if (!body) return;
    return highlightMessageMatches(body, match.query);
  }, [activeConversationSearchMatch, activeRoomId, roomState?.messages]);
  useEffect(() => {
    setActiveConversationSearchMatch((match) =>
      match?.roomId === activeRoomId ? match : null,
    );
    setPendingConversationSearchNavigation((navigation) =>
      navigation?.roomId === activeRoomId ? navigation : null,
    );
  }, [activeRoomId]);
  const agents = state?.agents ?? [];
  const activeAgents = agents.filter((agent) => !agent.archivedAt);
  const projects = state?.projects ?? [];
  const editingAgent = editingAgentId
    ? (agents.find((agent) => agent.id === editingAgentId) ?? null)
    : null;
  const rooms = state?.rooms ?? [];
  const noemaRoom = rooms.find((room) => room.id === 'room-noema') ?? null;
  const currentProjectSessionRoom =
    roomState?.room.id === activeRoomId
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
  const navigateToConversationSearchResult = useCallback(
    (messageId: string) => {
      const query = conversationSearchQuery.trim();
      if (!query || !currentRoom) return;
      setPendingConversationSearchNavigation({
        messageId,
        roomId: currentRoom.id,
        query,
      });
      shouldFollowRef.current = false;
      closeConversationSearch();
      void loadRoom(currentRoom.id, { limit: 200, aroundMessageId: messageId });
    },
    [closeConversationSearch, conversationSearchQuery, currentRoom, loadRoom],
  );
  const members = roomState?.room.id === activeRoomId ? roomState.members : [];
  const messages =
    roomState?.room.id === activeRoomId ? roomState.messages : [];
  const workTasks =
    roomState?.room.id === activeRoomId ? roomState.workTasks : [];
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant');
  const currentRoomQueue = currentRoom
    ? (queuedMessagesByRoom[currentRoom.id] ?? [])
    : [];
  const activeReply = messages.find(
    (message) => message.role === 'assistant' && message.status === 'streaming',
  );
  const currentQueuePaused = Boolean(
    currentRoom &&
    latestAssistantMessage &&
    currentRoomQueue.length > 0 &&
    !activeReply &&
    ['failed', 'interrupted'].includes(latestAssistantMessage.status) &&
    queueResumedAfterByRoom[currentRoom.id] !== latestAssistantMessage.id,
  );
  const messageAgent = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const currentRecipient =
    (currentRoom?.kind === 'group'
      ? members.find((agent) => agent.id === 'noema' && !agent.archivedAt)
      : null) ??
    members.find((agent) => !agent.archivedAt) ??
    members[0] ??
    null;
  const currentRecipientArchived = Boolean(currentRecipient?.archivedAt);
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
    const query = navigationSearch.trim().toLocaleLowerCase();
    if (!query) return rooms;
    return rooms.filter((room) => {
      const participants = room.memberIds
        .map((id) => messageAgent.get(id)?.name ?? '')
        .join(' ');
      return `${room.title} ${participants} ${room.preview?.text ?? ''}`
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [messageAgent, rooms, navigationSearch]);
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
  const projectQuery = navigationSearch.trim().toLocaleLowerCase();
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
  const projectWorkspaceSessionRoomIds = projectWorkspace
    ? projectWorkspace.members
        .filter(
          (member) => member.status === 'active' && member.agentId !== 'noema',
        )
        .map((member) => member.sessionRoomId)
        .join('|')
    : '';
  const loadProjectSessions = useCallback(
    async (project: NoemaSocialProject) => {
      const members = project.members.filter(
        (member) => member.status === 'active' && member.agentId !== 'noema',
      );
      setProjectSessionsById((current) => ({
        ...current,
        [project.id]: {
          loading: true,
          error: null,
          sessions: current[project.id]?.sessions ?? [],
        },
      }));
      const results = await Promise.allSettled(
        members.map((member) =>
          project.status === 'archived'
            ? window.noema.getSocialRoom(member.sessionRoomId).then((room) => ({
                project: {
                  id: project.id,
                  title: project.title,
                  brief: project.brief,
                  status: project.status,
                },
                agentId: member.agentId,
                room,
              }))
            : window.noema.getSocialProjectSession(project.id, member.agentId),
        ),
      );
      const sessions = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const failed = results.some((result) => result.status === 'rejected');
      setProjectSessionsById((current) => ({
        ...current,
        [project.id]: {
          loading: false,
          error: failed ? '部分成员的工作记录暂时无法载入。' : null,
          sessions,
        },
      }));
    },
    [],
  );
  useEffect(() => {
    if (projectWorkspace) void loadProjectSessions(projectWorkspace);
  }, [
    projectWorkspace?.id,
    projectWorkspaceSessionRoomIds,
    loadProjectSessions,
  ]);
  useEffect(() => {
    if (!projectWorkspace) return;
    const roomIds = new Set(
      projectWorkspaceSessionRoomIds.split('|').filter(Boolean),
    );
    return window.noema.onSocialEvent((event: NoemaSocialEvent) => {
      if (
        'roomId' in event &&
        roomIds.has(event.roomId) &&
        event.type !== 'chat-message-delta'
      ) {
        void loadProjectSessions(projectWorkspace);
      }
    });
  }, [
    projectWorkspace?.id,
    projectWorkspaceSessionRoomIds,
    loadProjectSessions,
  ]);
  const projectSessionState = projectWorkspace
    ? projectSessionsById[projectWorkspace.id]
    : undefined;
  const projectSessionTasks = (projectSessionState?.sessions ?? [])
    .flatMap((session) => session.room.workTasks)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const agentWorkspace =
    agents.find((agent) => agent.id === agentWorkspaceId) ?? null;
  const agentWorkspaceProjects = agentWorkspace
    ? projects
        .filter((project) =>
          project.members.some(
            (member) =>
              member.agentId === agentWorkspace.id &&
              member.status === 'active',
          ),
        )
        .sort((left, right) => {
          const statusOrder =
            Number(left.status === 'archived') -
            Number(right.status === 'archived');
          return statusOrder || right.updatedAt.localeCompare(left.updatedAt);
        })
    : [];
  const agentWorkspaceProject = agentWorkspaceProjects[0] ?? null;
  const viewingProjectSession = Boolean(
    activeProjectSession &&
    activeProjectSession.roomId === currentRoom?.id &&
    activeProject?.id === activeProjectSession.projectId,
  );
  useEffect(() => {
    const request = ++conversationSearchRequestRef.current;
    const query = conversationSearchQuery.trim();
    const roomId = currentRoom?.id;
    setConversationSearchError('');
    if (!conversationSearchOpen || !query || !roomId) {
      setConversationSearchLoading(false);
      setConversationSearchResponse({ roomId: roomId ?? '', query, items: [] });
      return;
    }
    setConversationSearchLoading(true);
    const timer = window.setTimeout(() => {
      void window.noema
        .searchSocialRoomMessages(roomId, query)
        .then((items) => {
          if (request === conversationSearchRequestRef.current)
            setConversationSearchResponse({ roomId, query, items });
        })
        .catch((error: unknown) => {
          if (request === conversationSearchRequestRef.current) {
            setConversationSearchResponse({ roomId, query, items: [] });
            setConversationSearchError(
              error instanceof Error ? error.message : '当前聊天搜索失败。',
            );
          }
        })
        .finally(() => {
          if (request === conversationSearchRequestRef.current)
            setConversationSearchLoading(false);
        });
    }, 160);
    return () => {
      clearTimeout(timer);
      conversationSearchRequestRef.current++;
    };
  }, [
    conversationSearchOpen,
    conversationSearchQuery,
    conversationSearchRetry,
    currentRoom?.id,
  ]);
  const conversationSearchResults =
    conversationSearchResponse.roomId === currentRoom?.id &&
    conversationSearchResponse.query === conversationSearchQuery.trim()
      ? conversationSearchResponse.items
      : [];
  const retryConversationSearch = () =>
    setConversationSearchRetry((attempt) => attempt + 1);
  const renderRoomListItem = (room: NoemaSocialRoom) => {
    const agent = messageAgent.get(room.memberIds[0] ?? '');
    const selected =
      !projectWorkspaceId &&
      !agentWorkspaceId &&
      !archivedProjectsOpen &&
      room.id === activeRoomId;
    return (
      <NoemaButton
        key={room.id}
        type="button"
        className={`index-item room-list-item ${selected ? 'selected' : ''}`}
        aria-current={selected ? 'page' : undefined}
        title={room.title}
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
            {room.kind === 'direct' ? (
              agent?.kind === 'core' ? (
                '你的个人伙伴'
              ) : (
                <>
                  {agent?.capabilities?.includes('project-work') ? (
                    <span className="member-capability">可执行</span>
                  ) : null}
                  {agent?.headline || '常驻私聊'}
                </>
              )
            ) : (
              room.preview?.text || '独立的群聊记录'
            )}
          </small>
        </span>
      </NoemaButton>
    );
  };
  const openAgentWorkspace = (agentId: string) => {
    setArchivedProjectsOpen(false);
    setProjectWorkspaceId(null);
    setAgentWorkspaceId(agentId);
    setActiveProjectSession(null);
    setReplyTarget(null);
    setSelectedForwardMessageIds([]);
    setActiveRoomId('room-noema');
    setShowRoomList(false);
    shouldFollowRef.current = true;
  };
  const openHistorySource = (source: NoemaSocialHistorySource) => {
    const room = rooms.find((candidate) => candidate.id === source.roomId);
    if (!room) {
      setNotice('这条历史来源所在的聊天空间已不可用。');
      return;
    }
    setPendingScrollMessageId(source.id);
    if (activeRoomId === room.id) {
      void loadRoom(room.id, { limit: 200, aroundMessageId: source.id });
    } else {
      pendingRoomTargetRef.current = { roomId: room.id, messageId: source.id };
      selectRoom(room);
      shouldFollowRef.current = false;
    }
  };
  const focusPendingReviewFeedback = (messageId: string) => {
    const feedbackSelector = `[data-review-message-id="${messageId}"] textarea`;
    const targetSelector = `[data-review-message-id="${messageId}"]`;
    const focusFeedback = () => {
      const feedback = document.querySelector<HTMLElement>(feedbackSelector);
      if (!feedback?.isConnected || !feedback.getClientRects().length) {
        return false;
      }
      scrollMessageIntoView(conversationRef.current, feedback);
      feedback.focus({ preventScroll: true });
      return true;
    };
    if (focusFeedback()) return;
    const observer = new MutationObserver(() => {
      if (focusFeedback()) {
        observer.disconnect();
        window.clearTimeout(timeout);
        setPendingScrollMessageId(null);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      const target = document.querySelector<HTMLElement>(targetSelector);
      if (target?.isConnected) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
      setPendingScrollMessageId(null);
    }, 5_000);
  };
  const handleSend = async (
    event?: FormEvent,
    overrideText?: string,
    options?: { fromEdit?: boolean },
  ) => {
    event?.preventDefault();
    const sourceText = overrideText ?? draft;
    if (
      !currentRoom ||
      !currentRecipient ||
      (!sourceText.trim() && draftAttachments.length === 0) ||
      (busy && !activeReply && !options?.fromEdit)
    ) {
      return;
    }
    const routing =
      currentRoom.kind === 'group' &&
      activeProject?.groupRoomId !== currentRoom.id
        ? resolveGroupRecipient(sourceText, members, currentRecipient.id)
        : { agent: currentRecipient, error: null };
    if (routing.error) {
      setNotice(routing.error);
      return;
    }
    const recipient = routing.agent ?? currentRecipient;
    if (recipient.archivedAt) {
      setNotice('这位联系人已归档；恢复后才能继续聊天。');
      return;
    }
    const roomId = currentRoom.id;
    const text = sourceText;
    const persistentProjectQueue =
      currentRoom.kind === 'group' && activeProject?.groupRoomId === roomId;
    if (
      activeReply &&
      !persistentProjectQueue &&
      currentRoomQueue.length >= 20
    ) {
      setNotice('最多暂存 20 条待发消息。');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const preparedMessage = await prepareChatMessage(text, draftAttachments, {
        extractPdfText: (file) =>
          extractChatPdfText(file, {
            pdfjs,
            workerSrc: pdfWorkerUrl,
            maxCharacters: MAX_CHAT_ATTACHMENT_CHARACTERS,
          }),
      });
      const messageText = preparedMessage;
      if (activeReply && !persistentProjectQueue) {
        setQueuedMessagesByRoom((current) => {
          const queue = current[roomId] ?? [];
          return {
            ...current,
            [roomId]: [
              ...queue,
              {
                id: crypto.randomUUID(),
                roomId,
                agentId: recipient.id,
                text: messageText,
                replyToMessageId: replyTarget?.id ?? null,
                error: null,
              },
            ],
          };
        });
        setRoomDraft(roomId, '');
        clearDraftAttachments(roomId);
        setReplyTarget(null);
        if (draftRef.current) draftRef.current.style.height = 'auto';
        setNotice('已加入队列。');
        return;
      }
      shouldFollowRef.current = true;
      setLiveTrace(null);
      const sent = await window.noema.sendSocialMessage({
        roomId,
        agentId: recipient.id,
        text: messageText,
        replyToMessageId: replyTarget?.id ?? null,
      });
      const currentAttachments =
        draftAttachmentsByRoomRef.current[roomId] ?? [];
      const attachmentsUnchanged =
        currentAttachments.length === draftAttachments.length &&
        currentAttachments.every(
          (file, index) => file === draftAttachments[index],
        );
      if (draftsByRoomRef.current[roomId] === text && attachmentsUnchanged) {
        setRoomDraft(roomId, '');
        clearDraftAttachments(roomId);
      }
      setReplyTarget(null);
      if (draftRef.current) draftRef.current.style.height = 'auto';
      if (sent.queued) {
        setNotice('群消息已保存；点名成员会在当前工作边界收到。');
      }
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
  const rewindAndResend = async (messageId: string, text: string) => {
    if (!currentRoom || busy || activeReply) return;
    try {
      setBusy(true);
      setNotice('');
      await window.noema.rewindSocialMessage(currentRoom.id, messageId);
      setLiveTrace(null);
      await loadRoom(currentRoom.id);
      await handleSend(undefined, text, { fromEdit: true });
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '消息没有修改，请重试。',
      );
    } finally {
      setBusy(false);
    }
  };
  const saveAssistantEdit = async (messageId: string, text: string) => {
    if (!currentRoom || busy || activeReply) return;
    try {
      setBusy(true);
      setNotice('');
      await window.noema.editSocialAssistantMessage(
        currentRoom.id,
        messageId,
        text,
      );
      setLiveTrace(null);
      await loadRoom(currentRoom.id);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '回复没有修改，请重试。',
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const currentRoomId = currentRoom?.id;
    const queued = currentRoomId
      ? queuedMessagesByRoom[currentRoomId]?.[0]
      : null;
    if (
      !queued ||
      queued.error ||
      currentQueuePaused ||
      activeReply ||
      busy ||
      queueDispatchingRef.current
    ) {
      return;
    }
    queueDispatchingRef.current = queued.id;
    setBusy(true);
    void window.noema
      .sendSocialMessage({
        roomId: queued.roomId,
        agentId: queued.agentId,
        text: queued.text,
        replyToMessageId: queued.replyToMessageId,
      })
      .then(async () => {
        setQueuedMessagesByRoom((current) => {
          const remaining = (current[queued.roomId] ?? []).filter(
            (item) => item.id !== queued.id,
          );
          const next = { ...current };
          if (remaining.length) next[queued.roomId] = remaining;
          else delete next[queued.roomId];
          return next;
        });
        await Promise.all([refreshState(), loadRoom(queued.roomId)]);
      })
      .catch((error: unknown) => {
        setQueuedMessagesByRoom((current) => ({
          ...current,
          [queued.roomId]: (current[queued.roomId] ?? []).map((item) =>
            item.id === queued.id
              ? {
                  ...item,
                  error:
                    error instanceof Error
                      ? error.message
                      : '消息没有发送，请重试。',
                }
              : item,
          ),
        }));
      })
      .finally(() => {
        queueDispatchingRef.current = null;
        setBusy(false);
      });
  }, [
    activeReply,
    busy,
    currentRoom?.id,
    loadRoom,
    currentQueuePaused,
    messages,
    queuedMessagesByRoom,
    refreshState,
  ]);
  const resumeCurrentQueue = () => {
    if (!currentRoom || !latestAssistantMessage) return;
    setQueueResumedAfterByRoom((current) => ({
      ...current,
      [currentRoom.id]: latestAssistantMessage.id,
    }));
  };
  const openForwardDialog = (messageIds = selectedForwardMessageIds) => {
    if (!currentRoom || messageIds.length === 0) return;
    const targetRooms = rooms.filter(
      (room) =>
        room.id !== currentRoom.id &&
        room.memberIds.some((id) =>
          state?.agents.some((agent) => agent.id === id && !agent.archivedAt),
        ),
    );
    const targetRoom = targetRooms[0];
    if (!targetRoom) {
      setNotice('没有可转发的聊天。');
      return;
    }
    setForwardTargetRoomId(targetRoom.id);
    setForwardDialogOpen(true);
  };
  const forwardMessage = (message: NoemaSocialMessage) => {
    if (
      !currentRoom ||
      !['user', 'assistant'].includes(message.role) ||
      message.status !== 'complete'
    ) {
      return;
    }
    forwardOriginMessageId.current = message.id;
    setSelectedForwardMessageIds([message.id]);
    openForwardDialog([message.id]);
  };
  const startThread = (message: NoemaSocialMessage) => {
    if (message.role !== 'user' || message.status !== 'complete') return;
    if (document.activeElement instanceof HTMLButtonElement) {
      threadTriggerRef.current = document.activeElement;
    }
    forwardOriginMessageId.current = message.id;
    setSelectedForwardMessageIds([message.id]);
    const initial = message.content.replace(/\s+/gu, ' ').trim().slice(0, 80);
    setThreadTitle(initial || '未命名主题');
    setThreadDialogOpen(true);
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
  const handleStopProjectWork = async (task: NoemaSocialWorkTask) => {
    try {
      await window.noema.stopSocialWorkTask(task.id);
      await loadRoom(task.roomId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '任务没有停止。');
    }
  };
  const handleResumeProjectWork = async (task: NoemaSocialWorkTask) => {
    try {
      await window.noema.resumeSocialWorkTask(task.id);
      await loadRoom(task.roomId);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '任务无法从检查点继续。',
      );
    }
  };
  const handleContinueProjectWork = async (task: NoemaSocialWorkTask) => {
    try {
      await window.noema.continueSocialWorkTask(task.id);
      await loadRoom(task.roomId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '这项工单无法继续。');
    }
  };
  const handleReviewProjectFileChange = async (
    task: NoemaSocialWorkTask,
    changeId: string,
    action: 'keep' | 'revert',
  ) => {
    try {
      const updated = await window.noema.reviewSocialWorkFileChange({
        taskId: task.id,
        changeId,
        action,
      });
      await loadRoom(task.roomId);
      const state = updated.fileChanges.find(
        (change) => change.id === changeId,
      )?.state;
      setNotice(
        state === 'kept'
          ? '当前文件已保留。'
          : state === 'reverted'
            ? '文件修改已安全撤回。'
            : state === 'not_applied'
              ? '记录显示这次写入没有生效。'
              : '文件状态已核对，请查看任务卡片中的结果。',
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '文件变更没有处理。');
      await loadRoom(task.roomId);
    }
  };
  const handleReviewProjectGitState = async (taskId: string) => {
    try {
      const review = await window.noema.reviewSocialWorkGitState(taskId);
      setGitReviewsByTask((current) => ({ ...current, [taskId]: review }));
      if (!review.available) setNotice('Git 工作区状态暂不可用。');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Git 工作区状态读取失败。',
      );
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
  const handleRetry = useCallback(
    async (message: NoemaSocialMessage) => {
      setNotice('');
      try {
        await window.noema.retrySocialReply(message.id);
        await loadRoom(message.roomId);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '重试没有启动。');
      }
    },
    [loadRoom],
  );
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
  const chooseProjectWorkspace = async () => {
    setProjectBusy(true);
    setNotice('');
    try {
      const selection = await window.noema.chooseProjectWorkspace();
      if (selection) setNewProjectWorkspace(selection);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '没有选择文件夹。');
    } finally {
      setProjectBusy(false);
    }
  };
  const handleCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    const eligibleAgentIds = projectAgentIds.filter((agentId) =>
      activeAgents.some((agent) => agent.id === agentId),
    );
    if (!eligibleAgentIds.length) {
      setNotice('项目至少需要一位专业联系人。');
      return;
    }
    if (!newProjectWorkspace) {
      setNotice('先选择工作文件夹。');
      return;
    }
    setProjectBusy(true);
    setNotice('');
    try {
      const project = await window.noema.createSocialProject({
        title: projectTitle.trim(),
        brief: projectBrief.trim(),
        agentIds: ['noema', ...eligibleAgentIds],
        workspacePath: newProjectWorkspace.workspacePath,
        workspaceIdentity: newProjectWorkspace.identity,
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
      await refreshState();
      setProjectWorkspaceId(project.id);
      setArchivedProjectsOpen(false);
      setProjectTab('delivery');
      setAgentWorkspaceId(null);
      setActiveProjectSession(null);
      setReplyTarget(null);
      setActiveRoomId(project.groupRoomId);
      setShowRoomList(false);
      shouldFollowRef.current = true;
      await loadRoom(project.groupRoomId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法打开这个项目。');
    }
  };
  const openProjectEvidenceMessage = (messageId: string) => {
    if (!projectWorkspace) return;
    setPendingScrollMessageId(messageId);
    setProjectTab('group');
    setActiveProjectSession(null);
    setReplyTarget(null);
    setSelectedForwardMessageIds([]);
    shouldFollowRef.current = false;
    if (activeRoomId !== projectWorkspace.groupRoomId)
      setActiveRoomId(projectWorkspace.groupRoomId);
  };
  const openProjectMemberSession = async (
    project: NoemaSocialProject,
    agentId: string,
  ) => {
    setNotice('');
    try {
      const membership = project.members.find(
        (member) => member.agentId === agentId,
      );
      const session =
        project.status === 'archived' && membership
          ? { room: await window.noema.getSocialRoom(membership.sessionRoomId) }
          : await window.noema.getSocialProjectSession(project.id, agentId);
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
      setReplyTarget(null);
      setSelectedForwardMessageIds([]);
      setShowRoomList(false);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '无法打开成员的项目会话。',
      );
    }
  };
  const openGlobalSearchSource = async (
    roomId: string,
    message?: NoemaSocialSearchResult,
  ) => {
    const navigation = globalNavigationSequence.current;
    const source = await window.noema.getSocialRoom(
      roomId,
      message ? { limit: 200, aroundMessageId: message.id } : { limit: 200 },
    );
    if (navigation !== globalNavigationSequence.current)
      throw new DOMException('搜索已关闭。', 'AbortError');
    if (
      message &&
      (source.messageWindow?.targetFound === false ||
        !source.messages.some((item) => item.id === message.id))
    )
      throw new Error('这条消息已移除，请重新搜索。');
    const project = projects.find(
      (item) =>
        item.groupRoomId === roomId ||
        item.members.some((member) => member.sessionRoomId === roomId),
    );
    const membership = project?.members.find(
      (member) => member.sessionRoomId === roomId,
    );
    setProjectWorkspaceId(project?.groupRoomId === roomId ? project.id : null);
    setActiveProjectSession(
      project && membership
        ? { projectId: project.id, agentId: membership.agentId, roomId }
        : null,
    );
    setProjectTab('group');
    setAgentWorkspaceId(null);
    setArchivedProjectsOpen(false);
    setReplyTarget(null);
    setSelectedForwardMessageIds([]);
    shouldFollowRef.current = !message;
    if (activeRoomId === roomId) setRoomState(source);
    else if (message)
      pendingRoomTargetRef.current = { roomId, messageId: message.id };
    setActiveRoomId(roomId);
    setShowRoomList(false);
    if (message) {
      setPendingScrollMessageId(message.id);
    } else requestAnimationFrame(() => draftRef.current?.focus());
  };
  const restoreCurrentProject = async (project: NoemaSocialProject) => {
    if (projectStatusBusy) return;
    setProjectStatusBusy(true);
    try {
      await window.noema.restoreSocialProject(project.id);
      await refreshState();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '恢复失败。');
    } finally {
      setProjectStatusBusy(false);
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
  const retryProjectGrowthMember = async (
    project: NoemaSocialProject,
    agentId: string,
  ) => {
    const batch = project.growthBatch;
    if (!batch || projectStatusBusy) return;
    setProjectStatusBusy(true);
    setNotice('');
    try {
      await window.noema.retrySocialProjectGrowthMember(batch.id, agentId);
      await refreshState();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '成员经历整理未能重试。',
      );
    } finally {
      setProjectStatusBusy(false);
    }
  };
  const handleAgentNameChange = (value: string) => {
    setAgentName(value);
    if (agentNameError) setAgentNameError('');
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
        projectWork: true,
      });
      setCreateAgentOpen(false);
      setAgentName('');
      setAgentNameError('');
      setAgentHeadline('');
      setAgentDescription('');
      setAgentProjectWork(true);
      setActiveRoomId(room.room.id);
      setShowRoomList(false);
      await Promise.all([refreshState(), loadRoom(room.room.id)]);
      requestAnimationFrame(() => draftRef.current?.focus());
    } catch (error) {
      const message = socialErrorMessage(error, '联系人没有创建成功。');
      if (/已有联系人使用这个名称/u.test(message)) {
        setAgentNameError(message);
      } else {
        setNotice(message);
      }
    } finally {
      setCreatingAgent(false);
    }
  };
  const openAgentProfileEditor = (agent: NoemaSocialAgent) => {
    setAgentName(agent.name);
    setAgentNameError('');
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
      setAgentNameError('');
      setAgentHeadline('');
      setAgentDescription('');
      if (activeRoomId) {
        await Promise.all([refreshState(), loadRoom(activeRoomId)]);
      }
      setNotice('资料已更新；之后开始的新回复会使用这些资料。');
      requestAnimationFrame(() => editAgentTriggerRef.current?.focus());
    } catch (error) {
      const message = socialErrorMessage(error, '联系人资料没有更新。');
      if (/已有联系人使用这个名称/u.test(message)) {
        setAgentNameError(message);
      } else {
        setNotice(message);
      }
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
      setNotice(
        nextEnabled
          ? `${agent.name}可以在对话中承接文件任务；启动前会请你选择工作目录。`
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
    setProviderFeedback(null);
    setEditProviderConfig(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        dialogRef.current
          ?.querySelector<HTMLInputElement>('[data-dialog-initial-focus]')
          ?.focus(),
      ),
    );
  };
  const refreshProviderModels = async () => {
    setRefreshingProvider(true);
    setProviderFeedback(null);
    try {
      const result = await window.noema.refreshModels();
      await refreshState();
      if (
        result.error ||
        result.connected !== true ||
        (result.models?.length ?? 0) === 0
      ) {
        setProviderFeedback({
          kind: 'error',
          message:
            result.error ??
            '连接未建立或没有可用模型。请检查服务地址、网络和凭据。',
        });
      } else {
        setProviderFeedback({ kind: 'success', message: '模型列表已更新。' });
      }
    } catch (error) {
      setProviderFeedback({
        kind: 'error',
        message:
          error instanceof Error ? error.message : '重新检查失败，请重试。',
      });
    } finally {
      setRefreshingProvider(false);
    }
  };
  const handleProviderSave = async (event: FormEvent) => {
    event.preventDefault();
    setSavingProvider(true);
    setProviderFeedback(null);
    try {
      const result = await window.noema.configureProvider({
        baseUrl: providerBaseUrl,
        apiKey: providerApiKey,
      });
      setProviderApiKey('');
      setEditProviderConfig(false);
      await refreshState();
      if (
        result.error ||
        result.connected !== true ||
        (result.models?.length ?? 0) === 0
      ) {
        setProviderFeedback({
          kind: 'error',
          message:
            result.error ??
            '连接未建立或没有可用模型。请检查服务地址、网络和凭据。',
        });
        return;
      }
      setSettingsOpen(false);
      requestAnimationFrame(() => settingsTriggerRef.current?.focus());
    } catch (error) {
      setProviderFeedback({
        kind: 'error',
        message:
          error instanceof Error ? error.message : '连接没有保存，请重试。',
      });
    } finally {
      setSavingProvider(false);
    }
  };
  const handleWebSearchSave = async () => {
    if (!webSearchApiKey.trim()) return;
    setSavingWebSearch(true);
    setNotice('');
    try {
      await window.noema.configureWebSearch({ apiKey: webSearchApiKey });
      setWebSearchApiKey('');
      await refreshState();
      setNotice('网页搜索已配置；符合本轮请求时最多搜索一次。');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '网页搜索配置没有保存。',
      );
    } finally {
      setSavingWebSearch(false);
    }
  };
  const handleWebSearchClear = async () => {
    setSavingWebSearch(true);
    setNotice('');
    try {
      await window.noema.clearWebSearch();
      setWebSearchApiKey('');
      await refreshState();
      setNotice('网页搜索凭据已从本机移除。');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '网页搜索凭据没有移除。',
      );
    } finally {
      setSavingWebSearch(false);
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
      ? '配置模型服务后即可开始聊天。'
      : !state?.connected || modelOptions.length === 0
        ? (state?.error ?? '当前没有可用模型。')
        : activeRouteUnavailable
          ? activeRoute?.executionStatus === 'needsKey'
            ? '所选模型需要配置服务商密钥。可以切换其他可用模型，或检查模型服务设置。'
            : '所选模型最近报告额度已耗尽。可以切换其他模型后继续。'
          : null;
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
  const submitProjectReview = async (review: NoemaSocialProjectReview) => {
    if (busy || activeReply)
      throw new Error('请等待当前回复结束，再提交反馈。');
    setBusy(true);
    try {
      await window.noema.sendSocialMessage({
        roomId: review.roomId,
        agentId: 'noema',
        text: draftsByRoom[`review:${review.id}`] ?? '',
        reviewRequestId: review.id,
      });
      setRoomDraft(`review:${review.id}`, '');
      await Promise.all([refreshState(), loadRoom(review.roomId)]);
    } finally {
      setBusy(false);
    }
  };
  const resetChat = async () => {
    const reset = await window.noema.resetSocialChat();
    if (!reset) return false;
    setLiveTrace(null);
    setNotice('已开始新会话，之前的上下文不再带入。');
    await loadRoom('room-noema');
    return true;
  };

  return {
    resetChat,
    liveTrace,
    messageAgent,
    handleStopProjectWork,
    handleResumeProjectWork,
    handleContinueProjectWork,
    handleReviewProjectFileChange,
    handleReviewProjectGitState,
    gitReviewsByTask,
    handleDisableCaseReuse,
    handleWithdrawPracticeCandidate,
    projects,
    openProjectMemberSession,
    rooms,
    selectRoom,
    setReplyTarget,
    cancelForward,
    forwardMessage,
    setRoomDraft,
    draftRef,
    conversationTurns,
    navigation,
    showRoomList,
    projectWorkspace,
    agentWorkspace,
    archivedProjectsOpen,
    providerReady,
    activeProject,
    activeProjectSession,
    currentRoom,
    currentRecipient,
    currentRecipientArchived,
    draft,
    draftAttachments,
    busy,
    roomState,
    historyPageLoading,
    historyPageError,
    loadEarlierMessages,
    noemaRoom,
    conversationRef,
    shouldFollowRef,
    setShowJumpToLatest,
    members,
    viewingProjectSession,
    messages,
    workTasks,
    setState,
    handleRetry,
    openHistorySource,
    focusPendingReviewFeedback,
    selectedForwardMessageIds,
    childThreads,
    draftsByRoom,
    submitProjectReview,
    activeReply,
    showJumpToLatest,
    handleSend,
    rewindAndResend,
    saveAssistantEdit,
    continuity,
    notice,
    setNotice,
    providerWarning,
    setSettingsOpen,
    state,
    threadTriggerRef,
    openThreadDialog,
    startThread,
    openForwardDialog,
    replyTarget,
    currentQueuePaused,
    currentRoomQueue,
    resumeCurrentQueue,
    handleStop,
    setQueuedMessagesByRoom,
    groupDraftRef,
    removeDraftAttachment,
    setDraft,
    handleComposerKeyDown,
    attachmentInputRef,
    addDraftAttachments,
    activeRoute,
    activeModel,
    shellRef,
    setShowRoomList,
    globalSearchTriggerRef,
    openGlobalSearch,
    windowMaximized,
    setWindowMaximized,
    searchRef,
    navigationSearch,
    setNavigationSearch,
    renderRoomListItem,
    memberRooms,
    otherConversationRooms,
    activeProjects,
    projectWorkspaceId,
    openProject,
    setArchivedProjectsOpen,
    setProjectWorkspaceId,
    setAgentWorkspaceId,
    archivedProjects,
    settingsTriggerRef,
    personalMemoryTriggerRef,
    userFollowupTriggerRef,
    personalMemoryDialogRef,
    userFollowupDialogRef,
    setProjectTab,
    searchTriggerRef,
    openConversationSearch,
    openAgentWorkspace,
    setPendingScrollMessageId,
    handleThreadStatus,
    threadStatusBusy,
    handleDeleteThread,
    projectTab,
    agents,
    projectStatusBusy,
    retryProjectGrowthMember,
    openProjectEvidenceMessage,
    projectSessionTasks,
    projectSessionState,
    loadProjectSessions,
    restoreCurrentProject,
    archiveCurrentProject,
    agentWorkspaceProject,
    updatingAgentId,
    handleToggleAgentProjectWork,
    openAgentProfileEditor,
    handleToggleAgentArchive,
    globalSearchOpen,
    dialogRef,
    closeGlobalSearch,
    openGlobalSearchSource,
    conversationSearchOpen,
    closeConversationSearch,
    activeConversationSearchMatch,
    conversationSearchRef,
    conversationSearchQuery,
    setConversationSearchQuery,
    conversationSearchResults,
    conversationSearchLoading,
    conversationSearchError,
    retryConversationSearch,
    navigateToConversationSearchResult,
    forwardDialogOpen,
    handleForward,
    selectedForwardMessages,
    forwardTargetRoomId,
    chooseForwardRoom,
    forwardableRooms,
    forwardBusy,
    forwardTargetRoom,
    threadDialogOpen,
    threadBusy,
    closeThreadDialog,
    handleCreateThread,
    threadTitle,
    setThreadTitle,
    createAgentOpen,
    editingAgentId,
    closeAgentDialog,
    handleUpdateAgentProfile,
    handleCreateAgent,
    editingAgent,
    agentName,
    setAgentName,
    agentNameError,
    handleAgentNameChange,
    creatingAgent,
    updatingAgentProfile,
    agentHeadline,
    setAgentHeadline,
    agentDescription,
    setAgentDescription,
    agentProjectWork,
    setAgentProjectWork,
    createGroupOpen,
    closeGroupDialog,
    handleCreateGroup,
    groupTitle,
    setGroupTitle,
    activeAgents,
    groupAgentIds,
    toggleGroupAgent,
    createProjectOpen,
    closeProjectDialog,
    handleCreateProject,
    projectTitle,
    setProjectTitle,
    projectBrief,
    setProjectBrief,
    newProjectWorkspace,
    setNewProjectWorkspace,
    chooseProjectWorkspace,
    projectAgentIds,
    setProjectAgentIds,
    projectBusy,
    settingsOpen,
    executionPermissions,
    executionPermissionsBusy,
    executionPermissionsError,
    handleExecutionPermissionsChange,
    closeSettingsDialog,
    openPersonalMemories,
    personalMemoryOpen,
    closePersonalMemories,
    personalMemoryList,
    personalMemoryLoading,
    refreshPersonalMemories,
    personalMemoryBusy,
    personalMemoryError,
    setPersonalMemoryError,
    personalMemoryDraft,
    setPersonalMemoryDraft,
    editingPersonalMemoryId,
    setEditingPersonalMemoryId,
    deletingPersonalMemoryId,
    setDeletingPersonalMemoryId,
    handlePersonalMemoryEnabled,
    savePersonalMemory,
    deletePersonalMemory,
    openUserFollowups,
    userFollowupsOpen,
    closeUserFollowups,
    userFollowupList,
    userFollowupLoading,
    refreshUserFollowups,
    userFollowupBusy,
    userFollowupError,
    setUserFollowupError,
    userFollowupTitle,
    setUserFollowupTitle,
    userFollowupBody,
    setUserFollowupBody,
    userFollowupDueAt,
    setUserFollowupDueAt,
    editingUserFollowupId,
    setEditingUserFollowupId,
    handleUserFollowupsEnabled,
    saveUserFollowup,
    cancelUserFollowup,
    handleProviderSave,
    refreshProviderModels,
    refreshingProvider,
    providerFeedback,
    setProviderFeedback,
    agentTriggerRef,
    editAgentTriggerRef,
    setCreateAgentOpen,
    groupTriggerRef,
    setCreateGroupOpen,
    projectTriggerRef,
    setCreateProjectOpen,
    editProviderConfig,
    modelOptions,
    beginProviderEdit,
    providerBaseUrl,
    setProviderBaseUrl,
    providerApiKey,
    setProviderApiKey,
    switchingModel,
    handleModelChange,
    savingWebSearch,
    handleWebSearchClear,
    webSearchApiKey,
    setWebSearchApiKey,
    handleWebSearchSave,
    savingProvider,
  };
}
export type SocialChatController = ReturnType<typeof useSocialChatController>;
