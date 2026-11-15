import { resolveGroupRecipient } from '../../shared/chat/group-mentions.ts';

export class ChatMessageSender {
  constructor({
    store,
    projectStore,
    collaboration,
    active,
    isShuttingDown,
    requireReadyModel,
    getProjectSessionContext,
    schedulePendingProjectGroupInboxes,
    schedulePendingProjectReports,
    runTurn,
    emit,
  }) {
    this.store = store;
    this.projectStore = projectStore;
    this.collaboration = collaboration;
    this.active = active;
    this.isShuttingDown = isShuttingDown;
    this.requireReadyModel = requireReadyModel;
    this.getProjectSessionContext = getProjectSessionContext;
    this.schedulePendingProjectGroupInboxes =
      schedulePendingProjectGroupInboxes;
    this.schedulePendingProjectReports = schedulePendingProjectReports;
    this.runTurn = runTurn;
    this.emit = emit;
  }

  get shuttingDown() {
    return this.isShuttingDown();
  }

  sendMessage({
    roomId,
    agentId,
    text,
    replyToMessageId = null,
    reviewRequestId = null,
  }) {
    if (this.shuttingDown) throw new Error('Noema 正在关闭，暂不能发送消息。');
    const snapshot = this.store.getRoomSnapshot(roomId);
    const projectGroup =
      snapshot.room.kind === 'group' &&
      this.projectStore
        ?.listProjects({ includeArchived: true })
        .find((p) => p.groupRoomId === roomId);
    if (projectGroup && this.collaboration) {
      this.projectStore?.assertWorkAllowed(roomId);
      const replyTo = replyToMessageId
        ? this.store.resolveReplyTarget({ roomId, messageId: replyToMessageId })
        : null;
      const result = this.collaboration.publish({
        projectId: projectGroup.id,
        text,
        replyTo,
      });
      this.emit({ type: 'chat-state-updated', roomId });
      this.schedulePendingProjectGroupInboxes();
      this.schedulePendingProjectReports();
      return result;
    }
    if (snapshot.room.kind === 'group') {
      const fallback =
        snapshot.members.find(
          (member) => member.id === 'noema' && !member.archivedAt,
        ) ?? snapshot.members.find((member) => !member.archivedAt);
      const route = resolveGroupRecipient(text, snapshot.members, fallback?.id);
      if (route.error || !route.agent)
        throw new Error(route.error || '群里没有可回应的成员。');
      agentId = route.agent.id;
    }
    const recipient = this.store.getAgent(agentId);
    if (recipient.kind === 'specialist' && recipient.archivedAt) {
      throw new Error('这位联系人已归档；恢复后才能继续聊天。');
    }
    const model = this.requireReadyModel();
    const projectContext = this.getProjectSessionContext(roomId, agentId);
    const review = reviewRequestId
      ? this.projectStore?.getReview(reviewRequestId)
      : null;
    if (
      reviewRequestId &&
      (!review || agentId !== 'noema' || review.roomId !== roomId)
    )
      throw new Error('请在对应 Noema 主聊中提交评审反馈。');
    if (projectContext) this.projectStore?.assertWorkAllowed(roomId);
    const targetMessageId = review?.requestMessageId ?? replyToMessageId;
    const replyTo = targetMessageId
      ? this.store.resolveReplyTarget({
          roomId,
          messageId: targetMessageId,
        })
      : null;
    const beginTurn = (messageText) =>
      this.store.beginTurn({
        roomId,
        agentId,
        text: messageText,
        model,
        replyTo,
      });
    if (snapshot.room.kind === 'group') {
      this.projectStore?.assertWorkAllowed(roomId);
    }
    const turn = review
      ? this.projectStore.submitReview({
          reviewId: review.id,
          roomId,
          feedback: text,
          beginTurn: (current, feedback) =>
            beginTurn(`对「${current.projectTitle}」的评审反馈：\n${feedback}`),
        }).turn
      : beginTurn(text);
    const reviewContext = review
      ? {
          reviewId: review.id,
          projectId: review.projectId,
          projectTitle: this.projectStore.getProject(review.projectId).title,
          feedback: text,
        }
      : null;
    const controller = new AbortController();
    const run = {
      ...turn,
      controller,
      text,
      notifyUser: true,
      forwardedSources: [],
      replyTo,
      projectContext,
      reviewContext,
      mirrorRoomId: turn.mirrorRoomId ?? null,
      mirrorUserMessageId: turn.mirrorUserMessageId ?? null,
      mirrorAssistantMessageId: turn.mirrorAssistantMessageId ?? null,
      done: null,
    };
    run.done = this.runTurn(run);
    this.active.set(roomId, run);
    if (run.mirrorRoomId) this.active.set(run.mirrorRoomId, run);
    this.emit({ type: 'chat-turn-started', ...turn });
    if (run.mirrorRoomId) {
      this.emit({
        type: 'chat-turn-started',
        turnId: turn.turnId,
        userMessageId: turn.mirrorUserMessageId,
        assistantMessageId: turn.mirrorAssistantMessageId,
        roomId: run.mirrorRoomId,
        agentId,
        model,
      });
    }
    if (review) {
      const project = this.projectStore.getProject(review.projectId);
      this.emit({
        type: 'project-updated',
        projectId: project.id,
        groupRoomId: project.groupRoomId,
      });
    }
    return { turnId: turn.turnId, messageId: turn.assistantMessageId };
  }
}
