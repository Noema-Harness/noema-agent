import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { OllamaClient } from './ollama-client.mjs';
import { registerRootIpc, CHANNELS } from './root-ipc.mjs';
import { RootAgent } from './root-agent.mjs';
import { RootStore } from './root-store.mjs';
import {
  createWindowPreferences,
  isInternalNavigation,
  shouldOpenExternally,
} from './window-security.mjs';

function writeSmokeLog(step: string, details: Record<string, unknown> = {}) {
  const logFile = process.env.NOEMA_SMOKE_LOG_FILE;
  if (process.env.NOEMA_SMOKE_TEST !== '1' || !logFile) return;
  fs.writeFileSync(logFile, JSON.stringify({ step, ...details }));
}

writeSmokeLog('main-entry', { argv: process.argv, packaged: app.isPackaged });

const testDataArgument = process.argv.find((argument) =>
  argument.startsWith('--noema-e2e-user-data-dir='),
);
if (!app.isPackaged && testDataArgument) {
  const testPortArgument = process.argv.find((argument) =>
    argument.startsWith('--noema-e2e-port='),
  );
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    testPortArgument?.slice('--noema-e2e-port='.length) ?? '9222',
  );
  const testUserData = path.resolve(
    testDataArgument.slice('--noema-e2e-user-data-dir='.length),
  );
  fs.mkdirSync(testUserData, { recursive: true });
  app.setPath('userData', testUserData);
}

if (
  process.env.NOEMA_SMOKE_TEST === '1' &&
  process.env.NOEMA_SMOKE_USER_DATA_DIR
) {
  const smokeUserData = path.resolve(process.env.NOEMA_SMOKE_USER_DATA_DIR);
  fs.mkdirSync(smokeUserData, { recursive: true });
  app.setPath('userData', smokeUserData);
}

let mainWindow: BrowserWindow | null = null;
let rootStore: RootStore | null = null;
let unregisterRootIpc: (() => void) | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 680,
    minHeight: 560,
    backgroundColor: '#f1f3f0',
    webPreferences: createWindowPreferences(
      path.join(__dirname, 'preload.cjs'),
    ),
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternalNavigation(url, MAIN_WINDOW_VITE_DEV_SERVER_URL))
      event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (process.env.NOEMA_SMOKE_TEST === '1') {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const bridgeState = await mainWindow?.webContents.executeJavaScript(
          'window.noema.getRootState()',
        );
        if (!bridgeState || !Array.isArray(bridgeState.messages)) {
          throw new Error('Root conversation bridge did not return its state');
        }
        const result = {
          url: mainWindow?.webContents.getURL() ?? null,
          title: mainWindow?.getTitle() ?? null,
          rootStateLoaded: true,
        };
        writeSmokeLog('renderer-loaded', result);
        if (process.env.NOEMA_SMOKE_TEST_FILE) {
          fs.writeFileSync(
            process.env.NOEMA_SMOKE_TEST_FILE,
            JSON.stringify(result),
          );
        }
      } catch (error) {
        writeSmokeLog('renderer-bridge-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      app.quit();
    });
  }
};

async function startNoema() {
  if (app.isPackaged && process.platform === 'win32') {
    try {
      const { default: handleSquirrelEvent } =
        await import('electron-squirrel-startup');
      writeSmokeLog('squirrel-event', { handled: handleSquirrelEvent });
      if (handleSquirrelEvent) return;
    } catch (error) {
      console.error('Could not handle the Windows installer event:', error);
      app.quit();
      return;
    }
  }

  await app.whenReady();
  writeSmokeLog('app-ready', { userData: app.getPath('userData') });
  try {
    rootStore = new RootStore(
      path.join(app.getPath('userData'), 'noema.sqlite3'),
    );
    writeSmokeLog('store-opened');
    const rootAgent = new RootAgent({
      store: rootStore,
      ollama: new OllamaClient(),
      emit: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CHANNELS.event, payload);
        }
      },
    });
    unregisterRootIpc = registerRootIpc({
      ipcMain,
      rootAgent,
      isTrustedSender: (sender) =>
        Boolean(mainWindow && sender === mainWindow.webContents),
    });
    if (process.env.NOEMA_SMOKE_TEST !== '1') {
      void rootAgent.refreshModels();
    }
    createWindow();
    writeSmokeLog('window-created');
  } catch (error) {
    writeSmokeLog('startup-error', {
      error: error instanceof Error ? error.message : String(error),
    });
    dialog.showErrorBox(
      'Noema 无法启动',
      `本机对话数据无法打开。请检查应用数据目录权限后重试。\n\n${error instanceof Error ? error.message : '未知错误'}`,
    );
    app.quit();
  }
}

void startNoema();

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  unregisterRootIpc?.();
  rootStore?.close();
});
