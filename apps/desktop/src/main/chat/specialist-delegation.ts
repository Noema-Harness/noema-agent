import { ModelProviderError } from '../providers/openai-compatible-client.mjs';

import type { ChatRun } from './chat-run.ts';

type SocialChatStore = import('./social-chat-store.mjs').SocialChatStore;
/** Agent fields this delegation reads (see SocialChatStore.getAgent). */
type Specialist = { id: string; name: string; systemPrompt: string };

export class SpecialistDelegation {
  // The untyped store infers defaults like `senderAgentId = null`,
  // `delegationParentMessageId = null` and `ownAgentId = null` as `null`;
  // they take message/agent IDs.
  declare store: Omit<SocialChatStore, 'beginTurn' | 'getContext'> & {
    beginTurn: (input: {
      roomId: string;
      agentId: string;
      senderAgentId: string;
      text: string;
      model: string;
      delegationParentMessageId: string;
    }) => ReturnType<SocialChatStore['beginTurn']>;
    getContext: (
      roomId: string,
      options: { ownAgentId: string },
    ) => ReturnType<SocialChatStore['getContext']>;
  };
  declare active: Map<string, ChatRun>;
  declare emit: (event: object) => void;
  declare chatRuntimeFor: (
    agentId: string,
    roomId: string,
  ) => { streamChat: (options: object) => AsyncIterable<string> };
  declare recordHandoff: (input: Record<string, unknown>) => unknown;
  declare scheduleInboxes: () => void;
  declare formatError: (error: unknown) => string;

  constructor({
    store,
    active,
    emit,
    chatRuntimeFor,
    recordHandoff,
    scheduleInboxes,
    formatError,
  }: {
    store: SpecialistDelegation['store'];
    active: SpecialistDelegation['active'];
    emit: SpecialistDelegation['emit'];
    chatRuntimeFor: SpecialistDelegation['chatRuntimeFor'];
    recordHandoff: SpecialistDelegation['recordHandoff'];
    scheduleInboxes: SpecialistDelegation['scheduleInboxes'];
    formatError: SpecialistDelegation['formatError'];
  }) {
    this.store = store;
    this.active = active;
    this.emit = emit;
    this.chatRuntimeFor = chatRuntimeFor;
    this.recordHandoff = recordHandoff;
    this.scheduleInboxes = scheduleInboxes;
    this.formatError = formatError;
  }

