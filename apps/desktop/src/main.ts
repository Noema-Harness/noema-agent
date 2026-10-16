import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  safeStorage,
  shell,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { EncryptedSecretStore } from './encrypted-secret-store.mjs';
import { runIsolatedWorkerE2E } from './isolated-worker-e2e.mjs';
import { DEFAULT_BASE_URL, FreeLLMAPIClient } from './freellmapi-client.mjs';
import {
  createImportAwareSendMessage,
  registerRootIpc,
  CHANNELS,
} from './root-ipc.mjs';
import { RootAgent } from './root-agent.mjs';
import { RootStore } from './root-store.mjs';
import {
  resolveNoemaDatabasePath,
  resolveNoemaDshUserDataPath,
} from './runtime-paths.mjs';
import {
  CodexAppServerAdapter,
  resolveCodexExecutable,
} from './codex-app-server-adapter.mjs';
import {
  DshHeadlessAdapter,
  resolveDshHeadlessRuntime,
} from './dsh-headless-adapter.mjs';
import {
  createWindowPreferences,
  isInternalNavigation,
  shouldOpenExternally,
} from './window-security.mjs';
import {
  activateQuickCaptureWindow,
  focusPrimaryWindow,
  finishQuickCaptureWindow,
  registerQuickCaptureShortcut,
} from './quick-capture-shortcut.mjs';

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
let providerSecretStore: EncryptedSecretStore | null = null;
let unregisterRootIpc: (() => void) | null = null;
let rootAgent: RootAgent | null = null;
let quickCaptureShortcutRegistration: ReturnType<
  typeof registerQuickCaptureShortcut
> | null = null;
let quickCaptureReturnToPrevious = false;
let quickCaptureActive = false;
let quickCaptureRendererReady = false;
let pendingQuickCaptureRequest = false;
let shutdownStarted = false;
let shutdownComplete = false;
const testDatabasePath = process.env.NOEMA_E2E_DATABASE_PATH ?? null;
const testDshUserDataPath = process.env.NOEMA_E2E_DSH_USER_DATA_PATH ?? null;
const testWorkerPreface = process.env.NOEMA_E2E_WORKER_PREFACE ?? null;
const testWorkerPrompt = process.env.NOEMA_E2E_WORKER_PROMPT ?? null;
const testRootOnly = process.env.NOEMA_E2E_ROOT_ONLY === '1';
const testDirectWorker = process.env.NOEMA_E2E_DIRECT_WORKER === '1';
const testVerificationChecksJson =
  process.env.NOEMA_E2E_VERIFICATION_CHECKS ?? null;
const testCaptureQuickCapture =
  process.env.NOEMA_SMOKE_CAPTURE_QUICK_CAPTURE === '1';
const quickCaptureDesktopScreenshotPath =
  process.env.NOEMA_SMOKE_QUICK_CAPTURE_DESKTOP_PATH ?? null;
const quickCaptureNarrowScreenshotPath =
  process.env.NOEMA_SMOKE_QUICK_CAPTURE_NARROW_PATH ?? null;
delete process.env.NOEMA_E2E_DATABASE_PATH;
delete process.env.NOEMA_E2E_DSH_USER_DATA_PATH;
delete process.env.NOEMA_E2E_WORKER_PREFACE;
delete process.env.NOEMA_E2E_WORKER_PROMPT;
delete process.env.NOEMA_E2E_ROOT_ONLY;
delete process.env.NOEMA_E2E_DIRECT_WORKER;
delete process.env.NOEMA_E2E_VERIFICATION_CHECKS;
delete process.env.NOEMA_SMOKE_CAPTURE_QUICK_CAPTURE;
delete process.env.NOEMA_SMOKE_QUICK_CAPTURE_DESKTOP_PATH;
delete process.env.NOEMA_SMOKE_QUICK_CAPTURE_NARROW_PATH;

const isSquirrelLifecycleEvent = process.argv.some((argument) =>
  /^--squirrel-(install|updated|uninstall|obsolete)$/.test(argument),
);
const hasSingleInstanceLock =
  process.env.NOEMA_SMOKE_TEST === '1' ||
  isSquirrelLifecycleEvent ||
  app.requestSingleInstanceLock();

