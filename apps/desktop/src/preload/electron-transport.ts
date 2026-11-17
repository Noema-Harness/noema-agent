import { ipcRenderer } from 'electron';
import type {
  BridgeListener,
  BridgeTransport,
} from '../shared/bridge/transport.ts';

/**
 * The desktop host's BridgeTransport: Electron IPC in both directions.
 *
 * This is the only module on the renderer side that may touch `ipcRenderer`.
 * A remote or companion host replaces this file's transport with its own.
 */
export function createElectronTransport(): BridgeTransport {
  return {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        (listener as BridgeListener)(payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  };
}
