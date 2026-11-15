/**
 * Runs one already-planned member growth review at a time.
 * The service remains the owner of turn execution and room activity.
 */
export class ProjectGrowthBatchScheduler {
  constructor({
    store,
    projectStore,
    isShuttingDown,
    isPaused,
    hasActiveRoom,
    hasStreamingReply,
    requireReadyModel,
    getProjectSessionContext,
    startRun,
    emit,
    formatError,
  }) {
    this.store = store;
    this.projectStore = projectStore;
    this.isShuttingDown = isShuttingDown;
    this.isPaused = isPaused;
    this.hasActiveRoom = hasActiveRoom;
    this.hasStreamingReply = hasStreamingReply;
    this.requireReadyModel = requireReadyModel;
    this.getProjectSessionContext = getProjectSessionContext;
    this.startRun = startRun;
    this.emit = emit;
    this.formatError = formatError;
    this.drains = new Map();
  }

  schedulePending() {
    if (this.isShuttingDown() || this.isPaused() || !this.projectStore) return;
    for (const batch of this.projectStore.listRunningProjectGrowthBatches()) {
      if (batch.members.some((member) => member.status === 'pending')) {
        this.schedule(batch.id);
      }
    }
  }

  finalizeCompleted() {
    if (this.isShuttingDown() || !this.projectStore) return;
    for (const batch of this.projectStore.listUnfinalizedCompletedProjectGrowthBatches()) {
      try {
        const result = this.projectStore.archiveCompletedProjectGrowthBatch(
          batch.id,
        );
        this.emit({
          type: 'project-updated',
          projectId: result.project.id,
          groupRoomId: result.project.groupRoomId,
        });
        if (result.archived) {
          this.emit({
            type: 'project-growth-archived',
            projectId: result.project.id,
            groupRoomId: result.project.groupRoomId,
            title: result.project.title,
          });
        }
      } catch {
        // Leave the completion unfinalized; startup/state refresh can retry safely.
      }
    }
  }

  retryMember(batchId, agentId) {
    if (this.isShuttingDown()) {
      throw new Error('Noema 正在关闭，暂不能续接成员复盘。');
    }
    const batch = this.projectStore?.getProjectGrowthBatch(batchId);
    if (!batch) throw new Error('找不到这个成长批次。');
    const project = this.projectStore.getProject(batch.projectId);
    if (project.status !== 'active' || project.pendingReview) {
      throw new Error('项目当前不能续接成员复盘。');
    }
    const updated = this.projectStore.retryProjectGrowthMember(
      batchId,
      agentId,
    );
    this.emit({
      type: 'project-updated',
      projectId: project.id,
      groupRoomId: project.groupRoomId,
    });
    this.schedule(batchId);
    return updated;
  }

  schedule(batchId) {
    if (this.isShuttingDown() || this.drains.has(batchId)) return;
    let drain;
    drain = this.drain(batchId)
      .catch(() => {
        const batch = this.projectStore?.getProjectGrowthBatch(batchId);
        if (batch) {
          this.emit({
            type: 'project-updated',
            projectId: batch.projectId,
            groupRoomId: this.projectStore.getProject(batch.projectId)
              .groupRoomId,
          });
        }
      })
      .finally(() => {
        if (this.drains.get(batchId) === drain) {
          this.drains.delete(batchId);
        }
      });
    this.drains.set(batchId, drain);
  }

  async drain(batchId) {
    while (!this.isShuttingDown()) {
      if (this.isPaused()) return;
      const batch = this.projectStore.getProjectGrowthBatch(batchId);
      if (!batch || batch.status !== 'running') return;
      const next = batch.members.find((member) => member.status === 'pending');
      if (!next) return;
      if (
        this.hasActiveRoom(next.sessionRoomId) ||
        this.hasStreamingReply(next.sessionRoomId)
      ) {
        return;
      }
      let model;
      try {
        model = this.requireReadyModel();
      } catch {
        return;
      }
      const claimed = this.projectStore.claimNextProjectGrowthMember(batchId);
      if (!claimed) return;
      const project = this.projectStore.getProject(batch.projectId);
      const context = this.getProjectSessionContext(
        project.groupRoomId,
        claimed.agentId,
      );
      if (!context || context.status !== 'active') {
        this.projectStore.failProjectGrowthMember(batchId, claimed.agentId, {
          status: 'failed',
          code: 'project_session_unavailable',
          message: '该成员的项目会话当前不可用。',
        });
        continue;
      }
      const prompt = [
        `项目「${project.title}」已完成当前共享计划第 ${batch.planRevision} 版。`,
        '请从你自己的项目会话和随后提供的群聊公开记录中复核这段经历。总结你实际承担的工作、哪些做法经结果支持、哪些仍不确定，以及这段经历是否足以改变你自己的定位、指令、记忆、经历或技能。',
        '先参考随本轮载入的自己现有资产；只有存在可复用且有依据的变化时，才调用 manage_member_assets 写入自己的资产，否则明确说明无需修改。经历简报必须简短、带项目来源，不把一次偶然结果写成通用规则。',
        '工具调用必须是真实的工具调用，不要把调用写成正文文字。用一段不超过 200 字的话简述你写了什么，放在工具调用之后。',
        '这是内部成长回合：不要继续项目工作、改共享计划、向群发消息或请求用户确认；不要虚构未参与的工作。',
      ].join('\n\n');
      let turn;
      try {
        turn = this.store.beginTurn({
          roomId: claimed.sessionRoomId,
          agentId: claimed.agentId,
          senderAgentId: 'noema',
          text: prompt,
          model,
        });
        this.projectStore.bindProjectGrowthTurn(
          batchId,
          claimed.agentId,
          turn.turnId,
        );
      } catch (error) {
        this.projectStore.failProjectGrowthMember(batchId, claimed.agentId, {
          status: 'failed',
          code: 'growth_turn_start_failed',
          message: this.formatError(error),
        });
        continue;
      }
      const run = {
        ...turn,
        roomId: claimed.sessionRoomId,
        agentId: claimed.agentId,
        model,
        controller: new AbortController(),
        text: prompt,
        projectContext: context,
        isProjectGrowthTurn: true,
        projectGrowthBatchId: batchId,
        forwardedSources: [],
        replyTo: null,
        done: null,
      };
      run.done = this.startRun(run);
      await run.done;
      this.emit({
        type: 'project-updated',
        projectId: project.id,
        groupRoomId: project.groupRoomId,
      });
      this.finalizeCompleted();
    }
  }
}
