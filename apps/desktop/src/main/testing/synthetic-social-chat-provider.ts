export interface SyntheticSocialChatStreamInput {
  model: string;
  messages: object[];
  tools?: object[];
  onToolCalls?: (calls: object[], requestId: string) => void;
  onRouteMetadata?: (route: string | null) => void;
  signal: AbortSignal;
}

export interface SyntheticSocialChatProvider {
  streamChat(input: SyntheticSocialChatStreamInput): AsyncIterable<string>;
}

interface SyntheticSocialChatOptions {
  provider: SyntheticSocialChatProvider;
  store: {
    listAgents(): Array<{
      id: string;
      archivedAt: string | null;
      capabilities: string[];
    }>;
  };
  requests: unknown[];
  e2eValid: boolean;
  liveE2e: boolean;
  e2eModel: string;
  historyRecallMarker: string;
  composerQueueMarker: string;
  delegationMarker: string;
  delegationTask: string;
  delegationResult: string;
}

export function createSyntheticSocialChatProvider(
  options: SyntheticSocialChatOptions,
): SyntheticSocialChatProvider {
  const {
    provider,
    store,
    requests,
    e2eValid,
    liveE2e,
    e2eModel,
    historyRecallMarker,
    composerQueueMarker,
    delegationMarker,
    delegationTask,
    delegationResult,
  } = options;

  if (!e2eValid || liveE2e) {
    if (!liveE2e) return provider;
    return {
      async *streamChat(input) {
        requests.push(input);
        yield* provider.streamChat(input);
      },
    };
  }

  return {
    async *streamChat(input) {
      requests.push(input);
      const messages = input.messages as Array<{
        role: string;
        content: string;
      }>;
      const tools = input.tools as
        | Array<{ function?: { name?: string } }>
        | undefined;
      const latestUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === 'user')?.content;
      if (latestUserMessage?.includes('NOEMA_WORK_ENTRY_')) {
        const latestUserIndex = messages.findLastIndex(
          (message) => message.role === 'user',
        );
        const hasCurrentToolResult = messages
          .slice(latestUserIndex + 1)
          .some((message) => message.role === 'tool');
        if (hasCurrentToolResult) {
          yield 'NOEMA_WORK_ENTRY_TOOL_HANDLED';
          return;
        }
        const workToolAvailable = tools?.some(
          (tool) => tool.function?.name === 'start_project_work',
        );
        if (!workToolAvailable) {
          yield 'NOEMA_WORK_ENTRY_CHAT_ONLY';
          return;
        }
        const executor = store
          .listAgents()
          .find(
            (member) =>
              !member.archivedAt &&
              member.capabilities.includes('project-work'),
          );
        if (!executor) {
          throw new Error(
            'Synthetic workspace-entry E2E could not find an eligible executor.',
          );
        }
        input.onToolCalls?.(
          [
            {
              id: 'e2e-social-work-entry',
              function: {
                name: 'start_project_work',
                arguments: JSON.stringify({
                  agent_id: executor.id,
                  task: latestUserMessage,
                }),
              },
            },
          ],
          '',
        );
        return;
      }
      const history = latestUserMessage?.includes(historyRecallMarker)
        ? messages.find((message) =>
            message.content?.includes('"type":"noema_history_recall"'),
          )
        : undefined;
      if (history) {
        input.onRouteMetadata?.(e2eModel);
        yield '我找到了你提到的旧对话，可以从来源查看原文。';
        return;
      }
      if (latestUserMessage?.includes(composerQueueMarker)) {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        yield '输入区队列布局夹具回复已完成。';
        return;
      }
      const specialistReport = messages.find(
        (message) => message.role === 'tool',
      );
      if (specialistReport) {
        input.onRouteMetadata?.(e2eModel);
        yield `结合工程搭档的协助，我核对了这项信息。${delegationTask} 核对结果：${delegationResult}`;
        return;
      }
      if (latestUserMessage?.includes(delegationMarker)) {
        input.onToolCalls?.(
          [
            {
              id: 'e2e-specialist-delegation',
              function: {
                name: 'delegate_to_specialist',
                arguments: JSON.stringify({
                  agent_id: 'engineering-partner',
                  task: delegationTask,
                }),
              },
            },
          ],
          '',
        );
        return;
      }
      if (latestUserMessage === delegationTask) {
        yield delegationResult;
        return;
      }
      if (latestUserMessage?.includes('今天发生了一件让我有点难受')) {
        yield '听起来这件事还留在你心里。你愿意先讲讲，最难受的是哪一部分吗？';
        return;
      }
      if (latestUserMessage?.includes('想起这件事还是有些不舒服')) {
        yield '它似乎还在影响你。你现在最想先说的是哪一部分？';
        return;
      }
      if (latestUserMessage?.includes('我们再聊一件普通小事')) {
        yield '好啊，说来听听，你想聊什么？';
        return;
      }
      if (latestUserMessage?.includes('请说说这两条消息的重点')) {
        yield '第一条是 OpenAI 的官方发布说明，第二条补充了项目进展；前者说明能力变化，后者说明这些变化怎样影响实际使用。';
        return;
      }
      yield '收到。你想先从哪一部分聊起？';
    },
  };
}