const createWindow = () => {
  quickCaptureRendererReady = false;
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
    quickCaptureActive = false;
    quickCaptureRendererReady = false;
    pendingQuickCaptureRequest = false;
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingQuickCaptureRequest) dispatchQuickCaptureRequest();
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
        const quickCaptureSmoke = await captureQuickCaptureSmokeScreenshots();
        const result = {
          url: mainWindow?.webContents.getURL() ?? null,
          title: mainWindow?.getTitle() ?? null,
          rootStateLoaded: true,
          providerConfigured: Boolean(bridgeState.providerConfigured),
          providerBaseUrl: bridgeState.providerBaseUrl ?? null,
          connected: Boolean(bridgeState.connected),
          providerError: bridgeState.error ?? null,
          models: Array.isArray(bridgeState.models)
            ? bridgeState.models.map(
                (model: { name: string; label: string }) => ({
                  name: model.name,
                  label: model.label,
                }),
              )
            : [],
          dshAvailable: Boolean(bridgeState.dshAvailable),
          dshWorkerAvailable: Boolean(bridgeState.dshWorkerAvailable),
          dshWorkerError: bridgeState.dshWorkerError ?? null,
          quickCaptureShortcut: quickCaptureShortcutRegistration
            ? {
                accelerator: quickCaptureShortcutRegistration.accelerator,
                registered: quickCaptureShortcutRegistration.registered,
              }
            : null,
          quickCaptureSmoke,
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

function dispatchQuickCaptureRequest() {
  if (!mainWindow || mainWindow.isDestroyed() || !quickCaptureRendererReady) {
    return;
  }
  pendingQuickCaptureRequest = false;
  mainWindow.webContents.send(CHANNELS.quickCaptureRequest, {
    returnToPrevious: quickCaptureReturnToPrevious,
  });
}

function markQuickCaptureReady() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  quickCaptureRendererReady = true;
  if (pendingQuickCaptureRequest) dispatchQuickCaptureRequest();
  return true;
}

function openQuickCapture() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    quickCaptureReturnToPrevious = true;
    quickCaptureActive = true;
    pendingQuickCaptureRequest = true;
    createWindow();
    return;
  }
  const returnToPrevious = activateQuickCaptureWindow(mainWindow);
  if (!quickCaptureActive) {
    quickCaptureReturnToPrevious = returnToPrevious;
    quickCaptureActive = true;
  }

  if (mainWindow.webContents.isLoading() || !quickCaptureRendererReady) {
    pendingQuickCaptureRequest = true;
    return;
  }
  dispatchQuickCaptureRequest();
}

function finishQuickCapture() {
  if (!quickCaptureActive) return false;
  const finished = finishQuickCaptureWindow(
    mainWindow,
    quickCaptureReturnToPrevious,
  );
  quickCaptureActive = false;
  quickCaptureReturnToPrevious = false;
  return finished;
}

function writeQuickCaptureSmokeScreenshot(
  targetPath: string,
  image: Electron.NativeImage,
) {
  if (
    app.isPackaged ||
    process.env.NOEMA_SMOKE_TEST !== '1' ||
    !path.isAbsolute(targetPath)
  ) {
    throw new Error('快捷速记截图只允许由未打包的 smoke 测试写入绝对路径。');
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, image.toPNG(), { flag: 'wx' });
}

async function waitForQuickCaptureDialog() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!mainWindow || mainWindow.isDestroyed()) break;
    const state = await mainWindow.webContents.executeJavaScript(
      `(() => ({
        open: Boolean(document.querySelector('.quick-capture-dialog')?.open),
        focused: document.activeElement?.id === 'quick-capture-input',
      }))()`,
    );
    if (state.open && state.focused) return state;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('快捷速记窗口未打开或输入框未获得焦点。');
}

