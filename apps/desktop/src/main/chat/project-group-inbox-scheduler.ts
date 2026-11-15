import type { ChatRun } from './chat-run.ts';

type SocialChatStore = import('./social-chat-store.mjs').SocialChatStore;
type SocialProjectStore =
  import('../projects/social-project-store.mjs').SocialProjectStore;
/** Row shape returned by SocialChatStore.listProjectGroupInbox. */
type ProjectGroupInboxItem = {
  turnId: string;
  projectId: string;
  roomId: string;
  agentId: string;
  sessionRoomId: string;
  userMessageId: string;
  text: string;
  senderAgentId: string | null;
  rootId: string | null;
  depth: number;
  triggerKind: string | null;
  planItemId: string | null;
  planSubmissionRevision: number | null;
  replyToJson: string | null;
  replyTo: Record<string, unknown> | null;
  queuedAt: string;
};
/** Plan item fields read when deciding dispatch order. */
type PlanItem = {
  id: string;
  ownerAgentId: string | null;
  status: string;
  ready: boolean;
};

/**
 * Drains durable project-group inbox items into one project-session run at a
 * time. Keeps queue state, pause-on-failure, and dispatch eligibility out of
 * the chat service while preserving the existing run lifecycle.
 */
export class ProjectGroupInboxScheduler {
  // The untyped store infers `roomId = null` as `null`; it takes a room ID.
  declare store: Omit<SocialChatStore, 'listProjectGroupInbox'> & {
    listProjectGroupInbox: (roomId?: string | null) => ProjectGroupInboxItem[];
  };
  declare projectStore: SocialProjectStore | null;
  declare collaboration:
    | import('../projects/project-collaboration-store.mjs').ProjectCollaborationStore
    | null;
  declare active: Map<string, ChatRun>;
  declare isShuttingDown: () => boolean;
  declare isPaused: () => boolean;
  declare pause: () => void;
  declare hasStreamingReply: (roomId: string) => boolean;
  declare requireReadyModel: () => string;
  declare getProjectSessionContext: (
    roomId: string,
    agentId: string,
  ) => ReturnType<SocialProjectStore['getProjectSessionContext']>;
  declare syncWorkResults: () => void;
  declare recordOutbox: (event: Record<string, unknown>) => unknown;
  declare scheduleReports: () => void;
  declare startRun: (run: ChatRun) => Promise<unknown>;
  declare emit: (event: object) => void;
  declare drains: Map<string, Promise<void>>;

  constructor({
    store,
    projectStore,
    collaboration,
    active,
    isShuttingDown,
    isPaused,
    pause,
    hasStreamingReply,
    requireReadyModel,
    getProjectSessionContext,
    syncWorkResults,
    recordOutbox,
    scheduleReports,
    startRun,
    emit,
  }: {
    store: ProjectGroupInboxScheduler['store'];
    projectStore: ProjectGroupInboxScheduler['projectStore'];
    collaboration: ProjectGroupInboxScheduler['collaboration'];
    active: ProjectGroupInboxScheduler['active'];
    isShuttingDown: ProjectGroupInboxScheduler['isShuttingDown'];
    isPaused: ProjectGroupInboxScheduler['isPaused'];
    pause: ProjectGroupInboxScheduler['pause'];
    hasStreamingReply: ProjectGroupInboxScheduler['hasStreamingReply'];
    requireReadyModel: ProjectGroupInboxScheduler['requireReadyModel'];
    getProjectSessionContext: ProjectGroupInboxScheduler['getProjectSessionContext'];
    syncWorkResults: ProjectGroupInboxScheduler['syncWorkResults'];
    recordOutbox: ProjectGroupInboxScheduler['recordOutbox'];
    scheduleReports: ProjectGroupInboxScheduler['scheduleReports'];
    startRun: ProjectGroupInboxScheduler['startRun'];
    emit: ProjectGroupInboxScheduler['emit'];
  }) {
    this.store = store;
    this.projectStore = projectStore;
    this.collaboration = collaboration;
    this.active = active;
    this.isShuttingDown = isShuttingDown;
    this.isPaused = isPaused;
    this.pause = pause;
    this.hasStreamingReply = hasStreamingReply;
    this.requireReadyModel = requireReadyModel;
    this.getProjectSessionContext = getProjectSessionContext;
    this.syncWorkResults = syncWorkResults;
    this.recordOutbox = recordOutbox;
    this.scheduleReports = scheduleReports;
    this.startRun = startRun;
    this.emit = emit;
    this.drains = new Map();
  }

  schedulePending() {
    if (this.isShuttingDown()) return;
    try {
      this.syncWorkResults();
    } catch (error) {
      this.emit({
        type: 'project-work-notification-failed',
        error: (error as Error).message,
      });
    }
    const roomIds = new Set(
      this.store.listProjectGroupInbox().map((message) => message.roomId),
    );
    for (const roomId of roomIds) this.scheduleDrain(roomId);
    this.scheduleReports();
  }

