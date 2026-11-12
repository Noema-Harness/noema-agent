import type { App, BrowserWindow } from 'electron';
import fs from 'node:fs';

export type RendererSmokeDeps = {
  restoreMainWindowForTest: () => boolean;
  hasTray: () => boolean;
  runProbe: (name: string, ...args: unknown[]) => Promise<unknown>;
  writeSmokeLog: (step: string, details?: Record<string, unknown>) => void;
  armDiagnosticsReadFailure: (armed: boolean) => void;
};

/** Drives the packaged/dev renderer smoke scenario after the window loads. */
export function scheduleRendererSmoke(
  deps: RendererSmokeDeps,
  window: BrowserWindow,
  app: App,
  initialWindowFitsWorkArea: boolean,
): void {
  const runProbe = deps.runProbe;
  window.webContents.once('did-finish-load', async () => {
    let bridgeProbeStage = 'social-state';
    try {
      const bridgeState = await window?.webContents.executeJavaScript(
        'window.noema.getSocialState()',
      );
      if (
        !bridgeState ||
        !Array.isArray(bridgeState.agents) ||
        !Array.isArray(bridgeState.rooms)
      ) {
        throw new Error('Social chat bridge did not return contacts and rooms');
      }
      const firstRoom = bridgeState.rooms[0];
      bridgeProbeStage = 'social-room';
      const socialRoom = firstRoom
        ? await window?.webContents.executeJavaScript(
            `window.noema.getSocialRoom(${JSON.stringify(firstRoom.id)})`,
          )
        : null;
      if (!socialRoom?.room || !Array.isArray(socialRoom.members)) {
        throw new Error('Social chat room could not be opened through IPC');
      }
      bridgeProbeStage = 'diagnostics-runtime-manifest';
      const diagnosticsRuntime = await window?.webContents.executeJavaScript(
        'window.noema.getDiagnosticsRecent(1).then((result) => result.runtime)',
      );
      if (
        !diagnosticsRuntime?.applicationVersion ||
        !diagnosticsRuntime?.electronVersion ||
        !Number.isSafeInteger(diagnosticsRuntime?.socialSchemaVersion) ||
        !Number.isSafeInteger(diagnosticsRuntime?.diagnosticsSchemaVersion)
      ) {
        throw new Error('Packaged diagnostics runtime manifest is incomplete');
      }
      bridgeProbeStage = 'smoke-rendering';
      const socialStartStateScreenshot = await runProbe(
        'captureSocialStartStateScreenshot',
      );
      const settingsDialogReview = await runProbe(
        'captureSettingsDialogReviewScreenshots',
      );
      deps.armDiagnosticsReadFailure(
        process.env.NOEMA_SMOKE_DIAGNOSTICS_FAILURES === '1',
      );
      const auxiliarySurfaceReview = await runProbe(
        'captureAuxiliarySurfaceReviewScreenshots',
      );
      const historyTraceSmoke = await runProbe(
        'captureHistoryTraceSmokeScreenshots',
      );
      const legacyArchiveSmoke = await runProbe(
        'captureLegacyArchiveSmokeScreenshots',
      );
      const modelAvailabilitySmoke = await runProbe(
        'inspectModelAvailabilitySmoke',
        bridgeState.models ?? [],
        bridgeState.selectedModel ?? null,
        {
          connected: Boolean(bridgeState.connected),
          providerConfigured: Boolean(bridgeState.providerConfigured),
          providerName: bridgeState.providerName,
        },
      );
      const socialChatSmoke = await runProbe(
        'captureSocialChatSmokeScreenshots',
      );
      const socialLiveChatSmoke = await runProbe('verifyLiveSocialChatSmoke');
      let desktopLifecycleSmoke: {
        trayReady: boolean;
        hiddenOnClose: boolean;
        restoredSameWindow: boolean;
      } | null = null;
      if (process.platform === 'win32') {
        const originalWindow = window;
        originalWindow?.show();
        originalWindow?.close();
        const hiddenOnClose = Boolean(
          originalWindow && !originalWindow.isVisible(),
        );
        deps.restoreMainWindowForTest();
        const restoredSameWindow = Boolean(
          originalWindow &&
          window === originalWindow &&
          originalWindow.isVisible(),
        );
        desktopLifecycleSmoke = {
          trayReady: Boolean(deps.hasTray()),
          hiddenOnClose,
          restoredSameWindow,
        };
        if (
          !desktopLifecycleSmoke.trayReady ||
          !desktopLifecycleSmoke.hiddenOnClose ||
          !desktopLifecycleSmoke.restoredSameWindow
        ) {
          throw new Error(
            `Desktop tray lifecycle probe failed: ${JSON.stringify(desktopLifecycleSmoke)}`,
          );
        }
      }
      const result = {
        url: window?.webContents.getURL() ?? null,
        title: window?.getTitle() ?? null,
        packaged: app.isPackaged,
        windowFitsWorkArea: initialWindowFitsWorkArea,
        rootStateLoaded: true,
        socialChat: {
          agentCount: bridgeState.agents.length,
          roomCount: bridgeState.rooms.length,
          agentIds: bridgeState.agents.map((agent: { id: string }) => agent.id),
          roomIds: bridgeState.rooms.map((room: { id: string }) => room.id),
          firstRoomOpened: true,
        },
        providerConfigured: Boolean(bridgeState.providerConfigured),
        providerBaseUrl: bridgeState.providerBaseUrl ?? null,
        connected: Boolean(bridgeState.connected),
        providerError: bridgeState.error ?? null,
        models: Array.isArray(bridgeState.models)
          ? bridgeState.models.map(
              (model: {
                name: string;
                label: string;
                routeKind: 'router' | 'direct';
                executionStatus: 'ready' | 'needsKey' | 'exhausted' | null;
              }) => ({
                name: model.name,
                label: model.label,
                routeKind: model.routeKind,
                executionStatus: model.executionStatus,
              }),
            )
          : [],
        historyTraceSmoke,
        legacyArchiveSmoke,
        modelAvailabilitySmoke,
        socialChatSmoke,
        socialStartStateScreenshot,
        settingsDialogReview,
        auxiliarySurfaceReview,
        socialLiveChatSmoke,
        diagnosticsRuntime,
        desktopLifecycleSmoke,
      };
      deps.writeSmokeLog('renderer-loaded', result);
      if (process.env.NOEMA_SMOKE_TEST_FILE) {
        fs.writeFileSync(
          process.env.NOEMA_SMOKE_TEST_FILE,
          JSON.stringify(result),
        );
      }
      if (process.env.NOEMA_SMOKE_HMR_DONE_FILE) {
        const deadline = Date.now() + 15_000;
        while (
          !fs.existsSync(process.env.NOEMA_SMOKE_HMR_DONE_FILE) &&
          Date.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!fs.existsSync(process.env.NOEMA_SMOKE_HMR_DONE_FILE)) {
          deps.writeSmokeLog('renderer-hmr-probe-timeout');
        }
      }
    } catch (error) {
      let rendererBoot: unknown = null;
      try {
        rendererBoot = await window?.webContents.executeJavaScript(
          `(() => ({
              rendererEntryEvaluated: performance
                .getEntriesByName('noema.renderer.entry-evaluated')
                .length > 0,
              reactRefreshReady: typeof window.$RefreshReg$ === 'function',
              rootLength: document.querySelector('#root')?.innerHTML.length ?? 0,
              scripts: [...document.scripts].map((script) => ({
                src: script.src,
                type: script.type,
              })),
            }))()`,
        );
      } catch {}
      deps.writeSmokeLog('renderer-bridge-failed', {
        stage: bridgeProbeStage,
        error: error instanceof Error ? error.message : String(error),
        rendererBoot,
      });
    }
    app.quit();
  });
}
