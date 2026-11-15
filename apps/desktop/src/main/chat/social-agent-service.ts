type SocialChatStore = import('./social-chat-store.mjs').SocialChatStore;
/**
 * The shape createAgent() is read as here. TS migration note: the store returns
 * getRoomSnapshot(), which has no `agent` field, so the read below throws and
 * the best-effort catch swallows it. Typed as the caller expects; behavior is
 * unchanged.
 */
};

export class SocialAgentService {
  declare store: SocialChatStore;
  declare ensureAgentWorkspace:
    | ((input: { agentId: string; name: string }) => void)
    | null;
  declare emit: (event: object) => void;
  declare isShuttingDown: () => boolean;
  declare hasActiveRoom: (roomId: string) => boolean;
  declare hasActiveReplyForAgent: (agentId: string) => boolean;

  constructor({
    store,
    ensureAgentWorkspace = null,
    emit,
    isShuttingDown,
    hasActiveRoom,
    hasActiveReplyForAgent,
  }: {
    store: SocialAgentService['store'];
    ensureAgentWorkspace?: SocialAgentService['ensureAgentWorkspace'];
    emit: SocialAgentService['emit'];
    isShuttingDown: SocialAgentService['isShuttingDown'];
    hasActiveRoom: SocialAgentService['hasActiveRoom'];
    hasActiveReplyForAgent: SocialAgentService['hasActiveReplyForAgent'];
  }) {
    this.store = store;
    this.ensureAgentWorkspace = ensureAgentWorkspace;
    this.emit = emit;
    this.isShuttingDown = isShuttingDown;
    this.hasActiveRoom = hasActiveRoom;
    this.hasActiveReplyForAgent = hasActiveReplyForAgent;
  }

  createAgent(input: Parameters<SocialChatStore['createAgent']>[0]) {
    const room = this.store.createAgent(input);
    try {
      // A new contact's direct room has exactly one member: the new specialist.
      const agent = room.members.find((member) => member.kind === 'specialist');
      if (agent)
        this.ensureAgentWorkspace?.({ agentId: agent.id, name: agent.name });
    } catch {
      // Default workspace creation is best-effort; task start retries it.
    }
    this.emit({ type: 'chat-room-created', roomId: room.room.id });
    return room;
  }

  updateAgentProfile(
    input: Parameters<SocialChatStore['updateAgentProfile']>[0],
  ) {
    const agent = this.store.updateAgentProfile(input);
    this.emit({ type: 'agent-state-updated', agentId: agent.id });
    return agent;
  }

  createContinuationThread(
    input: Parameters<SocialChatStore['createContinuationThread']>[0],
  ) {
    if (this.isShuttingDown())
      throw new Error('Noema 正在关闭，暂不能新建主题。');
    const room = this.store.createContinuationThread(input);
    this.emit({ type: 'chat-room-created', roomId: room.room.id });
    this.emit({ type: 'chat-state-updated', roomId: input.sourceRoomId });
    return room;
  }

  setContinuationThreadClosed(roomId: string, closed: boolean) {
    if (this.isShuttingDown())
      throw new Error('Noema 正在关闭，暂不能更新主题。');
    if (closed && this.hasActiveRoom(roomId))
      throw new Error('主题中仍有回复正在生成；停止回复后再结束。');
    const room = this.store.setContinuationThreadClosed(roomId, closed);
    this.emit({ type: 'chat-state-updated', roomId });
    return room;
  }

  deleteContinuationThread(roomId: string) {
    if (this.isShuttingDown())
      throw new Error('Noema 正在关闭，暂不能删除主题。');
    if (this.hasActiveRoom(roomId))
      throw new Error('主题中仍有回复正在生成；停止回复后再删除。');
    const result = this.store.deleteContinuationThread(roomId);
    this.emit({ type: 'chat-state-updated', roomId: result.parentRoomId });
    return result;
  }

  setAgentProjectWork(agentId: string, enabled: boolean) {
    const agent = this.store.setAgentProjectWork(agentId, enabled);
    this.emit({ type: 'agent-state-updated', agentId });
    return agent;
  }

  setAgentArchived(agentId: string, archived: boolean) {
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
