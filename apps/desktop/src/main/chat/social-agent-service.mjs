export class SocialAgentService {
  constructor({
    store,
    ensureAgentWorkspace = null,
    emit,
    isShuttingDown,
    hasActiveRoom,
    hasActiveReplyForAgent,
  }) {
    this.store = store;
    this.ensureAgentWorkspace = ensureAgentWorkspace;
    this.emit = emit;
    this.isShuttingDown = isShuttingDown;
    this.hasActiveRoom = hasActiveRoom;
    this.hasActiveReplyForAgent = hasActiveReplyForAgent;
  }

  createAgent(input) {
    const room = this.store.createAgent(input);
    try {
      this.ensureAgentWorkspace?.({
        agentId: room.agent.id,
        name: room.agent.name,
      });
    } catch {
      // Default workspace creation is best-effort; task start retries it.
    }
    this.emit({ type: 'chat-room-created', roomId: room.room.id });
    return room;
  }

  updateAgentProfile(input) {
    const agent = this.store.updateAgentProfile(input);
    this.emit({ type: 'agent-state-updated', agentId: agent.id });
    return agent;
  }

  createContinuationThread(input) {
    if (this.isShuttingDown())
      throw new Error('Noema 正在关闭，暂不能新建主题。');
    const room = this.store.createContinuationThread(input);
    this.emit({ type: 'chat-room-created', roomId: room.room.id });
    this.emit({ type: 'chat-state-updated', roomId: input.sourceRoomId });
    return room;
  }

  setContinuationThreadClosed(roomId, closed) {
    if (this.isShuttingDown())
      throw new Error('Noema 正在关闭，暂不能更新主题。');
    if (closed && this.hasActiveRoom(roomId))
      throw new Error('主题中仍有回复正在生成；停止回复后再结束。');
    const room = this.store.setContinuationThreadClosed(roomId, closed);
    this.emit({ type: 'chat-state-updated', roomId });
    return room;
  }

  deleteContinuationThread(roomId) {
    if (this.isShuttingDown())
      throw new Error('Noema 正在关闭，暂不能删除主题。');
    if (this.hasActiveRoom(roomId))
      throw new Error('主题中仍有回复正在生成；停止回复后再删除。');
    const result = this.store.deleteContinuationThread(roomId);
    this.emit({ type: 'chat-state-updated', roomId: result.parentRoomId });
    return result;
  }

  setAgentProjectWork(agentId, enabled) {
    const agent = this.store.setAgentProjectWork(agentId, enabled);
    this.emit({ type: 'agent-state-updated', agentId });
    return agent;
  }

  setAgentArchived(agentId, archived) {
    if (archived) {
      if (this.hasActiveReplyForAgent(agentId)) {
        throw new Error('这位联系人正在回复；停止当前回复后再归档。');
      }
      if (this.store.hasActiveWorkForAgent(agentId)) {
        throw new Error(
          '这位联系人还有未完成的工作；先等待或停止任务后再归档。',
        );
      }
    }
    const agent = this.store.setAgentArchived(agentId, archived);
    this.emit({ type: 'agent-state-updated', agentId });
    return agent;
  }
}
