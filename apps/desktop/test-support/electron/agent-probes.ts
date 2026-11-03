import { verifyConversationNavigation } from './conversation-navigation-e2e.mjs';
import type { DesktopProbeContext } from './probe-context';
import { writeSmokeScreenshot } from './capture';
import type { createAttachmentProbes } from './attachment-probes';
export function createAgentProbes(
  context: DesktopProbeContext,
  attachments: ReturnType<typeof createAttachmentProbes>,
) {
  const { mainWindow, socialAgentE2eModelRequests, socialChatService } =
    context;
  const {
    socialAgentForwardDesktopScreenshotPath,
    socialAgentForwardNarrowScreenshotPath,
    testSocialAgentLiveE2e,
    testSocialAgentLiveModel,
    socialAgentDelegationMarker,
    socialAgentDelegationTask,
    socialAgentDelegationResult,
    socialAgentDelegationDesktopScreenshotPath,
    socialAgentDelegationNarrowScreenshotPath,
    socialHistoryRecallMarker,
    socialHistoryRecallScreenshotPath,
    socialMessageSearchScreenshotPath,
    socialContinuationDesktopScreenshotPath,
    socialContinuationNarrowScreenshotPath,
    socialContinuationRoomDesktopScreenshotPath,
    socialContinuationRoomNarrowScreenshotPath,
    socialAgentCreateDesktopScreenshotPath,
    socialAgentCreateNarrowScreenshotPath,
    socialAgentProjectScreenshotPath,
    socialAgentProfileNarrowScreenshotPath,
    socialAgentProfileDesktopScreenshotPath,
    socialAgentContactDesktopScreenshotPath,
    socialAgentContactNarrowScreenshotPath,
  } = context.options;
  const { captureSocialTextAttachmentsE2e } = attachments;
  async function captureSocialAgentCreationE2e() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('联系人创建测试没有可用窗口。');
    }
    const navigationLayout = await verifyConversationNavigation(mainWindow);
    const roomDraftIsolation = await mainWindow.webContents
      .executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label + '；当前窗口：' + JSON.stringify({title: document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim(), rooms: [...document.querySelectorAll('.room-list-item .item-title')].map(item => item.textContent?.trim()), text: document.body.innerText.slice(0, 500)}));
    };
    const setDraft = (value) => {
      const input = document.querySelector('#social-message-input');
      if (!input) throw new Error('找不到聊天草稿输入框');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input;
    };
    const selectRoom = async (title) => {
      const row = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === title);
      if (!row) throw new Error('找不到聊天：' + title);
      row.click();
      await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === title, title + ' 聊天');
      return document.querySelector('#social-message-input');
    };
    await waitFor(() => document.querySelector('.room-list-item'), '联系人和聊天列表初始化');
    await selectRoom('Noema');
    const noemaDraft = 'E2E 草稿仅属于 Noema';
    setDraft(noemaDraft);
    const partnerInput = await selectRoom('工程搭档');
    const partnerStartedEmpty = partnerInput?.value === '';
    const partnerDraft = 'E2E 草稿仅属于工程搭档';
    setDraft(partnerDraft);
    const noemaInput = await selectRoom('Noema');
    const noemaDraftRestored = noemaInput?.value === noemaDraft;
    const partnerInputAgain = await selectRoom('工程搭档');
    const partnerDraftRestored = partnerInputAgain?.value === partnerDraft;
    await selectRoom('Noema');
    setDraft('');
    return { partnerStartedEmpty, noemaDraftRestored, partnerDraftRestored };
  })()`);
    if (
      !roomDraftIsolation?.partnerStartedEmpty ||
      !roomDraftIsolation?.noemaDraftRestored ||
      !roomDraftIsolation?.partnerDraftRestored
    ) {
      throw new Error(
        `切换聊天时的草稿隔离不符合预期：${JSON.stringify(roomDraftIsolation)}`,
      );
    }
    const forwardingSelection = await mainWindow.webContents
      .executeJavaScript(`(async () => {
    const waitFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    await waitFor(() => document.querySelector('.room-list-item'), '联系人和聊天列表初始化');
    const sourceRoomItem = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.item-title')?.textContent?.trim() === '工程搭档');
    if (!sourceRoomItem) throw new Error('找不到工程搭档私聊');
    sourceRoomItem.click();
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === '工程搭档', '工程搭档私聊');
    const findSourceUser = () => [...document.querySelectorAll('.chat-message.user-message')]
      .find((article) => article.textContent?.includes('OpenAI 官方发布说明'));
    if (!findSourceUser()) throw new Error('找不到来源私聊中的目标消息');
    const sourceRoom = await window.noema.getSocialRoom('room-engineering-partner');
    const initialTargetCount = (await window.noema.getSocialRoom('room-engineering-collaboration')).messages.length;
    const clickForward = () => {
      const button = [...(findSourceUser()?.querySelectorAll('.message-actions button') ?? [])]
        .find((candidate) => candidate.textContent?.trim() === '转发');
      if (!button) throw new Error('来源消息没有显示转发操作');
      button.click();
    };
    clickForward();
    await waitFor(() => document.querySelector('.forward-selection-toolbar'), '转发消息选择状态');
    const selectSecondMessage = () => {
      const secondSource = [...document.querySelectorAll('.chat-message.agent-message')]
        .find((article) => article.textContent?.includes('收到：我会先核对 OpenAI 官方发布说明'));
      const button = [...(secondSource?.querySelectorAll('.message-actions button') ?? [])]
        .find((candidate) => candidate.textContent?.includes('选择转发'));
      if (!button) throw new Error('无法把同一私聊中的第二条消息加入合并转发');
      button.click();
    };
    selectSecondMessage();
    await waitFor(
      () => document.querySelectorAll('.message-actions button.is-selected').length === 2,
      '取消前选中两条消息',
    );
    const selectedBeforeCancel = document.querySelectorAll('.message-actions button.is-selected').length;
    document.querySelector('.forward-selection-toolbar button:not(.primary-action)')?.click();
    await waitFor(() => !document.querySelector('.forward-selection-toolbar'), '取消转发选择');
    const targetCountAfterCancel = (await window.noema.getSocialRoom('room-engineering-collaboration')).messages.length;
    const cancelHadNoSend = initialTargetCount === targetCountAfterCancel;
    clickForward();
    await waitFor(() => document.querySelector('.forward-selection-toolbar'), '重新开始转发');
    selectSecondMessage();
    await waitFor(
      () => document.querySelectorAll('.message-actions button.is-selected').length === 2,
      '合并转发选中两条消息',
    );
    document.querySelector('.forward-selection-toolbar .primary-action')?.click();
    await waitFor(() => document.querySelector('.forward-dialog'), '转发目标选择窗口');
    return {
      sourceTitle: sourceRoom.room.title,
      selectedCount: document.querySelectorAll('.message-actions button.is-selected').length,
      previewContainsSource: Boolean(document.querySelector('.forward-dialog-preview')?.textContent?.includes('OpenAI 官方发布说明')),
      previewHasTwoMessages: document.querySelectorAll('.forward-dialog-preview article').length === 2,
      targetCanBeChosen: Boolean(document.querySelector('.forward-dialog select option[value="room-engineering-collaboration"]')),
      cancelHadNoSend,
      selectedBeforeCancel,
    };
  })()`);
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await new Promise((resolve) => setTimeout(resolve, 240));
    if (socialAgentForwardDesktopScreenshotPath) {
      const image = await mainWindow.capturePage();
      writeSmokeScreenshot(socialAgentForwardDesktopScreenshotPath, image);
    }
    mainWindow.setSize(680, 560);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const forwardNarrow = await mainWindow.webContents
      .executeJavaScript(`(() => {
    const dialog = document.querySelector('.forward-dialog');
    const shell = document.querySelector('.social-shell');
    const rect = dialog?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      dialogVisible: Boolean(rect && rect.width > 0 && rect.height > 0),
      dialogInViewport: Boolean(rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight),
      dialogNoOverflow: Boolean(dialog && dialog.scrollWidth <= dialog.clientWidth),
      shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
      documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  })()`);
    if (
      !forwardNarrow.dialogVisible ||
      !forwardNarrow.dialogInViewport ||
      !forwardNarrow.dialogNoOverflow ||
      !forwardNarrow.shellNoOverflow ||
      !forwardNarrow.documentNoOverflow
    ) {
      throw new Error(
        `转发目标选择窄屏布局不符合预期：${JSON.stringify(forwardNarrow)}`,
      );
    }
    if (socialAgentForwardNarrowScreenshotPath) {
      const image = await mainWindow.capturePage();
      writeSmokeScreenshot(socialAgentForwardNarrowScreenshotPath, image);
    }
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const forwardingSent = await mainWindow.webContents
      .executeJavaScript(`(async () => {
    const liveResponseTimeout = ${testSocialAgentLiveE2e ? 65_000 : 7_000};
    const waitFor = async (predicate, label, timeoutMs = 7000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const choose = document.querySelector('.forward-dialog select');
    if (!choose) throw new Error('缺少转发目标选择器');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(choose, 'room-engineering-collaboration');
    choose.dispatchEvent(new Event('change', { bubbles: true }));
    const sendButton = document.querySelector('.forward-dialog button[type="submit"]');
    if (!sendButton || sendButton.disabled) throw new Error('转发目标未准备好');
    sendButton.click();
    const state = await waitFor(async () => {
      const room = await window.noema.getSocialRoom('room-engineering-collaboration');
      const user = [...room.messages].reverse().find((message) => message.role === 'user' && message.forwardedSources?.length === 2);
      return user ? { room, user } : null;
    }, '合并转发消息送达目标聊天');
    await waitFor(
      () =>
        [...document.querySelectorAll('.forwarded-message-card')].some(
          (item) => item.textContent?.includes('工程搭档'),
        ),
      '目标聊天中的转发卡片',
    );
    const assistantForForward = state.room.messages.find(
      (message) => message.turnId === state.user.turnId && message.role === 'assistant',
    );
    const userArticle = [...document.querySelectorAll('.chat-message.user-message')]
      .find((article) => article.querySelector('.forwarded-message-card')?.textContent?.includes('OpenAI 官方发布说明'));
    return {
      bundlePersisted: state.user.forwardedSources.length === 2,
      forwardCreatedAssistant: Boolean(assistantForForward),
      sourceRoom: state.user.forwardedSources[0]?.roomTitle ?? null,
      forwardCardVisible: Boolean(userArticle?.querySelector('.forwarded-message-card')),
      selectedContent: state.user.forwardedSources.map((source) => source.content),
    };
  })()`);
    forwardingSent.forwardingDidNotTriggerResponse =
      !forwardingSent.forwardCreatedAssistant &&
      socialAgentE2eModelRequests.length === 0;
    const forwardingReply = await mainWindow.webContents
      .executeJavaScript(`(async () => {
    const liveResponseTimeout = ${testSocialAgentLiveE2e ? 65_000 : 7000};
    const waitFor = async (predicate, label, timeoutMs = 7000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const userArticle = [...document.querySelectorAll('.chat-message.user-message')]
      .find((article) => article.querySelector('.forwarded-message-card')?.textContent?.includes('OpenAI 官方发布说明'));
    let replyExcerptVisible = false;
    if (!${testSocialAgentLiveE2e}) {
      const replyButton = [...(userArticle?.querySelectorAll('.message-actions button') ?? [])]
        .find((button) => button.textContent?.trim() === '引用');
      if (!replyButton) throw new Error('转发消息没有当前房间回复入口');
      replyButton.click();
      await waitFor(() => document.querySelector('.draft-quote'), '当前房间回复预览');
      replyExcerptVisible = document.querySelector('.draft-quote')?.textContent?.includes('OpenAI 官方发布说明') ?? false;
    }
    const textarea = document.querySelector('#social-message-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, '请说说这两条消息的重点。');
    textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.message-composer button[type="submit"]')?.click();
    const replied = await waitFor(async () => {
      const room = await window.noema.getSocialRoom('room-engineering-collaboration');
      const user = [...room.messages].reverse().find((message) => message.role === 'user' && message.content.includes('请说说这两条消息的重点。'));
      const assistant = user ? room.messages.find((message) => message.turnId === user.turnId && message.role === 'assistant') : null;
      if (assistant?.status === 'failed' || assistant?.status === 'interrupted') {
        throw new Error(
          '转发后的后续请求未完成：' +
            (assistant.errorCode ?? assistant.status),
        );
      }
      return user && assistant?.status === 'complete' ? { room, user, assistant } : null;
    }, '转发后的单独消息及模型回应', liveResponseTimeout);
    return {
      replyExcerptVisible,
      currentRoomReplyAttached: replied.user.replyTo?.roomId === 'room-engineering-collaboration',
      replyText: replied.user.content,
      realReplyStatus: replied.assistant.status,
      realReplyLength: replied.assistant.content.length,
      realReplyText: replied.assistant.content.slice(0, 800),
    };
  })()`);
    Object.assign(forwardingSent, forwardingReply);
    const modelRequest = socialAgentE2eModelRequests.at(-1);
    const modelInput =
      modelRequest?.messages.map((message) => message.content).join('\n') ?? '';
    forwardingSent.modelInputVerified = Boolean(
      modelRequest?.model ===
        (testSocialAgentLiveE2e ? testSocialAgentLiveModel : 'e2e-local-spy') &&
      modelInput.includes('用户转发的聊天消息') &&
      modelInput.includes('来自「工程搭档」') &&
      modelInput.includes('OpenAI 官方发布说明') &&
      !modelInput.includes('紫水晶') &&
      modelInput.endsWith('请说说这两条消息的重点。'),
    );
    forwardingSent.liveProviderUsed =
      testSocialAgentLiveE2e && socialAgentE2eModelRequests.length === 1;
    forwardingSent.liveProviderReplyComplete =
      testSocialAgentLiveE2e &&
      forwardingSent.realReplyStatus === 'complete' &&
      forwardingSent.realReplyLength > 0;
    forwardingSent.followUpTriggeredOneResponse =
      !testSocialAgentLiveE2e && socialAgentE2eModelRequests.length === 1;
    if (
      forwardingSelection.selectedCount !== 2 ||
      forwardingSelection.selectedBeforeCancel !== 2 ||
      !forwardingSelection.previewContainsSource ||
      !forwardingSelection.previewHasTwoMessages ||
      !forwardingSelection.targetCanBeChosen ||
      !forwardingSelection.cancelHadNoSend ||
      !forwardingSent.bundlePersisted ||
      !forwardingSent.forwardingDidNotTriggerResponse ||
      !forwardingSent.forwardCardVisible ||
      (!testSocialAgentLiveE2e && !forwardingSent.replyExcerptVisible) ||
      (!testSocialAgentLiveE2e && !forwardingSent.currentRoomReplyAttached) ||
      !forwardingSent.modelInputVerified ||
      (!testSocialAgentLiveE2e &&
        !forwardingSent.followUpTriggeredOneResponse) ||
      (testSocialAgentLiveE2e &&
        (!forwardingSent.liveProviderUsed ||
          !forwardingSent.liveProviderReplyComplete))
    ) {
      throw new Error(
        `消息转发/回复流程与模型输入不符合预期：${JSON.stringify({ forwardingSelection, forwardingSent, modelRequest })}`,
      );
    }
    let specialistDelegation: Record<string, unknown> | null = null;
    if (!testSocialAgentLiveE2e) {
      socialAgentE2eModelRequests.length = 0;
      const delegation = (await mainWindow.webContents
        .executeJavaScript(`(async () => {
      const waitFor = async (predicate, label, timeoutMs = 7000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        throw new Error('等待超时：' + label + '；当前窗口：' + JSON.stringify({url: location.href, title: document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim(), rooms: [...document.querySelectorAll('.room-list-item .item-title')].map(item => item.textContent?.trim()), text: document.body.innerText.slice(0, 600)}));
      };
      const noemaRoomItem = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
      noemaRoomItem?.click();
      await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === 'Noema', '返回 Noema 主聊');
      const before = await window.noema.getSocialState();
      const beforeRoom = await window.noema.getSocialRoom('room-noema');
      const input = document.querySelector('#social-message-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!input || input.disabled || !setter) throw new Error('Noema 主聊输入框不可用');
      const trigger = ${JSON.stringify(socialAgentDelegationMarker)} + '一项信息，并整理成清单：比较三种代码托管方案应核对哪些关键字段？';
      setter.call(input, trigger);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const completed = await waitFor(async () => {
        const room = await window.noema.getSocialRoom('room-noema');
        const user = [...room.messages].reverse().find((message) => message.role === 'user' && message.content.includes(${JSON.stringify(socialAgentDelegationMarker)}));
        const assistant = user ? room.messages.find((message) => message.turnId === user.turnId && message.role === 'assistant') : null;
        if (assistant?.status === 'failed' || assistant?.status === 'interrupted') {
          throw new Error('委派回复未完成：' + (assistant.errorCode ?? assistant.status));
        }
        return user && assistant?.status === 'complete' ? { room, user, assistant } : null;
      }, '专业 agent 委派完成');
      await waitFor(
        () =>
          [...document.querySelectorAll('.chat-message.agent-message')].some(
            (article) => article.dataset.messageId === completed.assistant.id,
          ),
        '专业 agent 委派回复显示在聊天中',
      );
      const after = await window.noema.getSocialState();
      const assistantArticle = [...document.querySelectorAll('.chat-message.agent-message')]
        .find((article) => article.dataset.messageId === completed.assistant.id);
      const turn = assistantArticle?.closest('.conversation-turn');
      const userArticle = turn?.querySelector('.user-message');
      const measureMessage = (article) => {
        const body = article?.querySelector('.message-content');
        const bodyRect = body?.getBoundingClientRect();
        const articleRect = article?.getBoundingClientRect();
        return bodyRect && articleRect
          ? {
              bodyHeight: Math.round(bodyRect.height),
              bubbleHeight: Math.round(articleRect.height),
              bodyWidth: Math.round(bodyRect.width),
              bubbleWidth: Math.round(articleRect.width),
            }
          : null;
      };
      const messageGeometry = {
        user: measureMessage(userArticle),
        assistant: measureMessage(assistantArticle),
      };
      const messagesInTurn = turn?.querySelectorAll('.chat-message').length ?? 0;
      const promptText = ${JSON.stringify(socialAgentDelegationTask)};
      return {
        userText: completed.user.content,
        assistantMessageId: completed.assistant.id,
        assistantText: completed.assistant.content,
        assistantStatus: completed.assistant.status,
        sameTurn: completed.user.turnId === completed.assistant.turnId,
        groupedInUi: messagesInTurn === 2,
        directSpeakerAttributionWorks: Boolean(
          turn &&
            turn.querySelector('.user-message .byline') &&
            turn.querySelector('.agent-message .byline strong')?.textContent?.trim() === 'Noema',
        ),
        assistantVisible: Boolean(assistantArticle && assistantArticle.getClientRects().length),
        messageGeometry,
        messageBodyFitsContent: [messageGeometry.user, messageGeometry.assistant].every(
          (item) => item && item.bodyHeight <= item.bubbleHeight + 32,
        ),
        messageAuxiliaryOutsideBubble: Boolean(
          turn &&
            !turn.querySelector('.message-actions')?.closest('.message-body') &&
            !turn.querySelector('.interaction-adjustment-trace')?.closest('.message-body'),
        ),
        visibleDelegationLabels: Boolean(turn?.textContent?.includes('工程搭档的协助') && turn.textContent.includes(${JSON.stringify(socialAgentDelegationTask)})),
        actualResultVisible: Boolean(turn?.textContent?.includes(${JSON.stringify(socialAgentDelegationResult)})),
        initialMessageCount: beforeRoom.messages.length,
        messageCountDelta: completed.room.messages.length - beforeRoom.messages.length,
        roomCountUnchanged: before.rooms.length === after.rooms.length,
        workspaceTasksUnchanged: completed.room.workTasks.length === beforeRoom.workTasks.length,
        model: completed.assistant.model,
        promptText,
      };
    })()`)) as Record<string, unknown>;
      specialistDelegation = delegation;
      const delegationRequests = socialAgentE2eModelRequests.splice(0);
      const delegatedInput = delegationRequests[1]?.messages ?? [];
      delegation.contextChecks = {
        threeModelCalls: delegationRequests.length === 3,
        boundedMessages: delegatedInput.length <= 8,
        taskAtEnd: delegatedInput
          .at(-1)
          ?.content?.includes(socialAgentDelegationTask),
        specialistHistory: delegatedInput.some((message) =>
          message.content?.includes('紫水晶'),
        ),
        rootRequestExcluded: delegatedInput.every(
          (message) => !message.content?.includes(socialAgentDelegationMarker),
        ),
        rootPrivateHistoryExcluded: delegatedInput.every(
          (message) => !message.content?.includes('分享不愉快经历时'),
        ),
      };
      delegation.specialistContextBounded =
        delegationRequests.length === 3 &&
        delegatedInput.length <= 8 &&
        delegatedInput.at(-1)?.role === 'user' &&
        delegatedInput.at(-1)?.content?.includes(socialAgentDelegationTask) &&
        delegatedInput.some((message) => message.content.includes('紫水晶')) &&
        delegatedInput.every(
          (message) =>
            !message.content.includes(socialAgentDelegationMarker) &&
            !message.content.includes('分享不愉快经历时'),
        );
      delegation.singleExtraInference = delegationRequests.length === 3;
      if (
        delegation.assistantStatus !== 'complete' ||
        !delegation.sameTurn ||
        !delegation.groupedInUi ||
        !delegation.directSpeakerAttributionWorks ||
        !delegation.assistantVisible ||
        !delegation.messageAuxiliaryOutsideBubble ||
        !delegation.messageBodyFitsContent ||
        !delegation.visibleDelegationLabels ||
        !delegation.actualResultVisible ||
        delegation.messageCountDelta !== 2 ||
        !delegation.roomCountUnchanged ||
        !delegation.workspaceTasksUnchanged ||
        !delegation.specialistContextBounded ||
        !delegation.singleExtraInference
      ) {
        throw new Error(
          `Noema 主聊委派与消息呈现不符合预期：${JSON.stringify(delegation)}`,
        );
      }
      mainWindow.setSize(1280, 800);
      await mainWindow.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      await mainWindow.webContents.executeJavaScript(`(() => {
      const trigger = [...document.querySelectorAll('.chat-message.user-message')]
        .find((article) => article.textContent?.includes(${JSON.stringify(socialAgentDelegationMarker)}));
      trigger?.scrollIntoView({ block: 'center' });
    })()`);
      await mainWindow.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      if (socialAgentDelegationDesktopScreenshotPath) {
        writeSmokeScreenshot(
          socialAgentDelegationDesktopScreenshotPath,
          await mainWindow.capturePage(),
        );
      }
      mainWindow.setSize(680, 560);
      await mainWindow.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      await mainWindow.webContents.executeJavaScript(`(() => {
      const reply = [...document.querySelectorAll('.chat-message.agent-message')]
        .find((article) => article.dataset.messageId === ${JSON.stringify(specialistDelegation.assistantMessageId)});
      reply?.scrollIntoView({ block: 'center' });
    })()`);
      await mainWindow.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      const delegationNarrowLayout = await mainWindow.webContents
        .executeJavaScript(`(() => {
      const shell = document.querySelector('.social-shell');
      const thread = document.querySelector('.message-thread');
      const composer = document.querySelector('.message-composer');
      const rect = composer?.getBoundingClientRect();
      return {
        width: window.innerWidth,
        composerVisible: Boolean(rect && rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0),
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        threadNoOverflow: Boolean(thread && thread.scrollWidth <= thread.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        groupedTurnVisible: Boolean([...document.querySelectorAll('.conversation-turn')].some((turn) => turn.querySelectorAll('.chat-message').length === 2 && turn.getClientRects().length)),
      };
    })()`);
      delegation.narrowLayout = delegationNarrowLayout;
      if (
        !delegationNarrowLayout.composerVisible ||
        !delegationNarrowLayout.shellNoOverflow ||
        !delegationNarrowLayout.threadNoOverflow ||
        !delegationNarrowLayout.documentNoOverflow ||
        !delegationNarrowLayout.groupedTurnVisible
      ) {
        throw new Error(
          `专业 agent 委派窄窗布局不符合预期：${JSON.stringify(delegationNarrowLayout)}`,
        );
      }
      delegation.passed = true;
      if (socialAgentDelegationNarrowScreenshotPath) {
        writeSmokeScreenshot(
          socialAgentDelegationNarrowScreenshotPath,
          await mainWindow.capturePage(),
        );
      }
    }
    let historySearch: Record<string, unknown> | null = null;
    if (!testSocialAgentLiveE2e) {
      if (!socialChatService) throw new Error('社交聊天服务尚未就绪');
      const historySeed = socialChatService.store.beginTurn({
        roomId: 'room-noema',
        agentId: 'noema',
        text: `${socialHistoryRecallMarker}。`,
        model: 'e2e-local-spy',
      });
      socialChatService.store.appendAssistantDelta(
        historySeed.assistantMessageId,
        '这条旧消息用于检查 Noema 是否能在用户明确提及时找回原文。',
      );
      socialChatService.store.completeReply(historySeed.assistantMessageId);
      mainWindow.setSize(1280, 800);
      const searchFlow = (await mainWindow.webContents
        .executeJavaScript(`(async () => {
      const waitFor = async (predicate, label) => {
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        throw new Error('等待超时：' + label);
      };
      const search = async (query) => {
        await waitFor(() => !document.querySelector('.global-search-dialog'), '关闭上一次全局搜索');
        const trigger = document.querySelector('.global-search-trigger');
        trigger?.click();
        const input = await waitFor(() => document.querySelector('[aria-label="搜索联系人、项目和消息"]'), '打开全局搜索');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) throw new Error('全局搜索输入框不可用');
        setter.call(input, query);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return await waitFor(() => {
          const list = document.querySelector('.global-search-dialog [cmdk-list]');
          const hits = [...document.querySelectorAll('.global-search-dialog [cmdk-item]')];
          return list && list.getAttribute('aria-busy') !== 'true' && hits.some((item) => item.textContent?.includes(query))
            ? {
                list,
                hits,
                visibleCount: hits.filter((item) => {
                  const rect = item.getBoundingClientRect();
                  return getComputedStyle(item).visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                }).length,
              }
            : null;
        }, '全局搜索结果：' + query);
      };
      const earlierSearch = await search('不愉快经历');
      const earlierHit = earlierSearch.hits.find((item) => item.textContent?.includes('不愉快经历'));
      if (!earlierHit) throw new Error('未找到历史消息搜索结果');
      const earlierTitle = earlierHit.querySelector('.global-search-source strong')?.textContent?.trim();
      const earlierMessageId = earlierHit.getAttribute('data-value')?.replace(/^message:/, '');
      earlierHit.click();
      await waitFor(() => {
        const room = document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim();
        const target = document.querySelector('[data-message-id="' + earlierMessageId + '"]');
        const thread = document.querySelector('.message-thread')?.getBoundingClientRect();
        const rect = target?.getBoundingClientRect();
        return room === 'Noema' && rect && thread && rect.bottom > thread.top && rect.top < thread.bottom;
      }, '跳回历史消息');
      const crossSearch = await search('紫水晶');
      const crossRoomHit = crossSearch.hits.find((item) => item.textContent?.includes('紫水晶') && item.querySelector('.global-search-source strong')?.textContent?.includes('工程搭档'));
      if (!crossRoomHit) throw new Error('未找到另一聊天中的消息');
      const crossRoomMessageId = crossRoomHit.getAttribute('data-value')?.replace(/^message:/, '');
      crossRoomHit.click();
      await waitFor(() => {
        const room = document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim();
        const target = document.querySelector('[data-message-id="' + crossRoomMessageId + '"]');
        const thread = document.querySelector('.message-thread')?.getBoundingClientRect();
        const rect = target?.getBoundingClientRect();
        return room === '工程搭档' && rect && thread && rect.bottom > thread.top && rect.top < thread.bottom;
      }, '跨聊天跳回命中消息');
      const searchClearedAfterOpen = !document.querySelector('.global-search-dialog');
      return {
        earlierResultRoom: earlierTitle,
        earlierResultReached: true,
        crossRoomResultRoom: '工程搭档',
        crossRoomResultReached: true,
        searchClearedAfterOpen,
        searchResultCount: crossSearch.hits.length,
        searchResultsVisible: crossSearch.visibleCount > 0,
        searchResultBounds: crossSearch.hits.map((button) => {
          const rect = button.getBoundingClientRect();
          const list = button.closest('.conversation-list');
          const listRect = list?.getBoundingClientRect();
          const style = getComputedStyle(button);
          return {
            top: rect.top,
            bottom: rect.bottom,
            listTop: listRect?.top,
            listBottom: listRect?.bottom,
            listScrollTop: list?.scrollTop,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            color: style.color,
            text: button.textContent?.trim(),
          };
        }),
      };
    })()`)) as Record<string, unknown>;
      socialAgentE2eModelRequests.length = 0;
      const historyRecall = (await mainWindow.webContents
        .executeJavaScript(`(async () => {
      const waitFor = async (predicate, label, timeoutMs = 7000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await predicate();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        throw new Error('等待超时：' + label);
      };
      const noemaRoomItem = [...document.querySelectorAll('.room-list-item')]
        .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
      noemaRoomItem?.click();
      await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === 'Noema', '返回 Noema 主聊');
      const input = document.querySelector('#social-message-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!input || input.disabled || !setter) throw new Error('Noema 主聊输入框不可用');
      const userText = '你还记得我们之前说过「${socialHistoryRecallMarker}」吗？';
      setter.call(input, userText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const state = await waitFor(async () => {
        const room = await window.noema.getSocialRoom('room-noema');
        const user = [...room.messages].reverse().find((message) => message.role === 'user' && message.content === userText);
        const assistant = user ? room.messages.find((message) => message.turnId === user.turnId && message.role === 'assistant') : null;
        if (assistant?.status === 'failed' || assistant?.status === 'interrupted') {
          throw new Error('历史回忆回复未完成：' + (assistant.errorCode ?? assistant.status));
        }
        return user && assistant?.status === 'complete' ? { room, user, assistant } : null;
      }, 'Noema 历史回忆回复完成');
      const article = await waitFor(
        () => [...document.querySelectorAll('.chat-message.agent-message')]
          .find((item) => item.dataset.messageId === state.assistant.id),
        '历史来源追溯显示在回复旁',
      );
      const trace = article.querySelector('.social-history-recall-trace');
      if (!trace) throw new Error('主聊没有显示历史来源追溯');
      trace.open = true;
      trace.setAttribute('open', '');
      const sourceButton = trace.querySelector('button');
      const sourceId = sourceButton?.closest('li')?.querySelector('blockquote')?.textContent;
      const sourceExcerptVisible = Boolean(
        trace.open &&
        sourceButton?.getBoundingClientRect().height &&
        sourceButton.closest('li')?.querySelector('blockquote')?.getBoundingClientRect().height,
      );
      const sourceMessageId = state.assistant.historySources?.[0]?.id;
      const sourceRoomId = state.assistant.historySources?.[0]?.roomId;
      const sourceVisible = Boolean(
        trace.textContent.includes(${JSON.stringify(socialHistoryRecallMarker)}) &&
        trace.textContent.includes('跳到原对话') &&
        state.assistant.historySearchStatus === 'found' &&
        state.assistant.historySourcesIncluded === true &&
        state.assistant.historySources.some((source) => source.id === ${JSON.stringify(historySeed.userMessageId)}),
      );
      if (!sourceVisible || !sourceExcerptVisible || !sourceButton || sourceRoomId !== 'room-noema') {
        throw new Error('历史来源未按预期展示：' + JSON.stringify(state.assistant.historySources));
      }
      return {
        userText,
        assistantId: state.assistant.id,
        status: state.assistant.historySearchStatus,
        sourceCount: state.assistant.historySources.length,
        sourcesIncluded: state.assistant.historySourcesIncluded,
        sourceRoomId,
        sourceText: sourceId,
        sourceMessageId,
        sourceVisible,
        sourceExcerptVisible,
      };
    })()`)) as Record<string, unknown>;
      const recallModelInput =
        socialAgentE2eModelRequests[0]?.messages
          .map((message) => message.content)
          .join('\n') ?? '';
      const recallModelCalls = socialAgentE2eModelRequests.length;
      historySearch = {
        ...searchFlow,
        recall: { ...historyRecall, modelCalls: recallModelCalls },
      };
      if (
        recallModelCalls !== 1 ||
        !recallModelInput.includes(socialHistoryRecallMarker) ||
        recallModelInput.includes('紫水晶') ||
        !historyRecall.sourceVisible ||
        !historyRecall.sourceExcerptVisible
      ) {
        throw new Error(
          `历史回忆未保持范围、成本和来源边界：${JSON.stringify({ historyRecall, recallModelCalls, recallModelInput })}`,
        );
      }
      if (socialHistoryRecallScreenshotPath) {
        writeSmokeScreenshot(
          socialHistoryRecallScreenshotPath,
          await mainWindow.capturePage(),
        );
      }
      const recallSourceJump = await mainWindow.webContents
        .executeJavaScript(`(async () => {
      const trace = document.querySelector('[data-message-id="${historyRecall.assistantId}"] .social-history-recall-trace');
      const button = trace?.querySelector('button');
      const sourceId = ${JSON.stringify(historyRecall.sourceMessageId)};
      button?.click();
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        const target = document.querySelector('[data-message-id="' + sourceId + '"]');
        const thread = document.querySelector('.message-thread')?.getBoundingClientRect();
        const rect = target?.getBoundingClientRect();
        if (target && rect && thread && rect.bottom > thread.top && rect.top < thread.bottom) return true;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return false;
    })()`);
      if (!recallSourceJump) throw new Error('历史来源入口没有跳回原消息');
      (historySearch.recall as Record<string, unknown>).sourceJumped = true;
      if (
        searchFlow.earlierResultRoom !== 'Noema' ||
        !searchFlow.earlierResultReached ||
        !searchFlow.crossRoomResultReached ||
        !searchFlow.searchClearedAfterOpen ||
        !searchFlow.searchResultsVisible ||
        !recallSourceJump
      ) {
        throw new Error(
          `历史消息搜索没有回到原对话：${JSON.stringify(searchFlow)}`,
        );
      }
      if (socialMessageSearchScreenshotPath) {
        writeSmokeScreenshot(
          socialMessageSearchScreenshotPath,
          await mainWindow.capturePage(),
        );
      }
      await mainWindow.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('.chat-search input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (input && setter) {
        setter.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    }
    const continuationThreadWorkflow = await mainWindow.webContents
      .executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const setValue = (element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const noemaRoom = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
    if (!noemaRoom) throw new Error('找不到 Noema 主聊天');
    noemaRoom.click();
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === 'Noema', 'Noema 主聊天');
    const sourceText = '分享不愉快经历时，请先问我最在意的部分。';
    const sourceMessage = () => [...document.querySelectorAll('.chat-message.user-message')]
      .find((article) => article.textContent?.includes(sourceText));
    const source = await waitFor(sourceMessage, '来源消息');
    const sourceId = source.dataset.messageId;
    [...source.querySelectorAll('.message-actions button')]
      .find((button) => button.textContent?.trim() === '转发')?.click();
    await waitFor(() => document.querySelector('.forward-selection-toolbar'), '消息选择状态');
    [...document.querySelectorAll('.forward-selection-toolbar button')]
      .find((button) => button.textContent?.trim() === '开主题')?.click();
    await waitFor(() => document.querySelector('[aria-labelledby="continuation-title"]'), '主题创建窗口');
    setValue(document.querySelector('[aria-labelledby="continuation-title"] input'), 'E2E 持续主题');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { sourceId, dialogVisible: Boolean(document.querySelector('[aria-labelledby="continuation-title"]')) };
  })()`);
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    if (socialContinuationDesktopScreenshotPath) {
      writeSmokeScreenshot(
        socialContinuationDesktopScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
    mainWindow.setSize(680, 560);
    const continuationNarrow = await mainWindow.webContents
      .executeJavaScript(`(() => {
    const dialog = document.querySelector('[aria-labelledby="continuation-title"]');
    const rect = dialog?.getBoundingClientRect();
    const shell = document.querySelector('.social-shell');
    return {
      width: window.innerWidth,
      visible: Boolean(rect && rect.width > 0 && rect.height > 0),
      inViewport: Boolean(rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight),
      dialogNoOverflow: Boolean(dialog && dialog.scrollWidth <= dialog.clientWidth),
      shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
      documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  })()`);
    if (socialContinuationNarrowScreenshotPath) {
      writeSmokeScreenshot(
        socialContinuationNarrowScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
    if (
      !continuationThreadWorkflow.dialogVisible ||
      !continuationNarrow.visible ||
      !continuationNarrow.inViewport ||
      !continuationNarrow.dialogNoOverflow ||
      !continuationNarrow.shellNoOverflow ||
      !continuationNarrow.documentNoOverflow
    ) {
      throw new Error(
        `主题创建窗口布局不符合预期：${JSON.stringify({ continuationThreadWorkflow, continuationNarrow })}`,
      );
    }
    const continuationCreated = await mainWindow.webContents
      .executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const titleInput = document.querySelector('[aria-labelledby="continuation-title"] input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(titleInput, 'E2E 持续主题');
    titleInput?.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('[aria-labelledby="continuation-title"] button[type="submit"]')][0]?.click();
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === 'E2E 持续主题', '新主题聊天');
    const state = await window.noema.getSocialState();
    const room = state.rooms.find((item) => item.title === 'E2E 持续主题');
    const snapshot = await window.noema.getSocialRoom(room.id);
    const originVisible = snapshot.messages[0]?.forwardedSources?.some((item) => item.id === ${JSON.stringify(continuationThreadWorkflow.sourceId)});
    const originIdMatches = room.originMessageId === ${JSON.stringify(continuationThreadWorkflow.sourceId)};
    const originLabelVisible = document.querySelector('.forwarded-message-card')?.textContent?.includes('来源消息') === true;
    const originMessageTimeHidden = !document.querySelector('.chat-message.user-message .message-meta');
    return { threadRoomId: room.id, originVisible, originIdMatches, originLabelVisible, originMessageTimeHidden };
  })()`);
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    if (socialContinuationRoomDesktopScreenshotPath) {
      writeSmokeScreenshot(
        socialContinuationRoomDesktopScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
    mainWindow.setSize(680, 560);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const continuationRoomNarrow = await mainWindow.webContents
      .executeJavaScript(`(() => {
    const shell = document.querySelector('.social-shell');
    const panel = document.querySelector('.conversation-panel');
    const header = document.querySelector('.room-header');
    return {
      width: window.innerWidth,
      roomTitle: document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() ?? '',
      shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
      panelNoOverflow: Boolean(panel && panel.scrollWidth <= panel.clientWidth),
      headerNoOverflow: Boolean(header && header.scrollWidth <= header.clientWidth),
      documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  })()`);
    if (socialContinuationRoomNarrowScreenshotPath) {
      writeSmokeScreenshot(
        socialContinuationRoomNarrowScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
    mainWindow.setSize(1280, 800);
    const continuationLifecycle = await mainWindow.webContents
      .executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const room = (await window.noema.getSocialState()).rooms.find((item) => item.id === ${JSON.stringify(continuationCreated.threadRoomId)});
    [...document.querySelectorAll('.note-row button')].find((button) => button.textContent?.trim() === '回到来源消息')?.click();
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === 'Noema', '来源聊天回链');
    const sourceLink = await waitFor(() => [...document.querySelectorAll('.message-continuation-link')].find((item) => item.textContent?.includes('E2E 持续主题')), '来源消息上的主题链接');
    const originBacklinkVisible = Boolean(sourceLink);
    sourceLink.click();
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === 'E2E 持续主题', '返回主题聊天');
    const closeButton = [...document.querySelectorAll('.note-row button')].find((button) => button.textContent?.trim() === '结束主题');
    closeButton?.click();
    await waitFor(async () => (await window.noema.getSocialRoom(room.id)).room.closedAt, '结束主题');
    await waitFor(() => document.querySelector('#social-message-input')?.disabled, '已结束主题的输入锁定');
    const closedComposerDisabled = Boolean(document.querySelector('#social-message-input')?.disabled);
    const reopenButton = await waitFor(() => [...document.querySelectorAll('.note-row button')]
      .find((button) => button.textContent?.trim() === '重新打开' && !button.disabled), '重新打开按钮就绪');
    reopenButton.click();
    await waitFor(async () => !(await window.noema.getSocialRoom(room.id)).room.closedAt, '重新打开主题');
    const deleteButton = await waitFor(() => [...document.querySelectorAll('.note-row button')]
      .find((button) => button.textContent?.trim() === '删除' && !button.disabled), '删除按钮就绪');
    window.confirm = () => true;
    deleteButton.click();
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === 'Noema', '删除后返回来源聊天');
    const afterDelete = await window.noema.getSocialState();
    return {
      originBacklinkVisible,
      closedComposerDisabled,
      deleted: !afterDelete.rooms.some((item) => item.id === room.id),
      parentPreserved: afterDelete.rooms.some((item) => item.id === 'room-noema'),
    };
  })()`);
    Object.assign(continuationLifecycle, continuationCreated, {
      threadNarrow: continuationRoomNarrow,
    });
    if (
      !continuationLifecycle.originVisible ||
      !continuationLifecycle.originIdMatches ||
      !continuationLifecycle.originLabelVisible ||
      !continuationLifecycle.originMessageTimeHidden ||
      !continuationLifecycle.originBacklinkVisible ||
      !continuationLifecycle.closedComposerDisabled ||
      !continuationLifecycle.deleted ||
      !continuationLifecycle.parentPreserved ||
      continuationRoomNarrow.width > 700 ||
      continuationRoomNarrow.roomTitle !== 'E2E 持续主题' ||
      !continuationRoomNarrow.shellNoOverflow ||
      !continuationRoomNarrow.panelNoOverflow ||
      !continuationRoomNarrow.headerNoOverflow ||
      !continuationRoomNarrow.documentNoOverflow
    ) {
      throw new Error(
        `主题线程生命周期不符合预期：${JSON.stringify(continuationLifecycle)}`,
      );
    }
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 5000;
    document.querySelector('.sidebar-settings-button')?.click();
    while (Date.now() < deadline && !document.querySelector('.settings-dialog')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    [...document.querySelectorAll('.settings-administration button')]
      .find((button) => button.textContent?.trim() === '创建联系人')?.click();
    while (Date.now() < deadline && !document.querySelector('#social-agent-name')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 220));
  })()`);
    const inspectCreateDialog = async (width: number, height: number) => {
      mainWindow?.setSize(width, height);
      await mainWindow?.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      return mainWindow?.webContents.executeJavaScript(`(() => {
      const shell = document.querySelector('.social-shell');
      const dialog = document.querySelector('.agent-create-dialog');
      const rect = dialog?.getBoundingClientRect();
      const submit = dialog?.querySelector('button[type="submit"]');
      const submitRect = submit?.getBoundingClientRect();
      return {
        dialogVisible: Boolean(rect && rect.width > 0 && rect.height > 0),
        dialogInViewport: Boolean(rect && rect.top >= 0 && rect.bottom <= window.innerHeight),
        fields: dialog?.querySelectorAll('.dialog-field').length ?? 0,
        submitVisible: Boolean(
          submitRect &&
            rect &&
            submitRect.top >= rect.top &&
            submitRect.bottom <= rect.bottom &&
            submitRect.bottom <= window.innerHeight,
        ),
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    })()`);
    };
    const dialogDesktop = await inspectCreateDialog(1280, 800);
    if (
      !dialogDesktop?.dialogVisible ||
      !dialogDesktop.dialogInViewport ||
      dialogDesktop.fields !== 3 ||
      !dialogDesktop.submitVisible ||
      !dialogDesktop.shellNoOverflow ||
      !dialogDesktop.documentNoOverflow
    ) {
      throw new Error(
        `桌面创建联系人表单布局不符合预期：${JSON.stringify(dialogDesktop)}`,
      );
    }
    if (socialAgentCreateDesktopScreenshotPath) {
      const image = await mainWindow.capturePage();
      writeSmokeScreenshot(socialAgentCreateDesktopScreenshotPath, image);
    }
    const dialogNarrow = await inspectCreateDialog(680, 560);
    if (
      !dialogNarrow?.dialogVisible ||
      !dialogNarrow.dialogInViewport ||
      dialogNarrow.fields !== 3 ||
      !dialogNarrow.submitVisible ||
      !dialogNarrow.shellNoOverflow ||
      !dialogNarrow.documentNoOverflow
    ) {
      throw new Error(
        `窄窗口创建联系人表单布局不符合预期：${JSON.stringify(dialogNarrow)}`,
      );
    }
    if (socialAgentCreateNarrowScreenshotPath) {
      const image = await mainWindow.capturePage();
      writeSmokeScreenshot(socialAgentCreateNarrowScreenshotPath, image);
    }
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const dialogCancel = await mainWindow.webContents
      .executeJavaScript(`(async () => {
    const waitFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const deadline = Date.now() + 5000;
    const initialDialog = {
      focusedName: document.activeElement?.id === 'social-agent-name',
      fieldCount: document.querySelectorAll('.agent-create-dialog .dialog-field').length,
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    while (Date.now() < deadline && document.querySelector('.agent-create-dialog')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (document.querySelector('.agent-create-dialog')) throw new Error('Escape 没有关闭创建联系人表单');
    await waitFrames();
    return {
      initialDialog,
      cancelReturnedFocus: document.activeElement?.classList?.contains('sidebar-settings-button') ?? false,
      cancelFocusTarget: {
        tagName: document.activeElement?.tagName ?? null,
        className: document.activeElement?.className ?? null,
        buttonConnected: Boolean(document.querySelector('.sidebar-settings-button')?.isConnected),
        buttonVisible: Boolean(document.querySelector('.sidebar-settings-button')?.getClientRects().length),
      },
    };
  })()`);
    mainWindow.setSize(360, 640);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const result = await mainWindow.webContents
      .executeJavaScript(`(async () => {
    const waitFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    const setValue = (element, value) => {
      if (!element) throw new Error('找不到表单字段');
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const initial = await window.noema.getSocialState();
    const initialDialog = ${JSON.stringify(dialogCancel.initialDialog)};
    const cancelReturnedFocus = ${JSON.stringify(dialogCancel.cancelReturnedFocus)};
    const cancelFocusTarget = ${JSON.stringify(dialogCancel.cancelFocusTarget)};
    document.querySelector('.navigation-reveal')?.click();
    await waitFor(() => !document.querySelector('.social-body')?.classList.contains('room-open'), '移动端返回联系人列表');
    await waitFrames();
    document.querySelector('.sidebar-settings-button')?.click();
    await waitFor(() => document.querySelector('.settings-dialog'), '移动端连接设置');
    [...document.querySelectorAll('.settings-administration button')]
      .find((button) => button.textContent?.trim() === '创建联系人')?.click();
    await waitFor(() => document.querySelector('#social-agent-name'), '重新打开联系人表单');
    let name = 'E2E 图形观察员';
    setValue(document.querySelector('#social-agent-name'), name);
    setValue(document.querySelector('#social-agent-headline'), '长期观察游戏视觉与交互');
    setValue(document.querySelector('#social-agent-description'), '先和我厘清体验，再讨论如何验证。');
    const creationCapability = document.querySelector('.agent-capability-choice input');
    const projectWorkDefaultedOff = creationCapability?.checked === false;
    creationCapability?.click();
    await waitFrames();
    document.querySelector('.agent-create-dialog button[type="submit"]')?.click();
    const createdState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const agent = state.agents.find((candidate) => candidate.name === name);
      return agent ? { state, agent } : null;
    }, '本机联系人记录');
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === name, '新联系人私聊');
    const directRoom = await window.noema.getSocialRoom(
      createdState.state.rooms.find((room) => room.kind === 'direct' && room.memberIds.includes(createdState.agent.id)).id,
    );
    const initialDirectIsEmpty = directRoom.messages.length === 1 && directRoom.messages[0].role === 'system';
    const capabilityWasExplicitlyGranted = createdState.agent.capabilities.includes('project-work');
    document.querySelector('[aria-label="成员资料"]')?.click();
    await waitFor(() => document.querySelector('.work-content h2')?.textContent?.trim() === name, '联系人资料页');
    const projectWorkControl = [...document.querySelectorAll('.asset-row button')]
      .find((button) => button.textContent?.includes('已启用'));
    projectWorkControl?.click();
    const projectWorkRevokedState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const agent = state.agents.find((candidate) => candidate.id === createdState.agent.id);
      return agent && !agent.capabilities.includes('project-work') ? state : null;
    }, '撤回项目工作能力');
    document.querySelector('[aria-label="成员资料"]')?.click();
    await waitFor(() => document.querySelector('.work-content h2')?.textContent?.trim() === name, '重新打开联系人资料页');
    const refreshedCapabilityControl = await waitFor(() => [...document.querySelectorAll('.asset-row button')]
      .find((button) => button.textContent?.includes('未启用')), '更新项目工作能力开关');
    refreshedCapabilityControl?.click();
    const projectWorkEnabledState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const agent = state.agents.find((candidate) => candidate.id === createdState.agent.id);
      return agent?.capabilities.includes('project-work') ? state : null;
    }, '重新开启项目工作能力');
    const projectWorkOptInAndReversible =
      projectWorkDefaultedOff &&
      capabilityWasExplicitlyGranted &&
      projectWorkRevokedState.agents.some(
        (agent) => agent.id === createdState.agent.id && agent.capabilities.length === 0,
      ) &&
      projectWorkEnabledState.agents.some(
        (agent) => agent.id === createdState.agent.id && agent.capabilities.includes('project-work'),
      );
    const directBeforeProfileEdit = await window.noema.getSocialRoom(directRoom.room.id);
    const initialDirectMessageIds = directBeforeProfileEdit.messages.map((message) => message.id);
    [...document.querySelectorAll('.profile-links button')]
      .find((button) => button.textContent?.trim() === '编辑资料')?.click();
    await waitFor(() => document.querySelector('#social-agent-name'), '编辑联系人资料表单');
    await waitFrames();
    const profileEditNarrow = (() => {
      const dialog = document.querySelector('.agent-create-dialog')?.getBoundingClientRect();
      const submit = document.querySelector('.agent-create-dialog button[type="submit"]')?.getBoundingClientRect();
      const shell = document.querySelector('.social-shell');
      return {
        width: window.innerWidth,
        visible: Boolean(dialog && dialog.width > 0 && dialog.height > 0),
        fieldCount: document.querySelectorAll('.agent-create-dialog .dialog-field').length,
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        submitVisible: Boolean(dialog && submit && submit.top >= dialog.top && submit.bottom <= dialog.bottom && submit.bottom <= window.innerHeight),
      };
    })();
    if (
      !profileEditNarrow.visible ||
      profileEditNarrow.fieldCount !== 3 ||
      !profileEditNarrow.shellNoOverflow ||
      !profileEditNarrow.documentNoOverflow ||
      !profileEditNarrow.submitVisible
    ) throw new Error('窄窗口联系人资料表单布局不符合预期：' + JSON.stringify(profileEditNarrow));
    const updatedName = 'E2E 视觉与交互研究员';
    setValue(document.querySelector('#social-agent-name'), updatedName);
    setValue(document.querySelector('#social-agent-headline'), '长期研究游戏视觉、交互与用户测试');
    setValue(document.querySelector('#social-agent-description'), '先检查一手证据，再说明不确定性和可验证的下一步。');
    document.querySelector('.agent-create-dialog button[type="submit"]')?.click();
    const profileUpdatedState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const agent = state.agents.find((candidate) => candidate.id === createdState.agent.id);
      return agent?.name === updatedName ? { state, agent } : null;
    }, '更新后的联系人资料');
    await waitFor(() => document.querySelector('.work-title strong')?.textContent?.trim() === updatedName, '同步更新联系人资料标题');
    const updatedDirectRoom = await window.noema.getSocialRoom(directRoom.room.id);
    const profileEdit = {
      name: updatedName,
      identityPreserved: profileUpdatedState.agent.id === createdState.agent.id,
      updatedForFutureReplies:
        profileUpdatedState.agent.headline === '长期研究游戏视觉、交互与用户测试' &&
        profileUpdatedState.agent.description === '先检查一手证据，再说明不确定性和可验证的下一步。',
      capabilityPreserved: profileUpdatedState.agent.capabilities.includes('project-work'),
      historyPreserved:
        updatedDirectRoom.messages.length === initialDirectMessageIds.length &&
        updatedDirectRoom.messages.every((message, index) => message.id === initialDirectMessageIds[index]),
      directTitleUpdated: updatedDirectRoom.room.title === updatedName,
      narrowLayout: profileEditNarrow,
    };
    if (
      !profileEdit.identityPreserved ||
      !profileEdit.updatedForFutureReplies ||
      !profileEdit.capabilityPreserved ||
      !profileEdit.historyPreserved ||
      !profileEdit.directTitleUpdated
    ) throw new Error('联系人资料编辑破坏了身份、能力或聊天记录：' + JSON.stringify(profileEdit));
    name = updatedName;
    document.querySelector('.profile-links button.primary')?.click();
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === name, '打开更新后的常驻私聊');
    const shell = document.querySelector('.social-shell');
    const panel = document.querySelector('.conversation-panel');
    const header = document.querySelector('.room-header');
    const controls = document.querySelector('.pane-actions');
    const compactRoomLayout = {
      width: window.innerWidth,
      roomTitle: document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() ?? '',
      actionsVisible: Boolean(controls && controls.getClientRects().length),
      shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
      panelNoOverflow: Boolean(panel && panel.scrollWidth <= panel.clientWidth),
      headerNoOverflow: Boolean(header && header.scrollWidth <= header.clientWidth),
      documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };

    document.querySelector('[aria-label="成员资料"]')?.click();
    await waitFor(() => document.querySelector('.work-content h2')?.textContent?.trim() === name, '归档前打开成员资料');
    [...document.querySelectorAll('.profile-links button')]
      .find((button) => button.textContent?.includes('归档联系人'))?.click();
    const archivedState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      return state.agents.find((candidate) => candidate.id === createdState.agent.id)?.archivedAt
        ? state : null;
    }, '联系人归档状态');
    await waitFor(() => [...document.querySelectorAll('.profile-links button')].some((button) => button.textContent?.includes('恢复联系人')), '联系人恢复入口');
    document.querySelector('.profile-links button.primary')?.click();
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === name, '归档成员常驻私聊');
    const archivedUi = Boolean(document.querySelector('.archived-agent-notice'));
    document.querySelector('.sidebar-settings-button')?.click();
    await waitFor(() => document.querySelector('.settings-dialog'), '归档状态打开设置');
    [...document.querySelectorAll('.settings-administration button')]
      .find((button) => button.textContent?.trim() === '新建群聊')?.click();
    await waitFor(() => document.querySelector('#social-group-title'), '归档状态下新群聊表单');
    const archivedInviteExcluded = ![...document.querySelectorAll('.group-agent-option')]
      .some((option) => option.querySelector('strong')?.textContent?.trim() === name);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !document.querySelector('#social-group-title'), '关闭归档状态群聊表单');

    document.querySelector('[aria-label="成员资料"]')?.click();
    await waitFor(() => document.querySelector('.work-content h2')?.textContent?.trim() === name, '恢复前打开成员资料');
    [...document.querySelectorAll('.profile-links button')]
      .find((button) => button.textContent?.includes('恢复联系人'))?.click();
    const restoredState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const agent = state.agents.find((candidate) => candidate.id === createdState.agent.id);
      return agent && !agent.archivedAt ? state : null;
    }, '联系人恢复状态');
    await waitFor(() => [...document.querySelectorAll('.profile-links button')].some((button) => button.textContent?.includes('归档联系人')), '联系人归档入口');

    document.querySelector('.profile-links button.primary')?.click();
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === name, '恢复联系人常驻私聊');
    document.querySelector('.sidebar-settings-button')?.click();
    await waitFor(() => document.querySelector('.settings-dialog'), '恢复状态打开设置');
    [...document.querySelectorAll('.settings-administration button')]
      .find((button) => button.textContent?.trim() === '新建群聊')?.click();
    await waitFor(() => document.querySelector('#social-group-title'), '新群聊表单');
    const inviteOption = [...document.querySelectorAll('.group-agent-option')]
      .find((option) => option.querySelector('strong')?.textContent?.trim() === name);
    const inviteVisible = Boolean(inviteOption);
    if (!inviteVisible) throw new Error('新联系人没有出现在群聊邀请列表中');
    inviteOption.querySelector('input')?.click();
    setValue(document.querySelector('#social-group-title'), 'E2E 专业协作');
    await waitFrames();
    document.querySelector('.social-dialog[aria-labelledby="create-group-title"] button[type="submit"]')?.click();
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === 'E2E 专业协作', '包含新联系人的群聊');
    const groupState = await window.noema.getSocialState();
    const groupRoom = groupState.rooms.find((room) => room.title === 'E2E 专业协作');
    const groupSnapshot = await window.noema.getSocialRoom(groupRoom.id);
    const sameIdentityJoined = groupSnapshot.members.some((member) => member.id === createdState.agent.id);
    const groupDidNotImportDm = !groupSnapshot.messages.some((message) => message.content.includes('长期观察游戏视觉与交互'));
    document.querySelector('.sidebar-settings-button')?.click();
    await waitFor(() => document.querySelector('.settings-dialog'), '新建项目打开设置');
    [...document.querySelectorAll('.settings-administration button')]
      .find((button) => button.textContent?.trim() === '新建项目')?.click();
    await waitFor(() => document.querySelector('.project-dialog input'), '新项目表单');
    setValue(document.querySelector('.project-dialog input'), 'E2E 定价追踪');
    setValue(document.querySelector('.project-dialog textarea'), '比较平台价格并记录变化。');
    const projectMemberOption = [...document.querySelectorAll('.project-dialog .group-agent-option')]
      .find((option) => option.querySelector('strong')?.textContent?.trim() === name);
    if (!projectMemberOption) throw new Error('已创建的专业联系人没有出现在项目成员列表中');
    projectMemberOption.querySelector('input')?.click();
    document.querySelector('.project-dialog button[type="submit"]')?.click();
    await waitFor(() => document.querySelector('.work-title strong')?.textContent?.trim() === 'E2E 定价追踪' && document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === 'Noema', 'Noema 主聊旁的项目工作区');
    [...document.querySelectorAll('.work-tabs button')]
      .find((button) => button.textContent?.trim() === '交付')?.click();
    const projectCreatedState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const project = state.projects.find((candidate) => candidate.title === 'E2E 定价追踪');
      return project ? { state, project } : null;
    }, '项目持久化状态');
    const projectSidebarEntry = [...document.querySelectorAll('.project-list-item')]
      .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'E2E 定价追踪');
    const projectNotDuplicatedInOtherChats = ![...document.querySelectorAll('.room-list-item .item-title')]
      .some((item) => item.textContent?.includes('E2E 定价追踪'));
    const projectBannerVisible = Boolean(document.querySelector('.project-brief')?.textContent?.includes('比较平台价格并记录变化'));
    const projectMemberSession = projectCreatedState.project.members.find((member) => member.agentId === createdState.agent.id);
    const projectGroup = await window.noema.getSocialRoom(projectCreatedState.project.groupRoomId);
    const projectPrivateDmUnchanged = !(await window.noema.getSocialRoom(directRoom.room.id)).messages.some((message) => message.content.includes('比较平台价格并记录变化'));
    const archiveButton = await waitFor(() => [...document.querySelectorAll('.real-project-actions button')]
      .find((button) => button.textContent?.trim() === '归档项目'), '项目归档按钮');
    archiveButton.click();
    const archivedProjectState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const project = state.projects.find((candidate) => candidate.id === projectCreatedState.project.id);
      return project?.status === 'archived' ? state : null;
    }, '项目归档状态').catch(async (error) => {
      const state = await window.noema.getSocialState();
      const project = state.projects.find((candidate) => candidate.id === projectCreatedState.project.id);
      throw new Error(error.message + JSON.stringify({
        projectStatus: project?.status,
        notice: document.querySelector('[role="status"]')?.textContent,
        actions: [...document.querySelectorAll('.real-project-actions button')].map((button) => ({text: button.textContent?.trim(), disabled: button.disabled})),
      }));
    });
    const archivedProjectHidden = !archivedProjectState.rooms.some((room) => room.id === projectCreatedState.project.groupRoomId);
    await waitFor(() => [...document.querySelectorAll('.bottom-link')]
      .some((button) => button.textContent?.includes('已归档项目')), '归档项目分区');
    [...document.querySelectorAll('.bottom-link')]
      .find((button) => button.textContent?.includes('已归档项目'))?.click();
    const archivedProjectEntry = await waitFor(() =>
      [...document.querySelectorAll('.project-link')]
        .find((item) => item.querySelector('strong')?.textContent?.trim() === 'E2E 定价追踪'),
      '归档列表中的项目恢复入口',
    );
    archivedProjectEntry?.click();
    await waitFor(() => document.querySelector('.work-title strong')?.textContent?.trim() === 'E2E 定价追踪', '打开归档项目');
    [...document.querySelectorAll('.work-content button')]
      .find((button) => button.textContent?.trim() === '恢复项目')?.click();
    const restoredProjectState = await waitFor(async () => {
      const state = await window.noema.getSocialState();
      const project = state.projects.find((candidate) => candidate.id === projectCreatedState.project.id);
      return project?.status === 'active' ? state : null;
    }, '项目恢复状态');
    await waitFor(() => document.querySelector('.work-title strong')?.textContent?.trim() === 'E2E 定价追踪', '恢复后的原项目工作区');
    [...document.querySelectorAll('.work-tabs button')]
      .find((button) => button.textContent?.startsWith('成员'))?.click();
    const openMemberSession = await waitFor(() => [...document.querySelectorAll('.member-row')]
      .find((button) => button.textContent?.includes(name)), '项目成员会话入口');
    if (!openMemberSession) throw new Error('项目群没有提供成员独立会话入口');
    openMemberSession.click();
    await waitFor(() => document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === name, '成员项目会话');
    const sessionMarker = 'E2E 项目会话请求标记：蓝松石';
    setValue(document.querySelector('#social-message-input'), sessionMarker);
    document.querySelector('.send-message-button')?.click();
    const projectSessionReply = await waitFor(async () => {
      const room = await window.noema.getSocialRoom(projectMemberSession.sessionRoomId);
      const userMessage = room.messages.find((message) => message.content.includes(sessionMarker));
      const assistantMessage = userMessage && room.messages.find((message) => message.turnId === userMessage.turnId && message.role === 'assistant');
      return assistantMessage?.status === 'complete' ? { room, userMessage, assistantMessage } : null;
    }, '成员项目会话回复');
    const projectLifecycle = {
      created: Boolean(projectSidebarEntry && projectCreatedState.project.status === 'active'),
      projectNotDuplicatedInOtherChats,
      projectBannerVisible,
      memberSessionCreated: Boolean(projectMemberSession?.sessionRoomId),
      groupRoomLoaded: projectGroup.room.id === projectCreatedState.project.groupRoomId,
      projectPrivateDmUnchanged,
      archived: archivedProjectState.projects.find((candidate) => candidate.id === projectCreatedState.project.id)?.status === 'archived',
      archivedProjectHidden,
      restored: restoredProjectState.rooms.some((room) => room.id === projectCreatedState.project.groupRoomId),
      restoredSameSession: restoredProjectState.projects.find((candidate) => candidate.id === projectCreatedState.project.id)?.members.find((member) => member.agentId === createdState.agent.id)?.sessionRoomId === projectMemberSession?.sessionRoomId,
      memberSessionOpened:
        document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() === name &&
        document.querySelector('.room-header .chat-header-title small')?.textContent?.includes('项目会话') === true,
      memberSessionReplied: projectSessionReply.assistantMessage.status === 'complete',
      projectSessionContainsOnlyItsOwnRequest: projectSessionReply.room.messages.some((message) => message.content.includes(sessionMarker)) && !projectSessionReply.room.messages.some((message) => message.content.includes('葡萄柚') || message.content.includes('珊瑚标记')),
    };
    return {
      navigationLayout: ${JSON.stringify(navigationLayout)},
      roomDraftIsolation: ${JSON.stringify(roomDraftIsolation)},
      forwarding: {
        ...${JSON.stringify(forwardingSelection)},
        narrow: ${JSON.stringify(forwardNarrow)},
        ...${JSON.stringify(forwardingSent)},
      },
      specialistDelegation: ${JSON.stringify(specialistDelegation)},
      historySearch: ${JSON.stringify(historySearch)},
      continuationThread: {
        ...${JSON.stringify(continuationThreadWorkflow)},
        narrow: ${JSON.stringify(continuationNarrow)},
        threadNarrow: ${JSON.stringify(continuationRoomNarrow)},
        ...${JSON.stringify(continuationLifecycle)},
      },
      initial,
      initialDialog,
      dialogDesktop: ${JSON.stringify(dialogDesktop)},
      dialogNarrow: ${JSON.stringify(dialogNarrow)},
      cancelReturnedFocus,
      cancelFocusTarget,
      agentId: createdState.agent.id,
      createdRoomId: directRoom.room.id,
      initialDirectIsEmpty,
      projectWorkDefaultedOff,
      capabilityWasExplicitlyGranted,
      projectWorkOptInAndReversible,
      agentProfileEdit: profileEdit,
      compactRoomLayout,
      archived: Boolean(archivedState.agents.find((agent) => agent.id === createdState.agent.id)?.archivedAt),
      archivedUi,
      archivedInviteExcluded,
      restored: !restoredState.agents.find((agent) => agent.id === createdState.agent.id)?.archivedAt,
      inviteVisible,
      sameIdentityJoined,
      groupDidNotImportDm,
      projectLifecycle,
      totalAgents: groupState.agents.length,
      totalRooms: groupState.rooms.length,
    };
  })()`);

    const projectSessionPrompt =
      socialAgentE2eModelRequests.at(-1)?.messages ?? [];
    result.projectLifecycle.projectSessionModelScope =
      projectSessionPrompt.some((message) =>
        message.content.includes('noema_project_session'),
      ) &&
      projectSessionPrompt.some((message) =>
        message.content.includes('比较平台价格并记录变化'),
      ) &&
      projectSessionPrompt.some((message) =>
        message.content.includes('E2E 项目会话请求标记：蓝松石'),
      ) &&
      !projectSessionPrompt.some((message) =>
        /葡萄柚|珊瑚标记/.test(message.content),
      );

    if (socialAgentProjectScreenshotPath) {
      mainWindow.setSize(1280, 800);
      await mainWindow.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      const image = await mainWindow.capturePage();
      writeSmokeScreenshot(socialAgentProjectScreenshotPath, image);
    }

    if (
      !result?.initialDialog?.focusedName ||
      result.initialDialog.fieldCount !== 3 ||
      result.compactRoomLayout.width > 700 ||
      !result.compactRoomLayout.actionsVisible ||
      !result.compactRoomLayout.shellNoOverflow ||
      !result.compactRoomLayout.panelNoOverflow ||
      !result.compactRoomLayout.headerNoOverflow ||
      !result.compactRoomLayout.documentNoOverflow ||
      !result.cancelReturnedFocus ||
      !result.initialDirectIsEmpty ||
      !result.projectWorkDefaultedOff ||
      !result.capabilityWasExplicitlyGranted ||
      !result.projectWorkOptInAndReversible ||
      !result.archived ||
      !result.archivedUi ||
      !result.archivedInviteExcluded ||
      !result.restored ||
      !result.inviteVisible ||
      !result.sameIdentityJoined ||
      !result.groupDidNotImportDm ||
      !result.projectLifecycle?.created ||
      !result.projectLifecycle.projectNotDuplicatedInOtherChats ||
      !result.projectLifecycle.projectBannerVisible ||
      !result.projectLifecycle.memberSessionCreated ||
      !result.projectLifecycle.groupRoomLoaded ||
      !result.projectLifecycle.projectPrivateDmUnchanged ||
      !result.projectLifecycle.archived ||
      !result.projectLifecycle.archivedProjectHidden ||
      !result.projectLifecycle.restored ||
      !result.projectLifecycle.restoredSameSession ||
      !result.projectLifecycle.memberSessionOpened ||
      !result.projectLifecycle.memberSessionReplied ||
      !result.projectLifecycle.projectSessionContainsOnlyItsOwnRequest ||
      !result.projectLifecycle.projectSessionModelScope
    ) {
      throw new Error(
        `用户专业联系人创建流程不符合预期：${JSON.stringify(result)}`,
      );
    }
    await mainWindow.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    document.querySelector('.navigation-reveal')?.click();
    await waitFor(() => !document.querySelector('.social-body')?.classList.contains('room-open'), '打开移动端聊天列表');
    const expectedAgentName = ${JSON.stringify(result.agentProfileEdit?.name ?? '')};
    const row = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.item-title')?.textContent?.trim() === expectedAgentName);
    if (!row) throw new Error('找不到专业联系人的常驻私聊列表项');
    row?.click();
    await waitFor(
      () =>
        document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() ===
          expectedAgentName &&
        !document.querySelector('.project-context-strip'),
      '返回成员常驻私聊',
    );
  })()`);
    const inspectAgentProfileDialog = async (width: number, height: number) => {
      mainWindow?.setSize(width, height);
      await mainWindow?.webContents.executeJavaScript(
        `new Promise((resolve) => {
        const dialog = document.querySelector('.agent-create-dialog');
        const animations = dialog?.getAnimations() ?? [];
        Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
          .then(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })`,
      );
      return mainWindow?.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('.agent-create-dialog')?.getBoundingClientRect();
      const submit = document.querySelector('.agent-create-dialog button[type="submit"]')?.getBoundingClientRect();
      const shell = document.querySelector('.social-shell');
      return {
        width: window.innerWidth,
        visible: Boolean(dialog && dialog.width > 0 && dialog.height > 0),
        fieldCount: document.querySelectorAll('.agent-create-dialog .dialog-field').length,
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        submitVisible: Boolean(dialog && submit && submit.top >= dialog.top && submit.bottom <= dialog.bottom && submit.bottom <= window.innerHeight),
      };
    })()`);
    };
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(`(async () => {
    const profileTriggerDeadline = Date.now() + 5000;
    while (Date.now() < profileTriggerDeadline && !document.querySelector('[aria-label="成员资料"]')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    document.querySelector('[aria-label="成员资料"]')?.click();
    const profileDeadline = Date.now() + 5000;
    while (Date.now() < profileDeadline && !document.querySelector('.profile-links button')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    const edit = [...document.querySelectorAll('.profile-links button')]
      .find((button) => button.textContent?.trim() === '编辑资料');
    if (!edit) throw new Error('成员资料页缺少资料编辑入口');
    edit.click();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !document.querySelector('.agent-create-dialog')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (!document.querySelector('.agent-create-dialog')) throw new Error('资料编辑窗口没有打开');
  })()`);
    const profileNarrow = await inspectAgentProfileDialog(360, 640);
    if (
      !profileNarrow?.visible ||
      profileNarrow.width > 700 ||
      profileNarrow.fieldCount !== 3 ||
      !profileNarrow.shellNoOverflow ||
      !profileNarrow.documentNoOverflow ||
      !profileNarrow.submitVisible
    ) {
      throw new Error(
        `窄窗口联系人资料编辑布局不符合预期：${JSON.stringify(profileNarrow)}`,
      );
    }
    if (socialAgentProfileNarrowScreenshotPath) {
      writeSmokeScreenshot(
        socialAgentProfileNarrowScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
    await mainWindow.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
    );
    await mainWindow.webContents.executeJavaScript(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
    );
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(`(async () => {
    const edit = [...document.querySelectorAll('.profile-links button')]
      .find((button) => button.textContent?.trim() === '编辑资料');
    edit?.click();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !document.querySelector('.agent-create-dialog')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  })()`);
    const profileDesktop = await inspectAgentProfileDialog(1280, 800);
    if (
      !profileDesktop?.visible ||
      profileDesktop.fieldCount !== 3 ||
      !profileDesktop.shellNoOverflow ||
      !profileDesktop.documentNoOverflow ||
      !profileDesktop.submitVisible
    ) {
      throw new Error(
        `桌面联系人资料编辑布局不符合预期：${JSON.stringify(profileDesktop)}`,
      );
    }
    if (socialAgentProfileDesktopScreenshotPath) {
      writeSmokeScreenshot(
        socialAgentProfileDesktopScreenshotPath,
        await mainWindow.capturePage(),
      );
    }
    await mainWindow.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
    );
    await mainWindow.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && ![...document.querySelectorAll('.profile-links button')]
      .some((button) => button.textContent?.trim() === '打开常驻私聊')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    [...document.querySelectorAll('.profile-links button')]
      .find((button) => button.textContent?.trim() === '打开常驻私聊')?.click();
  })()`);
    await mainWindow.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() !== ${JSON.stringify(result.agentProfileEdit?.name ?? '')}) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  })()`);
    result.agentProfileEdit.desktopLayout = profileDesktop;
    result.agentProfileEdit.narrowLayout = profileNarrow;
    const inspectContactRoom = async (width: number, height: number) => {
      mainWindow?.setSize(width, height);
      await mainWindow?.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      return mainWindow?.webContents.executeJavaScript(`(() => {
      const shell = document.querySelector('.social-shell');
      const panel = document.querySelector('.conversation-panel');
      const header = document.querySelector('.room-header');
      const actions = document.querySelector('.pane-actions');
      const profile = actions?.querySelector('[aria-label="成员资料"]');
      return {
        width: window.innerWidth,
        roomTitle: document.querySelector('.room-header .chat-header-title strong')?.textContent?.trim() ?? '',
        actionsVisible: Boolean(actions && actions.getClientRects().length && profile?.getClientRects().length),
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        panelNoOverflow: Boolean(panel && panel.scrollWidth <= panel.clientWidth),
        headerNoOverflow: Boolean(header && header.scrollWidth <= header.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    })()`);
    };
    const contactDesktop = await inspectContactRoom(1280, 800);
    if (
      contactDesktop?.roomTitle !== result.agentProfileEdit?.name ||
      !contactDesktop.actionsVisible ||
      !contactDesktop.shellNoOverflow ||
      !contactDesktop.panelNoOverflow ||
      !contactDesktop.headerNoOverflow ||
      !contactDesktop.documentNoOverflow
    ) {
      throw new Error(
        `联系人能力控制桌面布局不符合预期：${JSON.stringify(contactDesktop)}`,
      );
    }
    if (socialAgentContactDesktopScreenshotPath) {
      const image = await mainWindow.capturePage();
      writeSmokeScreenshot(socialAgentContactDesktopScreenshotPath, image);
    }
    const contactNarrow = await inspectContactRoom(666, 640);
    if (
      contactNarrow?.roomTitle !== result.agentProfileEdit?.name ||
      !contactNarrow.actionsVisible ||
      !contactNarrow.shellNoOverflow ||
      !contactNarrow.panelNoOverflow ||
      !contactNarrow.headerNoOverflow ||
      !contactNarrow.documentNoOverflow
    ) {
      throw new Error(
        `联系人能力控制窄窗口布局不符合预期：${JSON.stringify(contactNarrow)}`,
      );
    }
    if (socialAgentContactNarrowScreenshotPath) {
      const image = await mainWindow.capturePage();
      writeSmokeScreenshot(socialAgentContactNarrowScreenshotPath, image);
    }
    const textAttachments = await captureSocialTextAttachmentsE2e();
    return { ...result, contactDesktop, contactNarrow, textAttachments };
  }
  return { captureSocialAgentCreationE2e };
}