  async delegateToSpecialist({
    specialist,
    task,
    model,
    parentSignal,
    parentInteractionId,
    parentExecutionId = null,
  }: {
    specialist: Specialist;
    task: string;
    model: string;
    parentSignal: AbortSignal;
    parentInteractionId: string;
    parentExecutionId?: string | null;
  }) {
    const existingHandoff =
      this.store.getSpecialistHandoff(parentInteractionId);
    if (existingHandoff) {
      specialist = existingHandoff.agent;
      task = existingHandoff.task;
      if (existingHandoff.status === 'complete') {
        this.recordHandoff({
          parentExecutionId,
          memberTurnId: existingHandoff.turnId,
          handoffId: existingHandoff.userMessageId,
          memberAgentId: specialist.id,
          parentInteractionId,
          operation: 'handoff.recovered',
          status: 'completed',
        });
        return {
          delivered: true,
          status: 'completed',
          report: existingHandoff.report,
          recovered: true,
        };
      }
    }
    const roomId = this.store.getAgentResidentRoomId(specialist.id);
    if (this.active.has(roomId) || this.store.hasStreamingReply(roomId)) {
      this.recordHandoff({
        parentExecutionId,
        memberTurnId: null,
        memberAgentId: specialist.id,
        parentInteractionId,
        operation: 'handoff.busy',
        status: 'denied',
        errorCode: 'specialist_room_busy',
      });
      return {
        delivered: false,
        status: 'busy',
        report: '联系人常驻私聊正在回复；本次交办未投递。',
      };
    }

    const turn = existingHandoff
      ? {
          ...this.store.retryReply(existingHandoff.assistantMessageId, model),
          assistantMessageId: existingHandoff.assistantMessageId,
        }
      : this.store.beginTurn({
          roomId,
          agentId: specialist.id,
          senderAgentId: 'noema',
          text: task,
          model,
          delegationParentMessageId: parentInteractionId,
        });
    const handoffId = existingHandoff?.userMessageId ?? turn.userMessageId;
    this.recordHandoff({
      parentExecutionId,
      memberTurnId: turn.turnId,
      handoffId,
      memberAgentId: specialist.id,
      parentInteractionId,
      operation: existingHandoff ? 'handoff.retried' : 'handoff.started',
      status: 'running',
    });
    const controller = new AbortController();
    const abortWithParent = () => controller.abort(parentSignal.reason);
    if (parentSignal.aborted) abortWithParent();
    else
      parentSignal.addEventListener('abort', abortWithParent, { once: true });
    const run = { ...turn, roomId, agentId: specialist.id, controller };
    this.active.set(roomId, run);
    this.emit({ type: 'chat-turn-started', ...turn });

    let report = '';
    try {
      const messages = [
        { role: 'system', content: specialist.systemPrompt },
        {
          role: 'system',
          content:
            'Noema 已在你和它的常驻私聊中交办当前任务。该私聊中标记为 [Noema] 的历史消息来自 Noema，而不是人类用户；此前人类与您的对话仍是有效背景。Noema 主聊没有提供给你。完成后直接给 Noema 可核对的结论，并保留不确定性。',
        },
        ...this.store.getContext(roomId, { ownAgentId: specialist.id }),
      ];
      for await (const delta of this.chatRuntimeFor(
        run.agentId,
        run.roomId,
      ).streamChat({
        model,
        messages,
        signal: controller.signal,
        usageOperation: 'specialist_private_handoff',
        usageInteractionId: parentInteractionId,
        usageExecutionId: turn.turnId,
        usageTurnId: turn.turnId,
        usageParentExecutionId: parentExecutionId,
      })) {
        controller.signal.throwIfAborted();
        if (!this.store.appendAssistantDelta(turn.assistantMessageId, delta)) {
          throw new ModelProviderError(
            'reply_not_streaming',
            '专业联系人的回复已停止写入。',
          );
        }
        report += delta;
        this.emit({
          type: 'chat-message-delta',
          roomId,
          messageId: turn.assistantMessageId,
          delta,
        });
      }
      if (!report.trim()) {
        throw new ModelProviderError(
          'empty_reply',
          `「${specialist.name}」没有返回文字。`,
        );
      }
      controller.signal.throwIfAborted();
      if (!this.store.completeReply(turn.assistantMessageId)) {
        throw new ModelProviderError(
          'reply_not_streaming',
          '专业联系人的回复没有完成保存。',
        );
      }
      this.emit({
        type: 'chat-turn-completed',
        roomId,
        messageId: turn.assistantMessageId,
        empty: false,
      });
      this.recordHandoff({
        parentExecutionId,
        memberTurnId: turn.turnId,
        handoffId,
        memberAgentId: specialist.id,
        parentInteractionId,
        operation: 'handoff.completed',
        status: 'completed',
      });
      return { delivered: true, status: 'completed', report };
    } catch (error) {
      if (process.env.NOEMA_SMOKE_TEST === '1') {
        console.error('Noema social turn failed:', error);
      }
      const interrupted =
        controller.signal.aborted ||
        (error as { name?: unknown } | null)?.name === 'AbortError';
      const message = this.formatError(error);
      const code =
        typeof (error as { code?: unknown } | null)?.code === 'string'
          ? (error as { code: string }).code
          : 'chat_error';
      this.recordHandoff({
        parentExecutionId,
        memberTurnId: turn.turnId,
        handoffId,
        memberAgentId: specialist.id,
        parentInteractionId,
        operation: interrupted ? 'handoff.interrupted' : 'handoff.failed',
        status: interrupted ? 'interrupted' : 'failed',
        errorCode: interrupted ? 'reply_interrupted' : code,
      });
      if (interrupted) {
        if (this.store.interruptReply(turn.assistantMessageId)) {
          this.emit({
            type: 'chat-turn-interrupted',
            roomId,
            messageId: turn.assistantMessageId,
            message,
          });
        }
      } else {
        this.store.failReply(turn.assistantMessageId, code, message);
        this.emit({
          type: 'chat-turn-failed',
          roomId,
          messageId: turn.assistantMessageId,
          code,
          message,
        });
      }
      if (parentSignal.aborted) throw error;
      return {
        delivered: true,
        status: interrupted ? 'interrupted' : 'failed',
        report: message,
      };
    } finally {
      parentSignal.removeEventListener('abort', abortWithParent);
      if (this.active.get(roomId) === run) this.active.delete(roomId);
      this.emit({ type: 'chat-state-updated', roomId });
      this.scheduleInboxes();
    }
  }
}
