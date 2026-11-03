import { randomUUID } from 'node:crypto';

export const DEFAULT_DESKTOP_SHUTDOWN_TIMEOUT_MS = 12_000;

function safeRecord(recordEvent, operation, status, errorCode = null) {
  try {
    recordEvent?.({
      executionId: randomUUID(),
      module: 'desktop.lifecycle',
      operation,
      status,
      ...(errorCode ? { errorCode } : {}),
    });
  } catch {
    // Lifecycle diagnostics never block window or application control.
  }
}

export function createDesktopLifecycle({
  app,
  createTray,
  createWindow,
  getWindow,
  recordEvent,
  onSystemSessionEnd,
}) {
  let tray = null;
  let quitting = false;

  function restoreWindow() {
    if (quitting) return false;
    let window = getWindow();
    if (!window || window.isDestroyed()) window = createWindow();
    if (!window || window.isDestroyed()) return false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    safeRecord(recordEvent, 'window.restored', 'observed');
    return true;
  }

  function requestQuit() {
    if (quitting) return;
    quitting = true;
    safeRecord(recordEvent, 'exit.requested', 'observed');
    app.quit();
  }

  return {
    initializeTray() {
      if (tray) return true;
      try {
        tray = createTray({
          onOpen: restoreWindow,
          onQuit: requestQuit,
        });
        if (!tray) throw new Error('tray_unavailable');
        safeRecord(recordEvent, 'tray.ready', 'completed');
        return true;
      } catch {
        tray = null;
        safeRecord(
          recordEvent,
          'tray.error',
          'failed',
          'tray_initialization_failed',
        );
        return false;
      }
    },

    attachWindow(window) {
      window.on('close', (event) => {
        if (quitting || !tray) return;
        event.preventDefault();
        window.hide();
        safeRecord(recordEvent, 'window.hidden', 'observed');
      });
      window.on('query-session-end', (event) => {
        if (typeof onSystemSessionEnd !== 'function') return;
        event.preventDefault();
        safeRecord(recordEvent, 'system-session-end.requested', 'observed');
        try {
          onSystemSessionEnd();
        } catch {
          safeRecord(
            recordEvent,
            'system-session-end.handler',
            'failed',
            'shutdown_handler_failed',
          );
        }
      });
    },

    restoreWindow,

    onSecondInstance() {
      const window = getWindow();
      if (!window || window.isDestroyed()) return false;
      return restoreWindow();
    },

    markQuitting() {
      if (quitting) return false;
      quitting = true;
      safeRecord(recordEvent, 'exit.requested', 'observed');
      return true;
    },

    onWindowAllClosed() {
      if (tray || process.platform === 'darwin') return;
      app.quit();
    },

    dispose() {
      if (!tray) return;
      try {
        tray.destroy();
      } catch {
        // The process is already leaving; tray teardown is best effort.
      }
      tray = null;
    },

    get hasTray() {
      return Boolean(tray);
    },

    get isQuitting() {
      return quitting;
    },
  };
}

export async function waitForDesktopShutdown(
  operations,
  timeoutMs = DEFAULT_DESKTOP_SHUTDOWN_TIMEOUT_MS,
) {
  const boundedTimeout = Math.max(1, Math.floor(timeoutMs));
  let timer;
  const settled = Promise.allSettled(
    operations.map((operation) => Promise.resolve().then(operation)),
  );
  const outcome = await Promise.race([
    settled.then((results) => ({ type: 'settled', results })),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ type: 'timeout' }), boundedTimeout);
    }),
  ]);
  clearTimeout(timer);
  return outcome;
}
