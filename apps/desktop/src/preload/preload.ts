import { contextBridge } from 'electron';
import { createBridge } from '../shared/bridge/create-bridge.ts';
import { createElectronTransport } from './electron-transport.ts';

const bridge = createBridge(createElectronTransport(), {
  appVersion: process.env.npm_package_version ?? '0.1.0',
  includeSocialWorkRaceProbe: process.argv.includes(
    '--noema-social-work-reverse-snapshot-probe',
  ),
});

contextBridge.exposeInMainWorld('noema', bridge);
