import { contextBridge, ipcRenderer } from 'electron';
import type { NoemaRootEvent, NoemaRootState } from './noema-bridge.d.ts';

const bridge = {
  appVersion: process.env.npm_package_version ?? '0.1.0',
  getRootState: (): Promise<NoemaRootState> =>
    ipcRenderer.invoke('noema:root-state'),
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
};

contextBridge.exposeInMainWorld('noema', bridge);
