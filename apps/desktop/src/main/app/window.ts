import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  screen,
  shell,
} from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactSensitiveText } from '../../shared/text/sensitive-text.ts';
import {
  createWindowPreferences,
  isInternalNavigation,
  shouldOpenExternally,
} from '../platform/window-security.ts';
import {
  fitsWithinWorkArea,
  resolveInitialWindowSize,
} from '../platform/window-geometry.ts';

export type WindowEntryRoute = 'social-chat' | 'legacy-archive';

export interface MainWindowSmoke {
  enabled: boolean;
  hidden: boolean;
  run(window: BrowserWindow, initialWindowFitsWorkArea: boolean): void;
}

export interface MainWindowOptions {
  dirname: string;
  testRendererUrl: string | null;
  devServerUrl: string | undefined;
  viteName: string;
  testSocialWorkPrompt: boolean;
  testSocialAgentWorkflow: boolean;
  socialWorkReverseSnapshotProbe: boolean;
  desktopLifecycle: { attachWindow(window: BrowserWindow): void } | null;
  pendingFollowupNavigation: { resetRenderer(): void };
  recordDiagnosticEvent(event: Record<string, unknown>): void;
  writeRendererHealthLog(step: string, details?: Record<string, unknown>): void;
  setMainWindow(window: BrowserWindow | null): void;
  resetEntryReadiness(): void;
  setEntryRoute(route: WindowEntryRoute | null): void;
  getApplicationExecutionId(): string;
  smoke: MainWindowSmoke;
}

