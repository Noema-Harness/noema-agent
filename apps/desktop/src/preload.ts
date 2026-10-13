import { contextBridge, ipcRenderer } from 'electron';
import type { NoemaRootEvent, NoemaRootState } from './noema-bridge.d.ts';

const bridge = {
  appVersion: process.env.npm_package_version ?? '0.1.0',
  getRootState: (): Promise<NoemaRootState> =>
    ipcRenderer.invoke('noema:root-state'),
  refreshModels: () => ipcRenderer.invoke('noema:refresh-models'),
  selectModel: (model: string) =>
    ipcRenderer.invoke('noema:select-model', model),
  sendMessage: (text: string) => ipcRenderer.invoke('noema:send-message', text),
  retryTurn: (turnId: string, model?: string | null) =>
    ipcRenderer.invoke('noema:retry-turn', turnId, model ?? null),
  stopTurn: (turnId: string) => ipcRenderer.invoke('noema:stop-turn', turnId),
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
