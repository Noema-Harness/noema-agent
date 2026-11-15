/**
 * Stop/shutdown lifecycle for resident agent runs.
 * Keeps interruption events, partial team formation, and active-run teardown
 * out of the chat service body.
 */
import type { ChatRun } from './chat-run.ts';
import type { ReplyStatusWriter } from './reply-status-writer.ts';
import type { RunMessageWriter } from './run-message-writer.ts';
import type { UserFollowupDelivery } from './user-followup-delivery.ts';

export class ChatLifecycle {
  declare active: Map<string, ChatRun>;
  declare assistantMessageIds: (run: ChatRun) => string[];
  declare appendProjectFormationPartialResult: (run: ChatRun) => boolean;
  declare setRunReplyStatus: ReplyStatusWriter['setRunReplyStatus'];
  declare recordSocialChatEvent: (
    run: ChatRun,
    action: string,
    status: string,
    code?: string | null,
  ) => unknown;
  declare emitRunEvent: RunMessageWriter['emitRunEvent'];
  declare emit: (event: object) => void;
  declare getUserFollowups: () => UserFollowupDelivery;
  declare clearFollowupTimer: () => void;
  declare setShuttingDown: (value: boolean) => void;

  constructor({
    active,
    assistantMessageIds,
    appendProjectFormationPartialResult,
    setRunReplyStatus,
    recordSocialChatEvent,
    emitRunEvent,
    emit,
    getUserFollowups,
    clearFollowupTimer,
    setShuttingDown,
  }: {
    active: ChatLifecycle['active'];
    assistantMessageIds: ChatLifecycle['assistantMessageIds'];
    appendProjectFormationPartialResult: ChatLifecycle['appendProjectFormationPartialResult'];
    setRunReplyStatus: ChatLifecycle['setRunReplyStatus'];
    recordSocialChatEvent: ChatLifecycle['recordSocialChatEvent'];
    emitRunEvent: ChatLifecycle['emitRunEvent'];
    emit: ChatLifecycle['emit'];
    getUserFollowups: ChatLifecycle['getUserFollowups'];
    clearFollowupTimer: ChatLifecycle['clearFollowupTimer'];
    setShuttingDown: ChatLifecycle['setShuttingDown'];
  }) {
    this.active = active;
    this.assistantMessageIds = assistantMessageIds;
    this.appendProjectFormationPartialResult =
      appendProjectFormationPartialResult;
    this.setRunReplyStatus = setRunReplyStatus;
    this.recordSocialChatEvent = recordSocialChatEvent;
    this.emitRunEvent = emitRunEvent;
    this.emit = emit;
    this.getUserFollowups = getUserFollowups;
    this.clearFollowupTimer = clearFollowupTimer;
    this.setShuttingDown = setShuttingDown;
  }

  stopReply(messageId: string) {
    for (const run of this.active.values()) {
      if (!this.assistantMessageIds(run).includes(messageId)) continue;
      const projectFormationInterrupted =
        this.appendProjectFormationPartialResult(run);
      run.controller.abort();
      if (this.setRunReplyStatus(run, 'interrupted')) {
        this.recordSocialChatEvent(
          run,
          'reply.interrupted',
          'interrupted',
          'reply_interrupted',
        );
        this.emitRunEvent(run, 'chat-turn-interrupted', {
          message: projectFormationInterrupted
            ? '团队已建立；共享计划尚未完成，已保留，可在项目群中 @Noema 继续。'
            : '已停止生成；已有内容已保留。',
        });
        this.emit({ type: 'chat-state-updated', roomId: run.roomId });
        if (run.mirrorRoomId)
          this.emit({ type: 'chat-state-updated', roomId: run.mirrorRoomId });
      }
      return true;
    }
    return false;
  }

  async shutdown() {
    this.setShuttingDown(true);
    this.clearFollowupTimer();
    const active = [...this.active.values()];
    for (const run of active) run.controller.abort();
    await Promise.allSettled([
      ...active.map((run) => run.done),
      this.getUserFollowups().stop(),
    ]);
  }
}
