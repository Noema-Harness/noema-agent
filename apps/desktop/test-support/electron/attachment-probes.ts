import type { DesktopProbeContext } from './probe-context';
import { writeSmokeScreenshot } from './capture';
export function createAttachmentProbes(context: DesktopProbeContext) {
  const { mainWindow, socialAgentE2eModelRequests } = context;
  const {
    testSocialAgentLiveE2e,
    socialTextAttachmentDesktopScreenshotPath,
    socialTextAttachmentNarrowScreenshotPath,
  } = context.options;
  async function captureSocialTextAttachmentsE2e() {
    if (!mainWindow || mainWindow.isDestroyed() || testSocialAgentLiveE2e) {
      throw new Error('文字附件 E2E 需要隔离的确定性模型与桌面窗口。');
    }
    mainWindow.setSize(1280, 800);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const requestCountBefore = socialAgentE2eModelRequests.length;
    const ui = await mainWindow.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate, label, timeoutMs = 7000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    await waitFor(() => document.querySelector('.room-list-item'), '聊天列表初始化');
    const noema = [...document.querySelectorAll('.room-list-item')]
      .find((item) => item.querySelector('.item-title')?.textContent?.trim() === 'Noema');
    if (!noema) {
      const state = await window.noema.getSocialState();
      return {
        missingNoema: true,
        rooms: state.rooms.map((room) => ({ id: room.id, title: room.title })),
        roomListTitles: [...document.querySelectorAll('.item-title')].map((item) => item.textContent?.trim()),
        visibleText: document.body.innerText.slice(0, 1200),
      };
    }
    noema.click();
    await waitFor(() => document.querySelector('.chat-header-title strong')?.textContent?.trim() === 'Noema', 'Noema 主聊');

    const choose = (file) => {
      const input = document.querySelector('input[aria-label="选择附件"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('找不到附件输入框。');
      const transfer = new DataTransfer();
      transfer.items.add(file);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set?.call(input, transfer.files);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const makePdf = () => {
      const stream = 'BT /F1 12 Tf 72 720 Td (Noema PDF marker: amber harbor) Tj ET';
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        '<< /Length ' + stream.length + ' >>\\nstream\\n' + stream + '\\nendstream',
      ];
      let pdf = '%PDF-1.4\\n';
      const offsets = [0];
      for (const [index, object] of objects.entries()) {
        offsets.push(new TextEncoder().encode(pdf).byteLength);
        pdf += String(index + 1) + ' 0 obj\\n' + object + '\\nendobj\\n';
      }
      const xrefOffset = new TextEncoder().encode(pdf).byteLength;
      pdf += 'xref\\n0 ' + (objects.length + 1) + '\\n0000000000 65535 f \\n';
      pdf += offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n \\n').join('');
      pdf += 'trailer\\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\\nstartxref\\n' + xrefOffset + '\\n%%EOF';
      return new File([pdf], 'brief.pdf', { type: 'application/pdf' });
    };
    choose(new File(['unsupported'], 'photo.png', { type: 'image/png' }));
    await waitFor(() => document.querySelector('.inline-notice')?.textContent?.includes('图片暂不支持'), '不支持格式提示');
    const unsupportedNotice = document.querySelector('.inline-notice')?.textContent?.trim() ?? '';

    const input = document.querySelector('#social-message-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!(input instanceof HTMLTextAreaElement) || !setter) throw new Error('找不到聊天输入框。');
    setter.call(input, '请概括这个文件。');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    choose(new File(['remove me'], 'discard.txt', { type: 'text/plain' }));
    await waitFor(() => document.querySelector('.attachment-chip')?.textContent?.includes('discard.txt'), '待移除附件预览');
    document.querySelector('[aria-label="移除附件 discard.txt"]')?.click();
    await waitFor(() => !document.querySelector('.attachment-chip'), '移除附件');
    const draftPreservedAfterRemoval = input.value === '请概括这个文件。';
    choose(new File(['附件正文标记：琥珀海岸'], 'brief.txt', { type: 'text/plain' }));
    await waitFor(() => document.querySelector('.attachment-chip')?.textContent?.includes('brief.txt'), '附件预览');
    choose(makePdf());
    await waitFor(() => [...document.querySelectorAll('.attachment-chip')].some((chip) => chip.textContent?.includes('brief.pdf')), 'PDF 附件预览');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const desktop = (() => {
      const shell = document.querySelector('.social-shell');
      const composer = document.querySelector('.message-composer');
      return {
        width: window.innerWidth,
        sendEnabled: !document.querySelector('.send-message-button')?.disabled,
        chipVisible: Boolean(document.querySelector('.attachment-chip')?.getClientRects().length),
        shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
        documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        composerVisible: Boolean(
          composer &&
            composer.getBoundingClientRect().bottom <= window.innerHeight + 1,
        ),
        composerBottom: composer?.getBoundingClientRect().bottom ?? null,
        viewportHeight: window.innerHeight,
        attachmentRows: document.querySelectorAll('.composer-files').length,
        attachmentChips: [...document.querySelectorAll('.attachment-chip')].map(
          (chip) => chip.textContent?.trim() ?? '',
        ),
      };
    })();
    return { unsupportedNotice, draftPreservedAfterRemoval, desktop };
  })()`);

    if (ui.missingNoema) {
      if (socialTextAttachmentDesktopScreenshotPath) {
        writeSmokeScreenshot(
          socialTextAttachmentDesktopScreenshotPath,
          await mainWindow.capturePage(),
        );
      }
      throw new Error(`附件 E2E 未找到 Noema：${JSON.stringify(ui)}`);
    }
    if (
      !ui.draftPreservedAfterRemoval ||
      !ui.desktop?.sendEnabled ||
      !ui.desktop?.chipVisible ||
      !ui.desktop?.shellNoOverflow ||
      !ui.desktop?.documentNoOverflow ||
      !ui.desktop?.composerVisible
    ) {
      if (socialTextAttachmentDesktopScreenshotPath) {
        writeSmokeScreenshot(
          socialTextAttachmentDesktopScreenshotPath,
          await mainWindow.capturePage(),
        );
      }
      throw new Error(`文字附件桌面输入状态异常：${JSON.stringify(ui)}`);
    }
    if (socialTextAttachmentDesktopScreenshotPath) {
      writeSmokeScreenshot(
        socialTextAttachmentDesktopScreenshotPath,
        await mainWindow.capturePage(),
      );
    }

    mainWindow.setSize(680, 560);
    await mainWindow.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const narrow = await mainWindow.webContents.executeJavaScript(`(() => {
    const shell = document.querySelector('.social-shell');
    const composer = document.querySelector('.message-composer');
    const rect = composer?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      sendEnabled: !document.querySelector('.send-message-button')?.disabled,
      chipVisible: Boolean(document.querySelector('.attachment-chip')?.getClientRects().length),
      shellNoOverflow: Boolean(shell && shell.scrollWidth <= shell.clientWidth),
      documentNoOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      composerVisible: Boolean(rect && rect.top < window.innerHeight && rect.bottom > 0),
      composerBounds: rect ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) } : null,
    };
  })()`);
    if (
      !narrow?.sendEnabled ||
      !narrow?.chipVisible ||
      !narrow?.shellNoOverflow ||
      !narrow?.documentNoOverflow ||
      !narrow?.composerVisible
    ) {
      throw new Error(`文字附件窄窗输入状态异常：${JSON.stringify(narrow)}`);
    }
    if (socialTextAttachmentNarrowScreenshotPath) {
      writeSmokeScreenshot(
        socialTextAttachmentNarrowScreenshotPath,
        await mainWindow.capturePage(),
      );
    }

    const sent = await mainWindow.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate, label, timeoutMs = 7000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error('等待超时：' + label);
    };
    document.querySelector('.send-message-button')?.click();
    return waitFor(async () => {
      const room = await window.noema.getSocialRoom('room-noema');
      const user = [...room.messages].reverse().find((message) =>
        message.role === 'user' && message.content.includes('Noema PDF marker: amber harbor'),
      );
      const assistant = user
        ? room.messages.find((message) => message.turnId === user.turnId && message.role === 'assistant')
        : null;
      if (assistant?.status === 'failed' || assistant?.status === 'interrupted') {
        throw new Error('附件消息回复失败：' + assistant.errorMessage);
      }
      if (user && assistant?.status === 'complete') {
        return {
          messageContent: user.content,
          replyStatus: assistant.status,
          remainingAttachmentChips: document.querySelectorAll('.attachment-chip').length,
        };
      }
      return null;
    }, '附件消息完成');
  })()`);
    const request = socialAgentE2eModelRequests.at(-1);
    const modelInput =
      request?.messages.map((message) => message.content).join('\n') ?? '';
    mainWindow.setSize(1280, 800);
    const result = {
      unsupportedNotice: ui.unsupportedNotice,
      draftPreservedAfterRemoval: ui.draftPreservedAfterRemoval,
      desktop: ui.desktop,
      narrow,
      messagePersisted:
        sent.messageContent.includes('附件文件："brief.txt"') &&
        sent.messageContent.includes('附件正文标记：琥珀海岸') &&
        sent.messageContent.includes('附件文件："brief.pdf"') &&
        sent.messageContent.includes('Noema PDF marker: amber harbor'),
      replyCompleted: sent.replyStatus === 'complete',
      modelReceivedAttachment:
        modelInput.includes('附件文件："brief.txt"') &&
        modelInput.includes('附件正文标记：琥珀海岸') &&
        modelInput.includes('附件文件："brief.pdf"') &&
        modelInput.includes('Noema PDF marker: amber harbor'),
      singleModelRequest:
        socialAgentE2eModelRequests.length === requestCountBefore + 1,
      attachmentDraftCleared: sent.remainingAttachmentChips === 0,
    };
    if (
      !result.unsupportedNotice.includes('图片暂不支持') ||
      !result.draftPreservedAfterRemoval ||
      !result.messagePersisted ||
      !result.replyCompleted ||
      !result.modelReceivedAttachment ||
      !result.singleModelRequest ||
      !result.attachmentDraftCleared
    ) {
      throw new Error(
        `文字附件没有完成同条消息闭环：${JSON.stringify(result)}`,
      );
    }
    return result;
  }
  return { captureSocialTextAttachmentsE2e };
}
