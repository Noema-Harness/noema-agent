import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('noema', {
  appVersion: process.env.npm_package_version ?? '0.1.0',
});