export function createMainWindow(options: MainWindowOptions): void {
  let initialWindowFitsWorkArea = false;
  options.setEntryRoute(null);
  options.resetEntryReadiness();
  options.pendingFollowupNavigation.resetRenderer();
  const display = screen.getPrimaryDisplay();
  const windowSize = resolveInitialWindowSize(display.workAreaSize);
  const rendererDevServerUrl = app.isPackaged
    ? undefined
    : (options.testRendererUrl ?? options.devServerUrl);
  const deferDevelopmentWindowUntilMounted = Boolean(
    rendererDevServerUrl && !options.testRendererUrl,
  );
  const window = new BrowserWindow({
    ...windowSize,
    ...(options.smoke.enabled ? { minWidth: 320, minHeight: 420 } : {}),
    show: !options.smoke.hidden && !deferDevelopmentWindowUntilMounted,
    title: 'Noema',
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#fcfcfc',
    webPreferences: createWindowPreferences(
      path.join(options.dirname, 'preload.cjs'),
      !app.isPackaged && options.socialWorkReverseSnapshotProbe
        ? ['--noema-social-work-reverse-snapshot-probe']
        : [],
    ),
  });
  options.setMainWindow(window);
  let rendererLoadRetryCount = 0;
  let rendererLoadRetryTimer: NodeJS.Timeout | undefined;
  let rendererMountCheckTimer: NodeJS.Timeout | undefined;
  let rendererMountRecoveryCount = 0;
  window.setMenuBarVisibility(false);
  window.webContents.on('did-start-loading', () => {
    if (rendererMountCheckTimer) clearTimeout(rendererMountCheckTimer);
    rendererMountCheckTimer = undefined;
    options.pendingFollowupNavigation.resetRenderer();
  });
  window.webContents.on('unresponsive', () => {
    options.writeRendererHealthLog('unresponsive');
  });
  window.webContents.on('responsive', () => {
    options.writeRendererHealthLog('responsive');
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    options.pendingFollowupNavigation.resetRenderer();
    options.writeRendererHealthLog('render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  if (rendererDevServerUrl) {
    window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
        if (
          !isMainFrame ||
          (errorCode !== -102 && errorCode !== -118) ||
          rendererLoadRetryCount >= 60 ||
          window.isDestroyed() ||
          rendererLoadRetryTimer
        )
          return;
        rendererLoadRetryCount += 1;
        options.writeRendererHealthLog('dev-renderer-load-retry', {
          attempt: rendererLoadRetryCount,
          errorCode,
          errorDescription,
        });
        rendererLoadRetryTimer = setTimeout(() => {
          rendererLoadRetryTimer = undefined;
          if (window.isDestroyed()) return;
          void window.loadURL(rendererDevServerUrl).catch((error) => {
            options.writeRendererHealthLog('dev-renderer-load-retry-failed', {
              attempt: rendererLoadRetryCount,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }, 500);
      },
    );
  }
  const publishWindowState = () => {
    if (window && !window.webContents.isDestroyed())
      window.webContents.send('noema:window-state', window.isMaximized());
  };
  window.on('maximize', publishWindowState);
  window.on('unmaximize', publishWindowState);
  initialWindowFitsWorkArea = fitsWithinWorkArea(
    window.getBounds(),
    display.workArea,
  );

  window.webContents.on(
    'console-message',
    (details, legacyLevel, legacyMessage, legacyLine, legacySource) => {
      if (details.level !== 'error' && legacyLevel !== 3) return;
      const message = details.message ?? legacyMessage;
      const source = details.sourceId ?? legacySource;
      const line = details.lineNumber ?? legacyLine;
      options.writeRendererHealthLog('console-error', {
        message: redactSensitiveText(message).snippet.slice(0, 2_000),
        source: path.basename(source ?? ''),
        line,
      });
      if (options.smoke.enabled) {
        console.error('Noema renderer error:', message, source, line);
      }
    },
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (
      !isInternalNavigation(
        url,
        options.testRendererUrl ?? options.devServerUrl,
        pathToFileURL(
          path.join(
            options.dirname,
            `../renderer/${options.viteName}/index.html`,
          ),
        ).href,
      )
    )
      event.preventDefault();
  });
  window.on('closed', () => {
    if (rendererLoadRetryTimer) clearTimeout(rendererLoadRetryTimer);
    rendererLoadRetryTimer = undefined;
    if (rendererMountCheckTimer) clearTimeout(rendererMountCheckTimer);
    rendererMountCheckTimer = undefined;
    options.setMainWindow(null);
    options.pendingFollowupNavigation.resetRenderer();
  });
  options.desktopLifecycle?.attachWindow(window);

  if (deferDevelopmentWindowUntilMounted && rendererDevServerUrl) {
    window.webContents.on('did-finish-load', () => {
      if (rendererMountCheckTimer) clearTimeout(rendererMountCheckTimer);
      rendererMountCheckTimer = setTimeout(() => {
        rendererMountCheckTimer = undefined;
        if (window.isDestroyed()) return;
        void window.webContents
          .executeJavaScript(`(() => {
            const root = document.getElementById('root');
            return {
              mounted: Boolean(root?.childElementCount),
              rootChildren: root?.childElementCount ?? 0,
              entryEvaluated: performance.getEntriesByName('noema.renderer.entry-evaluated').length > 0,
            };
          })()`)
          .then(
            (status: {
              mounted: boolean;
              rootChildren: number;
              entryEvaluated: boolean;
            }) => {
              options.writeRendererHealthLog(
                status.mounted ? 'renderer-mounted' : 'renderer-root-empty',
                status,
              );
              if (status.mounted) {
                if (!options.smoke.hidden) window.show();
                return;
              }
              if (rendererMountRecoveryCount < 2) {
                rendererMountRecoveryCount += 1;
                options.writeRendererHealthLog('renderer-mount-retry', {
                  attempt: rendererMountRecoveryCount,
                  ...status,
                });
                void window.loadURL(rendererDevServerUrl).catch((error) => {
                  options.writeRendererHealthLog(
                    'renderer-mount-retry-failed',
                    {
                      attempt: rendererMountRecoveryCount,
                      error:
                        error instanceof Error ? error.message : String(error),
                    },
                  );
                });
                return;
              }
              if (!options.smoke.hidden) window.show();
            },
          )
          .catch((error) => {
            options.writeRendererHealthLog('renderer-mount-check-failed', {
              error: error instanceof Error ? error.message : String(error),
            });
            if (!options.smoke.hidden) window.show();
          });
      }, 1_500);
    });
  }

  window.webContents.once('did-finish-load', () => {
    if (rendererLoadRetryTimer) clearTimeout(rendererLoadRetryTimer);
    rendererLoadRetryTimer = undefined;
    const loadedUrl = window?.webContents.getURL();
    if (options.getApplicationExecutionId() && loadedUrl) {
      const entryRoute =
        new URL(loadedUrl).hash === '#archive'
          ? 'legacy-archive'
          : 'social-chat';
      options.setEntryRoute(entryRoute);
      options.recordDiagnosticEvent({
        executionId: options.getApplicationExecutionId(),
        module: 'desktop.main',
        operation: 'entry.route_selected',
        status: 'observed',
        details: { route: entryRoute },
      });
    }
  });

  if (options.testRendererUrl) {
    void window.loadURL(options.testRendererUrl);
  } else if (options.devServerUrl) {
    void window.loadURL(options.devServerUrl);
  } else {
    void window.loadFile(
      path.join(options.dirname, `../renderer/${options.viteName}/index.html`),
    );
  }

  if (
    options.smoke.enabled &&
    !options.testSocialWorkPrompt &&
    !options.testSocialAgentWorkflow
  ) {
    options.smoke.run(window, initialWindowFitsWorkArea);
  }
}

export function createNoemaTray({
  onOpen,
  onQuit,
}: {
  onOpen: () => unknown;
  onQuit: () => void;
}) {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'noema-tray-icon.png')
    : path.join(app.getAppPath(), 'assets', 'noema-tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) throw new Error('tray_icon_unavailable');
  const tray = new Tray(icon);
  try {
    tray.setToolTip('Noema');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开 Noema', click: onOpen },
        { type: 'separator' },
        { label: '退出 Noema', click: onQuit },
      ]),
    );
    tray.on('click', onOpen);
    return tray;
  } catch (error) {
    tray.destroy();
    throw error;
  }
}
