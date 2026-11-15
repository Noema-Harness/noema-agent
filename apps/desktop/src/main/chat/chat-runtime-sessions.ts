import { NoemaToolSession } from '../mcp/noema-tool-session.ts';
import { ModelProviderError } from '../providers/openai-compatible-client.mjs';
import { createNoemaToolRegistry } from '../runtime/noema-tool-registry.ts';
import type {
  ChatRuntime,
  ChatRuntimeRegistry,
} from '../runtime/chat-runtime-registry.ts';
import { createChatTicketTool } from './chat-ticket-tool.ts';

/** Columns of SocialChatStore.listAgents() this module reads. */
type ListedAgent = { id: string; name: string; archivedAt: string | null };

/** DSH runtimes also own a resumable session; the native runtime does not. */
type SessionChatRuntime = ChatRuntime & {
  resetSession?: () => void;
  invalidateSession?: () => void;
};

export class ChatRuntimeSessions {
  declare chatRuntime: SessionChatRuntime;
  declare chatRuntimes: ChatRuntimeRegistry | null;
  declare nativeChatRuntime: SessionChatRuntime;
  declare store: import('./social-chat-store.mjs').SocialChatStore;
  declare startTicket:
    | Parameters<typeof createChatTicketTool>[0]['startTicket']
    | null;
  declare emit: (event: object) => void;

  constructor({
    chatRuntime,
    chatRuntimes,
    nativeChatRuntime,
    store,
    startTicket,
    emit,
  }: {
    chatRuntime: ChatRuntimeSessions['chatRuntime'];
    chatRuntimes: ChatRuntimeSessions['chatRuntimes'];
    nativeChatRuntime: ChatRuntimeSessions['nativeChatRuntime'];
    store: ChatRuntimeSessions['store'];
    startTicket: ChatRuntimeSessions['startTicket'];
    emit: ChatRuntimeSessions['emit'];
  }) {
    this.chatRuntime = chatRuntime;
    this.chatRuntimes = chatRuntimes;
    this.nativeChatRuntime = nativeChatRuntime;
    this.store = store;
    this.startTicket = startTicket;
    this.emit = emit;
  }

  chatRuntimeFor(agentId: string, roomId: string): SessionChatRuntime {
    if (this.chatRuntimes) {
      return this.chatRuntimes.forMainChat({ agentId, roomId });
    }
    return this.chatRuntime.kind === 'dsh' &&
      agentId === 'noema' &&
      roomId === 'room-noema'
      ? this.chatRuntime
      : this.nativeChatRuntime;
  }

  resetChatSession(agentId = 'noema') {
    if (agentId !== 'noema') {
      throw new Error('只有 Noema 主聊支持重置会话。');
    }
    const runtime = this.chatRuntimeFor(agentId, 'room-noema');
    if (typeof runtime.resetSession === 'function') {
      runtime.resetSession();
    }
    this.store.createConversationBoundary('room-noema');
    this.emit({ type: 'chat-state-updated', roomId: 'room-noema' });
    return true;
  }

  invalidateChatSession(agentId = 'noema', roomId = 'room-noema') {
    const runtime = this.chatRuntimeFor(agentId, roomId);
    if (typeof runtime.invalidateSession === 'function') {
      runtime.invalidateSession();
      return;
    }
    if (typeof runtime.resetSession === 'function') runtime.resetSession();
  }

  createChatTicketSession() {
    if (typeof this.startTicket !== 'function') {
      throw new ModelProviderError(
        'project_work_unavailable',
        '执行者尚未就绪；没有启动任务。',
      );
    }
    const assignees = (this.store.listAgents() as ListedAgent[]).filter(
      (agent) => agent.id !== 'noema' && !agent.archivedAt,
    );
    return new NoemaToolSession({
      registry: createNoemaToolRegistry([
        createChatTicketTool({
          startTicket: this.startTicket,
          availableAssignees: assignees.map((agent) => agent.name),
          resolveAssignee: (name) => {
            const match = assignees.find((agent) => agent.name === name);
            return match?.id ?? null;
          },
        }),
      ]),
    });
  }
}
