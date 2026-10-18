import { FreeLLMAPIError } from './freellmapi-client.mjs';

/** @typedef {Omit<Pick<import('./noema-bridge.d.ts').NoemaRootState,'connected'|'checking'|'models'|'selectedModel'|'error'|'providerConfigured'|'providerBaseUrl'|'providerName'>,'providerName'> & {providerName:string}} SocialProviderState */

function safeError(error) {
  if (error instanceof FreeLLMAPIError) return error.message;
  if (error?.name === 'AbortError') return '已停止生成；已有内容已保留。';
  return '本轮回复没有完成。消息已保留，你可以重试。';
}

/**
 * Sends room-scoped turns to a replaceable chat provider.
 * @param {{store:import('./social-chat-store.mjs').SocialChatStore,provider:import('./freellmapi-client.mjs').FreeLLMAPIClient,secretStore:{isConfigured:()=>boolean},getSelectedModel:()=>string|null,getRootState:()=>Promise<SocialProviderState>,emit?:(event:object)=>void}} options
 */
export class SocialChatService {
  /**
   * @param {{store:import('./social-chat-store.mjs').SocialChatStore,provider:import('./freellmapi-client.mjs').FreeLLMAPIClient,secretStore:{isConfigured:()=>boolean},getSelectedModel:()=>string|null,getRootState:()=>Promise<SocialProviderState>,emit?:(event:object)=>void}} options
   */
  constructor({
    store,
    provider,
    secretStore,
    getSelectedModel,
    getRootState,
    emit = () => {},
  }) {
    this.store = store;
    this.provider = provider;
    this.secretStore = secretStore;
    this.getSelectedModel = getSelectedModel;
    this.getRootState = getRootState;
    this.emit = emit;
    this.active = new Map();
    this.shuttingDown = false;
  }

  async getUiState() {
    const [root, social] = await Promise.all([
      this.getRootState(),
      Promise.resolve(this.store.getSnapshot()),
    ]);
    return {
      connected: root.connected,
      checking: root.checking,
      models: root.models,
      selectedModel: root.selectedModel,
      error: root.error,
      providerConfigured: root.providerConfigured,
      providerBaseUrl: root.providerBaseUrl,
      providerName: 'FreeLLMAPI',
      ...social,
    };
  }

  sendMessage({ roomId, agentId, text }) {
    if (this.shuttingDown) throw new Error('Noema 正在关闭，暂不能发送消息。');
    const model = this.requireReadyModel();
    const turn = this.store.beginTurn({ roomId, agentId, text, model });
    const controller = new AbortController();
    const run = {
      ...turn,
      controller,
      done: null,
    };
    run.done = this.runTurn(run);
    this.active.set(roomId, run);
    this.emit({ type: 'chat-turn-started', ...turn });
    return { turnId: turn.turnId, messageId: turn.assistantMessageId };
  }

  retryReply(messageId) {
    if (this.shuttingDown) throw new Error('Noema 正在关闭，暂不能重试。');
    const model = this.requireReadyModel();
    const turn = this.store.retryReply(messageId, model);
    const controller = new AbortController();
    const run = {
      ...turn,
      assistantMessageId: messageId,
      controller,
      done: null,
    };
    run.done = this.runTurn(run);
    this.active.set(turn.roomId, run);
    this.emit({
      type: 'chat-turn-started',
      turnId: turn.turnId,
      assistantMessageId: messageId,
      roomId: turn.roomId,
      agentId: turn.agentId,
      model,
    });
    return { turnId: turn.turnId, messageId };
  }

  requireReadyModel() {
    if (!this.secretStore.isConfigured()) {
      throw new FreeLLMAPIError(
        'credentials_missing',
        '请先在设置中连接本机 FreeLLMAPI。',
      );
    }
    const model = this.getSelectedModel();
    if (typeof model !== 'string' || !model.trim()) {
      throw new FreeLLMAPIError(
        'model_unavailable',
        '当前没有可用模型。请刷新模型列表后再试。',
      );
    }
    return model;
  }

  async runTurn(run) {
    const { assistantMessageId, roomId, agentId, model, controller } = run;
    try {
      const agent = this.store.getAgent(agentId);
      const messages = [
        { role: 'system', content: agent.systemPrompt },
        ...this.store.getContext(roomId),
      ];
      let content = '';
      for await (const delta of this.provider.streamChat({
        model,
        messages,
        signal: controller.signal,
      })) {
        content += delta;
        this.store.appendAssistantDelta(assistantMessageId, delta);
        this.emit({
          type: 'chat-message-delta',
          roomId,
          messageId: assistantMessageId,
          delta,
        });
      }
      if (!content.trim()) {
        throw new FreeLLMAPIError(
          'empty_reply',
          '模型没有返回文字。这条消息已保留，可以重试。',
        );
      }
      this.store.completeReply(assistantMessageId);
      this.emit({
        type: 'chat-turn-completed',
        roomId,
        messageId: assistantMessageId,
        empty: content.trim().length === 0,
      });
    } catch (error) {
      const interrupted =
        controller.signal.aborted || error?.name === 'AbortError';
      const message = safeError(error);
      if (interrupted) {
        this.store.interruptReply(assistantMessageId);
        this.emit({
          type: 'chat-turn-interrupted',
          roomId,
          messageId: assistantMessageId,
          message,
        });
      } else {
        const code =
          typeof error?.code === 'string' ? error.code : 'chat_error';
        this.store.failReply(assistantMessageId, code, message);
        this.emit({
          type: 'chat-turn-failed',
          roomId,
          messageId: assistantMessageId,
          code,
          message,
        });
      }
    } finally {
      if (this.active.get(roomId) === run) this.active.delete(roomId);
      this.emit({ type: 'chat-state-updated', roomId });
    }
  }

  stopReply(messageId) {
    for (const run of this.active.values()) {
      if (run.assistantMessageId !== messageId) continue;
      run.controller.abort();
      return true;
    }
    return false;
  }

  async shutdown() {
    this.shuttingDown = true;
    const active = [...this.active.values()];
    for (const run of active) run.controller.abort();
    await Promise.allSettled(active.map((run) => run.done));
  }
}