  scheduleDrain(roomId: string) {
    if (this.isShuttingDown() || this.isPaused() || this.drains.has(roomId))
      return;
    const drain = this.drain(roomId).catch((error) => {
      // Leave queued work durable, but do not immediately retry a malformed or
      // otherwise undeliverable head item in a microtask loop. A successful
      // user turn is the next explicit recovery boundary.
      this.pause();
      console.error(
        'Project group inbox paused after a delivery error:',
        error?.message ?? error,
      );
      this.emit({ type: 'chat-state-updated', roomId });
    });
    this.drains.set(roomId, drain);
    void drain.finally(() => {
      if (this.drains.get(roomId) === drain) {
        this.drains.delete(roomId);
        if (
          !this.isShuttingDown() &&
          !this.isPaused() &&
          !this.active.has(roomId) &&
          !this.hasStreamingReply(roomId)
        ) {
          const eligible = this.store
            .listProjectGroupInbox(roomId)
            .find((item) => {
              if (
                this.active.has(item.sessionRoomId) ||
                this.hasStreamingReply(item.sessionRoomId)
              )
                return false;
              if (!this.isDispatchable(item)) return false;
              try {
                this.requireReadyModel();
                const context = this.getProjectSessionContext(
                  roomId,
                  item.agentId,
                );
                return context?.status === 'active';
              } catch {
                return false;
              }
            });
          if (eligible) this.scheduleDrain(roomId);
        }
        this.scheduleReports();
      }
    });
  }

  isDispatchable(inboxItem: ProjectGroupInboxItem) {
    if (!inboxItem.planItemId || !this.projectStore) return true;
    const plan = this.projectStore.plans.get(inboxItem.projectId);
    const item = plan.items.find(
      (entry: PlanItem) => entry.id === inboxItem.planItemId,
    );
    // Let prepareDelivery discard stale notifications; only defer a valid,
    // ready item when its owner already has different work in progress.
    if (
      !item ||
      item.ownerAgentId !== inboxItem.agentId ||
      !['pending', 'in_progress'].includes(item.status) ||
      (item.status === 'pending' && !item.ready)
    )
      return true;
    if (item.status !== 'pending') return true;
    return !plan.items.some(
      (other: PlanItem) =>
        other.id !== item.id &&
        other.ownerAgentId === inboxItem.agentId &&
        other.status === 'in_progress',
    );
  }

  async drain(roomId: string) {
    while (!this.isShuttingDown()) {
      if (this.isPaused()) return;
      const pending = this.store
        .listProjectGroupInbox(roomId)
        .find(
          (item) =>
            !this.active.has(item.sessionRoomId) &&
            !this.hasStreamingReply(item.sessionRoomId) &&
            this.isDispatchable(item),
        );
      if (!pending) return;
      if (
        this.active.has(roomId) ||
        this.active.has(pending.sessionRoomId) ||
        this.hasStreamingReply(roomId) ||
        this.hasStreamingReply(pending.sessionRoomId)
      ) {
        return;
      }
      let model;
      let projectContext;
      try {
        model = this.requireReadyModel();
        projectContext = this.getProjectSessionContext(roomId, pending.agentId);
      } catch {
        return;
      }
      if (!projectContext) return;
      const turn = this.store.db.transaction(() =>
        this.collaboration!.prepareDelivery(pending)
          ? this.store.claimProjectGroupMessage(pending.turnId, model)
          : null,
      )();
      if (turn) {
        this.recordOutbox({
          projectId: pending.projectId,
          turnId: pending.turnId,
          agentId: pending.agentId,
          planItemId: pending.planItemId,
          planSubmissionRevision: pending.planSubmissionRevision,
          operation: 'outbox.claim',
          status: 'running',
        });
      }
      if (!turn) {
        if (
          !this.store
            .listProjectGroupInbox(roomId)
            .some((item) => item.turnId === pending.turnId)
        ) {
          this.recordOutbox({
            projectId: pending.projectId,
            turnId: pending.turnId,
            agentId: pending.agentId,
            planItemId: pending.planItemId,
            planSubmissionRevision: pending.planSubmissionRevision,
            operation: 'outbox.stale',
            status: 'skipped',
            errorCode: 'stale_delivery',
          });
          continue;
        }
        return;
      }
      const controller = new AbortController();
      const run: ChatRun = {
        ...turn,
        roomId,
        agentId: turn.agentId,
        model,
        controller,
        text: turn.text,
        replyTo: turn.replyTo,
        projectContext,
        mirrorRoomId: turn.sessionRoomId,
        mirrorUserMessageId: turn.mirrorUserMessageId,
        mirrorAssistantMessageId: turn.mirrorAssistantMessageId,
        done: null,
      };
      this.active.set(roomId, run);
      this.active.set(run.mirrorRoomId, run);
      this.emit({
        type: 'chat-turn-started',
        turnId: turn.turnId,
        userMessageId: turn.userMessageId,
        assistantMessageId: turn.assistantMessageId,
        roomId,
        agentId: turn.agentId,
        model,
      });
      this.emit({
        type: 'chat-turn-started',
        turnId: turn.turnId,
        userMessageId: turn.mirrorUserMessageId,
        assistantMessageId: turn.mirrorAssistantMessageId,
        roomId: run.mirrorRoomId,
        agentId: turn.agentId,
        model,
      });
      run.done = this.startRun(run);
      await run.done;
    }
  }
}
