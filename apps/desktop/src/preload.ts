import { contextBridge, ipcRenderer } from 'electron';
import type {
  NoemaQuickCaptureRequest,
  NoemaQuickCaptureShortcutStatus,
  NoemaRootEvent,
  NoemaRootState,
  NoemaSocialEvent,
  NoemaSocialRoomState,
  NoemaSocialState,
} from './noema-bridge.d.ts';

const bridge = {
  appVersion: process.env.npm_package_version ?? '0.1.0',
  getRootState: (): Promise<NoemaRootState> =>
    ipcRenderer.invoke('noema:root-state'),
  getSocialState: (): Promise<NoemaSocialState> =>
    ipcRenderer.invoke('noema:social-state'),
  getSocialRoom: (roomId: string): Promise<NoemaSocialRoomState> =>
    ipcRenderer.invoke('noema:social-room', roomId),
  createSocialGroup: (input: { title: string; agentIds: string[] }) =>
    ipcRenderer.invoke('noema:social-create-group', input),
  createSocialAgent: (input: {
    name: string;
    headline: string;
    description: string;
    projectWork: boolean;
  }) => ipcRenderer.invoke('noema:social-create-agent', input),
  setSocialAgentProjectWork: (agentId: string, enabled: boolean) =>
    ipcRenderer.invoke('noema:social-agent-project-work', agentId, enabled),
  setSocialAgentArchived: (agentId: string, archived: boolean) =>
    ipcRenderer.invoke('noema:social-agent-archive', agentId, archived),
  sendSocialMessage: (input: {
    roomId: string;
    agentId: string;
    text: string;
    sourceRoomId?: string | null;
    sourceIds?: string[];
    replyToMessageId?: string | null;
  }) => ipcRenderer.invoke('noema:social-send', input),
  stopSocialReply: (messageId: string) =>
    ipcRenderer.invoke('noema:social-stop', messageId),
  retrySocialReply: (messageId: string) =>
    ipcRenderer.invoke('noema:social-retry', messageId),
  startSocialWorkTask: (input: {
    roomId: string;
    agentId: string;
    prompt: string;
    reuseCase: boolean;
  }) => ipcRenderer.invoke('noema:social-work-start', input),
  stopSocialWorkTask: (taskId: string) =>
    ipcRenderer.invoke('noema:social-work-stop', taskId),
  setSocialWorkCaseEligible: (taskId: string, eligible: boolean) =>
    ipcRenderer.invoke('noema:social-work-case-eligible', taskId, eligible),
  refreshModels: () => ipcRenderer.invoke('noema:refresh-models'),
  configureProvider: (configuration: { baseUrl: string; apiKey: string }) =>
    ipcRenderer.invoke('noema:configure-provider', configuration),
  selectModel: (model: string) =>
    ipcRenderer.invoke('noema:select-model', model),
  sendMessage: (text: string) => ipcRenderer.invoke('noema:send-message', text),
  saveCapture: (text: string) => ipcRenderer.invoke('noema:save-capture', text),
  updateCapture: (id: string, text: string) =>
    ipcRenderer.invoke('noema:update-capture', id, text),
  deleteCapture: (id: string) => ipcRenderer.invoke('noema:delete-capture', id),
  discussCapture: (id: string) =>
    ipcRenderer.invoke('noema:discuss-capture', id),
  retryTurn: (turnId: string, model?: string | null) =>
    ipcRenderer.invoke('noema:retry-turn', turnId, model ?? null),
  stopTurn: (turnId: string) => ipcRenderer.invoke('noema:stop-turn', turnId),
  chooseWorkspace: () => ipcRenderer.invoke('noema:choose-workspace'),
  clearWorkspace: () => ipcRenderer.invoke('noema:clear-workspace'),
  stopBackgroundTask: (taskId: string) =>
    ipcRenderer.invoke('noema:stop-background-task', taskId),
  resumeBackgroundTask: (taskId: string) =>
    ipcRenderer.invoke('noema:resume-background-task', taskId),
  retryBackgroundEvent: (taskId: string) =>
    ipcRenderer.invoke('noema:retry-worker-event', taskId),
  listCodexThreads: (cursor?: string | null) =>
    ipcRenderer.invoke('noema:list-codex-threads', cursor ?? null),
  previewCodexThread: (threadId: string) =>
    ipcRenderer.invoke('noema:preview-codex-thread', threadId),
  importCodexThread: (input: {
    threadId: string;
    expectedSourceUpdatedAt: string | number | null;
  }) => ipcRenderer.invoke('noema:import-codex-thread', input),
  removeContextImport: () => ipcRenderer.invoke('noema:remove-context-import'),
  updateInteractionAdjustment: (input: {
    id: string;
    scope: 'conversation' | 'coding' | 'both';
    situation: string;
    behavior: string;
  }) => ipcRenderer.invoke('noema:update-interaction-adjustment', input),
  withdrawInteractionAdjustment: (id: string) =>
    ipcRenderer.invoke('noema:withdraw-interaction-adjustment', id),
  onRootEvent: (listener: (event: NoemaRootEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: NoemaRootEvent,
    ) => listener(payload);
    ipcRenderer.on('noema:root-event', handler);
    return () => ipcRenderer.removeListener('noema:root-event', handler);
  },
  onSocialEvent: (listener: (event: NoemaSocialEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: NoemaSocialEvent,
    ) => listener(payload);
    ipcRenderer.on('noema:social-event', handler);
    return () => ipcRenderer.removeListener('noema:social-event', handler);
  },
  onQuickCaptureRequested: (
    listener: (request: NoemaQuickCaptureRequest) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      request: NoemaQuickCaptureRequest,
    ) => listener(request);
    ipcRenderer.on('noema:quick-capture-request', handler);
    return () =>
      ipcRenderer.removeListener('noema:quick-capture-request', handler);
  },
  getQuickCaptureShortcutStatus:
    (): Promise<NoemaQuickCaptureShortcutStatus | null> =>
      ipcRenderer.invoke('noema:quick-capture-shortcut-status'),
  markQuickCaptureReady: () =>
    ipcRenderer.invoke('noema:mark-quick-capture-ready'),
  finishQuickCapture: () => ipcRenderer.invoke('noema:finish-quick-capture'),
};

contextBridge.exposeInMainWorld('noema', bridge);
