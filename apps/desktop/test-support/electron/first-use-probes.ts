import path from 'node:path';
import type { DesktopProbeContext } from './probe-context';
import { writeSmokeScreenshot } from './capture';
export function createFirstUseProbes(context: DesktopProbeContext) {
  const { mainWindow, writeSmokeLog, socialAgentE2eModelRequests } = context;
  const { testSocialAgentLiveE2e, socialAgentE2eResultPath } = context.options;
  async function captureSocialR0FirstUseE2e() {
    if (!mainWindow || mainWindow.isDestroyed() || !testSocialAgentLiveE2e) {
      throw new Error('R0 首次使用路径需要隔离的真实模型和桌面窗口。');
    }
    const prompt =
      '我有一个摄影工作坊的小副业想法：面向本地新手，周末做半天实操课，家里已有场地，单次试办预算上限 3000 元。我想判断需求、课程设计、运营和预算是否可行，最后形成一页试办方案与关键风险。请先判断是否需要组织不同专业角色协作；如果需要，就创建合适的成员并完成首轮分析，把结果整理回这条主聊。不要替我决定是否上线；没有可靠本地数据的地方请标明待核实。';
    const sendPrompt = async (text: string, phase: string) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        throw new Error('发送 R0 主聊消息前，桌面窗口已关闭。');
      }
      writeSmokeLog(`${phase}-send-started`);
      let sendTimeout: NodeJS.Timeout | null = null;
      const sent = await Promise.race([
        mainWindow.webContents.executeJavaScript(
          `window.noema.sendSocialMessage(${JSON.stringify({
            roomId: 'room-noema',
            agentId: 'noema',
            text,
          })})`,
        ),
        new Promise<never>((_, reject) => {
          sendTimeout = setTimeout(
            () => reject(new Error('等待主聊接受 R0 消息超过 30 秒。')),
            30_000,
          );
        }),
      ]).finally(() => {
        if (sendTimeout) clearTimeout(sendTimeout);
      });
      writeSmokeLog(`${phase}-send-accepted`, { turnId: sent.turnId });
      return sent;
    };
    const waitForReply = async (sent: { turnId: string; messageId: string }) =>
      mainWindow!.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 7 * 60_000;
      const sent = ${JSON.stringify(sent)};
      while (Date.now() < deadline) {
        const [state, mainRoom] = await Promise.all([
          window.noema.getSocialState(),
          window.noema.getSocialRoom('room-noema'),
        ]);
        const userMessage = mainRoom.messages.find((message) => message.turnId === sent.turnId && message.role === 'user');
        const mainReply = userMessage
          ? mainRoom.messages.find((message) => message.turnId === userMessage.turnId && message.role === 'assistant')
          : null;
        const project = userMessage
          ? state.projects.find((item) => item.sourceMessageId === userMessage.id)
          : null;
        let memberReplies = [];
        if (project) {
          const group = await window.noema.getSocialRoom(project.groupRoomId);
          memberReplies = group.messages.filter((message) =>
            message.role === 'assistant' && message.senderAgentId !== 'noema' && message.status === 'complete'
          );
        }
        if (mainReply?.status === 'failed' || mainReply?.status === 'interrupted') {
          return {
            outcome: 'reply_failed', sent, replyStatus: mainReply.status,
            errorCode: mainReply.errorCode, errorMessage: mainReply.errorMessage,
            project: project ? { id: project.id, title: project.title, status: project.status, members: project.members.map(({ agentId, name, headline }) => ({ agentId, name, headline })) } : null,
            memberReplyCount: memberReplies.length, mainReply: mainReply.content,
          };
        }
        if (mainReply?.status === 'complete') {
          return {
            outcome: 'reply_complete', sent,
            project: project ? { id: project.id, title: project.title, status: project.status, members: project.members.map(({ agentId, name, headline }) => ({ agentId, name, headline })) } : null,
            memberReplyCount: memberReplies.length, mainReply: mainReply.content,
            memberReplySummaries: memberReplies.map((message) => ({ senderAgentId: message.senderAgentId, contentLength: message.content.length, tail: message.content.slice(-120) })),
            model: mainReply.model,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const room = await window.noema.getSocialRoom('room-noema');
      const state = await window.noema.getSocialState();
      const userMessage = room.messages.find((message) => message.turnId === sent.turnId && message.role === 'user');
      const project = userMessage
        ? state.projects.find((item) => item.sourceMessageId === userMessage.id)
        : null;
      const mainReply = userMessage
        ? room.messages.find((message) => message.turnId === userMessage.turnId && message.role === 'assistant')
        : null;
      return {
        outcome: 'timed_out', sent,
        replyStatus: mainReply?.status ?? null,
        errorCode: mainReply?.errorCode ?? null,
        errorMessage: mainReply?.errorMessage ?? null,
        project: project ? { id: project.id, title: project.title, status: project.status, members: project.members.map(({ agentId, name, headline }) => ({ agentId, name, headline })) } : null,
      };
    })()`);
    const sent = await sendPrompt(prompt, 'r0-initial');
    const firstTurn = await waitForReply(sent);
    const followupPrompt =
      '先按二线城市、每期 4–6 人、预算 3000 元、有现成场地、我会基础摄影但没有教学经验作为工作假设。现在请实际推进首轮分析：组织两位不同专业成员，一位评估本地需求与竞品验证方法，一位设计半天新手课程和材料清单。让他们各自给建议，再由你汇总并标出待核实的信息。不要替我决定是否开课，也不必再追问，先按假设完成这一轮。';
    let result = firstTurn;
    if (firstTurn.outcome === 'reply_complete' && !firstTurn.project) {
      const followupSent = await sendPrompt(followupPrompt, 'r0-followup');
      result = await waitForReply(followupSent);
      result.firstTurn = {
        status: firstTurn.outcome,
        model: firstTurn.model,
        reply: firstTurn.mainReply,
      };
      result.followupPrompt = followupPrompt;
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('R0 首次使用结果返回前，桌面窗口已关闭。');
    }
    result.modelCallCount = socialAgentE2eModelRequests.length;
    result.prompt = prompt;
    if (
      result.outcome !== 'reply_complete' ||
      !result.project ||
      result.project.members.filter(
        (member: { agentId: string }) => member.agentId !== 'noema',
      ).length < 2 ||
      result.memberReplyCount < 2
    ) {
      writeSmokeLog('r0-result-incomplete', {
        outcome: result.outcome,
        modelCallCount: result.modelCallCount,
        projectCreated: Boolean(result.project),
        memberReplyCount: result.memberReplyCount ?? 0,
        replyStatus: result.replyStatus ?? null,
        errorCode: result.errorCode ?? null,
      });
      throw new Error(`R0 首次真实组队闭环未完成：${JSON.stringify(result)}`);
    }
    if (socialAgentE2eResultPath) {
      const renderedReplyComplete = await mainWindow.webContents
        .executeJavaScript(`(async () => {
      const deadline = Date.now() + 5_000;
      const messageId = ${JSON.stringify(result.sent.messageId)};
      while (Date.now() < deadline) {
        const message = document.querySelector('[data-message-id="' + CSS.escape(messageId) + '"]');
        if (message?.querySelector('.message-actions') && !document.querySelector('.runtime-status')) {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    })()`);
      if (!renderedReplyComplete) {
        throw new Error(
          '主聊回复已持久化完成，但桌面界面仍显示生成中；不保存未稳定截图。',
        );
      }
      const screenshotPath = path.join(
        path.dirname(socialAgentE2eResultPath),
        'r0-first-use.png',
      );
      writeSmokeScreenshot(screenshotPath, await mainWindow.capturePage());
      result.screenshotPath = screenshotPath;
    }
    writeSmokeLog('r0-result-complete', {
      projectCreated: true,
      memberCount: result.project.members.length,
      memberReplyCount: result.memberReplyCount,
      modelCallCount: result.modelCallCount,
    });
    return result;
  }
  return { captureSocialR0FirstUseE2e };
}
