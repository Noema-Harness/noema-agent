import type { DesktopProbeContext } from './probe-context';
import { writeSmokeScreenshot } from './capture';
export function createWindowProbes(context: DesktopProbeContext) {
  const { mainWindow, openQuickCapture, quickCaptureShortcutRegistration } =
    context;
  const {
    testCaptureQuickCapture,
    quickCaptureDesktopScreenshotPath,
    quickCaptureNarrowScreenshotPath,
    testCaptureHistoryTrace,
    historyTraceDesktopScreenshotPath,
    historyTraceIntermediateScreenshotPath,
    historyTraceNarrowScreenshotPath,
    testCaptureTimelineSearch,
    timelineSearchDesktopScreenshotPath,
    timelineSearchNarrowScreenshotPath,
    testCaptureModelAvailability,
    modelAvailabilityScreenshotPath,
    modelAvailabilityNarrowScreenshotPath,
    captureSocialChatSmoke,
    socialChatDesktopScreenshotPath,
    socialProjectWorkDesktopScreenshotPath,
    socialProjectWorkNarrowScreenshotPath,
    socialGroupDialogScreenshotPath,
    socialChatNarrowScreenshotPath,
    socialSettingsNarrowScreenshotPath,
    runSocialChatLiveSmoke,
  } = context.options;
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
    await new Promise((resolve) => setTimeout(resolve, 100));
    return shortcutStatusVisible;
  }

  async function captureQuickCaptureSmokeScreenshots() {
    if (!testCaptureQuickCapture) return null;
    const shortcutStatusVisible = await waitForQuickCaptureRender();
    openQuickCapture();
    const opened = await waitForQuickCaptureDialog();
    const shortcutBadgeVisible =
      await mainWindow?.webContents.executeJavaScript(
        `Boolean(document.querySelector('.quick-capture-heading kbd'))`,
      );
    if (
      shortcutBadgeVisible !==
      Boolean(quickCaptureShortcutRegistration?.registered)
    ) {
      throw new Error('速记窗口显示的快捷键与系统注册状态不一致。');
    }
    const screenshots = [];
    if (quickCaptureDesktopScreenshotPath) {
      const image = await mainWindow?.capturePage();
      if (!image) throw new Error('无法捕获快捷速记桌面预览。');
      writeSmokeScreenshot(quickCaptureDesktopScreenshotPath, image);
      screenshots.push(quickCaptureDesktopScreenshotPath);
    }
    if (quickCaptureNarrowScreenshotPath) {
      mainWindow?.setSize(680, 560);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const state = await waitForQuickCaptureDialog();
      if (!state.open || !state.focused) {
        throw new Error('窄窗口下快捷速记未保持可见与键盘焦点。');
      }
      const image = await mainWindow?.capturePage();
      if (!image) throw new Error('无法捕获快捷速记窄窗口预览。');
      writeSmokeScreenshot(quickCaptureNarrowScreenshotPath, image);
      screenshots.push(quickCaptureNarrowScreenshotPath);
    }
    return {
      dialogOpen: opened.open,
      inputFocused: opened.focused,
      shortcutStatusVisible,
      screenshots,
    };
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

  async function captureTimelineSearchSmokeScreenshots() {
    if (!testCaptureTimelineSearch) return null;
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('本地时间线搜索 smoke 没有可用窗口。');
    }
    mainWindow.setSize(1280, 720);
    const opened = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
    const trigger = document.querySelector('.conversation-search-trigger');
    if (!trigger) return resolve({ triggerFound: false, inputFocused: false });
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      triggerFound: true,
      inputFocused: document.activeElement?.id === 'conversation-search-input',
    })));
  })`);
    if (!opened.triggerFound || !opened.inputFocused) {
      throw new Error('搜索按钮没有打开面板并将焦点移入搜索框。');
    }

    const desktopState = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
    const input = document.querySelector('#conversation-search-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'NOEMA-LOCAL-CAPTURE-SEARCH');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const status = document.querySelector('.conversation-search-status');
      const card = document.querySelector('.capture-card.is-search-current');
      const bounds = card?.getBoundingClientRect();
      const scrollBounds = document.querySelector('.conversation-scroll')?.getBoundingClientRect();
      const contentBounds = card?.querySelector('.capture-content')?.getBoundingClientRect();
      resolve({
        status: status?.textContent?.trim() ?? '',
        highlighted: Boolean(card),
        cardVisible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
        contentVisible: Boolean(
          scrollBounds && contentBounds &&
          contentBounds.top >= scrollBounds.top - 1 &&
          contentBounds.bottom <= scrollBounds.bottom + 1,
        ),
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      });
    }));
  })`);
    if (
      !desktopState.status.includes('1 / 1 · 速记') ||
      !desktopState.highlighted ||
      !desktopState.cardVisible ||
      !desktopState.contentVisible ||
      !desktopState.noHorizontalOverflow
    ) {
      throw new Error('桌面视口没有定位到本机速记搜索结果。');
    }

    const screenshots = [];
    if (timelineSearchDesktopScreenshotPath) {
      writeSmokeScreenshot(
        timelineSearchDesktopScreenshotPath,
        await mainWindow.capturePage(),
      );
      screenshots.push(timelineSearchDesktopScreenshotPath);
    }

    mainWindow.setSize(680, 560);
    const narrowState = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const status = document.querySelector('.conversation-search-status');
      const card = document.querySelector('.capture-card.is-search-current');
      const bounds = card?.getBoundingClientRect();
      const scrollBounds = document.querySelector('.conversation-scroll')?.getBoundingClientRect();
        const contentBounds = card?.querySelector('.capture-content')?.getBoundingClientRect();
      resolve({
        status: status?.textContent?.trim() ?? '',
        highlighted: Boolean(card),
        cardVisible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
          contentVisible: Boolean(
            scrollBounds && contentBounds &&
            contentBounds.top >= scrollBounds.top - 1 &&
            contentBounds.bottom <= scrollBounds.bottom + 1,
        ),
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      });
    }));
  })`);
    if (
      !narrowState.status.includes('1 / 1 · 速记') ||
      !narrowState.highlighted ||
      !narrowState.cardVisible ||
      !narrowState.contentVisible ||
      !narrowState.noHorizontalOverflow
    ) {
      throw new Error(
        `窄窗口中速记搜索结果不可见或出现横向溢出：${JSON.stringify(narrowState)}`,
      );
    }
    if (timelineSearchNarrowScreenshotPath) {
      writeSmokeScreenshot(
        timelineSearchNarrowScreenshotPath,
        await mainWindow.capturePage(),
      );
      screenshots.push(timelineSearchNarrowScreenshotPath);
    }

    const focusReturned = await mainWindow.webContents
      .executeJavaScript(`new Promise((resolve) => {
    document.querySelector('.conversation-search-actions button[aria-label="关闭查找"]')?.click();
    requestAnimationFrame(() => resolve(
      document.activeElement?.classList.contains('conversation-search-trigger') ?? false,
    ));
  })`);
    if (!focusReturned)
      throw new Error('关闭搜索后焦点没有回到打开搜索的按钮。');
    return {
      opened: true,
      inputFocused: opened.inputFocused,
      matchedCapture: desktopState.highlighted && narrowState.highlighted,
      desktopNoOverflow: desktopState.noHorizontalOverflow,
      narrowNoOverflow: narrowState.noHorizontalOverflow,
      focusReturned,
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
      document.querySelector('[aria-label="连接与模型设置"]')?.click();
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
        mainWindow.setSize(680, 560);
        narrowLayoutValid = await mainWindow.webContents
          .executeJavaScript(`(() => {
        const dialog = document.querySelector('.settings-dialog');
        const rect = dialog?.getBoundingClientRect();
        return Boolean(
          document.documentElement.scrollWidth <= window.innerWidth &&
          rect && rect.width <= window.innerWidth && rect.height <= window.innerHeight
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
      return {
        verified: true,
        routes: models,
        options: socialState.options,
        selectedModel: socialState.selectedModel,
        connectionSummary: socialState.connectionSummary,
        selectedUnavailable,
        narrowLayoutValid,
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
          composerVisible: Boolean(rect && rect.width > 0 && rect.height > 0 && rect.bottom <= window.innerHeight),
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
  return {
    waitForQuickCaptureDialog,
    waitForQuickCaptureRender,
    captureQuickCaptureSmokeScreenshots,
    captureHistoryTraceSmokeScreenshots,
    captureTimelineSearchSmokeScreenshots,
    inspectModelAvailabilitySmoke,
    captureSocialChatSmokeScreenshots,
    verifyLiveSocialChatSmoke,
  };
}
