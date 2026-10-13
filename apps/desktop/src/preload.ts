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
  retryTurn: (turnId: string, model?: string | null) =>
    ipcRenderer.invoke('noema:retry-turn', turnId, model ?? null),
  stopTurn: (turnId: string) => ipcRenderer.invoke('noema:stop-turn', turnId),
  chooseWorkspace: () => ipcRenderer.invoke('noema:choose-workspace'),
  clearWorkspace: () => ipcRenderer.invoke('noema:clear-workspace'),
  stopBackgroundTask: (taskId: string) =>
    ipcRenderer.invoke('noema:stop-background-task', taskId),
  resumeBackgroundTask: (taskId: string) =>
    ipcRenderer.invoke('noema:resume-background-task', taskId),
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
