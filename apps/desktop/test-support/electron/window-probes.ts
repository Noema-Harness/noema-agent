import type { DesktopProbeContext } from './probe-context';
import { BrowserWindow } from 'electron';
import { writeSmokeScreenshot } from './capture';
import { CHANNELS } from '../../src/main/ipc/root-ipc.mjs';
export function createWindowProbes(context: DesktopProbeContext) {
  const { mainWindow } = context;
  const {
    testCaptureHistoryTrace,
    historyTraceDesktopScreenshotPath,
    historyTraceIntermediateScreenshotPath,
    historyTraceNarrowScreenshotPath,
    testCaptureLegacyArchive,
    legacyArchiveDesktopScreenshotPath,
    legacyArchiveNarrowScreenshotPath,
    testCaptureModelAvailability,
    modelAvailabilityScreenshotPath,
    modelAvailabilityNarrowScreenshotPath,
    captureSocialChatSmoke,
    socialChatDesktopScreenshotPath,
    socialStartStateScreenshotPath,
    socialStartStateNarrowScreenshotPath,
    socialProjectWorkDesktopScreenshotPath,
    socialProjectWorkNarrowScreenshotPath,
    socialGroupDialogScreenshotPath,
    socialChatNarrowScreenshotPath,
    socialSettingsNarrowScreenshotPath,
    socialSettingsDesktopReviewPath,
    socialSettingsNarrowReviewPath,
    socialGlobalSearchReviewPath,
    socialDiagnosticsReviewPath,
    socialArchivedProjectsReviewPath,
    socialPersonalMemoryReviewPath,
    socialUserFollowupsReviewPath,
    socialAgentCreateReviewPath,
    socialGroupCreateReviewPath,
    socialProjectCreateReviewPath,
    runSocialChatLiveSmoke,
  } = context.options;
  async function inspectRendererBridgeUnavailable() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Bridge 缺失状态检查没有可用的 renderer 地址。');
    }
    const rendererUrl = new URL(mainWindow.webContents.getURL());
    rendererUrl.hash = '';
    const probeWindow = new BrowserWindow({
      show: false,
      width: 960,
      height: 640,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    try {
      await probeWindow.loadURL(rendererUrl.toString());
      const state = await probeWindow.webContents
        .executeJavaScript(`(async () => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const card = document.querySelector('.desktop-runtime-card');
          if (card) {
            const heading = card.querySelector('h1');
            const rect = card.getBoundingClientRect();
            return {
              bridgeMissing: typeof window.noema?.getSocialState !== 'function',
              heading: heading?.textContent?.trim() ?? '',
              explainsBoundary: card.textContent?.includes('不会读取或保存对话') ?? false,
              givesNextStep: card.textContent?.includes('启动 Noema 桌面客户端') ?? false,
              linkedHeading: heading?.id === card.getAttribute('aria-labelledby'),
              fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
              noOverflow: document.documentElement.scrollWidth <= innerWidth,
              socialMounted: Boolean(document.querySelector('.social-shell, #message-input, #social-message-input')),
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return null;
      })()`);
      if (
        !state?.bridgeMissing ||
        !state.heading ||
        !state.explainsBoundary ||
        !state.givesNextStep ||
        !state.linkedHeading ||
        !state.fits ||
        !state.noOverflow ||
        state.socialMounted
      ) {
        throw new Error(
          `缺少 preload bridge 时没有显示安全的 renderer fallback：${JSON.stringify(state)}`,
        );
      }
      return state;
    } finally {
      if (!probeWindow.isDestroyed()) probeWindow.destroy();
    }
  }
  async function captureSocialStartStateScreenshot() {
    if (!socialStartStateScreenshotPath) return null;
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Noema 首屏截图没有可用窗口。');
    }
    const providerCheckSettled = await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const state = document.querySelector('.chat-start-state');
        if (state && state.getAttribute('aria-busy') === 'false') return true;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return false;
    })()`);
    if (!providerCheckSettled) {
      throw new Error('Social 首屏的模型连接检查未在 15 秒内结束。');
    }
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const state = await mainWindow.webContents.executeJavaScript(`(() => {
      const shell = document.querySelector('.social-shell');
      const start = document.querySelector('.chat-start-state');
      const visibleText = [...document.querySelectorAll('h1, h2, .section-title, .index-empty-state, .provider-warning, .first-meeting-entry, .empty-chat')]
        .filter((element) => element.getBoundingClientRect().width > 0)
        .map((element) => element.textContent?.replace(/\\s+/g, ' ').trim())
        .filter(Boolean);
      return {
        loaded: Boolean(shell),
        windowSize: { width: window.innerWidth, height: window.innerHeight },
        shellBounds: shell ? (() => {
          const rect = shell.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })() : null,
        checking: start?.getAttribute('aria-busy') === 'true',
        heading: start?.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        actionLabels: [...(start?.querySelectorAll('.chat-start-actions button') ?? [])]
          .map((button) => button.textContent?.replace(/\s+/g, ' ').trim()),
        hasComposer: Boolean(document.querySelector('#social-message-input')),
        legacyFirstMeetingVisible: Boolean(document.querySelector('.first-meeting-entry, .first-meeting-screen')),
        visibleText,
      };
    })()`);
    if (!state.loaded) throw new Error('Noema 社交聊天界面尚未加载。');
    if (state.checking || !state.heading || !state.hasComposer) {
      throw new Error(`Noema 首屏状态不完整：${JSON.stringify(state)}`);
    }
    if (state.legacyFirstMeetingVisible) {
      throw new Error('已退役的首次相遇引介仍出现在 Social 首屏。');
    }
    if (!state.actionLabels.length) {
      throw new Error('Social 首屏没有提供与模型状态对应的后续操作。');
    }
    const bridgeUnavailable = await inspectRendererBridgeUnavailable();
    writeSmokeScreenshot(
      socialStartStateScreenshotPath,
      await mainWindow.capturePage(),
    );
    if (socialStartStateNarrowScreenshotPath) {
      const originalSize = mainWindow.getSize();
      mainWindow.setSize(680, 560);
      await mainWindow.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      writeSmokeScreenshot(
        socialStartStateNarrowScreenshotPath,
        await mainWindow.capturePage(),
      );
      mainWindow.setSize(originalSize[0], originalSize[1]);
      await mainWindow.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
    }
    return {
      ...state,
      bridgeUnavailable,
      screenshotPath: socialStartStateScreenshotPath,
    };
  }

  async function captureSettingsDialogReviewScreenshots() {
    if (!socialSettingsDesktopReviewPath && !socialSettingsNarrowReviewPath)
      return null;
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('设置窗口截图没有可用的 Noema 主窗口。');
    }
    const originalSize = mainWindow.getSize();
    try {
      const open = await mainWindow.webContents
        .executeJavaScript(`(async () => {
        const trigger = document.querySelector('.sidebar-settings-button');
        trigger?.click();
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          const dialog = document.querySelector('.settings-dialog[role="dialog"]');
          if (dialog) return {
            opened: true,
            title: dialog.querySelector('h2')?.textContent?.trim() ?? '',
            focusEntered: dialog.contains(document.activeElement),
            modelPicker: Boolean(dialog.querySelector('select[aria-label="在设置中选择对话模型"]')),
          };
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        return { opened: false, title: '', focusEntered: false, modelPicker: false };
      })()`);
      if (!open.opened || open.title !== '模型与搜索' || !open.focusEntered) {
        throw new Error(
          `设置窗口没有打开或接收初始焦点：${JSON.stringify(open)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 240));
      if (socialSettingsDesktopReviewPath) {
        mainWindow.setSize(1280, 800);
        await mainWindow.webContents.executeJavaScript(
          'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        );
        await new Promise((resolve) => setTimeout(resolve, 240));
        writeSmokeScreenshot(
          socialSettingsDesktopReviewPath,
          await mainWindow.capturePage(),
        );
      }
      if (socialSettingsNarrowReviewPath) {
        mainWindow.setSize(680, 560);
        await mainWindow.webContents.executeJavaScript(
          'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        );
        await new Promise((resolve) => setTimeout(resolve, 240));
        writeSmokeScreenshot(
          socialSettingsNarrowReviewPath,
          await mainWindow.capturePage(),
        );
      }
      const closed = await mainWindow.webContents
        .executeJavaScript(`new Promise((resolve) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(
          !document.querySelector('.settings-dialog[role="dialog"]'),
        )));
      })`);
      return { ...open, closed };
    } finally {
      mainWindow.setSize(originalSize[0], originalSize[1]);
    }
  }
  async function captureAuxiliarySurfaceReviewScreenshots() {
    const surfaces = [
      {
        path: socialGlobalSearchReviewPath,
        trigger: '.global-search-trigger',
        surface: '.global-search-dialog[role="dialog"]',
        close: 'button[aria-label="关闭全局搜索"]',
        label: '全局搜索',
      },
      {
        path: socialDiagnosticsReviewPath,
        trigger: '.diagnostics-trigger',
        surface: '.diagnostics-dialog[role="dialog"]',
        close: 'button[aria-label="关闭运行诊断"]',
        label: '运行诊断',
      },
    ].filter((item) => item.path);
    const enabled =
      surfaces.length > 0 ||
      socialArchivedProjectsReviewPath ||
      socialPersonalMemoryReviewPath ||
      socialUserFollowupsReviewPath ||
      socialAgentCreateReviewPath ||
      socialGroupCreateReviewPath ||
      socialProjectCreateReviewPath;
    if (!enabled) return null;
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('辅助界面截图没有可用的 Noema 主窗口。');
    }
    const screenshots: string[] = [];
    const waitForSelector = async (selector: string) =>
      mainWindow.webContents.executeJavaScript(`(async () => {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          if (document.querySelector(${JSON.stringify(selector)})) return true;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return false;
      })()`);
    const waitForMissing = async (selector: string) =>
      mainWindow.webContents.executeJavaScript(`(async () => {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          if (!document.querySelector(${JSON.stringify(selector)})) return true;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return false;
      })()`);
    const capture = async (path: string) => {
      await new Promise((resolve) => setTimeout(resolve, 240));
      await mainWindow.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      writeSmokeScreenshot(path, await mainWindow.capturePage());
      screenshots.push(path);
    };
    try {
      mainWindow.setSize(1280, 800);
      for (const item of surfaces) {
        await mainWindow.webContents.executeJavaScript(`(() => {
          document.querySelector(${JSON.stringify(item.trigger)})?.click();
        })()`);
        if (!(await waitForSelector(item.surface))) {
          throw new Error(`${item.label}没有打开。`);
        }
        if (item.label === '运行诊断') {
          const listFailure = await waitForSelector(
            '.diagnostics-list-retry[role="alert"]',
          );
          if (!listFailure) {
            throw new Error('诊断列表读取失败没有显示独立错误状态。');
          }
          const listErrorPath = item.path!.replace(
            /\.png$/u,
            '-list-error.png',
          );
          writeSmokeScreenshot(listErrorPath, await mainWindow.capturePage());
          screenshots.push(listErrorPath);
          await mainWindow.webContents.executeJavaScript(`(() => {
            const retry = [...document.querySelectorAll('.diagnostics-list-retry button')]
              .find((button) => button.textContent?.trim() === '重试');
            retry?.click();
          })()`);
          if (
            !(await waitForSelector('.diagnostics-execution-list li button'))
          ) {
            throw new Error('诊断列表重试后没有显示隔离执行记录。');
          }
          if (
            !(await waitForSelector('.diagnostics-list-retry[role="alert"]'))
          ) {
            throw new Error('时间线读取失败没有显示独立错误状态。');
          }
          const timelineErrorPath = item.path!.replace(
            /\.png$/u,
            '-timeline-error.png',
          );
          writeSmokeScreenshot(
            timelineErrorPath,
            await mainWindow.capturePage(),
          );
          screenshots.push(timelineErrorPath);
          await mainWindow.webContents.executeJavaScript(`(() => {
            const retry = [...document.querySelectorAll('.diagnostics-list-retry button')]
              .find((button) => button.textContent?.trim() === '重试时间线');
            retry?.click();
          })()`);
          if (!(await waitForSelector('.diagnostics-event-list li'))) {
            throw new Error('时间线重试后没有显示隔离事件。');
          }
        }
        await capture(item.path!);
        if (item.label === '运行诊断') {
          mainWindow.setSize(420, 720);
          await mainWindow.webContents.executeJavaScript(
            'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
          );
          const state = await mainWindow.webContents.executeJavaScript(`(() => {
            const dialog = document.querySelector('.diagnostics-dialog');
            const rect = dialog?.getBoundingClientRect();
            const body = dialog?.querySelector('.diagnostics-body');
            const layoutColumns = body
              ? getComputedStyle(body).gridTemplateColumns.trim().split(' ').length
              : 0;
            const moduleFilter = dialog?.querySelector('select[aria-label="按模块筛选诊断事件"]');
            const phaseFilter = dialog?.querySelector('select[aria-label="按阶段筛选诊断事件"]');
            const count = () => dialog?.querySelector('.diagnostics-event-filters > span')?.textContent?.trim() ?? '';
            const eventCount = () => dialog?.querySelectorAll('.diagnostics-event-list > li').length ?? 0;
            const setSelect = (select, value) => {
              select.value = value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            };
            return {
              fits: Boolean(
                rect && rect.left >= 0 && rect.right <= innerWidth &&
                rect.top >= 0 && rect.bottom <= innerHeight &&
                document.documentElement.scrollWidth <= innerWidth
              ),
              filters: Boolean(moduleFilter && phaseFilter),
              visibleEventCount: eventCount(),
              windowWidth: innerWidth,
              layoutColumns,
              bodyOverflow: Boolean(dialog && dialog.scrollWidth > dialog.clientWidth + 1),
              count: count(),
            };
          })()`);
          if (!state.fits || state.bodyOverflow || state.layoutColumns !== 1) {
            throw new Error(
              `诊断面板在 420px 窗口中出现溢出：${JSON.stringify(state)}`,
            );
          }
          if (state.visibleEventCount > 0 && !state.filters) {
            throw new Error('诊断事件已显示但模块/阶段筛选入口缺失。');
          }
          if (!state.filters || state.visibleEventCount < 4) {
            throw new Error(
              `诊断隔离事件或筛选项缺失：${JSON.stringify(state)}`,
            );
          }
          const filterResult = await mainWindow.webContents
            .executeJavaScript(`(async () => {
            const dialog = document.querySelector('.diagnostics-dialog');
            const moduleFilter = dialog.querySelector('select[aria-label="按模块筛选诊断事件"]');
            const phaseFilter = dialog.querySelector('select[aria-label="按阶段筛选诊断事件"]');
            const initialCount = dialog.querySelectorAll('.diagnostics-event-list > li').length;
            const setSelect = (select, value) => {
              select.value = value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            setSelect(moduleFilter, 'diagnostics');
            await settle();
            const moduleCount = dialog.querySelectorAll('.diagnostics-event-list > li').length;
            setSelect(phaseFilter, 'failed');
            await settle();
            const noMatch = Boolean(dialog.querySelector('.diagnostics-filter-empty button')) &&
              dialog.querySelectorAll('.diagnostics-event-list > li').length === 0;
            dialog.querySelector('.diagnostics-filter-empty button')?.click();
            await settle();
            const resetCount = dialog.querySelectorAll('.diagnostics-event-list > li').length;
            dialog.querySelector('.diagnostics-detail-heading button')?.click();
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline && !dialog.querySelector('.diagnostics-preview')) {
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            const previewText = dialog.querySelector('.diagnostics-preview')?.textContent ?? '';
            const previewEventLabel = previewText.split('个事件')[0] ?? '';
            const previewEventCount = Number(previewEventLabel.split('·').at(-1)?.trim());
            const fullExportScope = previewEventCount >= initialCount;
            dialog.querySelector('.diagnostics-preview-actions button')?.click();
            return { moduleCount, noMatch, resetCount, initialCount, previewEventCount, previewText, fullExportScope };
          })()`);
          if (
            filterResult.moduleCount < 2 ||
            !filterResult.noMatch ||
            filterResult.resetCount < 4 ||
            !filterResult.fullExportScope
          ) {
            throw new Error(
              `诊断筛选或完整范围导出行为不符：${JSON.stringify(filterResult)}`,
            );
          }
          const narrowPath = item.path!.replace(/\.png$/u, '-420.png');
          writeSmokeScreenshot(narrowPath, await mainWindow.capturePage());
          screenshots.push(narrowPath);
          mainWindow.setSize(1280, 800);
          await mainWindow.webContents.executeJavaScript(
            'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
          );
        }
        await mainWindow.webContents.executeJavaScript(`(() => {
          document.querySelector(${JSON.stringify(item.close)})?.click();
        })()`);
        if (!(await waitForMissing(item.surface))) {
          throw new Error(`${item.label}没有关闭。`);
        }
      }
      if (socialArchivedProjectsReviewPath) {
        await mainWindow.webContents.executeJavaScript(`(() => {
          document.querySelector('.bottom-link-archive')?.click();
        })()`);
        if (!(await waitForSelector('.work-head .work-title strong'))) {
          throw new Error('归档项目页面没有打开。');
        }
        await capture(socialArchivedProjectsReviewPath);
        await mainWindow.webContents.executeJavaScript(`(() => {
          document.querySelector('button[aria-label="返回 Noema 主聊"]')?.click();
        })()`);
        await waitForSelector('.social-shell');
      }
      const captureSettingsChild = async (
        entryLabel: string,
        closeLabel: string,
        surface: string,
        path: string,
      ) => {
        await mainWindow.webContents.executeJavaScript(`(() => {
          const button = [...document.querySelectorAll('.bottom-link')]
            .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(entryLabel)});
          if (!button) throw new Error(${JSON.stringify(`${entryLabel}侧栏入口不存在。`)});
          button.click();
        })()`);
        if (!(await waitForSelector(surface))) {
          throw new Error(`${entryLabel}界面没有打开。`);
        }
        await capture(path);
        const originalSize = mainWindow.getSize();
        const narrowPath = path.replace(/\.png$/u, '-420.png');
        try {
          mainWindow.setSize(420, 720);
          await mainWindow.webContents.executeJavaScript(
            'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
          );
          const layout = await mainWindow.webContents
            .executeJavaScript(`(() => {
            const dialog = document.querySelector(${JSON.stringify(surface)});
            const rect = dialog?.getBoundingClientRect();
            return Boolean(
              rect && rect.left >= 0 && rect.right <= window.innerWidth &&
              rect.top >= 0 && rect.bottom <= window.innerHeight &&
              dialog.scrollWidth <= dialog.clientWidth + 1 &&
              document.documentElement.scrollWidth <= window.innerWidth
            );
          })()`);
          if (!layout)
            throw new Error(`${entryLabel}在 420px 窗口中出现溢出。`);
          writeSmokeScreenshot(narrowPath, await mainWindow.capturePage());
          screenshots.push(narrowPath);
        } finally {
          mainWindow.setSize(originalSize[0], originalSize[1]);
          await mainWindow.webContents.executeJavaScript(
            'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
          );
        }
        await mainWindow.webContents.executeJavaScript(`(() => {
          document.querySelector(${JSON.stringify(`button[aria-label="${closeLabel}"]`)})?.click();
        })()`);
        if (!(await waitForMissing(surface))) {
          throw new Error(`${entryLabel}界面没有关闭。`);
        }
      };
      const captureCreationDialog = async (
        actionText: string,
        surface: string,
        path: string,
      ) => {
        await mainWindow.webContents.executeJavaScript(`(() => {
          document.querySelector('.sidebar-settings-button')?.click();
        })()`);
        if (!(await waitForSelector('.settings-dialog[role="dialog"]'))) {
          throw new Error('设置窗口没有打开。');
        }
        await new Promise((resolve) => setTimeout(resolve, 240));
        await mainWindow.webContents.executeJavaScript(`(() => {
          const button = [...document.querySelectorAll('.settings-dialog button')]
            .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(actionText)});
          button?.click();
        })()`);
        if (!(await waitForSelector(surface))) {
          throw new Error(`${actionText}界面没有打开。`);
        }
        await capture(path);
        await mainWindow.webContents.executeJavaScript(`(() => {
          document.querySelector(${JSON.stringify(`${surface} button[aria-label="关闭"]`)})?.click();
        })()`);
        if (!(await waitForMissing(surface))) {
          throw new Error(`${actionText}界面没有关闭。`);
        }
      };
      if (socialAgentCreateReviewPath) {
        await captureCreationDialog(
          '新建伙伴',
          '.agent-create-dialog[role="dialog"]',
          socialAgentCreateReviewPath,
        );
      }
      if (socialGroupCreateReviewPath) {
        await captureCreationDialog(
          '新建群聊',
          '.social-dialog[aria-labelledby="create-group-title"]',
          socialGroupCreateReviewPath,
        );
      }
      if (socialProjectCreateReviewPath) {
        await captureCreationDialog(
          '新建项目',
          '.project-dialog[role="dialog"]',
          socialProjectCreateReviewPath,
        );
      }
      if (socialPersonalMemoryReviewPath) {
        await captureSettingsChild(
          '个人记忆',
          '关闭个人记忆',
          '.personal-memory-dialog[role="dialog"]',
          socialPersonalMemoryReviewPath,
        );
      }
      if (socialUserFollowupsReviewPath) {
        await captureSettingsChild(
          '回访提醒',
          '关闭回访提醒',
          '.user-followups-dialog[role="dialog"]',
          socialUserFollowupsReviewPath,
        );
      }
      return { screenshots };
    } finally {
      mainWindow.setSize(1280, 800);
    }
  }
  async function verifyPersonalMemoryLifecycle() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('个人记忆 E2E 没有可用的 Noema 主窗口。');
    }
    return mainWindow.webContents.executeJavaScript(`(async () => {
      const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
      const until = async (predicate, label, timeoutMs = 6000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const result = await predicate();
          if (result) return result;
          await wait();
        }
        throw new Error('个人记忆 E2E 等待超时：' + label);
      };
      const openMemoryDialog = async () => {
        document.querySelector('.sidebar-settings-button')?.click();
        const settings = await until(
          () => document.querySelector('.settings-dialog[role="dialog"]'),
          'settings-open-for-duplicate-entry-check',
        );
        if ([...settings.querySelectorAll('button')].some((item) =>
          /个人记忆|回访提醒/.test(item.textContent ?? ''),
        )) {
          throw new Error('记忆和回访管理不应在设置中重复出现。');
        }
        settings.querySelector('button[aria-label="关闭"]')?.click();
        await until(
          () => !document.querySelector('.settings-dialog[role="dialog"]'),
          'settings-close-after-duplicate-entry-check',
        );
        const button = [...document.querySelectorAll('.bottom-link')]
          .find((item) => item.textContent?.trim() === '个人记忆');
        if (!button) throw new Error('Social 侧栏中找不到个人记忆入口。');
        button.click();
        return until(
          () => document.querySelector('.personal-memory-dialog[role="dialog"]'),
          'memory-dialog-open',
        );
      };
      const closeMemoryDialog = async () => {
        document.querySelector('button[aria-label="关闭个人记忆"]')?.click();
        await until(
          () => !document.querySelector('.personal-memory-dialog[role="dialog"]'),
          'memory-dialog-close',
        );
      };
      const getList = () => window.noema.getPersonalMemories();
      const waitForContent = async (content, present = true) =>
        until(async () => {
          const state = await getList();
          return state.items.some((item) => item.content === content) === present
            ? state
            : null;
        }, 'store-content-' + (present ? 'present' : 'removed'));
      const findMemoryItem = (dialog, content) =>
        [...dialog.querySelectorAll('.personal-memory-item')]
          .find((item) => item.querySelector('p')?.textContent === content) ?? null;
      const fillDraft = async (dialog, content, submitLabel) => {
        const textarea = dialog.querySelector('textarea');
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        if (!textarea || !setter) throw new Error('个人记忆编辑框不可用。');
        setter.call(textarea, content);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await until(() => {
          const submit = [...dialog.querySelectorAll('button')]
            .find((item) => item.textContent?.trim() === submitLabel);
          return textarea.value === content && submit && !submit.disabled;
        }, 'draft-ready-for-' + submitLabel);
      };
      const submitDraft = (dialog, label) => {
        const button = [...dialog.querySelectorAll('button')]
          .find((item) => item.textContent?.trim() === label);
        if (!button || button.disabled) throw new Error('个人记忆提交按钮不可用：' + label);
        button.click();
      };
      const originalContent = 'E2E memory source: original value.';
      const navigationContent = 'E2E memory source: navigation item.';
      const editedContent = 'E2E memory source: edited value.';
      const addedContent = 'E2E memory: added through settings.';
      const rejectedContent = 'E2E memory failure trigger';
      const seeded = await getList();
      const sourceMemory = seeded.items.find((item) => item.content === originalContent);
      const navigationMemory = seeded.items.find((item) => item.content === navigationContent);
      if (!sourceMemory?.sourceRoomId || !sourceMemory?.sourceMessageId)
        throw new Error('个人记忆 E2E 来源夹具没有正确建立。');
      if (!navigationMemory?.sourceRoomId || !navigationMemory?.sourceMessageId)
        throw new Error('个人记忆 E2E 导航来源夹具没有正确建立。');

      let dialog = await openMemoryDialog();
      const toggle = dialog.querySelector(
        '.personal-memory-toggle .permission-switch',
      );
      if (!toggle) throw new Error('个人记忆使用开关不可用。');
      const memorySwitchOn = () => toggle.getAttribute('aria-checked') === 'true';
      if (memorySwitchOn()) toggle.click();
      await until(async () => !(await getList()).enabled, 'memory-paused');
      const afterPause = await getList();
      if (!afterPause.items.some((item) => item.id === sourceMemory.id))
        throw new Error('暂停后个人记忆条目没有保留。');
      await until(() => !toggle.disabled, 'memory-paused-ui-ready');
      if (!memorySwitchOn()) toggle.click();
      await until(async () => (await getList()).enabled, 'memory-resumed');
      await until(() => !toggle.disabled, 'memory-resumed-ui-ready');

      const originalItem = findMemoryItem(dialog, originalContent);
      const editButton = [...(originalItem?.querySelectorAll('button') ?? [])]
        .find((item) => item.textContent?.trim() === '修改');
      if (!editButton) throw new Error('个人记忆修改入口不可用。');
      await until(() => !editButton.disabled, 'memory-edit-button-enabled');
      editButton.click();
      await until(
        () => [...dialog.querySelectorAll('button')].some(
          (item) => item.textContent?.trim() === '保存修改',
        ),
        'memory-edit-mode-rendered',
      );
      await fillDraft(dialog, editedContent, '保存修改');
      submitDraft(dialog, '保存修改');
      await waitForContent(editedContent);
      await closeMemoryDialog();

      dialog = await openMemoryDialog();
      await until(() => findMemoryItem(dialog, editedContent), 'memory-reopen-persisted');
      await fillDraft(dialog, addedContent, '添加记忆');
      submitDraft(dialog, '添加记忆');
      await waitForContent(addedContent);

      await fillDraft(dialog, rejectedContent, '添加记忆');
      submitDraft(dialog, '添加记忆');
      const error = await until(
        () => dialog.querySelector('.dialog-error[role="alert"]')?.textContent?.trim(),
        'store-error-visible',
      );
      if ((await getList()).items.some((item) => item.content === rejectedContent))
        throw new Error('触发存储错误的个人记忆不应落盘。');

      const addedItem = findMemoryItem(dialog, addedContent);
      const deleteButton = [...(addedItem?.querySelectorAll('button') ?? [])]
        .find((item) => item.textContent?.trim() === '删除');
      if (!deleteButton) throw new Error('个人记忆删除入口不可用。');
      deleteButton.click();
      const confirm = await until(() => {
        const group = [...dialog.querySelectorAll('.personal-memory-delete-confirm')]
          .find((item) => item.querySelector('span')?.textContent?.includes('删除这条记忆'));
        return group;
      }, 'delete-confirmation');
      [...confirm.querySelectorAll('button')]
        .find((item) => item.textContent?.trim() === '确认删除')?.click();
      await waitForContent(addedContent, false);
      await closeMemoryDialog();

      dialog = await openMemoryDialog();
      await until(() => findMemoryItem(dialog, editedContent), 'memory-after-second-reopen');
      const sourceItem = findMemoryItem(dialog, navigationContent);
      const sourceButton = [...(sourceItem?.querySelectorAll('button') ?? [])]
        .find((item) => item.textContent?.trim() === '查看来源');
      if (!sourceButton) throw new Error('个人记忆来源回跳入口不可用。');
      sourceButton.click();
      await until(
        () => !document.querySelector('.personal-memory-dialog[role="dialog"]'),
        'source-navigation-closed-dialog',
      );
      const sourceSelector = '[data-message-id="' + navigationMemory.sourceMessageId + '"]';
      await until(() => document.querySelector(sourceSelector), 'source-message-visible');
      const finalState = await getList();
      const result = {
        passed:
          !afterPause.enabled &&
          finalState.enabled &&
          finalState.items.some((item) => item.content === editedContent) &&
          !finalState.items.some((item) => item.content === addedContent) &&
          Boolean(error) &&
          Boolean(document.querySelector(sourceSelector)),
        pauseResume: !afterPause.enabled && finalState.enabled,
        editPersistedAfterReopen: finalState.items.some((item) => item.content === editedContent),
        addedDeleted: !finalState.items.some((item) => item.content === addedContent),
        uiErrorVisible: Boolean(error),
        sourceNavigation: Boolean(document.querySelector(sourceSelector)),
      };
      if (!result.passed) throw new Error('个人记忆 E2E 结果未达到预期。');
      return result;
    })()`);
  }
  async function verifyUserFollowupLifecycle() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('回访 E2E 没有可用的 Noema 主窗口。');
    }
    const lifecycleResult = await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
      const until = async (predicate, label, timeoutMs = 6000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const result = await predicate();
          if (result) return result;
          await wait();
        }
        throw new Error('回访 E2E 等待超时：' + label);
      };
      const openDialog = async () => {
        document.querySelector('.sidebar-settings-button')?.click();
        const settings = await until(
          () => document.querySelector('.settings-dialog[role="dialog"]'),
          'settings-open-for-duplicate-entry-check',
        );
        if ([...settings.querySelectorAll('button')].some((item) =>
          /个人记忆|回访提醒/.test(item.textContent ?? ''),
        )) {
          throw new Error('记忆和回访管理不应在设置中重复出现。');
        }
        settings.querySelector('button[aria-label="关闭"]')?.click();
        await until(
          () => !document.querySelector('.settings-dialog[role="dialog"]'),
          'settings-close-after-duplicate-entry-check',
        );
        const button = [...document.querySelectorAll('.bottom-link')]
          .find((item) => item.textContent?.trim() === '回访提醒');
        if (!button) throw new Error('Social 侧栏中找不到回访提醒入口。');
        button.click();
        return until(
          () => document.querySelector('.user-followups-dialog[role="dialog"]'),
          'followups-dialog-open',
        );
      };
      const closeDialog = async () => {
        document.querySelector('button[aria-label="关闭回访提醒"]')?.click();
        await until(
          () => !document.querySelector('.user-followups-dialog[role="dialog"]'),
          'followups-dialog-close',
        );
      };
      const getList = () => window.noema.getUserFollowups();
      const waitForItem = async (predicate, label) =>
        until(async () => {
          const state = await getList();
          return state.items.find(predicate) ?? null;
        }, label);
      const inputSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      const textareaSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      const fill = async (dialog, { title, body, dueAt }, submitLabel) => {
        const titleInput = dialog.querySelector('input:not([type="checkbox"]):not([type="datetime-local"])');
        const bodyInput = dialog.querySelector('textarea');
        const dateInput = dialog.querySelector('input[type="datetime-local"]');
        if (!titleInput || !bodyInput || !dateInput || !inputSetter || !textareaSetter)
          throw new Error('回访编辑表单不可用。');
        if (title !== undefined) {
          inputSetter.call(titleInput, title);
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (body !== undefined) {
          textareaSetter.call(bodyInput, body);
          bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        let localValue;
        if (dueAt !== undefined) {
          const localDate = new Date(dueAt);
          localValue = new Date(
            localDate.getTime() - localDate.getTimezoneOffset() * 60_000,
          ).toISOString().slice(0, 16);
          inputSetter.call(dateInput, localValue);
          dateInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await until(() => {
          const submitButton = [...dialog.querySelectorAll('button')]
            .find((item) => item.textContent?.trim() === submitLabel);
          return Boolean(
            submitButton &&
            !submitButton.disabled &&
            (title === undefined || titleInput.value === title) &&
            (body === undefined || bodyInput.value === body) &&
            (localValue === undefined || dateInput.value === localValue),
          );
        }, 'followup-form-ready-for-' + submitLabel);
      };
      const submit = (dialog, label) => {
        const button = [...dialog.querySelectorAll('button')]
          .find((item) => item.textContent?.trim() === label);
        if (!button || button.disabled) throw new Error('回访提交按钮不可用：' + label);
        button.click();
      };
      const sourceTitle = 'E2E follow-up original title.';
      const editedTitle = 'E2E follow-up edited title.';
      const addedTitle = 'E2E follow-up added title.';
      const rejectedTitle = 'E2E follow-up failure trigger';
      const seeded = await getList();
      const sourceItem = seeded.items.find((item) => item.title === sourceTitle);
      const deletedSourceItem = seeded.items.find(
        (item) => item.title === 'E2E follow-up deleted source',
      );
      const retryItem = seeded.items.find(
        (item) => item.title === 'E2E follow-up retry state',
      );
      const overdueItem = seeded.items.find(
        (item) => item.title === 'E2E follow-up overdue state',
      );
      if (!sourceItem?.sourceMessageId || !sourceItem?.sourceRoomId)
        throw new Error('回访 E2E 来源夹具没有建立。');
      if (!deletedSourceItem || deletedSourceItem.sourceMessageCreatedAt)
        throw new Error('回访 E2E 已删除来源夹具没有正确建立。');
      if (!retryItem?.lastError)
        throw new Error('回访 E2E 通知失败状态夹具没有建立。');
      if (!overdueItem || Date.parse(overdueItem.dueAt) > Date.now())
        throw new Error('回访 E2E 逾期状态夹具没有建立。');

      let dialog = await openDialog();
      const toggle = dialog.querySelector(
        '.personal-memory-toggle input[type="checkbox"]',
      );
      if (!toggle) throw new Error('回访通知开关不可用。');
      if (toggle.checked) toggle.click();
      await until(async () => !(await getList()).enabled, 'followups-paused');
      const pausedState = await getList();
      if (!pausedState.items.some((item) => item.id === sourceItem.id))
        throw new Error('暂停后回访没有保留。');
      const overdueCard = [...dialog.querySelectorAll('.personal-memory-item')]
        .find((item) => item.querySelector('strong')?.textContent === overdueItem.title);
      const overdueVisible = Boolean(overdueCard?.querySelector('[data-state="overdue"]'));
      const timeLabel = [...dialog.querySelectorAll('label')]
        .find((item) => item.textContent?.includes('提醒时间'));
      const timezoneVisible = Boolean(
        timeLabel?.textContent?.includes(Intl.DateTimeFormat().resolvedOptions().timeZone),
      );
      if (!overdueVisible || !timezoneVisible)
        throw new Error('回访逾期状态或本机时区未显示。');
      if (!toggle.checked) toggle.click();
      await until(async () => (await getList()).enabled, 'followups-resumed');
      await until(() => !toggle.disabled, 'followups-resumed-ui-ready');

      const sourceCard = [...dialog.querySelectorAll('.personal-memory-item')]
        .find((item) => item.querySelector('strong')?.textContent === sourceTitle);
      const editButton = [...(sourceCard?.querySelectorAll('button') ?? [])]
        .find((item) => item.textContent?.trim() === '修改');
      if (!editButton) throw new Error('待处理回访的修改入口不可用。');
      await until(() => !editButton.disabled, 'followup-edit-button-enabled');
      editButton.click();
      await until(
        () => [...dialog.querySelectorAll('button')].some(
          (item) => item.textContent?.trim() === '保存修改',
        ),
        'followup-edit-mode-rendered',
      );
      const editedDueAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await fill(dialog, {
        title: editedTitle,
        body: 'E2E follow-up edited body.',
        dueAt: editedDueAt,
      }, '保存修改');
      submit(dialog, '保存修改');
      await waitForItem((item) => item.title === editedTitle, 'followup-edited');
      await closeDialog();

      dialog = await openDialog();
      await until(
        () => [...dialog.querySelectorAll('.personal-memory-item')]
          .some((item) => item.querySelector('strong')?.textContent === editedTitle),
        'followup-persisted-after-reopen',
      );
      const addedDueAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await fill(dialog, {
        title: addedTitle,
        body: 'E2E follow-up added body.',
        dueAt: addedDueAt,
      }, '安排回访');
      submit(dialog, '安排回访');
      const addedItem = await waitForItem((item) => item.title === addedTitle, 'followup-added');

      await fill(dialog, {
        title: rejectedTitle,
        body: 'E2E follow-up rejected body.',
        dueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }, '安排回访');
      submit(dialog, '安排回访');
      const error = await until(
        () => dialog.querySelector('.dialog-error[role="alert"]')?.textContent?.trim(),
        'followup-store-error-visible',
      );
      if ((await getList()).items.some((item) => item.title === rejectedTitle))
        throw new Error('触发存储错误的回访不应落盘。');

      const addedCard = [...dialog.querySelectorAll('.personal-memory-item')]
        .find((item) => item.querySelector('strong')?.textContent === addedTitle);
      [...(addedCard?.querySelectorAll('button') ?? [])]
        .find((item) => item.textContent?.trim() === '取消')?.click();
      await until(async () => {
        const current = await getList();
        return current.items.find((item) => item.id === addedItem.id)?.status === 'canceled';
      }, 'followup-canceled');
      await closeDialog();

      dialog = await openDialog();
      const finalState = await getList();
      const deletedSourceCard = [...dialog.querySelectorAll('.personal-memory-item')]
        .find((item) => item.querySelector('strong')?.textContent === deletedSourceItem.title);
      const retryCard = [...dialog.querySelectorAll('.personal-memory-item')]
        .find((item) => item.querySelector('strong')?.textContent === retryItem.title);
      const editedSourceCard = [...dialog.querySelectorAll('.personal-memory-item')]
        .find((item) => item.querySelector('strong')?.textContent === editedTitle);
      const sourceLink = [...(editedSourceCard?.querySelectorAll('button') ?? [])]
        .find((item) => item.textContent?.trim() === '查看来源');
      if (!sourceLink) throw new Error('回访卡片缺少可用的来源回跳。');
      sourceLink.click();
      await until(
        () => !document.querySelector('.user-followups-dialog[role="dialog"]'),
        'followup-source-panel-closes',
      );
      const sourceSelector = '[data-message-id="' + sourceItem.sourceMessageId + '"]';
      const sourcePanelNavigation = await until(
        () => document.querySelector(sourceSelector),
        'followup-source-panel-navigation',
      );
      const result = {
        passed:
          !pausedState.enabled &&
          finalState.enabled &&
          finalState.items.some((item) => item.title === editedTitle) &&
          finalState.items.find((item) => item.id === addedItem.id)?.status === 'canceled' &&
          Boolean(error) &&
          overdueVisible &&
          timezoneVisible &&
          Boolean(deletedSourceCard?.textContent?.includes('原消息已删除')) &&
          Boolean(retryCard?.querySelector('[data-state="retry"]')) &&
          Boolean(sourcePanelNavigation),
        pauseResume: !pausedState.enabled && finalState.enabled,
        editPersistedAfterReopen: finalState.items.some((item) => item.title === editedTitle),
        addAndCancel: finalState.items.find((item) => item.id === addedItem.id)?.status === 'canceled',
        uiErrorVisible: Boolean(error),
        deletedSourceVisible: Boolean(deletedSourceCard?.textContent?.includes('原消息已删除')),
        retryStateVisible: Boolean(retryCard?.querySelector('[data-state="retry"]')),
        sourcePanelNavigation: Boolean(sourcePanelNavigation),
        overdueVisible,
        timezoneVisible,
        sourceFollowupId: sourceItem.id,
        sourceRoomId: sourceItem.sourceRoomId,
        sourceMessageId: sourceItem.sourceMessageId,
      };
      if (!result.passed) throw new Error('回访 E2E 结果未达到预期。');
      return result;
    })()`);
    if (!lifecycleResult.passed) throw new Error('回访 E2E 事务未达到预期。');
    if (!context.openFollowupSourceForTest)
      throw new Error('回访 E2E 的来源导航入口不可用。');
    const dispatched = context.openFollowupSourceForTest({
      followupId: lifecycleResult.sourceFollowupId,
      sourceRoomId: lifecycleResult.sourceRoomId,
      sourceMessageId: lifecycleResult.sourceMessageId,
    });
    if (!dispatched)
      throw new Error('回访来源事件没有发送到已就绪的 Social 界面。');
    const sourceSelector = `[data-message-id="${lifecycleResult.sourceMessageId}"]`;
    const sourceNavigation = await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const selector = ${JSON.stringify(sourceSelector)};
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        if (document.querySelector(selector)) return true;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return false;
    })()`);
    const result = {
      ...lifecycleResult,
      sourceNavigation: sourceNavigation === true,
      passed: lifecycleResult.passed && sourceNavigation === true,
    };
    if (!result.passed) throw new Error('回访 E2E 来源导航未抵达原始消息。');
    return result;
  }
  async function captureHistoryTraceSmokeScreenshots() {
    if (!testCaptureHistoryTrace) return null;
    const deadline = Date.now() + 10_000;
    let traceState = null;
    while (Date.now() < deadline && mainWindow && !mainWindow.isDestroyed()) {
      traceState = await mainWindow.webContents.executeJavaScript(`(() => {
      const traces = [...document.querySelectorAll('details.history-recall-trace')];
      traces.forEach((trace) => { trace.open = true; });
      const includedTrace = traces.find((trace) =>
        trace.textContent?.includes('本轮请求已包含'),
      );
      includedTrace?.scrollIntoView({ block: 'center' });
      return {
        heading: document.querySelector('.page-heading h1')?.textContent?.trim() ?? null,
        contextActions: [...document.querySelectorAll('.composer-context-tools button')]
          .map((button) => button.textContent?.trim() ?? '')
          .filter(Boolean),
        found: traces.some((trace) =>
          trace.textContent?.includes('本机找到') ||
          trace.textContent?.includes('本轮请求已包含'),
        ),
        included: Boolean(includedTrace),
        sourceCount: document.querySelectorAll('.history-recall-trace li').length,
        jumpButtonCount: document.querySelectorAll('.history-source-heading button:not(:disabled)').length,
        noMatch: traces.some((trace) => trace.textContent?.includes('没有找到相关原文')),
      };
    })()`);
      if (traceState?.found && traceState.sourceCount > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    if (
      !traceState?.found ||
      traceState.sourceCount < 1 ||
      traceState.jumpButtonCount < 1
    ) {
      throw new Error('历史来源披露没有显示可检查的原文来源。');
    }
    await mainWindow?.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const screenshots = [];
    if (historyTraceDesktopScreenshotPath) {
      const image = await mainWindow?.capturePage();
      if (!image) throw new Error('无法捕获历史来源披露桌面预览。');
      writeSmokeScreenshot(historyTraceDesktopScreenshotPath, image);
      screenshots.push(historyTraceDesktopScreenshotPath);
    }
    mainWindow?.setSize(827, 573);
    await mainWindow?.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const intermediateTopbarFits = await mainWindow?.webContents
      .executeJavaScript(`(() => {
    const header = document.querySelector('.topbar');
    if (!header) return false;
    const bounds = header.getBoundingClientRect();
    const controls = [...header.querySelectorAll('.topbar-tools > *')];
    return (
      header.scrollWidth <= header.clientWidth &&
      controls.length >= 4 &&
      controls.every((control) => {
        const rect = control.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.left >= bounds.left - 1 &&
          rect.right <= bounds.right + 1
        );
      })
    );
  })()`);
    if (!intermediateTopbarFits) {
      throw new Error(
        'Model controls overflow the app header at 827 × 573 CSS pixels.',
      );
    }
    if (historyTraceIntermediateScreenshotPath) {
      await mainWindow?.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      const image = await mainWindow?.capturePage();
      if (!image) throw new Error('无法捕获历史来源披露中间视口预览。');
      writeSmokeScreenshot(historyTraceIntermediateScreenshotPath, image);
      screenshots.push(historyTraceIntermediateScreenshotPath);
    }
    if (historyTraceNarrowScreenshotPath) {
      mainWindow?.setSize(680, 560);
      await mainWindow?.webContents
        .executeJavaScript(`new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.querySelector('details.history-recall-trace')?.scrollIntoView({ block: 'center' });
        requestAnimationFrame(resolve);
      }));
    })`);
      const image = await mainWindow?.capturePage();
      if (!image) throw new Error('无法捕获历史来源披露窄窗口预览。');
      writeSmokeScreenshot(historyTraceNarrowScreenshotPath, image);
      screenshots.push(historyTraceNarrowScreenshotPath);
    }
    await mainWindow?.webContents.executeJavaScript(`(() => {
    document.querySelector('.history-source-heading button:not(:disabled)')?.click();
  })()`);
    const jumpWorked = await mainWindow?.webContents
      .executeJavaScript(`new Promise((resolve) => {
    requestAnimationFrame(() => resolve(Boolean(
      document.activeElement?.id?.startsWith('transcript-message-')
    )));
  })`);
    if (!jumpWorked) throw new Error('历史来源按钮没有跳回原时间线消息。');
    return { ...traceState, jumpWorked, intermediateTopbarFits, screenshots };
  }

  async function captureLegacyArchiveSmokeScreenshots() {
    if (!testCaptureLegacyArchive) return null;
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('历史归档 smoke 没有可用窗口。');
    }
    mainWindow.setSize(1280, 800);
    const waitFor = async (selector: string) =>
      mainWindow.webContents.executeJavaScript(`(async () => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.querySelector(${JSON.stringify(selector)})) return true;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return false;
      })()`);
    const legacyUrl = new URL(mainWindow.webContents.getURL());
    legacyUrl.hash = 'legacy';
    await mainWindow.loadURL(legacyUrl.toString());
    if (!(await waitFor('.social-shell'))) {
      throw new Error('#legacy 退役入口没有回到默认 Social 界面。');
    }
    const retiredRouteState = await mainWindow.webContents
      .executeJavaScript(`(() => ({
      currentHash: window.location.hash,
      socialOnly: Boolean(document.querySelector('.social-shell')) &&
        !document.querySelector('.legacy-history-dialog, .capture-card, .quick-capture-dialog, .legacy-desktop-app'),
    }))()`);
    if (!retiredRouteState.socialOnly) {
      throw new Error(
        `#legacy 没有彻底退役并回到默认 Social：${JSON.stringify(retiredRouteState)}`,
      );
    }
    await mainWindow.webContents.executeJavaScript(`(() => {
      document.querySelector('.diagnostics-trigger')?.click();
    })()`);
    if (!(await waitFor('.diagnostics-dialog[role="dialog"]'))) {
      throw new Error('运行诊断入口没有打开，无法进入历史归档。');
    }
    await mainWindow.webContents.executeJavaScript(`(() => {
      [...document.querySelectorAll('.diagnostics-history-link')]
        .find((button) => button.textContent?.trim() === '历史归档')?.click();
    })()`);
    if (!(await waitFor('.legacy-history-dialog[role="dialog"]'))) {
      throw new Error('独立历史归档入口没有打开只读归档。');
    }
    await mainWindow.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('#legacy-history-category');
      if (!select) return;
      select.value = 'captures';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    if (!(await waitFor('.legacy-history-record-preview'))) {
      throw new Error('历史归档没有读取到隔离速记记录。');
    }
    const desktopState = await mainWindow.webContents
      .executeJavaScript(`(() => {
      const dialog = document.querySelector('.legacy-history-dialog');
      const record = dialog?.querySelector('.legacy-history-record');
      const rect = dialog?.getBoundingClientRect();
      return {
        category: dialog?.querySelector('#legacy-history-category')?.value ?? '',
        containsFixture: record?.textContent?.includes('NOEMA-LOCAL-CAPTURE-SEARCH') ?? false,
        sourceLabel: record?.textContent?.includes('来源：Root') ?? false,
        readOnly: (dialog?.querySelectorAll('.legacy-history-record-list button').length ?? 0) === 0,
        fits: Boolean(rect && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight),
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      };
    })()`);
    if (
      desktopState.category !== 'captures' ||
      !desktopState.containsFixture ||
      !desktopState.sourceLabel ||
      !desktopState.readOnly ||
      !desktopState.fits ||
      !desktopState.noHorizontalOverflow
    ) {
      throw new Error(
        `历史速记没有以只读记录显示：${JSON.stringify(desktopState)}`,
      );
    }
    const screenshots = [];
    if (legacyArchiveDesktopScreenshotPath) {
      writeSmokeScreenshot(
        legacyArchiveDesktopScreenshotPath,
        await mainWindow.capturePage(),
      );
      screenshots.push(legacyArchiveDesktopScreenshotPath);
    }
    await mainWindow.webContents.executeJavaScript(`(() => {
      const checkbox = [...document.querySelectorAll('.legacy-history-export-categories input[type="checkbox"]')]
        .find((input) => input.closest('.bp6-control')?.textContent?.includes('速记记录'));
      checkbox?.click();
      [...document.querySelectorAll('.legacy-history-export button')]
        .find((button) => button.textContent?.trim() === '预览导出内容')?.click();
    })()`);
    if (!(await waitFor('.legacy-history-export-preview'))) {
      throw new Error('历史速记的本地导出预览没有生成。');
    }
    const exportPreviewValid = await mainWindow.webContents
      .executeJavaScript(`(() => {
      const preview = document.querySelector('.legacy-history-export-preview');
      return Boolean(preview?.textContent?.includes('1 条记录') && preview.textContent.includes('速记记录'));
    })()`);
    if (!exportPreviewValid) throw new Error('历史速记导出预览范围错误。');
    await mainWindow.webContents.executeJavaScript(`(() => {
      [...document.querySelectorAll('.legacy-history-export-preview button')]
        .find((button) => button.textContent?.trim() === '取消预览')?.click();
    })()`);

    mainWindow.setSize(680, 560);
    const narrowState = await mainWindow.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('.legacy-history-dialog');
      const rect = dialog?.getBoundingClientRect();
      return {
        fits: Boolean(rect && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight),
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
        readOnly: (dialog?.querySelectorAll('.legacy-history-record-list button').length ?? 0) === 0,
      };
    })()`);
    if (
      !narrowState.fits ||
      !narrowState.noHorizontalOverflow ||
      !narrowState.readOnly
    ) {
      throw new Error(
        `窄窗口历史归档布局或只读边界不符：${JSON.stringify(narrowState)}`,
      );
    }
    if (legacyArchiveNarrowScreenshotPath) {
      writeSmokeScreenshot(
        legacyArchiveNarrowScreenshotPath,
        await mainWindow.capturePage(),
      );
      screenshots.push(legacyArchiveNarrowScreenshotPath);
    }
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(`(() => {
      document.querySelector('button[aria-label="关闭历史归档"]')?.click();
    })()`);
    if (!(await waitFor('.social-shell'))) {
      throw new Error('关闭历史归档后没有返回 Social 主界面。');
    }
    return {
      opened: true,
      legacyRouteRetired:
        retiredRouteState.redirected && retiredRouteState.socialOnly,
      matchedCapture: desktopState.containsFixture,
      readOnly: desktopState.readOnly && narrowState.readOnly,
      exportPreviewValid,
      desktopNoOverflow: desktopState.noHorizontalOverflow,
      narrowNoOverflow: narrowState.noHorizontalOverflow,
      screenshots,
    };
  }

  async function inspectModelAvailabilitySmoke(
    models: Array<{
      name: string;
      routeKind: 'router' | 'direct';
      executionStatus: 'ready' | 'needsKey' | 'exhausted' | null;
    }>,
    selectedModel: string | null,
    providerState: {
      connected: boolean;
      providerConfigured: boolean;
      providerName: string;
    },
  ) {
    if (!testCaptureModelAvailability && models.length === 0) return null;
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('模型状态 smoke 没有可用窗口。');
    }
    const socialSurface = await mainWindow.webContents.executeJavaScript(
      'Boolean(document.querySelector(".social-shell"))',
    );
    if (socialSurface) {
      mainWindow.setSize(1280, 720);
      const socialState = await mainWindow.webContents
        .executeJavaScript(`new Promise((resolve) => {
      document.querySelector('[aria-label="设置"]')?.click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
      const dialog = document.querySelector('.settings-dialog');
      const select = dialog?.querySelector('select[aria-label="在设置中选择对话模型"]');
      const warning = document.querySelector('.provider-warning')?.textContent?.trim() ?? '';
      resolve({
        options: [...(select?.options ?? [])].map((option) => ({
          value: option.value,
          label: option.textContent?.trim() ?? '',
          disabled: option.disabled,
        })),
        selectedModel: select?.value ?? '',
        connectionSummary: dialog?.querySelector('.connection-summary')?.textContent?.trim() ?? '',
        passwordFieldCount: dialog?.querySelectorAll('input[type="password"]').length ?? 0,
        dialogVisible: Boolean(dialog),
        composerDisabled: Boolean(document.querySelector('#social-message-input')?.disabled),
        warning,
      });
      }));
    })`);
      const mismatches = models.flatMap((model) => {
        const option = socialState.options.find(
          (candidate: { value: string; label: string; disabled: boolean }) =>
            candidate.value === model.name,
        );
        if (!option) return [`missing social model option: ${model.name}`];
        if (model.routeKind === 'router' && !option.label.includes('自动')) {
          return [`router is not labeled automatic: ${model.name}`];
        }
        if (
          ['exhausted', 'needsKey'].includes(model.executionStatus ?? '') &&
          !option.disabled
        ) {
          return [`unavailable route is not disabled: ${model.name}`];
        }
        if (model.executionStatus === 'ready' && option.disabled) {
          return [`ready route is disabled: ${model.name}`];
        }
        return [];
      });
      if (mismatches.length) {
        throw new Error(
          `Noema 设置中的模型列表与 FreeLLMAPI 状态不一致：${mismatches.join('; ')}`,
        );
      }
      if (!socialState.dialogVisible) {
        throw new Error('连接与模型设置没有打开。');
      }
      const selectedStatus = models.find(
        (model) => model.name === selectedModel,
      )?.executionStatus;
      const selectedUnavailable =
        selectedStatus === 'exhausted' || selectedStatus === 'needsKey';
      const providerReady = Boolean(
        providerState.connected && models.length > 0 && !selectedUnavailable,
      );
      if (socialState.selectedModel !== (selectedModel ?? '')) {
        throw new Error(
          `设置中的当前模型与 Noema 持久化选择不一致（UI=${JSON.stringify(socialState.selectedModel)}, store=${JSON.stringify(selectedModel)}, options=${JSON.stringify(socialState.options.map((option: { value: string }) => option.value))}）。`,
        );
      }
      const expectedConnectionSummary = providerState.providerConfigured
        ? providerState.connected
          ? `${providerState.providerName} 已连接`
          : `${providerState.providerName} 已配置，当前连接不可用`
        : '';
      if (
        expectedConnectionSummary &&
        !socialState.connectionSummary.includes(expectedConnectionSummary)
      ) {
        throw new Error('连接设置没有显示当前模型服务的真实连接状态。');
      }
      if (
        providerState.providerConfigured &&
        socialState.passwordFieldCount !== 0
      ) {
        throw new Error('已保存的模型密钥出现在设置页面中。');
      }
      if (providerReady === socialState.composerDisabled) {
        throw new Error('所选模型状态与聊天输入框的可用状态不一致。');
      }
      if (Boolean(socialState.warning) === providerReady) {
        throw new Error('聊天输入区没有按模型服务的真实状态显示提示。');
      }

      const screenshots: string[] = [];
      if (modelAvailabilityScreenshotPath) {
        writeSmokeScreenshot(
          modelAvailabilityScreenshotPath,
          await mainWindow.capturePage(),
        );
        screenshots.push(modelAvailabilityScreenshotPath);
      }
      let narrowLayoutValid: boolean | null = null;
      if (modelAvailabilityNarrowScreenshotPath) {
        mainWindow.setSize(420, 720);
        narrowLayoutValid = await mainWindow.webContents
          .executeJavaScript(`(() => {
        const dialog = document.querySelector('.settings-dialog');
        const rect = dialog?.getBoundingClientRect();
        const footer = dialog?.querySelector('.settings-dialog-footer')?.getBoundingClientRect();
        return Boolean(
          document.documentElement.scrollWidth <= window.innerWidth &&
          rect && rect.left >= 0 && rect.right <= window.innerWidth &&
          rect.top >= 0 && rect.bottom <= window.innerHeight &&
          footer && footer.top >= rect.top && footer.bottom <= rect.bottom &&
          dialog.querySelector('select[aria-label="在设置中选择对话模型"]') &&
          dialog.querySelector('.connection-summary-actions button')
        );
      })()`);
        if (!narrowLayoutValid) {
          throw new Error('窄窗口下连接与模型设置超出可视范围。');
        }
        writeSmokeScreenshot(
          modelAvailabilityNarrowScreenshotPath,
          await mainWindow.capturePage(),
        );
        screenshots.push(modelAvailabilityNarrowScreenshotPath);
      }
      let replacementCredentialIsEmpty: boolean | null = null;
      if (providerState.providerConfigured) {
        replacementCredentialIsEmpty = await mainWindow.webContents
          .executeJavaScript(`new Promise((resolve) => {
        const dialog = document.querySelector('.settings-dialog');
        [...(dialog?.querySelectorAll('button') ?? [])]
          .find((button) => button.textContent?.trim() === '更改配置')?.click();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const input = dialog?.querySelector('input[type="password"]');
          const emptyMaskedInput = Boolean(
            input && input.type === 'password' && input.value === ''
          );
          dialog?.querySelector('button[aria-label="关闭"]')?.click();
          resolve(emptyMaskedInput);
        }));
      })`);
        if (!replacementCredentialIsEmpty) {
          throw new Error('更改配置时没有显示空白的掩码密钥输入框。');
        }
      }
      return {
        verified: true,
        routes: models,
        options: socialState.options,
        selectedModel: socialState.selectedModel,
        connectionSummary: socialState.connectionSummary,
        selectedUnavailable,
        narrowLayoutValid,
        replacementCredentialIsEmpty,
        screenshots,
      };
    }
    if (
      modelAvailabilityScreenshotPath ||
      modelAvailabilityNarrowScreenshotPath
    ) {
      mainWindow.setSize(1280, 720);
    }
    const state: {
      options: Array<{ value: string; label: string; disabled: boolean }>;
      selectedModel: string;
      readinessLabel: string;
      readinessStatus: string;
      sendDisabled: boolean;
      unavailableNoticeVisible: boolean;
    } = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
    const draft = document.querySelector('#message-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(draft, '[NOEMA model-status smoke]');
    draft?.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      options: [...(document.querySelector('select[aria-label="选择免费回复模型"]')?.options ?? [])]
        .map((option) => ({ value: option.value, label: option.textContent?.trim() ?? '', disabled: option.disabled })),
      selectedModel: document.querySelector('select[aria-label="选择免费回复模型"]')?.value ?? '',
      readinessLabel: document.querySelector('.model-readiness-badge')?.textContent?.trim() ?? '',
      readinessStatus: document.querySelector('.model-readiness-badge')?.getAttribute('data-status') ?? '',
      sendDisabled: Boolean(document.querySelector('.send-button')?.disabled),
      unavailableNoticeVisible: [...document.querySelectorAll('.connection-notice strong')]
        .some((node) => node.textContent?.includes('所选模型当前不可用')),
    })));
  })`);
    const mismatches = models.flatMap((model) => {
      const option = state.options.find(
        (candidate) => candidate.value === model.name,
      );
      if (!option) return [`missing option: ${model.name}`];
      if (model.routeKind === 'router' && !option.label.includes('自动')) {
        return [`router is not labeled automatic: ${model.name}`];
      }
      if (model.executionStatus === 'ready' && option.disabled) {
        return [`ready route is disabled: ${model.name}`];
      }
      if (model.executionStatus === 'exhausted' && !option.disabled) {
        return [`exhausted route is not disabled: ${model.name}`];
      }
      if (model.executionStatus === 'needsKey' && !option.disabled) {
        return [`unkeyed route is not disabled: ${model.name}`];
      }
      return [];
    });
    if (mismatches.length) {
      throw new Error(
        `模型状态显示不符合 FreeLLMAPI 报告：${mismatches.join('; ')}`,
      );
    }
    const selectedStatus = models.find(
      (model) => model.name === selectedModel,
    )?.executionStatus;
    const selectedUnavailable = Boolean(
      selectedModel &&
      (!models.some((model) => model.name === selectedModel) ||
        selectedStatus === 'exhausted' ||
        selectedStatus === 'needsKey'),
    );
    const expectedReadinessLabel = selectedUnavailable
      ? selectedStatus === 'exhausted'
        ? '冷却中'
        : selectedStatus === 'needsKey'
          ? '需密钥'
          : '不可用'
      : selectedStatus === 'ready'
        ? '可用'
        : '状态未知';
    const expectedReadinessStatus =
      selectedStatus ?? (selectedUnavailable ? 'exhausted' : 'unknown');
    if (
      state.readinessLabel !== expectedReadinessLabel ||
      state.readinessStatus !== expectedReadinessStatus
    ) {
      throw new Error('所选模型的实时状态没有显示在模型控件旁。');
    }
    if (
      selectedUnavailable &&
      (!state.sendDisabled || !state.unavailableNoticeVisible)
    ) {
      throw new Error('不可用的所选模型仍可发送，或没有显示恢复说明。');
    }
    if (!selectedUnavailable && state.sendDisabled) {
      throw new Error('可用的所选模型被错误地阻止发送。');
    }
    const screenshot = modelAvailabilityScreenshotPath
      ? (() => {
          mainWindow.setSize(1280, 720);
          return mainWindow.capturePage();
        })()
      : null;
    if (screenshot && modelAvailabilityScreenshotPath) {
      writeSmokeScreenshot(modelAvailabilityScreenshotPath, await screenshot);
    }
    let narrowLayoutValid: boolean | null = null;
    if (modelAvailabilityNarrowScreenshotPath) {
      mainWindow.setSize(680, 560);
      narrowLayoutValid = await mainWindow.webContents
        .executeJavaScript(`new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const header = document.querySelector('.topbar');
        const bounds = header?.getBoundingClientRect();
        const controls = [...(header?.querySelectorAll('.topbar-tools > *') ?? [])];
        resolve(Boolean(
          document.documentElement.scrollWidth <= window.innerWidth &&
          header && bounds && header.scrollWidth <= header.clientWidth &&
          controls.every((control) => {
            const rect = control.getBoundingClientRect();
            return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
          })
        ));
      }));
    })`);
      if (!narrowLayoutValid) {
        throw new Error('窄窗口下模型状态标签挤出了顶部控件或页面。');
      }
      writeSmokeScreenshot(
        modelAvailabilityNarrowScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
    return {
      verified: true,
      routeCount: models.length,
      selectedUnavailable,
      narrowLayoutValid,
      routes: models.map((model) => ({
        name: model.name,
        routeKind: model.routeKind,
        executionStatus: model.executionStatus,
      })),
      screenshots: [
        modelAvailabilityScreenshotPath,
        modelAvailabilityNarrowScreenshotPath,
      ].filter(Boolean),
    };
  }

  async function captureSocialChatSmokeScreenshots() {
    if (!captureSocialChatSmoke) return null;
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('社交聊天 smoke 没有可用窗口。');
    }
    const originalSize = mainWindow.getSize();
    const screenshots: string[] = [];
    try {
      const inspectAt = async (width: number, height: number) => {
        mainWindow?.setSize(width, height);
        await mainWindow?.webContents.executeJavaScript(
          'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        );
        return mainWindow?.webContents.executeJavaScript(`(() => {
        const shell = document.querySelector('.social-shell');
        const panel = document.querySelector('.conversation-panel');
        const header = document.querySelector('.room-header');
        const composer = document.querySelector('.message-composer');
        const routing = document.querySelector('.reply-routing');
        const rect = composer?.getBoundingClientRect();
        const groupedResponseTurns = [...document.querySelectorAll('.conversation-turn')]
          .filter((turn) => turn.querySelectorAll('.chat-message').length > 1)
          .length;
        const groupAttributionVisible = [...document.querySelectorAll('.conversation-turn .chat-message .message-author')]
          .some((author) => !author.classList.contains('visually-hidden'));
        return {
          loaded: Boolean(shell),
          roomTitle: document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() ?? '',
          participantCount: document.querySelectorAll('.room-header-copy p').length,
          routingChoices: routing?.querySelectorAll('button').length ?? 0,
          groupedResponseTurns,
          groupAttributionVisible,
          projectModeSwitchVisible: Boolean(
            document.querySelector('.composer-mode-switch'),
          ),
          composerVisible: Boolean(
            rect &&
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom <= window.innerHeight + 1,
          ),
          shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
          panelNoOverflow: Boolean(panel && panel.scrollWidth <= panel.clientWidth),
          headerNoOverflow: Boolean(header && header.scrollWidth <= header.clientWidth),
          documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        };
      })()`);
      };

      await mainWindow.webContents.executeJavaScript(`(() => {
      const group = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.textContent?.includes('工程协作'));
      group?.click();
    })()`);
      await mainWindow.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 80))',
      );

      mainWindow.setSize(1280, 800);
      const desktop = await inspectAt(1280, 800);
      if (
        !desktop?.loaded ||
        desktop.roomTitle !== '工程协作' ||
        desktop.routingChoices !== 2 ||
        desktop.groupedResponseTurns < 1 ||
        !desktop.groupAttributionVisible ||
        !desktop.projectModeSwitchVisible ||
        !desktop.composerVisible ||
        !desktop.shellNoOverflow ||
        !desktop.panelNoOverflow ||
        !desktop.headerNoOverflow ||
        !desktop.documentNoOverflow
      ) {
        throw new Error(`桌面聊天状态不符合预期：${JSON.stringify(desktop)}`);
      }
      await mainWindow.webContents.executeJavaScript(`(() => {
      const mainChat = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
      mainChat?.click();
    })()`);
      await mainWindow.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 80))',
      );
      const noemaProjectModeSwitchVisible =
        await mainWindow.webContents.executeJavaScript(
          `Boolean(document.querySelector('.composer-mode-switch'))`,
        );
      if (noemaProjectModeSwitchVisible) {
        throw new Error('Noema 主聊仍显示冗余的手动项目模式切换。');
      }
      await mainWindow.webContents.executeJavaScript(`(() => {
      const group = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.textContent?.includes('工程协作'));
      group?.click();
    })()`);
      await mainWindow.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 80))',
      );
      if (socialChatDesktopScreenshotPath) {
        const image = await mainWindow.capturePage();
        writeSmokeScreenshot(socialChatDesktopScreenshotPath, image);
        screenshots.push(socialChatDesktopScreenshotPath);
      }

      const target = await mainWindow.webContents.executeJavaScript(`(() => {
      const buttons = [...document.querySelectorAll('.reply-routing button')];
      buttons[1]?.click();
      return buttons.map((button) => button.getAttribute('aria-pressed'));
    })()`);
      if (
        target.length !== 2 ||
        target[0] !== 'false' ||
        target[1] !== 'true'
      ) {
        throw new Error(`群聊回应对象切换没有生效：${JSON.stringify(target)}`);
      }

      if (
        socialProjectWorkDesktopScreenshotPath ||
        socialProjectWorkNarrowScreenshotPath
      ) {
        const projectMode = await mainWindow.webContents
          .executeJavaScript(`(async () => {
        const workCard = document.querySelector('.project-work-card');
        const button = document.querySelectorAll('.composer-mode-switch button')[1];
        if (!workCard || !button || button.disabled) {
          return { available: false, workCard: Boolean(workCard) };
        }
        button.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const updatedWorkCard = document.querySelector('.project-work-card');
        const taskDetail = updatedWorkCard?.querySelector('.project-work-task-detail');
        const sourceBody = updatedWorkCard?.closest('.conversation-turn')
          ?.querySelector('.user-message .message-body');
        const actionIndent = updatedWorkCard && sourceBody
          ? Math.round(updatedWorkCard.getBoundingClientRect().left - sourceBody.getBoundingClientRect().left)
          : null;
        const taskTextCollapsed = taskDetail instanceof HTMLDetailsElement && !taskDetail.open && Boolean(taskDetail.querySelector('.project-work-request')?.textContent?.trim());
        taskDetail?.querySelector('summary')?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const taskTextExpandWorks = taskDetail instanceof HTMLDetailsElement && taskDetail.open && Boolean(taskDetail.querySelector('.project-work-request')?.textContent?.trim());
        taskDetail?.querySelector('summary')?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          available: true,
          selected: button.getAttribute('aria-pressed') === 'true',
          placeholder: document.querySelector('.message-composer textarea')?.getAttribute('placeholder') ?? '',
          taskTextCollapsed,
          taskTextExpandWorks,
          actionIndent,
        };
      })()`);
        if (
          !projectMode.available ||
          !projectMode.selected ||
          !projectMode.taskTextCollapsed ||
          !projectMode.taskTextExpandWorks ||
          projectMode.actionIndent === null ||
          projectMode.actionIndent < 0 ||
          projectMode.actionIndent > 40
        ) {
          throw new Error(
            `真实项目工作活动没有进入可操作的聊天状态：${JSON.stringify(projectMode)}`,
          );
        }
        const projectDesktop = await inspectAt(1280, 800);
        if (
          !projectDesktop?.composerVisible ||
          !projectDesktop.shellNoOverflow ||
          !projectDesktop.panelNoOverflow ||
          !projectDesktop.documentNoOverflow
        ) {
          throw new Error(
            `桌面项目工作界面布局不符合预期：${JSON.stringify(projectDesktop)}`,
          );
        }
        if (socialProjectWorkDesktopScreenshotPath) {
          const image = await mainWindow.capturePage();
          writeSmokeScreenshot(socialProjectWorkDesktopScreenshotPath, image);
          screenshots.push(socialProjectWorkDesktopScreenshotPath);
        }
        const projectNarrow = await inspectAt(680, 560);
        if (
          !projectNarrow?.composerVisible ||
          !projectNarrow.shellNoOverflow ||
          !projectNarrow.panelNoOverflow ||
          !projectNarrow.documentNoOverflow
        ) {
          throw new Error(
            `窄窗口项目工作界面布局不符合预期：${JSON.stringify(projectNarrow)}`,
          );
        }
        if (socialProjectWorkNarrowScreenshotPath) {
          const image = await mainWindow.capturePage();
          writeSmokeScreenshot(socialProjectWorkNarrowScreenshotPath, image);
          screenshots.push(socialProjectWorkNarrowScreenshotPath);
        }
        await mainWindow.webContents.executeJavaScript(`(() => {
        document.querySelector('.composer-mode-switch button[aria-pressed="false"]')?.click();
      })()`);
      }

      const groupDialog = await mainWindow.webContents
        .executeJavaScript(`(async () => {
      const trigger = document.querySelector('.new-group-button');
      trigger?.focus();
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dialog = document.querySelector('.social-dialog[aria-labelledby="create-group-title"]');
      const focusable = () => [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? [])];
      const first = dialog?.querySelector('#social-group-title');
      const initiallyFocused = document.activeElement === first;
      const items = focusable();
      items.at(-1)?.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      const tabWrapped = document.activeElement === items[0];
      return {
        opened: Boolean(dialog),
        initiallyFocused,
        focusEntered: Boolean(dialog?.contains(document.activeElement)),
        activeElement: document.activeElement instanceof HTMLElement ? document.activeElement.outerHTML.slice(0, 180) : '',
        firstInput: first instanceof HTMLElement ? first.outerHTML.slice(0, 180) : '',
        tabWrapped,
      };
    })()`);
      if (
        !groupDialog.opened ||
        !groupDialog.initiallyFocused ||
        !groupDialog.tabWrapped
      ) {
        throw new Error(
          `新建群聊对话框的焦点管理不完整：${JSON.stringify(groupDialog)}`,
        );
      }
      if (socialGroupDialogScreenshotPath) {
        await new Promise((resolve) => setTimeout(resolve, 240));
        const image = await mainWindow.capturePage();
        writeSmokeScreenshot(socialGroupDialogScreenshotPath, image);
        screenshots.push(socialGroupDialogScreenshotPath);
      }
      const groupDialogClosed = await mainWindow.webContents
        .executeJavaScript(`new Promise((resolve) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        closed: !document.querySelector('.social-dialog[aria-labelledby="create-group-title"]'),
        focusRestored: document.activeElement === document.querySelector('.new-group-button'),
      })));
    })`);
      if (!groupDialogClosed.closed || !groupDialogClosed.focusRestored) {
        throw new Error('关闭新建群聊后没有恢复焦点。');
      }

      const narrow = await inspectAt(680, 560);
      if (
        !narrow?.loaded ||
        narrow.roomTitle !== '工程协作' ||
        narrow.routingChoices !== 2 ||
        !narrow.composerVisible ||
        !narrow.shellNoOverflow ||
        !narrow.panelNoOverflow ||
        !narrow.documentNoOverflow
      ) {
        throw new Error(`窄窗口聊天状态不符合预期：${JSON.stringify(narrow)}`);
      }
      if (socialChatNarrowScreenshotPath) {
        const image = await mainWindow.capturePage();
        writeSmokeScreenshot(socialChatNarrowScreenshotPath, image);
        screenshots.push(socialChatNarrowScreenshotPath);
      }
      const settingsDialog = await mainWindow.webContents
        .executeJavaScript(`(async () => {
      const trigger = document.querySelector('.settings-button');
      trigger?.focus();
      trigger?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const dialog = document.querySelector('.social-dialog[aria-labelledby="connection-settings-title"]');
      const first = dialog?.querySelector('[data-dialog-initial-focus]');
      const modelPicker = dialog?.querySelector('select[aria-label="在设置中选择对话模型"]');
      const initialFocus = document.activeElement === first;
      const items = [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? [])];
      items.at(-1)?.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      return { opened: Boolean(dialog), initialFocus, tabWrapped: document.activeElement === items[0], modelPickerVisible: Boolean(modelPicker) };
    })()`);
      if (
        !settingsDialog.opened ||
        !settingsDialog.initialFocus ||
        !settingsDialog.tabWrapped ||
        !settingsDialog.modelPickerVisible
      ) {
        throw new Error(
          `模型设置对话框缺少键盘边界或窄屏模型入口：${JSON.stringify(settingsDialog)}`,
        );
      }
      if (socialSettingsNarrowScreenshotPath) {
        await new Promise((resolve) => setTimeout(resolve, 240));
        const image = await mainWindow.capturePage();
        writeSmokeScreenshot(socialSettingsNarrowScreenshotPath, image);
        screenshots.push(socialSettingsNarrowScreenshotPath);
      }
      const settingsDialogClosed = await mainWindow.webContents
        .executeJavaScript(`new Promise((resolve) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        closed: !document.querySelector('.social-dialog[aria-labelledby="connection-settings-title"]'),
        focusRestored: document.activeElement === document.querySelector('.settings-button'),
      })));
    })`);
      if (!settingsDialogClosed.closed || !settingsDialogClosed.focusRestored) {
        throw new Error('关闭模型设置后没有恢复焦点。');
      }
      return {
        desktop,
        narrow,
        targetSwitchWorked: true,
        groupDialog,
        groupDialogClosed,
        settingsDialog,
        settingsDialogClosed,
        screenshots,
      };
    } finally {
      mainWindow?.setSize(originalSize[0], originalSize[1]);
    }
  }

  async function verifyLiveSocialChatSmoke() {
    if (!runSocialChatLiveSmoke) return null;
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('真实模型聊天 smoke 没有可用窗口。');
    }
    const result = await mainWindow.webContents
      .executeJavaScript(`(async () => {
    const expected = 'NOEMA_CHAT_OK_59D2';
    const roomDeadline = Date.now() + 5000;
    while (Date.now() < roomDeadline) {
      const noemaRoom = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
      noemaRoom?.click();
      if (document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === 'Noema') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const input = document.querySelector('#social-message-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!input || input.disabled || !setter) {
      const state = await window.noema.getSocialState();
      return {
        verified: false,
        status: 'composer_unavailable',
        inputFound: Boolean(input),
        inputDisabled: Boolean(input?.disabled),
        activeRoom: document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() ?? null,
        selectedModel: state.selectedModel ?? null,
        connected: Boolean(state.connected),
        providerConfigured: Boolean(state.providerConfigured),
        modelCount: state.models?.length ?? 0,
        providerWarning: document.querySelector('.provider-warning')?.textContent?.trim() ?? '',
      };
    }
    setter.call(input, '[NOEMA synthetic chat smoke] 请只回复这个标记，不要添加其它内容：' + expected);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }));
    const deadline = Date.now() + 65000;
    while (Date.now() < deadline) {
      const room = await window.noema.getSocialRoom('room-noema');
      const userTurn = [...room.messages].reverse().find((message) =>
        message.role === 'user' && message.content.includes('NOEMA synthetic chat smoke'),
      );
      const reply = userTurn
        ? room.messages.find((message) => message.turnId === userTurn.turnId && message.role === 'assistant')
        : null;
      if (reply?.status === 'complete') {
        return {
          verified: reply.content.includes(expected),
          status: reply.status,
          responseLength: reply.content.length,
          model: reply.model,
          via: 'composer-enter',
        };
      }
      if (reply?.status === 'failed' || reply?.status === 'interrupted') {
        return { verified: false, status: reply.status, error: reply.errorMessage ?? '' };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { verified: false, status: 'timeout' };
  })()`);
    return result;
  }
  const verifySocialWorkActiveProjection = async (input: {
    roomId: string;
    taskId: string;
  }) => {
    if (!mainWindow || mainWindow.isDestroyed())
      throw new Error('SocialWork active projection probe has no live window.');
    const roomTitle = await mainWindow.webContents.executeJavaScript(
      `(async () => {
        const state = await window.noema.getSocialState();
        return state.rooms.find((room) => room.id === ${JSON.stringify(input.roomId)})?.title ?? null;
      })()`,
    );
    if (!roomTitle) throw new Error('SocialWork active task room is missing.');
    const selectAndRead = `async () => {
      const deadline = Date.now() + 12000;
      const row = () => [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === ${JSON.stringify(roomTitle)});
      while (Date.now() < deadline && !row()) await new Promise((resolve) => setTimeout(resolve, 40));
      row()?.click();
      while (Date.now() < deadline) {
        const card = document.querySelector('.project-work-card[data-task-id="' + ${JSON.stringify(input.taskId)} + '"]');
        if (card) return card.className;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return null;
    }`;
    const activeClassPattern = /project-work-(starting|running|verifying)/u;
    const initialClass = await mainWindow.webContents.executeJavaScript(
      `(${selectAndRead})()`,
    );
    const initialStatus =
      typeof initialClass === 'string'
        ? (activeClassPattern.exec(initialClass)?.[1] ?? null)
        : null;
    if (!initialStatus) {
      throw new Error(
        `SocialWork active task did not project before renderer reload: ${String(initialClass)}`,
      );
    }
    const finishedLoad = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Active SocialWork renderer reload timed out.')),
        15000,
      );
      mainWindow.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    mainWindow.webContents.reload();
    await finishedLoad;
    const reloadedClass = await mainWindow.webContents.executeJavaScript(
      `(${selectAndRead})()`,
    );
    const reloadedStatus =
      typeof reloadedClass === 'string'
        ? (activeClassPattern.exec(reloadedClass)?.[1] ?? null)
        : null;
    if (!reloadedStatus) {
      throw new Error(
        `SocialWork active task was lost after renderer reload: ${String(reloadedClass)}`,
      );
    }
    return {
      taskId: input.taskId,
      roomId: input.roomId,
      initialStatus,
      reloadedStatus,
      sameTaskRetained: true,
    };
  };
  const hideWindowDuringSocialWork = async (input: {
    roomId: string;
    taskId: string;
  }) => {
    if (!mainWindow || mainWindow.isDestroyed())
      throw new Error('SocialWork background probe has no live window.');
    const roomTitle = await mainWindow.webContents.executeJavaScript(
      `(async () => {
        const state = await window.noema.getSocialState();
        return state.rooms.find((room) => room.id === ${JSON.stringify(input.roomId)})?.title ?? null;
      })()`,
    );
    const activeCardVisible = await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const deadline = Date.now() + 12000;
      const row = () => [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === ${JSON.stringify(roomTitle)});
      while (Date.now() < deadline && !row()) await new Promise((resolve) => setTimeout(resolve, 40));
      row()?.click();
      while (Date.now() < deadline) {
        const card = document.querySelector('.project-work-card[data-task-id="' + ${JSON.stringify(input.taskId)} + '"]');
        if (card) return /project-work-(starting|running|verifying)/u.test(card.className);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return false;
    })()`);
    if (!roomTitle || !activeCardVisible)
      throw new Error(
        'SocialWork task was not active before hiding the window.',
      );
    mainWindow.close();
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && mainWindow.isVisible()) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (mainWindow.isDestroyed() || mainWindow.isVisible()) {
      throw new Error(
        'Closing the SocialWork window did not preserve a hidden host process.',
      );
    }
    return {
      taskId: input.taskId,
      roomId: input.roomId,
      taskWasActive: true,
      windowHidden: true,
    };
  };
  const verifySocialWorkDurableProjection = async (input: {
    roomId: string;
    taskId: string;
    expectedStatus: string;
    workspacePath?: string;
    privateSentinel?: string;
    expectedCommandBatchStatus?: string;
    expectedCommandOrigin?: boolean;
    requireDiagnostics?: boolean;
  }) => {
    if (!mainWindow || mainWindow.isDestroyed())
      throw new Error('SocialWork projection probe has no live window.');
    const roomTitle = await mainWindow.webContents.executeJavaScript(
      `(async () => {
        const state = await window.noema.getSocialState();
        return state.rooms.find((room) => room.id === ${JSON.stringify(input.roomId)})?.title ?? null;
      })()`,
    );
    if (!roomTitle) throw new Error('SocialWork projection room is missing.');
    const commandReviewScript = `(() => {
      const card = document.querySelector('.project-work-card[data-task-id="' + ${JSON.stringify(input.taskId)} + '"]');
      const details = card?.querySelector('details.project-file-review');
      if (!details) return { present: false, summary: null, batchTexts: [], changeTexts: [] };
      details.open = true;
      return {
        present: true,
        summary: details.querySelector('summary')?.textContent?.trim() ?? null,
        batchTexts: [...details.querySelectorAll('.project-command-batches li')]
          .map((node) => node.textContent?.trim() ?? ''),
        changeTexts: [...details.querySelectorAll('.project-file-review-item')]
          .map((node) => node.textContent?.trim() ?? ''),
      };
    })()`;
    const selectAndRead = `async () => {
      const deadline = Date.now() + 12000;
      const row = () => [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === ${JSON.stringify(roomTitle)});
      while (Date.now() < deadline && !row()) await new Promise((resolve) => setTimeout(resolve, 40));
      row()?.click();
      while (Date.now() < deadline) {
        const card = document.querySelector('.project-work-card[data-task-id="' + ${JSON.stringify(input.taskId)} + '"]');
        if (card) return card.className;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return null;
    }`;
    const initialClass = await mainWindow.webContents.executeJavaScript(
      `(${selectAndRead})()`,
    );
    if (!initialClass?.includes(`project-work-${input.expectedStatus}`)) {
      throw new Error(
        `SocialWork task did not project its durable terminal state: ${String(initialClass)}`,
      );
    }
    let commandReview: {
      present: boolean;
      summary: string | null;
      batchTexts: string[];
      changeTexts: string[];
    } | null = null;
    if (input.expectedCommandBatchStatus || input.expectedCommandOrigin) {
      commandReview =
        await mainWindow.webContents.executeJavaScript(commandReviewScript);
      const batchLabels: Record<string, string> = {
        preparing: '准备隔离副本',
        running: '命令执行中',
        collecting: '收集差异',
        syncing: '正在回写',
        completed: '已回写',
        partial: '部分回写，需检查',
        conflict: '有冲突，未覆盖',
        not_applied: '未应用',
        unknown: '结果不确定，需检查',
      };
      const expectedLabel = input.expectedCommandBatchStatus
        ? batchLabels[input.expectedCommandBatchStatus]
        : null;
      if (!commandReview?.present) {
        throw new Error('Command batch review details are not rendered.');
      }
      if (
        expectedLabel &&
        !commandReview.batchTexts.some((text) => text.includes(expectedLabel))
      ) {
        throw new Error(
          `Command batch status was not projected: ${JSON.stringify(commandReview)}`,
        );
      }
      if (
        input.expectedCommandOrigin &&
        !commandReview.changeTexts.some((text) => text.includes('命令副本'))
      ) {
        throw new Error(
          `Command change origin was not projected: ${JSON.stringify(commandReview)}`,
        );
      }
    }
    const reverseSnapshotArmed = await mainWindow.webContents.executeJavaScript(
      `window.noema.testArmSocialWorkReverseSnapshot?.(${JSON.stringify(input.roomId)}, ${JSON.stringify(input.taskId)}) ?? false`,
    );
    if (!reverseSnapshotArmed)
      throw new Error('Could not arm the isolated reverse-snapshot IPC probe.');
    mainWindow.webContents.send(CHANNELS.socialEvent, {
      type: 'project-work-updated',
      roomId: input.roomId,
      task: { id: input.taskId, roomId: input.roomId, status: 'running' },
    });
    const firstSnapshotRequested = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 5000;
      const poll = async () => {
        const state = await window.noema.testGetSocialWorkReverseSnapshotStatus?.();
        if (state?.firstRequested) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(poll, 20);
      };
      poll();
    })`);
    if (!firstSnapshotRequested)
      throw new Error(
        'The first delayed SocialWork snapshot was not requested.',
      );
    mainWindow.webContents.send(CHANNELS.socialEvent, {
      type: 'project-work-updated',
      roomId: input.roomId,
      task: {
        id: input.taskId,
        roomId: input.roomId,
        status: input.expectedStatus,
      },
    });
    const reverseSnapshotResult = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 6000;
      const card = () => document.querySelector('.project-work-card[data-task-id="' + ${JSON.stringify(input.taskId)} + '"]');
      const poll = async () => {
        const probe = await window.noema.testGetSocialWorkReverseSnapshotStatus?.();
        const terminalProjection = card()?.classList.contains('project-work-${input.expectedStatus}');
        if (probe?.secondReturned && probe.firstReturned && terminalProjection) {
          setTimeout(() => resolve({
            secondReturned: probe.secondReturned,
            staleReturned: probe.firstReturned,
            terminalAfterStale: Boolean(card()?.classList.contains('project-work-${input.expectedStatus}')),
            className: card()?.className ?? null,
          }), 700);
          return;
        }
        if (Date.now() >= deadline) {
          resolve({
            secondReturned: Boolean(probe?.secondReturned),
            staleReturned: Boolean(probe?.firstReturned),
            terminalAfterStale: Boolean(terminalProjection),
            className: card()?.className ?? null,
          });
          return;
        }
        setTimeout(poll, 30);
      };
      poll();
    })`);
    if (
      !reverseSnapshotResult.secondReturned ||
      !reverseSnapshotResult.staleReturned ||
      !reverseSnapshotResult.terminalAfterStale
    ) {
      throw new Error(
        `Out-of-order SocialWork snapshot regressed durable state: ${JSON.stringify(reverseSnapshotResult)}`,
      );
    }
    const eventSubscribed = await mainWindow.webContents
      .executeJavaScript(`(() => {
      window.__noemaSocialWorkProbeEvent = false;
      window.__noemaSocialWorkProbeUnsubscribe = window.noema.onSocialEvent((event) => {
        if (event.type === 'project-work-updated' && event.roomId === ${JSON.stringify(input.roomId)} && event.task?.id === ${JSON.stringify(input.taskId)}) {
          window.__noemaSocialWorkProbeEvent = true;
        }
      });
      return true;
    })()`);
    if (!eventSubscribed)
      throw new Error('Could not subscribe to SocialWork events.');
    mainWindow.webContents.send(CHANNELS.socialEvent, {
      type: 'project-work-updated',
      roomId: input.roomId,
      task: { id: input.taskId, roomId: input.roomId, status: 'running' },
    });
    const staleEventResult = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 8000;
      const poll = () => {
        const card = document.querySelector('.project-work-card[data-task-id="' + ${JSON.stringify(input.taskId)} + '"]');
        const eventSeen = window.__noemaSocialWorkProbeEvent === true;
        if (eventSeen && card?.classList.contains('project-work-${input.expectedStatus}')) {
          window.__noemaSocialWorkProbeUnsubscribe?.();
          resolve({ eventSeen, durableStatusRetained: true, className: card.className });
          return;
        }
        if (Date.now() >= deadline) {
          window.__noemaSocialWorkProbeUnsubscribe?.();
          resolve({ eventSeen, durableStatusRetained: Boolean(card?.classList.contains('project-work-${input.expectedStatus}')), className: card?.className ?? null });
          return;
        }
        setTimeout(poll, 40);
      };
      poll();
    })`);
    if (
      !staleEventResult.eventSeen ||
      !staleEventResult.durableStatusRetained
    ) {
      throw new Error(
        `Stale SocialWork event regressed the renderer projection: ${JSON.stringify(staleEventResult)}`,
      );
    }
    const finishedLoad = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('SocialWork renderer reload timed out.')),
        15000,
      );
      mainWindow.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    mainWindow.webContents.reload();
    await finishedLoad;
    const reloadedClass = await mainWindow.webContents.executeJavaScript(
      `(${selectAndRead})()`,
    );
    if (!reloadedClass?.includes(`project-work-${input.expectedStatus}`)) {
      throw new Error(
        `SocialWork reload did not restore the durable task state: ${String(reloadedClass)}`,
      );
    }
    if (input.expectedCommandBatchStatus || input.expectedCommandOrigin) {
      const reloadedCommandReview =
        await mainWindow.webContents.executeJavaScript(commandReviewScript);
      const batchLabels: Record<string, string> = {
        preparing: '准备隔离副本',
        running: '命令执行中',
        collecting: '收集差异',
        syncing: '正在回写',
        completed: '已回写',
        partial: '部分回写，需检查',
        conflict: '有冲突，未覆盖',
        not_applied: '未应用',
        unknown: '结果不确定，需检查',
      };
      const expectedLabel = input.expectedCommandBatchStatus
        ? batchLabels[input.expectedCommandBatchStatus]
        : null;
      if (
        !reloadedCommandReview?.present ||
        (expectedLabel &&
          !reloadedCommandReview.batchTexts.some((text: string) =>
            text.includes(expectedLabel),
          )) ||
        (input.expectedCommandOrigin &&
          !reloadedCommandReview.changeTexts.some((text: string) =>
            text.includes('命令副本'),
          ))
      ) {
        throw new Error(
          `Command review projection did not survive reload: ${JSON.stringify(reloadedCommandReview)}`,
        );
      }
    }
    const diagnostics = await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const input = ${JSON.stringify(input)};
      const timeline = await window.noema.getDiagnosticsTimeline({ taskId: input.taskId });
      const preview = await window.noema.previewDiagnosticsExport({ taskId: input.taskId });
      const providerEvents = timeline.events.filter((event) => event.module === 'provider' && event.requestId);
      const providerRequestIds = new Set(providerEvents.map((event) => event.requestId));
      const usageLinked = timeline.usage.every((row) =>
        providerRequestIds.has(row.requestId) || timeline.events.some((event) => event.requestId === row.requestId),
      );
      const audit = {
        timelineTaskMatches: timeline.task?.id === input.taskId,
        taskEventExists: timeline.events.some((event) => event.taskId === input.taskId),
        exportTaskMatches: preview.taskId === input.taskId,
        exportContainsTaskId: preview.reportJson.includes(input.taskId),
        workspacePathRedacted: !input.workspacePath || !preview.reportJson.includes(input.workspacePath),
        promptRedacted: !input.privateSentinel || !preview.reportJson.includes(input.privateSentinel),
        usageLinked,
      };
      const reportJson = preview.reportJson;
      if (!audit.timelineTaskMatches ||
          (input.requireDiagnostics !== false && !audit.taskEventExists) ||
          !audit.exportTaskMatches || !audit.exportContainsTaskId ||
          !audit.workspacePathRedacted || !audit.promptRedacted || !audit.usageLinked) {
        throw new Error('SocialWork task diagnostics/export identity or redaction is invalid: ' + JSON.stringify(audit));
      }
      return {
        taskId: timeline.task.id,
        eventCount: timeline.events.length,
        providerRequestCount: providerEvents.length,
        usageCount: timeline.usage.length,
        usageLinked,
        exportLinkedAndRedacted: true,
      };
    })()`);
    return {
      taskId: input.taskId,
      roomId: input.roomId,
      initialStatus: input.expectedStatus,
      commandReview: commandReview
        ? {
            batchCount: commandReview.batchTexts.length,
            changeCount: commandReview.changeTexts.length,
            commandOriginProjected: commandReview.changeTexts.some((text) =>
              text.includes('命令副本'),
            ),
            reloaded: Boolean(input.expectedCommandBatchStatus),
          }
        : null,
      reversedSnapshotDidNotRegress: true,
      staleEventSeen: staleEventResult.eventSeen,
      staleEventDidNotRegress: staleEventResult.durableStatusRetained,
      reloadRestoredDurableStatus: true,
      diagnostics,
    };
  };
  const submitSocialWorkEntryFromRenderer = async (input: {
    workspaceTaskMode: boolean;
    prompt: string;
    expectedReply: string;
    expectNewTask: boolean;
    knownTaskIds: string[];
  }) => {
    if (!mainWindow || mainWindow.isDestroyed())
      throw new Error('Workspace-entry probe has no live window.');
    const result = await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const input = ${JSON.stringify(input)};
      const waitUntil = async (predicate, label) => {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const modeButton = document.querySelector('.composer-workspace-action');
      const textarea = document.querySelector('#social-message-input');
      const sendButton = document.querySelector('.send-message-button');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!modeButton || !textarea || !sendButton || !setter) {
        throw new Error('Workspace composer controls are unavailable.');
      }
      if (modeButton.disabled) throw new Error('Workspace action is unexpectedly unavailable.');
      const currentlyEnabled = modeButton.getAttribute('aria-pressed') === 'true';
      if (currentlyEnabled !== input.workspaceTaskMode) modeButton.click();
      await waitUntil(
        () => modeButton.getAttribute('aria-pressed') === String(input.workspaceTaskMode),
        'workspace mode state',
      );
      setter.call(textarea, input.prompt);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      sendButton.click();
      await waitUntil(
        () => document.body.innerText.includes(input.expectedReply),
        'synthetic assistant reply; sendDisabled=' + sendButton.disabled +
          '; activeRoom=' + (document.querySelector('[data-active-room-id]')?.getAttribute('data-active-room-id') ?? 'unknown') +
          '; renderer=' + JSON.stringify({
            title: document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() ?? null,
            route: location.hash,
            composerCount: document.querySelectorAll('#social-message-input').length,
            composerRect: (() => { const rect = textarea.getBoundingClientRect(); return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }; })(),
            bodyTail: document.body.innerText.slice(-700),
            messageSelectors: {
              messageRows: document.querySelectorAll('.message-row').length,
              socialMessages: document.querySelectorAll('.social-message').length,
              assistantMessages: [...document.querySelectorAll('[data-message-role]')].filter((node) => node.getAttribute('data-message-role') === 'assistant').length,
            },
          }),
      );
      const taskIds = () => [...document.querySelectorAll('.project-work-card[data-task-id]')]
        .map((card) => card.getAttribute('data-task-id'))
        .filter(Boolean);
      let newTaskId = null;
      if (input.expectNewTask) {
        newTaskId = await waitUntil(
          () => taskIds().find((taskId) => !input.knownTaskIds.includes(taskId)) ?? null,
          'workspace task card',
        );
      }
      await waitUntil(
        () => modeButton.getAttribute('aria-pressed') === 'false',
        'workspace mode reset after send',
      );
      const newTaskIds = taskIds().filter((taskId) => !input.knownTaskIds.includes(taskId));
      if (input.expectNewTask ? !newTaskId : newTaskIds.length !== 0) {
        throw new Error('Workspace mode produced an unexpected task-card result.');
      }
      return {
        workspaceTaskMode: input.workspaceTaskMode,
        expectedReplyObserved: true,
        modeResetAfterSend: true,
        newTaskId,
        newTaskIds,
      };
    })()`);
    if (!result?.expectedReplyObserved || !result.modeResetAfterSend) {
      throw new Error('Renderer workspace-entry submission did not complete.');
    }
    return result;
  };
  const verifySocialWorkEntryDiagnostics = async (input: {
    applicationExecutionId: string;
    taskId: string;
    workspacePath: string;
    handoffParentExecutionId: string;
    handoffMemberExecutionId: string;
    handoffParentInteractionId: string;
    handoffId: string;
    handoffRequestId: string;
  }) => {
    if (!mainWindow || mainWindow.isDestroyed())
      throw new Error('Workspace-entry diagnostics probe has no live window.');
    const result = await mainWindow.webContents
      .executeJavaScript(`(async () => {
      const input = ${JSON.stringify(input)};
      const entry = await window.noema.getDiagnosticsTimeline({
        executionId: input.applicationExecutionId,
      });
      const task = await window.noema.getDiagnosticsTimeline({ taskId: input.taskId });
      const handoff = await window.noema.getDiagnosticsTimeline({
        executionId: input.handoffParentExecutionId,
      });
      const handoffPreview = await window.noema.previewDiagnosticsExport({
        executionId: input.handoffParentExecutionId,
      });
      const handoffReport = JSON.parse(handoffPreview.reportJson);
      const handoffStarted = handoff.events.find((event) =>
        event.operation === 'handoff.started' &&
        event.details.handoffId === input.handoffId,
      );
      const handoffCompleted = handoff.events.find((event) =>
        event.operation === 'handoff.completed' &&
        event.details.handoffId === input.handoffId,
      );
      const handoffRequest = handoff.events.find((event) =>
        event.requestId === input.handoffRequestId,
      );
      const handoffExportLinked = handoffReport.events.some((event) =>
        event.details?.handoffId === input.handoffId,
      );
      if (!handoffStarted || !handoffCompleted || !handoffRequest) {
        throw new Error('Handoff diagnostics are missing stable lifecycle identities.');
      }
      if (handoffStarted.parentExecutionId !== input.handoffParentExecutionId ||
          handoffStarted.executionId !== input.handoffMemberExecutionId ||
          handoffStarted.details.memberAgentId !== 'engineering-partner' ||
          handoffStarted.details.parentInteractionId !== input.handoffParentInteractionId ||
          handoffCompleted.parentExecutionId !== input.handoffParentExecutionId ||
          handoffRequest.parentExecutionId !== input.handoffParentExecutionId ||
          handoffRequest.executionId !== input.handoffMemberExecutionId) {
        throw new Error('Handoff diagnostics do not share parent/member/request identities.');
      }
      if (!handoffExportLinked) {
        throw new Error('Handoff diagnostics export does not retain the handoff identity.');
      }
      const preview = await window.noema.previewDiagnosticsExport({
        executionId: input.applicationExecutionId,
      });
      const exportedReport = JSON.parse(preview.reportJson);
      const exportedTaskAnchor = exportedReport.events.find((event) =>
        event.operation === 'task.created_from_entry' && event.taskId === input.taskId,
      );
      const operations = entry.events.map((event) => event.operation);
      const anchor = entry.events.find((event) =>
        event.operation === 'task.created_from_entry' && event.taskId === input.taskId,
      );
      const canceled = entry.events.find((event) =>
        event.operation === 'workspace.selection' && event.status === 'canceled',
      );
      const required = [
        'entry.route_selected',
        'entry.capability_availability',
        'workspace.selection',
        'task.created_from_entry',
      ];
      const missing = required.filter((operation) => !operations.includes(operation));
      if (missing.length || !anchor || !canceled) {
        throw new Error('Application trace is missing workspace-entry facts: ' + missing.join(', '));
      }
      if (anchor.parentExecutionId !== input.applicationExecutionId ||
          canceled.parentExecutionId !== input.applicationExecutionId) {
        throw new Error('Workspace-entry events are not linked to the application execution.');
      }
      if (!task.task || task.task.id !== input.taskId ||
          !task.events.some((event) => event.taskId === input.taskId)) {
        throw new Error('Task diagnostics do not resolve the entry-created task.');
      }
      if (exportedReport.executionId !== input.applicationExecutionId ||
          !exportedTaskAnchor ||
          exportedTaskAnchor.parentExecutionId !== input.applicationExecutionId ||
          preview.reportJson.includes(input.workspacePath) ||
          preview.reportJson.includes('NOEMA_WORK_ENTRY_')) {
        throw new Error('Entry trace export check failed: ' + JSON.stringify({
          reportExecutionMatches: exportedReport.executionId === input.applicationExecutionId,
          reportHasLinkedTaskAnchor: Boolean(exportedTaskAnchor),
          reportHasTaskId: preview.reportJson.includes(input.taskId),
          reportHasWorkspacePath: preview.reportJson.includes(input.workspacePath),
          reportHasPromptSentinel: preview.reportJson.includes('NOEMA_WORK_ENTRY_'),
          reportLength: preview.reportJson.length,
        }));
      }
      return {
        applicationExecutionId: entry.executionId,
        taskId: task.task.id,
        entryOperations: operations,
        pickerCancelLinked: true,
        taskQueryLinked: true,
        handoffLinked: true,
        exportLinkedAndRedacted: true,
      };
    })()`);
    if (
      !result?.pickerCancelLinked ||
      !result?.taskQueryLinked ||
      !result?.handoffLinked ||
      !result?.exportLinkedAndRedacted
    ) {
      throw new Error(
        'Workspace-entry diagnostic query/export verification failed.',
      );
    }
    return result;
  };
  const verifySpecialistProfileFromRenderer = async (input: {
    name: string;
    updatedName: string;
  }) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Specialist profile probe has no live window.');
    }
    const originalBounds = mainWindow.getBounds();
    try {
      mainWindow.setSize(900, 720);
      const result = await mainWindow.webContents
        .executeJavaScript(`(async () => {
        const input = ${JSON.stringify(input)};
        const waitFor = async (selector, present = true) => {
          const deadline = Date.now() + 8_000;
          while (Date.now() < deadline) {
            const found = Boolean(document.querySelector(selector));
            if (found === present) return true;
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          return false;
        };
        const setValue = (selector, value) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error('Missing field: ' + selector);
          const prototype =
            element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const openCreate = async () => {
          if (!document.querySelector('.settings-dialog[role="dialog"]')) {
            document.querySelector('.sidebar-settings-button')?.click();
          }
          if (!(await waitFor('.settings-dialog[role="dialog"]'))) {
            throw new Error('Settings did not open.');
          }
          const button = [...document.querySelectorAll('.settings-dialog button')]
            .find((candidate) => candidate.textContent?.trim() === '新建伙伴');
          button?.click();
          if (!(await waitFor('.agent-create-dialog[role="dialog"]'))) {
            throw new Error('Create-specialist dialog did not open.');
          }
        };
        const fillCreate = (name) => {
          setValue('#social-agent-name', name);
          setValue('#social-agent-headline', '验证职责型命名与资料保存');
          setValue('#social-agent-description', '先核对字段，再保存并重新打开确认。');
        };
        const submit = () => {
          document.querySelector('.agent-create-dialog .primary-action')?.click();
        };
        const closeDialog = async () => {
          document
            .querySelector('.agent-create-dialog button[aria-label="关闭"]')
            ?.click();
          if (!(await waitFor('.agent-create-dialog[role="dialog"]', false))) {
            throw new Error('Create-specialist dialog did not close.');
          }
        };

        await openCreate();
        const placeholder = document.querySelector('#social-agent-name')?.getAttribute('placeholder') ?? '';
        const helper = document.querySelector('.agent-create-dialog')?.textContent?.includes('默认按职责命名') ?? false;
        fillCreate(input.name);
        submit();
        if (!(await waitFor('.agent-create-dialog[role="dialog"]', false))) {
          throw new Error('Specialist was not created.');
        }
        if (!(await waitFor('button[aria-label="成员资料"]'))) {
          throw new Error('Created specialist room did not open.');
        }

        await openCreate();
        fillCreate(input.name);
        submit();
        if (!(await waitFor('#social-agent-name-error'))) {
          throw new Error('Duplicate specialist name did not show a field error.');
        }
        const fieldError = document.querySelector('#social-agent-name-error')?.textContent?.trim() ?? '';
        const dialogStillOpen = Boolean(document.querySelector('.agent-create-dialog[role="dialog"]'));
        await closeDialog();

        document.querySelector('button[aria-label="成员资料"]')?.click();
        if (!(await waitFor('[data-agent-edit-trigger]'))) {
          throw new Error('Specialist profile did not open.');
        }
        const workspaceName = document.querySelector('.work-title strong')?.textContent?.trim() ?? '';
        document.querySelector('[data-agent-edit-trigger]')?.click();
        if (!(await waitFor('.agent-create-dialog[role="dialog"]'))) {
          throw new Error('Profile editor did not open.');
        }
        const reopenedValues = {
          name: document.querySelector('#social-agent-name')?.value ?? '',
          headline: document.querySelector('#social-agent-headline')?.value ?? '',
          description: document.querySelector('#social-agent-description')?.value ?? '',
        };
        setValue('#social-agent-name', input.updatedName);
        submit();
        if (!(await waitFor('.agent-create-dialog[role="dialog"]', false))) {
          throw new Error('Updated profile did not save.');
        }
        if (!(await waitFor('[data-agent-edit-trigger]'))) {
          throw new Error('Updated specialist profile is not reusable.');
        }
        const updatedWorkspaceName = document.querySelector('.work-title strong')?.textContent?.trim() ?? '';
        document.querySelector('[data-agent-edit-trigger]')?.click();
        if (!(await waitFor('.agent-create-dialog[role="dialog"]'))) {
          throw new Error('Profile editor did not reopen.');
        }
        const savedName = document.querySelector('#social-agent-name')?.value ?? '';
        const dialog = document.querySelector('.agent-create-dialog');
        const rect = dialog?.getBoundingClientRect();
        const narrowFits = Boolean(
          rect &&
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight &&
            document.documentElement.scrollWidth <= innerWidth,
        );
        await closeDialog();
        return {
          placeholder,
          helper,
          fieldError,
          dialogStillOpen,
          workspaceName,
          reopenedValues,
          updatedWorkspaceName,
          savedName,
          narrowFits,
        };
      })()`);
      if (
        !result?.helper ||
        !result?.fieldError ||
        result.dialogStillOpen !== true ||
        result.workspaceName !== input.name ||
        result.reopenedValues?.name !== input.name ||
        result.updatedWorkspaceName !== input.updatedName ||
        result.savedName !== input.updatedName ||
        result.narrowFits !== true ||
        result.placeholder === '例如：林间观察员'
      ) {
        throw new Error(
          `Specialist profile renderer check failed: ${JSON.stringify(result)}`,
        );
      }
      const finishedLoad = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Specialist profile reload timed out.')),
          15000,
        );
        mainWindow.webContents.once('did-finish-load', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      mainWindow.webContents.reload();
      await finishedLoad;
      const reloadRetained = await mainWindow.webContents.executeJavaScript(
        `(async () => {
          const deadline = Date.now() + 8000;
          while (Date.now() < deadline) {
            if (document.body.innerText.includes(${JSON.stringify(input.updatedName)})) {
              return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return false;
        })()`,
      );
      if (reloadRetained !== true) {
        throw new Error('Updated specialist did not survive renderer reload.');
      }
      return { ...result, reloadRetained };
    } finally {
      mainWindow.setBounds(originalBounds);
    }
  };
  return {
    captureSocialStartStateScreenshot,
    captureSettingsDialogReviewScreenshots,
    captureAuxiliarySurfaceReviewScreenshots,
    verifyPersonalMemoryLifecycle,
    verifyUserFollowupLifecycle,
    captureHistoryTraceSmokeScreenshots,
    captureLegacyArchiveSmokeScreenshots,
    inspectModelAvailabilitySmoke,
    captureSocialChatSmokeScreenshots,
    verifyLiveSocialChatSmoke,
    verifySocialWorkActiveProjection,
    hideWindowDuringSocialWork,
    verifySocialWorkDurableProjection,
    submitSocialWorkEntryFromRenderer,
    verifySocialWorkEntryDiagnostics,
    verifySpecialistProfileFromRenderer,
  };
}