async function waitForQuickCaptureRender() {
  const deadline = Date.now() + 10_000;
  let shortcutStatusVisible = false;
  while (Date.now() < deadline && mainWindow && !mainWindow.isDestroyed()) {
    const text = await mainWindow.webContents.executeJavaScript(
      "document.querySelector('.composer-hint')?.textContent ?? ''",
    );
    if (text.includes('快速速记') || text.includes('快捷速记不可用')) {
      shortcutStatusVisible = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  if (!shortcutStatusVisible) {
    throw new Error('快捷速记快捷键状态没有显示在主输入区。');
  }
  await mainWindow?.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  return shortcutStatusVisible;
}

async function captureQuickCaptureSmokeScreenshots() {
  if (!testCaptureQuickCapture) return null;
  const shortcutStatusVisible = await waitForQuickCaptureRender();
  openQuickCapture();
  const opened = await waitForQuickCaptureDialog();
  const screenshots = [];
  if (quickCaptureDesktopScreenshotPath) {
    const image = await mainWindow?.capturePage();
    if (!image) throw new Error('无法捕获快捷速记桌面预览。');
    writeQuickCaptureSmokeScreenshot(quickCaptureDesktopScreenshotPath, image);
    screenshots.push(quickCaptureDesktopScreenshotPath);
  }
  if (quickCaptureNarrowScreenshotPath) {
    mainWindow?.setSize(680, 560);
    await mainWindow?.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const state = await waitForQuickCaptureDialog();
    if (!state.open || !state.focused) {
      throw new Error('窄窗口下快捷速记未保持可见与键盘焦点。');
    }
    const image = await mainWindow?.capturePage();
    if (!image) throw new Error('无法捕获快捷速记窄窗口预览。');
    writeQuickCaptureSmokeScreenshot(quickCaptureNarrowScreenshotPath, image);
    screenshots.push(quickCaptureNarrowScreenshotPath);
  }
  return {
    dialogOpen: opened.open,
    inputFocused: opened.focused,
    shortcutStatusVisible,
    screenshots,
  };
}

function discoverFreeLLMAPIBaseUrl(appDataPath: string) {
  try {
    const configPath = path.join(appDataPath, 'FreeLLMAPI', 'config.json');
    const configuration = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (
      Number.isInteger(configuration.port) &&
      configuration.port > 0 &&
      configuration.port <= 65_535
    ) {
      return `http://127.0.0.1:${configuration.port}/v1`;
    }
  } catch {
    // Use FreeLLMAPI's documented default when the desktop configuration is absent.
  }
  return DEFAULT_BASE_URL;
}

function isPathWithin(directory: string, candidate: string) {
  const relative = path.relative(
    path.resolve(directory),
    path.resolve(candidate),
  );
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function isIsolatedE2eDirectory(directory: string, userDataDirectory: string) {
  try {
    const e2eRealPath = fs.realpathSync(directory);
    const userDataRealPath = fs.realpathSync(userDataDirectory);
    return (
      !isPathWithin(e2eRealPath, userDataRealPath) &&
      !isPathWithin(userDataRealPath, e2eRealPath)
    );
  } catch {
    return false;
  }
}

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
      resolveNoemaDatabasePath({
        userDataPath: app.getPath('userData'),
        isPackaged: app.isPackaged,
        testDatabasePath,
      }),
    );
    writeSmokeLog('store-opened');
    providerSecretStore = new EncryptedSecretStore({
      safeStorage,
      filePath: path.join(
        app.getPath('userData'),
        'credentials',
        'freellmapi.key',
      ),
    });
    if (process.env.NOEMA_FREELLMAPI_API_KEY) {
      providerSecretStore.set(process.env.NOEMA_FREELLMAPI_API_KEY);
      delete process.env.NOEMA_FREELLMAPI_API_KEY;
    }
    const configuredBaseUrl =
      providerSecretStore.getBaseUrl() ??
      process.env.NOEMA_FREELLMAPI_BASE_URL ??
      discoverFreeLLMAPIBaseUrl(app.getPath('appData'));
    const provider = new FreeLLMAPIClient({
      baseUrl: configuredBaseUrl,
      getApiKey: () => providerSecretStore?.get() ?? null,
    });
    const codexAdapter = new CodexAppServerAdapter({
      executable: resolveCodexExecutable(),
    });
    let dshAdapter: DshHeadlessAdapter | null = null;
    let dshRuntimeError: string | null = null;
    try {
      const runtime = await resolveDshHeadlessRuntime();
      dshAdapter = new DshHeadlessAdapter({
        runtime,
        userDataPath: resolveNoemaDshUserDataPath({
          userDataPath: app.getPath('userData'),
          isPackaged: app.isPackaged,
          testDatabasePath,
          testDshUserDataPath,
        }),
        providerBaseUrl: provider.baseUrl,
        getApiKey: () => providerSecretStore?.get() ?? null,
      });
    } catch (error) {
      dshRuntimeError =
        error instanceof Error
          ? error.message
          : '没有找到可用的 DSH 后台运行环境。';
    }
    const agent = new RootAgent({
      store: rootStore,
      provider,
      secretStore: providerSecretStore,
      dshAdapter,
      dshRuntimeError,
      codexAdapter: codexAdapter.available ? codexAdapter : null,
      emit: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CHANNELS.event, payload);
        }
      },
    });
    rootAgent = agent;
    unregisterRootIpc = registerRootIpc({
      ipcMain,
      rootAgent: agent,
      isTrustedSender: (sender) =>
        Boolean(mainWindow && sender === mainWindow.webContents),
      sendMessage: createImportAwareSendMessage(agent, async (imported) => {
        if (!mainWindow || mainWindow.isDestroyed()) return false;
        const consent = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '发送导入的 Codex 上下文',
          message: `“${imported.title}”的可见对话将随 Noema 本轮及后续对话发送。`,
          detail:
            '这份快照保存在本机。确认后，快照和你在 Noema 的近期对话会通过 FreeLLMAPI 发往当前选定的免费模型路由；上游服务的数据处理政策各不相同。该授权持续有效，直到你在 Noema 移除此快照。移除无法撤回此前已发送的数据；Codex 原会话不会被修改。',
          buttons: ['取消本次发送', '发送并继续使用此快照'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return consent.response === 1;
      }),
      chooseWorkspace: async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return null;
        const disclosure = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '后台任务的数据范围',
          message: '选择工作区会允许后台 DSH agent 读取和修改其中的文件。',
          detail: `任务指令${agent.store.getInteractionAdjustmentsForSurface('coding').length ? '及你保存的编码协作调整' : ''}，以及 agent 实际读取的文件内容，会通过本机 FreeLLMAPI 发往当前免费链中的第三方服务（目前包括 BlockRun、Kilo 和 OVH，并可能按可用性切换）。不同服务的数据处理条款不同；例如 Kilo 声明会记录请求/响应用于训练。免费不代表私密。不要选择包含不应发送给第三方的密钥或敏感资料的目录。你仍可在任务运行时停止它，但停止前的文件改动不会自动回滚。`,
          buttons: ['取消', '继续选择工作区'],
          defaultId: 1,
          cancelId: 0,
          noLink: true,
        });
        if (disclosure.response !== 1) return null;
        const selection = await dialog.showOpenDialog(mainWindow, {
          title: '选择后台 agent 可访问的工作区',
          properties: ['openDirectory'],
          buttonLabel: '允许此文件夹',
        });
        return selection.canceled ? null : (selection.filePaths[0] ?? null);
      },
      finishQuickCapture,
      markQuickCaptureReady,
      getQuickCaptureShortcutStatus: () =>
        quickCaptureShortcutRegistration
          ? {
              accelerator: quickCaptureShortcutRegistration.accelerator,
              registered: quickCaptureShortcutRegistration.registered,
            }
          : null,
    });
    if (
      !app.isPackaged &&
      testDatabasePath &&
      path.isAbsolute(testDatabasePath) &&
      testDshUserDataPath &&
      path.isAbsolute(testDshUserDataPath) &&
      (!testWorkerPreface ||
        testWorkerPreface.startsWith('[NOEMA E2E PREFACE]')) &&
      testWorkerPrompt?.startsWith('[NOEMA E2E]') &&
      path.resolve(testDatabasePath) !==
        path.join(app.getPath('userData'), 'noema.sqlite3') &&
      isIsolatedE2eDirectory(
        path.dirname(path.resolve(testDatabasePath)),
        app.getPath('userData'),
      ) &&
      path.resolve(testDshUserDataPath) !==
        path.resolve(app.getPath('userData')) &&
      path.resolve(testDshUserDataPath) !==
        path.dirname(path.resolve(testDatabasePath)) &&
      isPathWithin(
        path.dirname(path.resolve(testDatabasePath)),
        testDshUserDataPath,
      )
    ) {
      const e2eDirectory = path.dirname(path.resolve(testDatabasePath));
      const resultPath = path.join(
        e2eDirectory,
        `worker-e2e-result-${Date.now()}.json`,
      );
      void runIsolatedWorkerE2E({
        agent,
        store: rootStore,
        databasePath: testDatabasePath,
        prefacePrompt: testWorkerPreface,
        prompt: testWorkerPrompt,
        resultPath,
        rootOnly: testRootOnly,
        directWorker: testDirectWorker,
        verificationChecks:
          testDirectWorker && testVerificationChecksJson
            ? JSON.parse(testVerificationChecksJson)
            : [],
      })
        .catch((error) => {
          const result = {
            outcome: 'setup_failed',
            errorCode:
              typeof error?.code === 'string'
                ? error.code
                : 'e2e_scenario_failed',
          };
          fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), {
            encoding: 'utf8',
            flag: 'wx',
          });
          console.error(
            'Isolated Noema E2E scenario failed:',
            result.errorCode,
          );
        })
        .finally(() => app.quit());
      return;
    }
    if (
      process.env.NOEMA_SMOKE_TEST === '1' &&
      process.env.NOEMA_SMOKE_REFRESH_MODELS === '1'
    ) {
      await agent.refreshModels();
    } else if (process.env.NOEMA_SMOKE_TEST !== '1') {
      void agent.refreshModels();
    }
    quickCaptureShortcutRegistration = registerQuickCaptureShortcut({
      shortcutApi: globalShortcut,
      platform: process.platform,
      onQuickCapture: openQuickCapture,
    });
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
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

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    focusPrimaryWindow(mainWindow);
  });
  void startNoema();
} else {
  app.quit();
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (!rootAgent || shutdownComplete) {
    unregisterRootIpc?.();
    rootStore?.close();
    return;
  }
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void rootAgent.shutdown().finally(() => {
    shutdownComplete = true;
    unregisterRootIpc?.();
    rootStore?.close();
    app.quit();
  });
});

app.on('will-quit', () => {
  quickCaptureShortcutRegistration?.unregister();
  quickCaptureShortcutRegistration = null;
});
