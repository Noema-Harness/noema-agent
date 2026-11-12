export class ProjectReportScheduler {
  constructor({
    store,
    isShuttingDown,
    isPaused,
    hasActiveNoema,
    requireReadyModel,
    emit,
    startRun,
  }) {
    this.store = store;
    this.isShuttingDown = isShuttingDown;
    this.isPaused = isPaused;
    this.hasActiveNoema = hasActiveNoema;
    this.requireReadyModel = requireReadyModel;
    this.emit = emit;
    this.startRun = startRun;
    this.drain = null;
    this.pending = false;
  }

  schedule() {
    if (this.isShuttingDown() || this.isPaused()) return;
    if (this.drain) {
      this.pending = true;
      return;
    }
    this.pending = false;
    const drain = this.drainProjectReports().catch(() => {
      this.emit({ type: 'chat-state-updated', roomId: 'room-noema' });
    });
    this.drain = drain;
    void drain.finally(() => {
      if (this.drain === drain) this.drain = null;
      const rerun = this.pending;
      this.pending = false;
      if (this.isShuttingDown() || this.isPaused() || this.hasActiveNoema())
        return;
      try {
        this.requireReadyModel();
      } catch {
        return;
      }
      const waiting = this.store.db
        .prepare(
          `SELECT 1 FROM social_project_reports pr JOIN social_projects p ON p.id=pr.project_id WHERE pr.status='pending' AND p.status='active' LIMIT 1`,
        )
        .get();
      if (waiting || rerun) this.schedule();
    });
  }

  async drainProjectReports() {
    while (!this.isShuttingDown()) {
      if (this.isPaused()) return;
      if (this.hasActiveNoema() || this.store.hasStreamingReply('room-noema'))
        return;
      let model;
      try {
        model = this.requireReadyModel();
      } catch {
        return;
      }
      const turn = this.store.claimNextProjectReport(model);
      if (!turn) return;
      const projectReportData = turn;
      const userGroupRequest = turn.userGroupRequest === true;
      const projectContext = userGroupRequest
        ? {
            projectId: turn.projectId,
            title: turn.projectTitle,
            brief: turn.projectBrief,
            sourceMessageId: turn.sourceMessageId,
            status: turn.projectStatus,
            agentId: 'noema',
            roomId: turn.groupRoomId,
            groupRoomId: turn.groupRoomId,
          }
        : null;
      const controller = new AbortController();
      const run = {
        ...turn,
        ...this.store.db
          .prepare(
            'SELECT root_id AS rootId,depth FROM social_project_dispatch_log WHERE id=?',
          )
          .get(turn.sourceTurnId),
        controller,
        text: userGroupRequest ? turn.sourceUserText : '项目成员阶段报告',
        forwardedSources: [],
        replyTo: null,
        // Member reports are internal work inputs. A user-authored @Noema
        // message in the group is a public request and must receive its reply
        // in that same group room.
        notifyUser: userGroupRequest,
        suppressPublicReply: !userGroupRequest,
        projectContext,
        projectReportData,
        isProjectReportTurn: true,
        done: null,
      };
      this.emit({
        type: 'chat-turn-started',
        turnId: turn.turnId,
        userMessageId: turn.userMessageId,
        assistantMessageId: turn.assistantMessageId,
        roomId: turn.roomId,
        agentId: 'noema',
        model,
      });
      await this.startRun(run);
    }
  }
}
