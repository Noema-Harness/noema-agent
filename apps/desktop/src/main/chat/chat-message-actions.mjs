export class ChatMessageActions {
  constructor({
    store,
    active,
    isShuttingDown,
    requireReadyModel,
    getProjectSessionContext,
    runTurn,
    emit,
  }) {
    this.store = store;
    this.active = active;
    this.isShuttingDown = isShuttingDown;
    this.requireReadyModel = requireReadyModel;
    this.getProjectSessionContext = getProjectSessionContext;
    this.runTurn = runTurn;
    this.emit = emit;
  }

  get shuttingDown() {
    return this.isShuttingDown();
  }

  forwardMessages({ sourceRoomId, sourceIds, targetRoomId }) {
    if (this.shuttingDown) throw new Error('Noema 正在关闭，暂不能转发消息。');
    const result = this.store.appendForwardedMessage({
      sourceRoomId,
      sourceIds,
      targetRoomId,
    });
    this.emit({ type: 'chat-state-updated', roomId: targetRoomId });
    return result;
  }

  retryReply(messageId) {
    if (this.shuttingDown) throw new Error('Noema 正在关闭，暂不能重试。');
    const model = this.requireReadyModel();
    const assistant = this.store.getSocialMessage(messageId);
    const projectReportData =
      this.store.getProjectReportByAssistantMessage(messageId);
    const projectContext =
      assistant?.role === 'assistant'
        ? this.getProjectSessionContext(assistant.roomId, assistant.agentId)
        : null;
    let turn;
    let mirrorUserMessageId = null;
    let publicRoomId = null;
    let publicAssistantMessageId = null;
    const projectGroupId = projectContext?.groupRoomId;
    if (projectGroupId) {
      const sessionRoomId = projectContext.roomId;
      const otherRoomId =
        assistant.roomId === projectGroupId ? sessionRoomId : projectGroupId;
      const counterpart = this.store.getTurnAssistantMessage(
        otherRoomId,
        assistant.turnId,
        assistant.agentId,
      );
      if (counterpart) {
        publicRoomId = projectGroupId;
        mirrorUserMessageId =
          this.store.getTurnUserMessage(sessionRoomId, assistant.turnId)?.id ??
          null;
        const publicUserMessageId =
          this.store.getTurnUserMessage(publicRoomId, assistant.turnId)?.id ??
          this.store.db
            .prepare(
              'SELECT source_message_id AS id FROM social_project_dispatch_log WHERE assistant_message_id=?',
            )
            .get(
              assistant.roomId === publicRoomId ? assistant.id : counterpart.id,
            )?.id ??
          null;
        if (!mirrorUserMessageId || !publicUserMessageId) {
          throw new Error(
            '群聊与成员项目会话的用户消息记录不完整，暂不能重试。',
          );
        }
        const retried = this.store.retryReplies(
          [assistant.id, counterpart.id],
          model,
        );
        turn = retried[0];
        publicAssistantMessageId =
          assistant.roomId === publicRoomId ? assistant.id : counterpart.id;
        turn = {
          ...turn,
          roomId: publicRoomId,
          assistantMessageId: publicAssistantMessageId,
          userMessageId: publicUserMessageId,
          mirrorRoomId: sessionRoomId,
          mirrorAssistantMessageId:
            assistant.roomId === sessionRoomId ? assistant.id : counterpart.id,
          mirrorUserMessageId,
          projectReport:
            this.store.getTurnUserMessage(publicRoomId, assistant.turnId)
              ?.senderAgentId === null
              ? {
                  projectId: projectContext.projectId,
                  sourceTurnId: assistant.turnId,
                  sourceUserMessageId: publicUserMessageId,
                  sourceGroupAssistantMessageId:
                    assistant.roomId === publicRoomId
                      ? assistant.id
                      : counterpart.id,
                  agentId: assistant.agentId,
                  groupRoomId: publicRoomId,
                  sessionRoomId,
                }
              : null,
        };
      }
    }
    if (!publicRoomId) {
      turn = projectReportData
        ? this.store.retryProjectReport(messageId, model)
        : this.store.retryReply(messageId, model);
    }
    const controller = new AbortController();
    const run = {
      ...turn,
      assistantMessageId: turn.mirrorRoomId
        ? turn.assistantMessageId
        : messageId,
      controller,
      notifyUser: true,
      retried: true,
      text: turn.userText,
      forwardedSources: turn.forwardedSources,
      replyTo: turn.replyTo,
      projectContext,
      projectReport: turn.projectReport ?? null,
      projectReportData,
      isProjectReportTurn: Boolean(projectReportData),
      mirrorRoomId: turn.mirrorRoomId ?? null,
      mirrorUserMessageId: turn.mirrorUserMessageId ?? null,
      mirrorAssistantMessageId: turn.mirrorAssistantMessageId ?? null,
      done: null,
    };
    run.done = this.runTurn(run);
    this.active.set(turn.roomId, run);
    if (run.mirrorRoomId) this.active.set(run.mirrorRoomId, run);
    this.emit({
      type: 'chat-turn-started',
      turnId: turn.turnId,
      assistantMessageId: run.assistantMessageId,
      roomId: turn.roomId,
      agentId: turn.agentId,
      model,
    });
    if (run.mirrorRoomId) {
      this.emit({
        type: 'chat-turn-started',
        turnId: turn.turnId,
        userMessageId: run.mirrorUserMessageId,
        assistantMessageId: run.mirrorAssistantMessageId,
        roomId: run.mirrorRoomId,
        agentId: turn.agentId,
        model,
      });
    }
    return { turnId: turn.turnId, messageId };
  }
}
